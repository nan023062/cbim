"""Phase 3 — UserPromptSubmit dna bucket carries graph-expanded neighbours.

The hook level only needs three guarantees:

  * ``_recall`` calls search with ``filters={"expand_hops": 1}`` for the
    dna source (and ONLY for dna). Other sources keep the legacy call.
  * The post-expansion bucket is capped at ``_DNA_MAX_HITS``.
  * ``_render_bucket`` annotates expanded neighbours with the
    ``←邻居·hop{n}·via {seed}`` suffix and tags archived/deprecated
    metadata.
"""
from __future__ import annotations

import sys
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


# ---------------------------------------------------------------------------
# _recall sends expand_hops only for dna
# ---------------------------------------------------------------------------


def test_recall_passes_expand_hops_to_dna_only(monkeypatch, tmp_path):
    import cbim_user_prompt_submit as hook

    captured: list[tuple] = []

    class _FakeHit:
        def __init__(self, doc_id: str):
            self._d = {"doc_id": doc_id, "source": "dna",
                       "score": 1.0, "content": "x", "metadata": {}}

        def to_dict(self):
            return self._d

    def fake_search(source, query, **kwargs):
        captured.append((source, kwargs))
        return [_FakeHit(f"{source}-1")]

    import engine.retrieval as retrieval_mod
    monkeypatch.setattr(retrieval_mod, "search", fake_search)

    hook._recall(tmp_path, "anything")

    by_source = {s: kw for s, kw in captured}
    assert "filters" in by_source["dna"]
    assert by_source["dna"]["filters"] == {"expand_hops": 1}
    # Other sources keep the legacy call shape — no filters.
    for other in ("agents", "memory_medium", "transcript"):
        assert "filters" not in by_source[other]


def test_recall_caps_dna_at_max_hits(monkeypatch, tmp_path):
    import cbim_user_prompt_submit as hook

    class _FakeHit:
        def __init__(self, doc_id: str):
            self._d = {"doc_id": doc_id, "source": "dna",
                       "score": 1.0, "content": "x", "metadata": {}}

        def to_dict(self):
            return self._d

    def fake_search(source, query, **kwargs):
        if source == "dna":
            # Return more hits than the cap to force trimming.
            return [_FakeHit(f"d-{i}") for i in range(hook._DNA_MAX_HITS + 5)]
        return []

    import engine.retrieval as retrieval_mod
    monkeypatch.setattr(retrieval_mod, "search", fake_search)

    buckets = hook._recall(tmp_path, "anything")
    assert len(buckets["dna"]) == hook._DNA_MAX_HITS


# ---------------------------------------------------------------------------
# _render_bucket — neighbour annotations + archived tag
# ---------------------------------------------------------------------------


def test_render_bucket_annotates_graph_neighbours():
    import cbim_user_prompt_submit as hook

    hits = [
        {  # primary hit
            "doc_id": "alpha", "source": "dna",
            "score": 1.0, "content": "alpha module.",
            "metadata": {},
        },
        {  # graph neighbour
            "doc_id": "beta", "source": "dna",
            "score": 0.6, "content": "beta module.",
            "metadata": {"expanded_from": "alpha", "hop": 1},
        },
    ]
    out = hook._render_bucket("dna", hits)
    # Primary hit has no neighbour annotation.
    alpha_line = next(line for line in out.splitlines()
                      if "`alpha`" in line)
    assert "←邻居" not in alpha_line
    # Neighbour line carries the annotation.
    beta_line = next(line for line in out.splitlines()
                     if "`beta`" in line)
    assert "←邻居" in beta_line
    assert "hop1" in beta_line
    assert "via alpha" in beta_line


def test_render_bucket_marks_archived_module():
    import cbim_user_prompt_submit as hook

    hits = [
        {
            "doc_id": "old_thing", "source": "dna",
            "score": 0.4, "content": "deprecated.",
            "metadata": {"status": "archived"},
        },
    ]
    out = hook._render_bucket("dna", hits)
    assert "[archived]" in out


def test_render_bucket_marks_archived_neighbour_with_both_annotations():
    import cbim_user_prompt_submit as hook

    hits = [
        {
            "doc_id": "old_dep", "source": "dna",
            "score": 0.3, "content": "x",
            "metadata": {"expanded_from": "current", "hop": 1, "status": "archived"},
        },
    ]
    out = hook._render_bucket("dna", hits)
    assert "←邻居" in out
    assert "[archived]" in out


def test_render_bucket_unaffected_for_non_dna_sources():
    """Backwards compat: non-dna buckets render exactly as before."""
    import cbim_user_prompt_submit as hook

    hits = [
        {
            "doc_id": "m1", "source": "memory_medium",
            "score": 0.7, "content": "decision X",
            "metadata": {},
        },
    ]
    out = hook._render_bucket("memory_medium", hits)
    assert "←邻居" not in out
    assert "[archived]" not in out
    assert "[memory_medium]" in out


# ---------------------------------------------------------------------------
# session_start.ensure_graph wiring
# ---------------------------------------------------------------------------


def test_ensure_graph_creates_graph_when_missing(tmp_path):
    import cbim_session_start as hook

    # Create one .dna/module.md so build_graph has something to walk.
    mod = tmp_path / "modA" / ".dna"
    mod.mkdir(parents=True)
    (mod / "module.md").write_text(
        "---\nname: modA\ndependencies: []\nstatus: implemented\n---\n## Positioning\n\nA.\n",
        encoding="utf-8",
    )
    # Register it so build_graph filters to the registered set.
    from cbi._primitives.modules.registry import update_index
    update_index(tmp_path, ["modA"])

    hook._ensure_graph(tmp_path)

    graph_file = tmp_path / ".cbim" / "index" / "dna" / "graph.json"
    assert graph_file.exists()


def test_ensure_graph_swallows_failure(monkeypatch, tmp_path):
    """Builder explosion must not raise out of the hook."""
    import cbim_session_start as hook

    def _boom(*args, **kwargs):
        raise RuntimeError("simulated builder failure")

    # Monkeypatch the lazy import target.
    import cbi._primitives.modules.graph_builder as gb
    monkeypatch.setattr(gb, "build_graph", _boom)

    # Should not raise.
    hook._ensure_graph(tmp_path)
