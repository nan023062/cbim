"""Phase 3 — facade.search graph-expansion path (filters={"expand_hops":N}).

These tests build a real DNA tree under tmp_path/<root>, run the
graph_builder, then drive RetrievalFacade.search through the
``expand_hops`` directive. The facade is constructed with index_root =
tmp_path/.cbim/index so the GraphIndex.load() pivot through
``index_root.parent.parent`` resolves to the project root.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from cbi._primitives.modules.graph_builder import build_graph
from cbi._primitives.modules.registry import update_index
from engine.retrieval.config import RetrievalConfig
from engine.retrieval.facade import RetrievalError, RetrievalFacade


# ---------------------------------------------------------------------------
# Fixture helper
# ---------------------------------------------------------------------------


def _write_module(root: Path, rel: str, name: str,
                  deps: list[str] | None = None,
                  body_extra: str = "") -> None:
    mod_dir = root if rel == "." else root / rel
    dna = mod_dir / ".dna"
    dna.mkdir(parents=True, exist_ok=True)
    deps_yaml = "[]" if not deps else "[" + ", ".join(f'"{d}"' for d in deps) + "]"
    fm = (
        "---\n"
        f"name: {name}\n"
        f"dependencies: {deps_yaml}\n"
        "status: implemented\n"
        "---\n"
    )
    body = f"## Positioning\n\n{name} module.\n{body_extra}"
    (dna / "module.md").write_text(fm + body, encoding="utf-8")


def _build_test_project(tmp_path: Path) -> tuple[Path, RetrievalFacade]:
    """Three-module project where only the SEED module mentions the query.

    Beta and gamma's bodies use the unique tokens 'betatoken' / 'gammatoken'
    so a search for 'zorblexicon' matches alpha alone — letting us
    actually exercise graph expansion to bring in the dependents.
    Frontmatter ``dependencies`` is kept distinct from the body text so
    BM25 doesn't accidentally co-rank dependents on the seed query.
    """
    root = tmp_path / "proj"
    root.mkdir()
    _write_module(root, "alpha", name="alpha",
                  body_extra="zorblexicon here.")
    _write_module(root, "beta", name="beta", deps=["alpha"],
                  body_extra="betatoken only.")
    _write_module(root, "gamma", name="gamma", deps=["alpha"],
                  body_extra="gammatoken only.")
    update_index(root, ["alpha", "beta", "gamma"])
    build_graph(root)

    facade = RetrievalFacade(root / ".cbim" / "index", RetrievalConfig())
    # Push module bodies into the dna source so search() finds them.
    for path in ("alpha", "beta", "gamma"):
        md = (root / path / ".dna" / "module.md").read_text(encoding="utf-8")
        facade.index_upsert(
            "dna", path, md,
            {"source_path": str(root / path / ".dna" / "module.md")},
        )
    return root, facade


# ---------------------------------------------------------------------------
# Backwards-compat: search without filters is byte-identical to before
# ---------------------------------------------------------------------------


def test_search_without_filters_unchanged(tmp_path):
    _, f = _build_test_project(tmp_path)
    hits = f.search("dna", "zorblexicon")
    ids = [h.doc_id for h in hits]
    assert ids == ["alpha"]
    # No expanded_from / hop metadata may sneak in when filters is absent.
    for h in hits:
        assert "expanded_from" not in h.metadata
        assert "hop" not in h.metadata


# ---------------------------------------------------------------------------
# expand_hops on dna source — picks up neighbours
# ---------------------------------------------------------------------------


def test_expand_hops_returns_dependents_of_seed(tmp_path):
    _, f = _build_test_project(tmp_path)
    hits = f.search("dna", "zorblexicon", filters={"expand_hops": 1})
    ids = [h.doc_id for h in hits]
    # alpha is the only BM25 match; beta/gamma depend on alpha (incoming
    # depends_on edges) → they appear via graph expansion.
    assert "alpha" in ids
    assert "beta" in ids
    assert "gamma" in ids
    # Seeds preserve clean metadata; expansions carry expanded_from + hop.
    seed = next(h for h in hits if h.doc_id == "alpha")
    expanded = next(h for h in hits if h.doc_id == "beta")
    assert "expanded_from" not in seed.metadata
    assert expanded.metadata["expanded_from"] == "alpha"
    assert expanded.metadata["hop"] == 1


def test_expand_hops_seed_score_dominates_neighbour_score(tmp_path):
    _, f = _build_test_project(tmp_path)
    hits = f.search("dna", "zorblexicon", filters={"expand_hops": 1})
    seed_score = next(h.score for h in hits if h.doc_id == "alpha")
    nb_scores = [h.score for h in hits
                 if h.metadata.get("expanded_from") == "alpha"]
    assert nb_scores
    for s in nb_scores:
        assert s < seed_score, (
            f"hop-1 neighbour score {s} should be below seed score {seed_score}"
        )


def test_expand_hops_zero_is_noop(tmp_path):
    _, f = _build_test_project(tmp_path)
    hits_no = f.search("dna", "zorblexicon")
    hits_zero = f.search("dna", "zorblexicon",
                         filters={"expand_hops": 0})
    assert [h.doc_id for h in hits_no] == [h.doc_id for h in hits_zero]


def test_expand_hops_combined_with_metadata_filter(tmp_path):
    """Other filter keys still gate the SEED set by metadata equality.

    Graph expansion runs over the seed set, so a metadata gate that
    eliminates everything but beta yields beta as the seed; expansion
    then pulls in alpha and gamma (beta's neighbours).
    """
    root, f = _build_test_project(tmp_path)
    # Tag beta only.
    md = (root / "beta" / ".dna" / "module.md").read_text(encoding="utf-8")
    f.index_upsert("dna", "beta", md, {
        "source_path": str(root / "beta" / ".dna" / "module.md"),
        "tag": "marked",
    })
    hits = f.search(
        "dna", "betatoken",
        filters={"expand_hops": 1, "tag": "marked"},
    )
    ids = {h.doc_id for h in hits}
    assert "beta" in ids
    # alpha is reachable from beta (beta depends_on alpha) — graph
    # expansion does NOT re-apply the metadata filter to expanded nodes.
    assert "alpha" in ids


# ---------------------------------------------------------------------------
# Negative cases
# ---------------------------------------------------------------------------


def test_expand_hops_on_non_dna_source_raises(tmp_path):
    _, f = _build_test_project(tmp_path)
    f.index_upsert("memory_medium", "m1", "decision content")
    with pytest.raises(RetrievalError):
        f.search("memory_medium", "decision", filters={"expand_hops": 1})


def test_expand_hops_invalid_type_raises(tmp_path):
    _, f = _build_test_project(tmp_path)
    with pytest.raises(RetrievalError):
        f.search("dna", "zorblexicon", filters={"expand_hops": "two"})


def test_expand_hops_negative_raises(tmp_path):
    _, f = _build_test_project(tmp_path)
    with pytest.raises(RetrievalError):
        f.search("dna", "zorblexicon", filters={"expand_hops": -1})


# ---------------------------------------------------------------------------
# graph.json missing → silent degrade to seeds-only
# ---------------------------------------------------------------------------


def test_expand_hops_silently_degrades_when_graph_missing(tmp_path):
    """If graph.json is absent, expansion returns just the seeds."""
    root = tmp_path / "noproj"
    root.mkdir()
    _write_module(root, "alpha", name="alpha")
    update_index(root, ["alpha"])
    # Deliberately skip build_graph(root) — graph.json doesn't exist.

    f = RetrievalFacade(root / ".cbim" / "index", RetrievalConfig())
    md = (root / "alpha" / ".dna" / "module.md").read_text(encoding="utf-8")
    f.index_upsert("dna", "alpha", md,
                   {"source_path": str(root / "alpha" / ".dna" / "module.md")})

    hits = f.search("dna", "alpha", filters={"expand_hops": 1})
    # Seed-only result — no neighbours from a non-existent graph.
    ids = [h.doc_id for h in hits]
    assert ids == ["alpha"]
    # No expansion metadata sneaks in either.
    for h in hits:
        assert "expanded_from" not in h.metadata


# ---------------------------------------------------------------------------
# Public surface zero-change check
# ---------------------------------------------------------------------------


def test_public_search_signature_unchanged():
    import inspect
    from engine.retrieval import search as public_search
    sig = inspect.signature(public_search)
    params = list(sig.parameters.keys())
    assert params == ["source", "query", "top_k", "filters"]
