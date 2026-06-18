"""Tests for the PR-2 header-band weighting (retrieval scheme Y).

Header band = name + description + keywords from the dna frontmatter.
BM25 multiplies header-band token TF by 2; vector path embeds header
separately and search blends ``0.7*cos(q,header) + 0.3*cos(q,body)``.

Non-dna sources are untouched: passing ``header_content`` for any source
other than ``"dna"`` raises RetrievalError.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from cbi._primitives.modules.graph_builder import build_graph
from cbi._primitives.modules.registry import update_index
from engine.retrieval.config import RetrievalConfig
from engine.retrieval.facade import RetrievalError, RetrievalFacade
from engine.retrieval.index.bm25 import BM25Index


# ---------------------------------------------------------------------------
# BM25 unit tests — header_content multiplies tf by 2
# ---------------------------------------------------------------------------


def test_bm25_upsert_without_header_content_unchanged():
    """No header_content → behaves byte-identically to PR-1."""
    bm = BM25Index()
    bm.upsert("doc1", "alpha beta gamma alpha")
    # Two occurrences of "alpha" in body, none in header.
    assert bm.inverted["alpha"]["doc1"] == 2
    assert bm.inverted["beta"]["doc1"] == 1
    assert bm.doc_lengths["doc1"] == 4


def test_bm25_upsert_with_header_doubles_tf():
    """Header tokens get +2 each on top of body counts."""
    bm = BM25Index()
    bm.upsert("doc1", "body has alpha", header_content="alpha")
    # body: alpha 1; header bumps it by +2 → tf=3.
    # Non-header body words ("body", "has") stay at 1 each.
    assert bm.inverted["alpha"]["doc1"] == 3
    assert bm.inverted["body"]["doc1"] == 1
    # doc_length = 3 (body tokens) + 1 token * 2 = 5
    assert bm.doc_lengths["doc1"] == 5


def test_bm25_search_header_match_outranks_body_match():
    """A doc whose header mentions the query outranks one whose body
    mentions it the same number of times."""
    bm = BM25Index()
    # doc_h has "lru" once in the header; doc_b has "lru" once in the body.
    bm.upsert("doc_h", "filler tokens", header_content="lru")
    bm.upsert("doc_b", "lru filler", header_content="other")
    ranked = bm.search("lru", top_k=10)
    ids = [doc_id for doc_id, _ in ranked]
    assert ids[0] == "doc_h", ranked


def test_bm25_search_header_keyword_recoverable_from_body_only_query():
    """Token in header but not body still ranks at top for a header-only
    query — proving the header band injects discoverability."""
    bm = BM25Index()
    bm.upsert("doc_h", "no relevance here", header_content="event-bus pubsub")
    bm.upsert("doc_unrelated", "completely different prose")
    ranked = bm.search("pubsub", top_k=10)
    ids = [doc_id for doc_id, _ in ranked]
    assert ids[0] == "doc_h", ranked


# ---------------------------------------------------------------------------
# Facade integration — null provider (BM25-only)
# ---------------------------------------------------------------------------


def _build_facade(tmp_path: Path) -> RetrievalFacade:
    return RetrievalFacade(tmp_path / ".cbim" / "index", RetrievalConfig())


def test_facade_rejects_header_content_for_non_dna_source(tmp_path):
    f = _build_facade(tmp_path)
    with pytest.raises(RetrievalError, match="header_content"):
        f.index_upsert(
            "agents", "alice", "body",
            header_content="should-fail",
        )


def test_facade_dna_header_outranks_body_match_under_null_provider(tmp_path):
    """End-to-end via the facade with no embedding provider (BM25-only).

    Search for `cache_eviction_policy` finds doc_a (header = the term)
    above doc_b (body mentions cache_eviction_policy once).
    """
    f = _build_facade(tmp_path)
    f.index_upsert(
        "dna", "doc_a", "doc_a body has unrelated prose only.",
        header_content="cache_eviction_policy",
    )
    f.index_upsert(
        "dna", "doc_b",
        "doc_b body talks about cache_eviction_policy in passing.",
        header_content="other-topic",
    )
    hits = f.search("dna", "cache_eviction_policy", top_k=5)
    assert hits, "BM25 must rank at least one hit"
    assert hits[0].doc_id == "doc_a", [h.doc_id for h in hits]


def test_facade_dna_keyword_only_in_header_still_hits(tmp_path):
    """Keyword in the band but not the body is still discoverable."""
    f = _build_facade(tmp_path)
    f.index_upsert(
        "dna", "with_keyword",
        "Body with no keyword in sight.",
        header_content="cool-feature pubsub event-bus",
    )
    f.index_upsert(
        "dna", "no_keyword",
        "Just regular text about other things.",
        header_content="other-topic",
    )
    hits = f.search("dna", "pubsub", top_k=5)
    assert hits
    assert hits[0].doc_id == "with_keyword", [h.doc_id for h in hits]


# ---------------------------------------------------------------------------
# Reindex integration: services._reindex.reindex_dna derives header band
# ---------------------------------------------------------------------------


def test_reindex_dna_passes_header_content_to_facade(monkeypatch, tmp_path):
    """services._reindex.reindex_dna parses frontmatter, builds the
    header band, and forwards it to ``index_upsert`` as
    ``header_content``. Captures the call rather than booting the full
    facade singleton (which would resolve to the wrong project root).
    """
    captured: dict = {}

    def _capture(source, doc_id, content, metadata=None, header_content=None):
        captured["source"] = source
        captured["doc_id"] = doc_id
        captured["content"] = content
        captured["metadata"] = metadata
        captured["header_content"] = header_content

    import engine.retrieval as retrieval_pkg
    monkeypatch.setattr(retrieval_pkg, "index_upsert", _capture)

    # Also patch the patch_graph downstream call so we don't need a
    # full project layout for the graph rebuild path.
    from cbi._primitives.modules import graph_builder
    monkeypatch.setattr(graph_builder, "patch_graph", lambda *a, **k: None)

    root = tmp_path
    mod = root / "alpha"
    (mod / ".dna").mkdir(parents=True)
    (mod / ".dna" / "module.md").write_text(
        "---\n"
        "name: alpha-module\n"
        "owner: tester\n"
        "description: 事件分发\n"
        "keywords:\n"
        "  - event\n"
        "  - pub-sub\n"
        "status: implemented\n"
        "---\n\nbody prose without those terms.\n",
        encoding="utf-8",
    )

    from services._reindex import reindex_dna
    reindex_dna(root, mod)

    assert captured.get("source") == "dna"
    assert captured.get("doc_id") == "alpha"
    band = captured.get("header_content")
    assert band is not None, captured
    # The header band must include the structured frontmatter parts.
    assert "alpha-module" in band
    assert "事件分发" in band
    assert "event" in band
    assert "pub-sub" in band


# ---------------------------------------------------------------------------
# Build helper — header band derivation
# ---------------------------------------------------------------------------


def test_build_dna_header_band_returns_none_for_no_frontmatter():
    from services._reindex import _build_dna_header_band
    assert _build_dna_header_band("just a body, no frontmatter") is None


def test_build_dna_header_band_concatenates_name_description_keywords():
    from services._reindex import _build_dna_header_band
    raw = (
        "---\n"
        "name: alpha\n"
        "description: 事件分发\n"
        "keywords:\n"
        "  - event\n"
        "  - pub-sub\n"
        "---\n\nbody\n"
    )
    band = _build_dna_header_band(raw)
    assert band is not None
    # Order isn't strict but every part must appear.
    assert "alpha" in band
    assert "事件分发" in band
    assert "event" in band
    assert "pub-sub" in band
