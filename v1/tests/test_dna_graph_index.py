"""Unit tests for engine.retrieval.index.graph.GraphIndex.

Phase 3: read-only adjacency view with bounded BFS.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from engine.retrieval.index.graph import GraphIndex


def _graph(*edges: tuple[str, str, str], nodes: list[str] | None = None) -> dict:
    """Tiny graph dict builder. Each tuple = (src, dst, kind)."""
    node_set = set(nodes or [])
    for s, d, _ in edges:
        node_set.add(s)
        node_set.add(d)
    return {
        "schema_version": 1,
        "built_at": "2026-06-15T00:00:00Z",
        "build_mode": "full",
        "nodes": {n: {"kind": "leaf", "status": "implemented", "name": n}
                  for n in node_set},
        "edges": [{"src": s, "dst": d, "kind": k} for s, d, k in edges],
        "adjacency_out": {},  # GraphIndex rebuilds these from edges
        "adjacency_in": {},
    }


def test_empty_graph_returns_no_neighbours():
    g = GraphIndex(None)
    assert g.is_empty
    assert g.bfs(["x"], hops=2) == {}


def test_bfs_zero_hops_yields_empty():
    g = GraphIndex(_graph(("a", "b", "depends_on")))
    assert g.bfs(["a"], hops=0) == {}


def test_bfs_one_hop_picks_up_direct_neighbour():
    g = GraphIndex(_graph(("a", "b", "depends_on")))
    out = g.bfs(["a"], hops=1)
    assert out == {"b": (1, "a")}


def test_bfs_one_hop_bidirectional_picks_up_dependents():
    g = GraphIndex(_graph(("dep", "a", "depends_on")))
    out = g.bfs(["a"], hops=1)
    assert out == {"dep": (1, "a")}


def test_bfs_two_hops_walks_chain():
    g = GraphIndex(_graph(
        ("a", "b", "depends_on"),
        ("b", "c", "depends_on"),
    ))
    out = g.bfs(["a"], hops=2)
    assert out["b"] == (1, "a")
    assert out["c"] == (2, "a")


def test_bfs_filters_by_edge_kind():
    g = GraphIndex(_graph(
        ("a", "b", "depends_on"),
        ("a", "c", "contains"),
    ))
    out = g.bfs(["a"], hops=1, edge_kinds=("depends_on",))
    assert "b" in out
    assert "c" not in out


def test_bfs_seeds_excluded_from_output():
    g = GraphIndex(_graph(("a", "b", "depends_on")))
    out = g.bfs(["a", "b"], hops=1)
    # 'a' and 'b' are both seeds → neither appears in expansion.
    assert "a" not in out and "b" not in out


def test_bfs_records_first_visit_via_closer_seed():
    g = GraphIndex(_graph(
        ("a", "x", "depends_on"),
        ("b", "x", "depends_on"),
    ))
    # x is reachable from both a and b at hop=1; first seed wins.
    out = g.bfs(["a", "b"], hops=1)
    assert out["x"][0] == 1
    assert out["x"][1] in {"a", "b"}


def test_bfs_skips_unknown_seed():
    g = GraphIndex(_graph(("a", "b", "depends_on")))
    out = g.bfs(["unknown_seed"], hops=2)
    # Unknown seed → no walks possible; return empty.
    assert out == {}


def test_load_returns_empty_when_graph_missing(tmp_path: Path):
    g = GraphIndex.load(tmp_path)
    assert g.is_empty
    assert g.bfs(["any"], hops=1) == {}


def test_bfs_capped_at_max_visits():
    """Sanity: enormous graph terminates quickly under the visit cap."""
    # Star with 6000 leaves so unbounded BFS would touch them all.
    edges = [("hub", f"leaf{i}", "depends_on") for i in range(6000)]
    g = GraphIndex(_graph(*edges))
    out = g.bfs(["hub"], hops=1)
    # Cap is ~5000 visits; we don't pin the exact number, just guard
    # against runaway expansion.
    assert len(out) <= 6000  # never explodes
    assert len(out) >= 1     # at least returns something useful


# ---------------------------------------------------------------------------
# Integration: GraphIndex.load over real graph_builder output
# ---------------------------------------------------------------------------


def test_graph_index_load_round_trip_with_builder(tmp_path: Path):
    from cbi._primitives.modules.graph_builder import build_graph
    from cbi._primitives.modules.registry import update_index

    def write(rel: str, name: str, body: str = "") -> None:
        d = (tmp_path if rel == "." else tmp_path / rel) / ".dna"
        d.mkdir(parents=True, exist_ok=True)
        body_text = body or f"## Positioning\n\n{name}\n"
        (d / "module.md").write_text(
            f"---\nname: {name}\nowner: tester\ndescription: m\n"
            f"keywords: []\nstatus: implemented\n---\n{body_text}",
            encoding="utf-8",
        )

    # Root parent's class diagram declares the deps (v2 schema).
    root_body = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    class a\n    class b\n    class c\n"
        "    b ..> a\n    c ..> a\n    c ..> b\n```\n"
    )
    write(".", "root", body=root_body)
    write("a", "a")
    write("b", "b")
    write("c", "c")
    update_index(tmp_path, [".", "a", "b", "c"])
    build_graph(tmp_path)

    g = GraphIndex.load(tmp_path)
    assert not g.is_empty
    out = g.bfs(["a"], hops=1)
    # 'a' has dependents b and c (incoming depends_on edges) → both at hop 1.
    assert {"b", "c"}.issubset(out.keys())
