"""Phase 1 (memory v2) — UserPromptSubmit recall injection wiring.

These cover the hook's coordinator-context recall path:

  - ``_recall`` returns a 4-source bucket dict; sources without hits
    come back as empty lists.
  - ``_apply_threshold`` drops below-min hits per source.
  - ``_apply_budget`` honours the priority list and the char budget.
  - ``_render_additional_context`` produces the two-section markdown
    payload (or "" when every bucket is empty).
  - ``main`` emits a JSON object with ``hookEventName="UserPromptSubmit"``
    when there is something to inject; emits nothing when the prompt is
    empty; never raises and always exits 0 even if retrieval blows up.

Performance: the recall pipeline against an isolated index runs in well
under one second.
"""
from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

import pytest


_HOOKS_SRC = Path(__file__).resolve().parent.parent / "kernel" / "project" / "hooks_src"


@pytest.fixture(autouse=True)
def _hooks_on_path():
    s = str(_HOOKS_SRC)
    added = s not in sys.path
    if added:
        sys.path.insert(0, s)
    try:
        yield
    finally:
        if added:
            try:
                sys.path.remove(s)
            except ValueError:
                pass


def _isolate_index_root(monkeypatch, tmp_path: Path) -> Path:
    """Steer engine.retrieval's default facade at a per-test index root."""
    from engine.retrieval import facade as _facade_mod

    index_root = tmp_path / ".cbim" / "index"
    monkeypatch.setattr(_facade_mod, "_resolve_index_root", lambda: index_root)
    _facade_mod.reset_default_facade()
    return index_root


def _seed_dna(content: str = "decision: prefer composition over inheritance") -> None:
    """Index a single DNA doc so dna queries return a real hit."""
    from engine.retrieval import index_upsert

    index_upsert(
        "dna",
        "src/sample",
        content,
        {"source_path": "/proj/src/sample/.dna/module.md"},
    )


# ---------------------------------------------------------------------------
# Pure-function coverage
# ---------------------------------------------------------------------------


def test_recall_returns_four_buckets_with_dna_hit(monkeypatch, tmp_path):
    """_recall returns the canonical bucket shape; only seeded source hits."""
    import cbim_user_prompt_submit as hook

    _isolate_index_root(monkeypatch, tmp_path)
    _seed_dna()

    buckets = hook._recall(tmp_path, "composition inheritance")

    assert set(buckets.keys()) == {"dna", "agents", "memory_medium", "transcript"}
    assert len(buckets["dna"]) >= 1
    first = buckets["dna"][0]
    assert first["doc_id"] == "src/sample"
    assert first["source"] == "dna"
    assert "score" in first and "content" in first
    # Other sources must remain empty (no docs indexed for them).
    assert buckets["agents"] == []
    assert buckets["memory_medium"] == []
    assert buckets["transcript"] == []


def test_recall_blank_prompt_skips_search(monkeypatch, tmp_path):
    """Empty prompt short-circuits — every bucket comes back empty,
    no exceptions, even with a populated index."""
    import cbim_user_prompt_submit as hook

    _isolate_index_root(monkeypatch, tmp_path)
    _seed_dna()

    for prompt in ("", "   ", "\n\t"):
        buckets = hook._recall(tmp_path, prompt)
        assert all(v == [] for v in buckets.values())


def test_apply_threshold_drops_low_scores():
    """Below-min hits are dropped; sources that go empty disappear."""
    import cbim_user_prompt_submit as hook

    raw = {
        "dna": [{"doc_id": "a", "score": 0.0, "content": "x", "source": "dna",
                 "metadata": {}}],
        "agents": [],
        "memory_medium": [
            {"doc_id": "m1", "score": 0.1, "content": "low", "source": "memory_medium",
             "metadata": {}},
            {"doc_id": "m2", "score": 0.5, "content": "high", "source": "memory_medium",
             "metadata": {}},
        ],
        "transcript": [
            {"doc_id": "t1", "score": 0.05, "content": "noise", "source": "transcript",
             "metadata": {}},
        ],
    }
    out = hook._apply_threshold(raw, min_scores=hook._MIN_SCORES)

    # dna keeps its 0.0-score hit (threshold=0.0).
    assert out["dna"][0]["doc_id"] == "a"
    # memory_medium drops m1 (0.1 < 0.3), keeps m2 (0.5 >= 0.3).
    assert [h["doc_id"] for h in out["memory_medium"]] == ["m2"]
    # transcript bucket goes empty -> removed.
    assert "transcript" not in out
    # agents was empty -> removed.
    assert "agents" not in out


def test_apply_budget_priority_crops_lowest():
    """char_budget=200 — dna fits, memory_medium half-fits, transcript dropped."""
    import cbim_user_prompt_submit as hook

    big_body = "X" * 100  # one hit costs ~100 chars + overhead
    raw = {
        "dna": [
            {"doc_id": "d1", "score": 0.9, "content": big_body, "source": "dna",
             "metadata": {}},
        ],
        "agents": [],
        "memory_medium": [
            {"doc_id": "m1", "score": 0.9, "content": big_body, "source": "memory_medium",
             "metadata": {}},
            {"doc_id": "m2", "score": 0.9, "content": big_body, "source": "memory_medium",
             "metadata": {}},
        ],
        "transcript": [
            {"doc_id": "t1", "score": 0.9, "content": big_body, "source": "transcript",
             "metadata": {}},
        ],
    }
    out = hook._apply_budget(raw, char_budget=200, priority=hook._PRIORITY)

    # dna survives; transcript is fully cut.
    assert "dna" in out
    assert [h["doc_id"] for h in out["dna"]] == ["d1"]
    assert "transcript" not in out


def test_apply_budget_dedupes_doc_id():
    """Same doc_id across buckets — only the first (higher-priority) survives."""
    import cbim_user_prompt_submit as hook

    raw = {
        "dna": [{"doc_id": "shared", "score": 0.9, "content": "in dna",
                 "source": "dna", "metadata": {}}],
        "agents": [],
        "memory_medium": [
            {"doc_id": "shared", "score": 0.9, "content": "in mem",
             "source": "memory_medium", "metadata": {}},
        ],
        "transcript": [],
    }
    out = hook._apply_budget(raw, char_budget=10_000, priority=hook._PRIORITY)
    # dna keeps it; memory_medium bucket is dropped (deduped to empty).
    assert "dna" in out
    assert "memory_medium" not in out


def test_render_empty_buckets_returns_empty_string():
    import cbim_user_prompt_submit as hook

    assert hook._render_additional_context({}) == ""
    assert hook._render_additional_context(
        {"dna": [], "agents": [], "memory_medium": [], "transcript": []}
    ) == ""


def test_render_includes_both_sections():
    """Non-empty dna + non-empty memory_medium -> two markdown headings."""
    import cbim_user_prompt_submit as hook

    buckets = {
        "dna": [
            {"doc_id": "src/x", "score": 0.7, "content": "rule body",
             "source": "dna", "metadata": {}},
        ],
        "agents": [],
        "memory_medium": [
            {"doc_id": "2026-06-15-foo", "score": 0.5, "content": "memo body",
             "source": "memory_medium", "metadata": {}},
        ],
        "transcript": [],
    }
    out = hook._render_additional_context(buckets)
    assert "## [CBIM recall] 永久知识" in out
    assert "## [CBIM recall] 相关记忆" in out
    assert "src/x" in out and "2026-06-15-foo" in out


# ---------------------------------------------------------------------------
# main() integration — stdin/stdout capture, exit code, never-raise contract
# ---------------------------------------------------------------------------


def _run_main_with_event(monkeypatch, capsys, event: dict, tmp_path: Path) -> tuple[int, str, str]:
    """Pipe ``event`` into the hook's main() and capture (rc, stdout, stderr)."""
    import cbim_user_prompt_submit as hook

    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(event)))
    # Make sure the kernel bootstrap finds something. The test repo's
    # .cbim/kernel/ already exists at the project root, but main() walks
    # up from cwd to .claude/, so we point cwd at the temp dir and stub
    # bootstrap_kernel to True so the in-process kernel from the parent
    # interpreter remains the one used.
    monkeypatch.setattr(hook, "bootstrap_kernel", lambda root: True)

    rc = hook.main()
    captured = capsys.readouterr()
    return rc, captured.out, captured.err


def test_main_emits_userpromptsubmit_payload_when_recall_hits(monkeypatch, capsys, tmp_path):
    _isolate_index_root(monkeypatch, tmp_path)
    _seed_dna("the team decided to use composition over inheritance")

    rc, stdout, _stderr = _run_main_with_event(
        monkeypatch, capsys,
        {"cwd": str(tmp_path), "prompt": "composition over inheritance"},
        tmp_path,
    )
    assert rc == 0
    assert stdout, "expected an additionalContext payload on stdout"
    payload = json.loads(stdout)
    out_block = payload["hookSpecificOutput"]
    assert out_block["hookEventName"] == "UserPromptSubmit"
    assert out_block["additionalContext"]
    assert "[CBIM recall]" in out_block["additionalContext"]


def test_main_blank_prompt_writes_no_payload(monkeypatch, capsys, tmp_path):
    _isolate_index_root(monkeypatch, tmp_path)
    _seed_dna()

    rc, stdout, _stderr = _run_main_with_event(
        monkeypatch, capsys,
        {"cwd": str(tmp_path), "prompt": ""},
        tmp_path,
    )
    assert rc == 0
    # Empty prompt -> nothing to recall -> no JSON written to stdout.
    assert stdout == ""


def test_main_swallows_retrieval_failure(monkeypatch, capsys, tmp_path):
    """Retrieval blowing up MUST result in rc=0 and no payload — the hook
    cannot block the user prompt under any circumstance."""
    import cbim_user_prompt_submit as hook

    _isolate_index_root(monkeypatch, tmp_path)

    def _boom(*_a, **_kw):
        raise RuntimeError("simulated retrieval crash")

    monkeypatch.setattr(hook, "_recall", _boom)

    rc, stdout, _stderr = _run_main_with_event(
        monkeypatch, capsys,
        {"cwd": str(tmp_path), "prompt": "anything"},
        tmp_path,
    )
    assert rc == 0
    assert stdout == ""


def test_main_handles_oversized_body(monkeypatch, capsys, tmp_path):
    """Indexed body of ~5 MB must not crash and the emitted additionalContext
    must stay under the hard ceiling."""
    import cbim_user_prompt_submit as hook

    _isolate_index_root(monkeypatch, tmp_path)
    huge = "lorem ipsum " * 500_000  # ~6 MB
    from engine.retrieval import index_upsert
    index_upsert("dna", "huge", huge, {"source_path": "/proj/huge/.dna/module.md"})

    rc, stdout, _stderr = _run_main_with_event(
        monkeypatch, capsys,
        {"cwd": str(tmp_path), "prompt": "lorem ipsum"},
        tmp_path,
    )
    assert rc == 0
    if stdout:
        payload = json.loads(stdout)
        ac = payload["hookSpecificOutput"]["additionalContext"]
        # ContextPack R4: rendered text must respect the hard ceiling.
        assert len(ac) <= hook._HARD_CHAR_CEILING


def test_recall_pipeline_under_one_second(monkeypatch, tmp_path):
    """_build_recall_context against an isolated, lightly-populated index
    must complete well under 1 s."""
    import cbim_user_prompt_submit as hook

    _isolate_index_root(monkeypatch, tmp_path)
    _seed_dna()

    start = time.perf_counter()
    out = hook._build_recall_context(tmp_path, "composition inheritance")
    elapsed = time.perf_counter() - start

    assert isinstance(out, str)
    assert elapsed < 1.0, f"recall pipeline too slow: {elapsed:.3f}s"
