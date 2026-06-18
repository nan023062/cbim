"""migrate_2_x.py — one-shot v1 -> v2 module.md migration tool.

This is a downstream operations script, NOT a CBIM module. It lives at
``v1/tools/`` and is intentionally outside the kernel package. It re-uses
parser primitives from ``cbi._primitives.modules`` and audit primitives
from ``engine.audit.baseline`` to stay semantically lock-step with the
runtime; it does not duplicate any of that logic.

Step 4 of the migration sprint implements **dry-run** scanning: walk every
``.dna/module.md`` under ``--root`` (default: this script's containing
v1/), compute the per-file change plan, and emit a stdout report.

Step 6 (``--apply``) lands the mechanical residue clean-up that ``dna_edit``
cannot perform from the schema-bound MCP path: physically strip the v2-
deleted ``dependencies`` and ``includeDirs`` frontmatter keys, re-render
the frontmatter in the v2 field order, and refresh the retrieval index.
The body (class diagram, Positioning, Origin Context, Key Decisions, etc.)
is preserved byte-for-byte — apply edits only the leading ``---`` block.

Detection rules per the migration sprint specification (each rule is
"detect, do not edit"):

  1. ``dependencies`` field present  -> plan field removal + count entries
  2. ``includeDirs`` field present   -> plan field removal + non-trivial
                                        entries flagged INCLUDEDIRS_NEEDS_HUMAN
  3. Class-diagram <-> frontmatter equivalence: for every frontmatter
     ``dependencies`` entry, check the parent (or, for non-leaf modules,
     this module's own) classDiagram for a ``..>`` arrow with the same
     (src_path, dst_path). Disagreement -> DIAGRAM_MISMATCH (informational
     only; apply mode does NOT skip these files). The mismatch typically
     means the legacy ``dependencies`` declaration is exactly the kind of
     stale residue the v2 migration removes — stripping the field resolves
     the mismatch at source.
  4. ``description`` missing or empty -> plan placeholder + add to the
                                          human TODO list.
  5. ``keywords`` missing or empty list -> plan ``[TODO]`` placeholder +
                                            add to the TODO list.
  6. ``status`` missing -> plan ``status: implemented`` insertion.
  7. ``links`` left as-is in either direction (loader injects default).

Description over 80 characters is reported (mechanical signal only — we
never rewrite, the human decides during Step 5).

Exit codes
----------
  0  Successful run, even with detected mismatches. Mismatch presence is
     conveyed in the report text, not the exit code, so a CI gate that
     wants to fail on mismatches can grep the report.
  >0 Script-level error (parse failure, IO error, unknown CLI flag).

CLI
---
  --dry-run   default; scan + report only, never writes
  --apply     strip ``dependencies`` / ``includeDirs`` from every
              module.md frontmatter and reindex; body unchanged.
              DIAGRAM_MISMATCH is informational and does NOT cause apply
              to skip a file — v2 deletes the legacy fields outright,
              which resolves the mismatch at the source.
  --root P    project root to scan (default: parent of this script's dir,
              i.e. submodule/cbim/v1). Resolved to absolute; cwd-independent.
"""

from __future__ import annotations

import argparse
import os
import sys
import textwrap
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Bootstrap kernel imports.
# This script lives at ``v1/tools/migrate_2_x.py``; its sibling ``v1/kernel``
# is the kernel package. We push v1/kernel onto sys.path so that
# ``cbi._primitives.modules.*`` and ``engine.audit.baseline`` resolve the
# same way the kernel resolves them itself (kernel root is on sys.path —
# see v1/kernel/context.py kernel_root()).
# ---------------------------------------------------------------------------
_SCRIPT_DIR = Path(__file__).resolve().parent
_V1_DIR = _SCRIPT_DIR.parent
_KERNEL_DIR = _V1_DIR / "kernel"
if str(_KERNEL_DIR) not in sys.path:
    sys.path.insert(0, str(_KERNEL_DIR))

# Re-use, do not re-implement. These are the parsers / scanners /
# constants the migration must agree with bit-for-bit.
from cbi._primitives.modules.graph_builder import (  # noqa: E402
    _extract_mermaid_blocks,
    _parse_class_diagram_deps,
    _parse_placeholder_origins,
)
from cbi._primitives.modules.loader import (  # noqa: E402
    _SCAN_SKIP_DIRS,
    _walk_dna_dirs,
)
from cbi._primitives.modules.frontmatter_schema import (  # noqa: E402
    _MODULE_FM_REQUIRED,
    _MODULE_FM_SCHEMA,
    _MODULE_FM_STATUS_VALUES,
)
from engine.audit.baseline import (  # noqa: E402
    BASELINE_REL_PATH,
    BaselineStore,
)
from services._fm import (  # noqa: E402
    parse_frontmatter,
    render_frontmatter,
    strip_frontmatter,
)
from services._reindex import reindex_dna  # noqa: E402
from atomic_io import atomic_write_text  # noqa: E402


# Tree-dep audit codes the ratchet plan targets. Drawn from
# engine/audit/checks/dna_tree.py docstring; kept in sync manually because
# that module exposes them only through finding emission, not as a tuple.
_TREE_DEP_CODES = frozenset({
    "TREE_DEP_ANCESTOR_DECLARED",
    "TREE_DEP_UP_TREE",
    "TREE_DEP_DANGLING",
})

# Mechanical description length threshold per the migration sprint spec.
# Anything longer is flagged for human rewrite during Step 5; the script
# never truncates.
_DESC_MAX_CHARS = 80


# ---------------------------------------------------------------------------
# Per-module plan dataclass-light (plain dict for stdout serialization ease)
# ---------------------------------------------------------------------------


def _module_path(mod_dir: Path, root: Path) -> str:
    """Return the canonical module path (loader / graph_builder format)."""
    rel = mod_dir.resolve().relative_to(root.resolve()).as_posix()
    return rel or "."


def _direct_parent_path(path: str, all_paths: set[str]) -> str | None:
    """Same semantics as graph_builder._direct_parent — duplicated here
    only to avoid importing a private helper across a module boundary
    that the kernel hasn't exposed yet. Kept literally line-for-line.
    """
    if path == ".":
        return None
    parts = path.split("/")
    for i in range(len(parts) - 1, 0, -1):
        candidate = "/".join(parts[:i])
        if candidate in all_paths:
            return candidate
    if "." in all_paths:
        return "."
    return None


def _is_leaf(path: str, all_paths: set[str]) -> bool:
    """Mirror graph_builder._is_leaf."""
    prefix = (path + "/") if path != "." else ""
    return not any(p != path and p.startswith(prefix) for p in all_paths)


# ---------------------------------------------------------------------------
# Plan computation
# ---------------------------------------------------------------------------


def _scan_modules_for_migration(root: Path) -> list[dict[str, Any]]:
    """Walk root for all .dna/module.md files and parse frontmatter+body.

    Re-uses ``_walk_dna_dirs`` so we hit exactly the same skip rules as
    loader / reindex / graph_builder. Legacy module.json files are
    ignored (out of v2 migration scope; loader still reads them).
    """
    md_dirs, _json_dirs = _walk_dna_dirs(root)
    mods: list[dict[str, Any]] = []
    for mod_dir in md_dirs:
        module_md = mod_dir / ".dna" / "module.md"
        try:
            raw = module_md.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            raise RuntimeError(
                f"failed to read {module_md}: {e}"
            ) from e
        fm = parse_frontmatter(raw)
        body = strip_frontmatter(raw)
        path = _module_path(mod_dir, root)
        mods.append({
            "mod_dir": mod_dir,
            "module_md": module_md,
            "path": path,
            "name": fm.get("name", path),
            "frontmatter": fm,
            "body": body,
            "raw": raw,
        })
    return mods


def _collect_diagram_deps_for_parent(
    parent_body: str,
    name_to_path: dict[str, str],
) -> set[tuple[str, str]]:
    """Resolve every ``..>`` arrow in a parent's classDiagram blocks.

    Returns ``{(src_path, dst_path), ...}`` exactly as graph_builder
    would emit them. Empty set when the body has no classDiagram block
    or no resolvable arrow.
    """
    pairs = _parse_class_diagram_deps(parent_body, name_to_path)
    return set(pairs)


def _has_classdiagram_block(body: str) -> bool:
    """True if at least one ```mermaid``` fenced block declares classDiagram."""
    for block in _extract_mermaid_blocks(body):
        first = next(
            (ln.strip() for ln in block.splitlines() if ln.strip()), ""
        )
        if first.startswith("classDiagram"):
            return True
    return False


def _includedirs_is_trivial(value: Any) -> bool:
    """An ``includeDirs`` entry is 'trivial' when it can be removed without
    human review: missing key, empty list, or a list whose only element is
    ``"."`` (the v1 'mount the module dir itself' shorthand, which v2's
    default ``links: [{kind: local, target: "."}]`` already covers).
    Anything else needs human eyes during Step 5.
    """
    if value is None:
        return True
    if isinstance(value, list):
        if len(value) == 0:
            return True
        if len(value) == 1 and value[0] in (".", "./"):
            return True
    return False


def _build_plan(modules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compute every module's seven-step change plan.

    Returns one dict per module with the action list, mismatch report,
    TODO flags, and would-block decision. No filesystem writes.
    """
    all_paths = {m["path"] for m in modules}
    by_path: dict[str, dict[str, Any]] = {m["path"]: m for m in modules}
    name_to_path = {m["name"]: m["path"] for m in modules if m.get("name")}

    plans: list[dict[str, Any]] = []
    for m in modules:
        path = m["path"]
        fm = m["frontmatter"]
        body = m["body"]
        actions: list[str] = []
        mismatch_entries: list[dict[str, Any]] = []
        todo_description = False
        todo_keywords = False
        description_overflow = False
        includedirs_needs_human = False

        # Step 1: dependencies field present?
        deps_value = fm.get("dependencies")
        if "dependencies" in fm:
            n = len(deps_value) if isinstance(deps_value, list) else 0
            actions.append(f"remove field `dependencies` ({n} entries)")

        # Step 2: includeDirs field present?
        if "includeDirs" in fm:
            inc_value = fm.get("includeDirs")
            n = len(inc_value) if isinstance(inc_value, list) else 0
            actions.append(f"remove field `includeDirs` ({n} entries)")
            if not _includedirs_is_trivial(inc_value):
                includedirs_needs_human = True
                actions.append("INCLUDEDIRS_NEEDS_HUMAN")

        # Step 3: classDiagram <-> frontmatter equivalence.
        # The check fires only when frontmatter actually lists deps; an
        # empty / missing dependencies field can never disagree with the
        # diagram (no frontmatter claims to verify).
        declared = [d for d in (deps_value or []) if isinstance(d, str)]
        if declared:
            # Source of truth for diagram deps:
            #   - parent module's classDiagram (the canonical D7 location)
            #   - PLUS this module's own classDiagram if non-leaf, since
            #     graph_builder treats parents' bodies symmetrically
            #     (see _emit_edges_for_module: "if not is_leaf: body = ...").
            diagram_deps: set[tuple[str, str]] = set()
            parent_path = _direct_parent_path(path, all_paths)
            if parent_path is not None:
                parent_mod = by_path.get(parent_path)
                if parent_mod is not None:
                    diagram_deps |= _collect_diagram_deps_for_parent(
                        parent_mod["body"], name_to_path,
                    )
            if not _is_leaf(path, all_paths):
                diagram_deps |= _collect_diagram_deps_for_parent(
                    body, name_to_path,
                )

            missing_edges: list[str] = []
            for dep in declared:
                if (path, dep) not in diagram_deps:
                    missing_edges.append(dep)
            if missing_edges:
                mismatch_entries.append({
                    "module": path,
                    "parent": parent_path,
                    "frontmatter_deps": list(declared),
                    "diagram_deps_for_module": sorted(
                        d for s, d in diagram_deps if s == path
                    ),
                    "missing": missing_edges,
                    "parent_has_classdiagram": (
                        _has_classdiagram_block(parent_mod["body"])
                        if parent_path and parent_mod else False
                    ),
                })

        # Step 4: description missing/empty?
        desc = fm.get("description") or ""
        if not isinstance(desc, str):
            desc = ""
        if not desc.strip():
            actions.append("insert placeholder `description` -> human TODO")
            todo_description = True
        elif len(desc) > _DESC_MAX_CHARS:
            description_overflow = True

        # Step 5: keywords missing or empty?
        kw = fm.get("keywords")
        if "keywords" not in fm:
            actions.append("insert `keywords: [TODO]` -> human TODO")
            todo_keywords = True
        elif isinstance(kw, list) and len(kw) == 0:
            actions.append(
                "insert `keywords: [TODO]` (currently []) -> human TODO"
            )
            todo_keywords = True

        # Step 6: status missing?
        if "status" not in fm:
            actions.append("insert `status: implemented`")
        elif fm.get("status") not in _MODULE_FM_STATUS_VALUES:
            actions.append(
                f"`status` is `{fm.get('status')}` (not in "
                f"{list(_MODULE_FM_STATUS_VALUES)}) -> human review"
            )

        # Step 7: links — present means leave alone, absent means leave
        # alone (loader injects default). No action either way.

        # NOTE: DIAGRAM_MISMATCH is informational, not apply-blocking.
        # The architect's per-entry adjudication (Step 5) confirmed the
        # three legacy mismatches are exactly stale `dependencies` that
        # should disappear with the field — wrong direction, leaf-tool
        # leak, or already-covered-by-parent edges. v2 deletes the
        # `dependencies` / `includeDirs` fields outright, so apply must
        # process every file unconditionally; mismatches resolve at the
        # source the moment the field is gone. We keep `would_block`
        # in the plan dict for backward dry-run-report compatibility,
        # but it is permanently False.
        would_block = False

        plans.append({
            "path": path,
            "module_md": m["module_md"],
            "actions": actions,
            "mismatch_entries": mismatch_entries,
            "would_block": would_block,
            "todo_description": todo_description,
            "todo_keywords": todo_keywords,
            "description_overflow": description_overflow,
            "description_length": len(desc),
            "includedirs_needs_human": includedirs_needs_human,
        })

    return plans


# ---------------------------------------------------------------------------
# Baseline ratchet plan (READ-ONLY count of would-clear entries)
# ---------------------------------------------------------------------------


def _baseline_ratchet_plan(root: Path) -> dict[str, Any]:
    """Count baseline entries this migration would clear, per code.

    NEVER writes to the baseline file. Returns:
      {
        "baseline_path": Path,
        "exists": bool,
        "by_code": {code: count},
        "total": int,
        "note": str,
      }

    Uses BaselineStore.load() then filters in-memory by ``entry.code``.
    Per the migration sprint spec, ``BaselineStore.clear(checks={"dna_tree"})``
    is forbidden because it would also drop ``TREE_CYCLE`` entries that
    have nothing to do with the v1->v2 migration; we filter strictly to
    the three TREE_DEP_* codes whose underlying conditions go away once
    frontmatter ``dependencies`` is gone.
    """
    # Baseline anchors at the directory containing .cbim/. ``root`` here
    # is whatever the user passed via --root; if no .cbim/ exists under
    # it, BaselineStore.load() will simply return an empty dict.
    store = BaselineStore(root)
    p = root / BASELINE_REL_PATH
    out: dict[str, Any] = {
        "baseline_path": p,
        "exists": store.exists(),
        "by_code": {c: 0 for c in sorted(_TREE_DEP_CODES)},
        "total": 0,
        "note": "",
    }
    if not store.exists():
        out["note"] = (
            "no baseline file at this root — 0 entries clearable. "
            "Baseline is per-project and anchors at the directory "
            "containing .cbim/; v1/ has no runtime .cbim/."
        )
        return out
    entries = store.load()
    for e in entries.values():
        if e.code in _TREE_DEP_CODES:
            out["by_code"][e.code] += 1
            out["total"] += 1
    out["note"] = (
        "would clear by `code`-filtered drop (NOT by check=dna_tree, "
        "which would also drop TREE_CYCLE)."
    )
    return out


# ---------------------------------------------------------------------------
# Report renderer (markdown-ish, plain stdout)
# ---------------------------------------------------------------------------


def _render_report(
    root: Path,
    modules: list[dict[str, Any]],
    plans: list[dict[str, Any]],
    ratchet: dict[str, Any],
) -> str:
    n_total = len(plans)
    n_with_actions = sum(1 for p in plans if p["actions"])
    n_mismatch = sum(1 for p in plans if p["mismatch_entries"])
    todo_desc = [p for p in plans if p["todo_description"]]
    todo_kw = [p for p in plans if p["todo_keywords"]]
    desc_long = [p for p in plans if p["description_overflow"]]
    inc_human = [p for p in plans if p["includedirs_needs_human"]]
    n_would_block = sum(1 for p in plans if p["would_block"])

    out: list[str] = []
    out.append("# module.md v1 -> v2 migration — DRY-RUN report")
    out.append("")
    out.append(f"- root: `{root}`")
    out.append(f"- script: `{Path(__file__).resolve()}`")
    out.append(
        f"- v2 schema fields (in order): {list(_MODULE_FM_SCHEMA)}"
    )
    out.append(
        f"- v2 required fields: {list(_MODULE_FM_REQUIRED)}"
    )
    out.append("")

    # ---------- Summary ----------
    out.append("## Summary")
    out.append("")
    out.append(f"- modules scanned: **{n_total}**")
    out.append(f"- modules with planned changes: **{n_with_actions}**")
    out.append(
        f"- modules with DIAGRAM_MISMATCH (informational only): "
        f"**{n_mismatch}**"
    )
    out.append(
        f"- modules apply would skip: **{n_would_block}** "
        "(apply strips deleted fields unconditionally; "
        "mismatches resolve at the source)"
    )
    out.append(f"- description TODOs (missing/empty): **{len(todo_desc)}**")
    out.append(
        f"- description over {_DESC_MAX_CHARS} chars (rewrite flag): "
        f"**{len(desc_long)}**"
    )
    out.append(f"- keywords TODOs (missing or `[]`): **{len(todo_kw)}**")
    out.append(
        f"- includeDirs needs human review: **{len(inc_human)}**"
    )
    out.append("")

    # ---------- Per-module diff plan ----------
    out.append("## Per-module diff plan")
    out.append("")
    for p in sorted(plans, key=lambda x: x["path"]):
        rel = p["module_md"].resolve()
        try:
            rel = rel.relative_to(root.resolve())
        except ValueError:
            pass
        out.append(f"### `{p['path']}`")
        out.append(f"- file: `{rel}`")
        if p["mismatch_entries"]:
            out.append(
                "- DIAGRAM_MISMATCH present (informational; see Mismatch "
                "report — apply will still strip the legacy field)"
            )
        if not p["actions"]:
            out.append("- planned actions: _(none)_")
        else:
            out.append("- planned actions:")
            for a in p["actions"]:
                out.append(f"  - {a}")
        if p["description_overflow"]:
            out.append(
                f"- description length = {p['description_length']} "
                f"(> {_DESC_MAX_CHARS}): mechanical flag, no truncation"
            )
        out.append("")

    # ---------- Mismatch report ----------
    out.append("## Mismatch report (DIAGRAM_MISMATCH)")
    out.append("")
    if n_mismatch == 0:
        out.append("_No frontmatter <-> classDiagram disagreement detected._")
        out.append("")
    else:
        out.append(
            "Each entry below is a frontmatter `dependencies` claim that "
            "cannot be resolved against the parent's (or this non-leaf "
            "module's own) classDiagram via the same parser graph_builder "
            "uses (`_parse_class_diagram_deps`). The presence of a "
            "classDiagram block alone is not enough — names must resolve "
            "through `name_to_path` (frontmatter `name` -> module path) or "
            "an explicit `class X : .from(...)` placeholder."
        )
        out.append("")
        out.append(
            "**Informational only.** v2 deletes the `dependencies` field "
            "outright; --apply strips it from every module unconditionally, "
            "which makes the mismatch disappear at the source (no class "
            "diagram edit required). The architect's Step 5 adjudication "
            "confirmed each legacy mismatch is exactly the kind of stale "
            "residue the v2 migration removes."
        )
        out.append("")
        for p in sorted(plans, key=lambda x: x["path"]):
            for entry in p["mismatch_entries"]:
                out.append(f"### `{entry['module']}`")
                rel = p["module_md"].resolve()
                try:
                    rel = rel.relative_to(root.resolve())
                except ValueError:
                    pass
                out.append(f"- file: `{rel}`")
                out.append(
                    f"- parent: `{entry['parent'] or '(no parent / root)'}`"
                )
                out.append(
                    f"- parent has classDiagram block: "
                    f"`{entry['parent_has_classdiagram']}`"
                )
                out.append(
                    f"- frontmatter dependencies: "
                    f"{entry['frontmatter_deps']}"
                )
                out.append(
                    f"- diagram deps emanating from this module: "
                    f"{entry['diagram_deps_for_module']}"
                )
                out.append(f"- missing edges: {entry['missing']}")
                out.append("")

    # ---------- Baseline ratchet plan ----------
    out.append("## Baseline ratchet plan")
    out.append("")
    out.append(f"- baseline path: `{ratchet['baseline_path']}`")
    out.append(f"- baseline file exists: `{ratchet['exists']}`")
    out.append(f"- note: {ratchet['note']}")
    out.append(f"- total clearable entries (TREE_DEP_* only): "
               f"**{ratchet['total']}**")
    if ratchet["total"] > 0:
        out.append("- by code:")
        for code, n in sorted(ratchet["by_code"].items()):
            out.append(f"  - `{code}`: {n}")
    out.append("")

    # ---------- TODO list ----------
    out.append("## TODO list (Step 5 human work)")
    out.append("")
    if todo_desc:
        out.append("### description missing / empty")
        for p in sorted(todo_desc, key=lambda x: x["path"]):
            out.append(f"- `{p['path']}`")
        out.append("")
    if desc_long:
        out.append(
            f"### description over {_DESC_MAX_CHARS} chars "
            "(consider rewriting)"
        )
        for p in sorted(desc_long, key=lambda x: x["path"]):
            out.append(
                f"- `{p['path']}` (length = {p['description_length']})"
            )
        out.append("")
    if todo_kw:
        out.append("### keywords missing or `[]`")
        for p in sorted(todo_kw, key=lambda x: x["path"]):
            out.append(f"- `{p['path']}`")
        out.append("")
    if inc_human:
        out.append("### includeDirs needs human review (non-trivial)")
        for p in sorted(inc_human, key=lambda x: x["path"]):
            out.append(f"- `{p['path']}`")
        out.append("")
    if not (todo_desc or desc_long or todo_kw or inc_human):
        out.append("_(no human follow-ups required)_")
        out.append("")

    # ---------- Final verdict ----------
    out.append("## Final verdict")
    out.append("")
    out.append(
        f"**would-apply**: all {n_total} modules will be processed by "
        "the Step 6 apply pass (no skips — DIAGRAM_MISMATCH is "
        "informational, not blocking). Subject only to the Step 5 human "
        "edits for description / keywords / non-trivial includeDirs."
    )
    out.append("")

    return "\n".join(out)


# ---------------------------------------------------------------------------
# Apply mode (Step 6) — strip v2-deleted frontmatter fields, atomic per file
# ---------------------------------------------------------------------------

# Frontmatter keys deleted by the v2 schema (PR-1). Apply mode physically
# removes them; the kernel's `_MODULE_FM_SCHEMA` no longer lists them, so a
# round-trip through `render_frontmatter(meta, _MODULE_FM_SCHEMA)` would
# already drop them — but only AFTER they have been popped from `meta`,
# since the renderer also emits "extra" keys (insertion-order tail) and
# would otherwise preserve them. The migration removes them at source.
_V2_DELETED_FIELDS = ("dependencies", "includeDirs")


def _slice_body_after_frontmatter(raw: str) -> str:
    """Return the substring of `raw` immediately after the closing `---`.

    Mirrors `services._fm.strip_frontmatter` boundary detection but does
    NOT call `.strip()` — apply mode preserves body whitespace verbatim
    (every byte after the closing `---` line, including its trailing
    newline). When `raw` has no frontmatter, the entire `raw` is the body.
    """
    if not raw.startswith("---"):
        return raw
    end = raw.find("\n---", 3)
    if end == -1:
        return raw
    return raw[end + 4:]


def _apply_one(
    module_md: Path,
    raw: str,
    fm: dict[str, Any],
) -> tuple[str, str | None]:
    """Apply v2 frontmatter cleanup to a single module.md.

    Returns (status, error). `status` is one of:
      - "written"      : file was rewritten on disk
      - "skipped_noop" : nothing to drop and re-rendered text matches raw
      - "skipped_mismatch" : caller-side gate; never returned here (apply
        loop screens these out before calling). Kept in the docstring for
        completeness only.

    On error, `status == "error"` and `error` is the OSError string. The
    raw file is left untouched (atomic_write_text rolls back its tmp file).
    """
    new_fm = dict(fm)  # preserve insertion order, drop the stale keys
    dropped: list[str] = []
    for key in _V2_DELETED_FIELDS:
        if key in new_fm:
            new_fm.pop(key)
            dropped.append(key)

    body_tail = _slice_body_after_frontmatter(raw)
    new_text = render_frontmatter(new_fm, _MODULE_FM_SCHEMA) + body_tail

    if new_text == raw:
        # Either no fields to drop, or rendering is already canonical.
        # Don't churn the file.
        return ("skipped_noop", None)

    try:
        atomic_write_text(module_md, new_text)
    except OSError as e:
        return ("error", str(e))
    return ("written", None)


def _run_apply(
    root: Path,
    modules: list[dict[str, Any]],
    plans: list[dict[str, Any]],
) -> dict[str, Any]:
    """Execute apply against every module unconditionally.

    Per the architect's Step 5 adjudication: the v2 schema deletes
    ``dependencies`` and ``includeDirs`` outright, so apply mode strips
    them from every module.md without exception. DIAGRAM_MISMATCH is
    informational (the dry-run report still surfaces it), but it does
    NOT gate apply — those mismatches resolve themselves the moment the
    legacy fields are gone, which is the whole point of the migration.

    Per-file independence:
      - A failure on file N does not abort processing of N+1, N+2, ... .
      - After each successful write, ``services._reindex.reindex_dna``
        is called with the same ``(root, module_dir)`` arguments the
        kernel's ``knowledge_service.edit_module`` uses. Reindex itself
        swallows retrieval-store failures (the dream loop reconciles),
        so we don't wrap it again.

    Returns a summary dict for the apply report.
    """
    written: list[str] = []
    skipped_noop: list[str] = []
    errors: list[tuple[str, str]] = []

    for m in modules:
        path = m["path"]
        module_md: Path = m["module_md"]
        mod_dir: Path = m["mod_dir"]

        status, err = _apply_one(module_md, m["raw"], m["frontmatter"])
        if status == "written":
            written.append(path)
            # Reindex side-effect — same call site `knowledge_service`
            # uses after `edit_module` writes module.md. reindex_dna's
            # own try/except absorbs retrieval-store failures.
            reindex_dna(root, mod_dir)
        elif status == "skipped_noop":
            skipped_noop.append(path)
        else:  # error
            errors.append((path, err or "unknown OSError"))

    return {
        "written": written,
        "skipped_noop": skipped_noop,
        "errors": errors,
    }


def _render_apply_report(
    root: Path,
    summary: dict[str, Any],
) -> str:
    out: list[str] = []
    out.append("# module.md v1 -> v2 migration — APPLY report")
    out.append("")
    out.append(f"- root: `{root}`")
    out.append(f"- script: `{Path(__file__).resolve()}`")
    out.append("")
    out.append("## Summary")
    out.append("")
    out.append(f"- modules rewritten: **{len(summary['written'])}**")
    out.append(
        f"- modules skipped (no v2-deleted fields present): "
        f"**{len(summary['skipped_noop'])}**"
    )
    out.append(f"- write errors: **{len(summary['errors'])}**")
    out.append("")
    if summary["written"]:
        out.append("## Rewritten")
        out.append("")
        for p in sorted(summary["written"]):
            out.append(f"- `{p}`")
        out.append("")
    if summary["errors"]:
        out.append("## Write errors")
        out.append("")
        for p, err in sorted(summary["errors"]):
            out.append(f"- `{p}`: {err}")
        out.append("")
    out.append("## Next steps")
    out.append("")
    out.append(
        "Re-run `python submodule/cbim/v1/tools/migrate_2_x.py --dry-run` "
        "to confirm the residual signal is zero (would-block: 0 / "
        "description over 80: 0 / keywords TODOs: 0)."
    )
    out.append("")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# CLI entry
# ---------------------------------------------------------------------------


def _build_argparser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="migrate_2_x",
        description=textwrap.dedent("""\
            One-shot v1 -> v2 module.md migration tool.

            --dry-run reports the per-file change plan; --apply strips the
            v2-deleted frontmatter fields and reindexes.
        """),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = p.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run", action="store_true", default=True,
        help="default: scan + report only, never writes",
    )
    mode.add_argument(
        "--apply", action="store_true", default=False,
        help=(
            "strip v2-deleted `dependencies` / `includeDirs` keys from "
            "every module.md unconditionally and reindex; body unchanged "
            "(DIAGRAM_MISMATCH is informational, not skipped)"
        ),
    )
    p.add_argument(
        "--root", type=Path, default=None,
        help="project root to scan (default: this script's parent v1/ dir)",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    parser = _build_argparser()
    args = parser.parse_args(argv)

    root = (args.root if args.root is not None else _V1_DIR).resolve()
    if not root.is_dir():
        print(f"error: --root {root} is not a directory", file=sys.stderr)
        return 2

    try:
        modules = _scan_modules_for_migration(root)
        plans = _build_plan(modules)
        if args.apply:
            summary = _run_apply(root, modules, plans)
            report = _render_apply_report(root, summary)
            # Surface a non-zero exit when any per-file write failed so
            # CI / shell wrappers can detect it without parsing stdout.
            apply_exit = 4 if summary["errors"] else 0
        else:
            ratchet = _baseline_ratchet_plan(root)
            report = _render_report(root, modules, plans, ratchet)
            apply_exit = 0
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 3
    # Re-encode for stdout safety on Windows consoles whose default
    # codepage may not be utf-8 (the report uses backticks, arrows, etc.
    # — all ASCII, but emit bytes via sys.stdout.buffer to bypass any
    # locale weirdness).
    try:
        sys.stdout.write(report)
        if not report.endswith("\n"):
            sys.stdout.write("\n")
        sys.stdout.flush()
    except UnicodeEncodeError:
        sys.stdout.buffer.write(report.encode("utf-8"))
        if not report.endswith("\n"):
            sys.stdout.buffer.write(b"\n")
        sys.stdout.buffer.flush()
    return apply_exit


if __name__ == "__main__":
    raise SystemExit(main())
