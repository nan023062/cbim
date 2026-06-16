#!/usr/bin/env python3
"""UserPromptSubmit hook — in-process bridge to kernel.

Phase 1 of the memory v2 redesign (see v1/docs/MEMORY-REDESIGN.zh-CN.md
section 6 / phase 1) injects a 4-source recall into the **coordinator's
main context** through `additionalContext`. Sub-agents do NOT inherit
this injection — their per-prompt recall is handled by the BT
ContextRetrieval node (kept for the architect's `module_knowledge`
audience). Audience boundary is fixed: this hook serves the coordinator
only.

Failure-safety contract (highest priority):

  * Any exception inside recall MUST result in an empty additionalContext
    and exit 0; the hook MUST NEVER block the prompt or exit non-zero.
  * Every retrieval call goes through ``safe_run`` so a broken provider
    silently degrades to "no recall this turn".
"""
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _lib.event_io import read_event, write_additional_context
from _lib.paths import project_root_from_cwd
from _lib.bridge import bootstrap_kernel, safe_run

# ---------------------------------------------------------------------------
# Recall configuration — module-level constants (no config file read).
# ---------------------------------------------------------------------------

# Per-source top-K passed to engine.retrieval.search.
_TOP_K_PER_SOURCE = 5

# Phase 3: dna source supports graph expansion. Seeds are still
# top_k=5; one BFS hop on each seed can drag in dependents / parent /
# children, which would blow past the per-bucket budget if we let it.
# Cap the post-expansion hit list at _DNA_MAX_HITS so the bucket stays
# bounded — seeds-first ordering means the cut, when it bites, drops
# only graph neighbours, never primary BM25/vector hits.
_DNA_MAX_HITS = 12

# Hop budget for the dna source; matches architect decision D3.
# Hop=1 picks up direct dependencies, dependents, the immediate parent,
# and direct children — the relevant first-degree context — without
# blowing the recall window. Hop=2 was discussed but deferred.
_DNA_EXPAND_HOPS = 1

# Whole-injection character budget. Claude Code's documented limit on
# additionalContext is 10_000 chars; we leave a 20% margin.
_CHAR_BUDGET = 8000

# Hard cap applied AFTER rendering as a last-resort guard. Keeps the
# emitted JSON well under the platform limit even when the per-bucket
# accountant is wrong (defence in depth — see Phase 1 ContextPack R4).
_HARD_CHAR_CEILING = 10_000
_HARD_CHAR_TRUNCATE_TO = 9_800

# Per-source minimum score gate. dna / agents are stable knowledge so we
# accept anything the index ranks; memory_medium / transcript are noisier
# so we drop low-score matches to keep the injection clean.
_MIN_SCORES = {
    "dna": 0.0,
    "agents": 0.0,
    "memory_medium": 0.3,
    "transcript": 0.3,
}

# Bucket priority — earlier entries get budget first; the last bucket is
# the first to be cropped or dropped when budget runs out.
_PRIORITY = ["dna", "agents", "memory_medium", "transcript"]

# Per-hit body summary length in characters. Keeps each line short enough
# that a top-K=5 bucket fits comfortably under any single bucket budget.
_BODY_SUMMARY_CHARS = 240


# ---------------------------------------------------------------------------
# Pre-existing housekeeping (unchanged).
# ---------------------------------------------------------------------------


def _mark_busy(root: Path) -> None:
    cbim = root / ".cbim"
    cbim.mkdir(parents=True, exist_ok=True)
    (cbim / ".cc-status").write_text(
        f"busy {datetime.now().isoformat()}\n", encoding="utf-8"
    )


def _log_user(root: Path, prompt: str, transcript_path: str) -> None:
    from engine.logger import log_user
    log_user(prompt, cbim=root / ".cbim", transcript_path=transcript_path)


# ---------------------------------------------------------------------------
# Recall pipeline — pure functions; ``main`` orchestrates with safe_run.
# ---------------------------------------------------------------------------


def _recall(root: Path, prompt: str) -> dict:
    """Run engine.retrieval.search across the four canonical sources.

    Returns a bucket dict keyed by source name with the per-source hit
    list (each hit is the ``Hit.to_dict()`` shape). Empty / blank prompt
    short-circuits to empty buckets — search is skipped entirely so the
    BM25 path doesn't waste cycles tokenising whitespace.

    Failures (unknown source, missing index, embedding crash, etc.) are
    swallowed per source: that bucket comes back empty, the others still
    run. Never raises.
    """
    buckets: dict[str, list[dict]] = {s: [] for s in _PRIORITY}
    query = (prompt or "").strip()
    if not query:
        return buckets

    try:
        from engine.retrieval import search as _search
    except (ImportError, ModuleNotFoundError):
        return buckets

    for source in _PRIORITY:
        # Phase 3: dna source uses graph expansion. expand_hops=1 walks
        # depends_on + contains edges from each seed once, so we surface
        # the seed's dependencies, dependents, parent, and direct
        # children alongside the BM25/vector hits.
        kwargs: dict = {"top_k": _TOP_K_PER_SOURCE}
        if source == "dna":
            kwargs["filters"] = {"expand_hops": _DNA_EXPAND_HOPS}
        try:
            hits = _search(source, query, **kwargs)
        except Exception:  # noqa: BLE001 — per-source failure must not stop the others
            continue
        try:
            hit_dicts = [h.to_dict() for h in hits or []]
        except Exception:  # noqa: BLE001 — defensive: malformed Hit object
            hit_dicts = []
        if source == "dna" and len(hit_dicts) > _DNA_MAX_HITS:
            # Seeds-first ordering preserved by facade — slicing keeps
            # primary hits and trims the longest-tail neighbours.
            hit_dicts = hit_dicts[:_DNA_MAX_HITS]
        buckets[source] = hit_dicts
    return buckets


def _apply_threshold(buckets: dict, *, min_scores: dict) -> dict:
    """Drop hits below the source-specific minimum score; remove empty buckets."""
    out: dict[str, list[dict]] = {}
    for source, hits in buckets.items():
        threshold = min_scores.get(source, 0.0)
        kept = [h for h in hits if float(h.get("score", 0.0) or 0.0) >= threshold]
        if kept:
            out[source] = kept
    return out


def _apply_budget(buckets: dict, *, char_budget: int, priority: list) -> dict:
    """Allocate ``char_budget`` across buckets in ``priority`` order.

    Within a bucket, hits are taken in their incoming order; duplicate
    ``doc_id``s across buckets are collapsed (first occurrence wins —
    higher-priority bucket retains the hit).

    Per-hit cost is ``len(metadata['source_path'] or doc_id) +
    min(len(content), _BODY_SUMMARY_CHARS)`` plus a small fixed overhead
    for separators. When a hit doesn't fit, we stop *that* bucket and
    move to the next priority class.
    """
    out: dict[str, list[dict]] = {}
    seen_ids: set[str] = set()
    spent = 0
    fixed_overhead_per_hit = 8  # bullet + spacing + score badge

    for source in priority:
        hits = buckets.get(source) or []
        kept: list[dict] = []
        for h in hits:
            doc_id = str(h.get("doc_id") or "")
            if doc_id and doc_id in seen_ids:
                continue
            label_len = len(doc_id) or 1
            body = (h.get("content") or "")[:_BODY_SUMMARY_CHARS]
            cost = label_len + len(body) + fixed_overhead_per_hit
            if spent + cost > char_budget:
                # Bucket budget exhausted — defer to next-priority bucket.
                break
            kept.append(h)
            seen_ids.add(doc_id)
            spent += cost
        if kept:
            out[source] = kept
        if spent >= char_budget:
            break
    return out


def _summarise_body(content: str) -> str:
    body = (content or "").strip()
    if len(body) > _BODY_SUMMARY_CHARS:
        body = body[: _BODY_SUMMARY_CHARS - 1] + "…"
    # Collapse internal newlines so the bullet stays on a single rendered line.
    return body.replace("\r", " ").replace("\n", " ")


def _render_bucket(source: str, hits: list[dict]) -> str:
    lines: list[str] = []
    for h in hits:
        doc_id = h.get("doc_id") or "?"
        score = float(h.get("score", 0.0) or 0.0)
        body = _summarise_body(h.get("content") or "")
        md = h.get("metadata") or {}
        # Phase 3: tag dna graph-expansion neighbours and archived modules
        # so the coordinator can see at a glance whether a hit is a primary
        # BM25/vector match or a graph neighbour pulled in alongside.
        annotations: list[str] = []
        expanded_from = md.get("expanded_from")
        if expanded_from:
            hop = md.get("hop")
            hop_text = f"hop{hop}" if hop is not None else "hop"
            annotations.append(f"←邻居·{hop_text}·via {expanded_from}")
        # Archived / deprecated modules carry their lifecycle status in
        # the dna source metadata via the upstream graph node — but the
        # current dna upsert doesn't propagate ``status`` into the
        # retrieval record's metadata. Surface the marker if it does
        # exist (forward-compat) so renderers don't grow a separate
        # path the day status is added.
        status = md.get("status")
        if status in ("archived", "deprecated"):
            annotations.append(f"[{status}]")
        suffix = (" " + " ".join(annotations)) if annotations else ""
        lines.append(
            f"- [{source}] `{doc_id}`{suffix} (score={score:.2f}) — {body}"
        )
    return "\n".join(lines)


def _render_additional_context(buckets: dict) -> str:
    """Render two markdown sections: permanent knowledge + relevant memory.

    Returns an empty string when every bucket is empty so the caller can
    skip writing additionalContext entirely (the hook MUST emit nothing
    rather than an empty payload, to keep CC's `additionalContext` log
    clean of zero-content entries).
    """
    if not any(buckets.get(s) for s in _PRIORITY):
        return ""

    perm_sections: list[str] = []
    if buckets.get("dna"):
        perm_sections.append(_render_bucket("dna", buckets["dna"]))
    if buckets.get("agents"):
        perm_sections.append(_render_bucket("agents", buckets["agents"]))

    mem_sections: list[str] = []
    if buckets.get("memory_medium"):
        mem_sections.append(_render_bucket("memory_medium", buckets["memory_medium"]))
    if buckets.get("transcript"):
        mem_sections.append(_render_bucket("transcript", buckets["transcript"]))

    parts: list[str] = []
    if perm_sections:
        parts.append("## [CBIM recall] 永久知识\n\n" + "\n".join(perm_sections))
    if mem_sections:
        parts.append("## [CBIM recall] 相关记忆\n\n" + "\n".join(mem_sections))

    text = "\n\n".join(parts)
    # Hard ceiling guard — second of two budget gates.
    if len(text) > _HARD_CHAR_CEILING:
        text = text[:_HARD_CHAR_TRUNCATE_TO] + "\n…[truncated]"
    return text


def _build_recall_context(root: Path, prompt: str) -> str:
    """Orchestrate recall → threshold → budget → render. Pure function."""
    buckets = _recall(root, prompt)
    buckets = _apply_threshold(buckets, min_scores=_MIN_SCORES)
    buckets = _apply_budget(buckets, char_budget=_CHAR_BUDGET, priority=_PRIORITY)
    return _render_additional_context(buckets)


def main() -> int:
    event = read_event()
    cwd = event.get("cwd") or "."
    prompt = event.get("prompt", "") or ""
    transcript_path = event.get("transcript_path", "") or ""
    root = project_root_from_cwd(cwd)

    if not bootstrap_kernel(root):
        return 0

    safe_run(lambda: _mark_busy(root), on_error_label="user_prompt.mark_busy")
    safe_run(
        lambda: _log_user(root, prompt, transcript_path),
        on_error_label="user_prompt.log_user",
    )

    text = safe_run(
        lambda: _build_recall_context(root, prompt),
        on_error_label="user_prompt.recall",
    )
    if text:
        write_additional_context(text, event_name="UserPromptSubmit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
