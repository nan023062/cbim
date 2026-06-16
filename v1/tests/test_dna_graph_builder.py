"""Unit tests for cbi._primitives.modules.graph_builder.

Phase 3 (DNA business knowledge graph) full-rebuild + patch behaviour.
Hermetic — every fixture builds a tmp_path project, no shared state.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from cbi._primitives.modules.graph_builder import (
    _graph_path,
    build_graph,
    load_graph,
    patch_graph,
)
from cbi._primitives.modules.registry import update_index


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _write_module(
    root: Path,
    rel: str,
    *,
    name: str,
    deps: list[str] | None = None,
    body: str = "",
    status: str = "implemented",
) -> Path:
    """Create root/<rel>/.dna/module.md with the given frontmatter + body."""
    mod_dir = root if rel == "." else root / rel
    dna = mod_dir / ".dna"
    dna.mkdir(parents=True, exist_ok=True)
    deps_yaml = "[]" if not deps else "[" + ", ".join(f'"{d}"' for d in deps) + "]"
    frontmatter = (
        "---\n"
        f"name: {name}\n"
        f"owner: tester\n"
        f"description: test module {name}\n"
        f"keywords: []\n"
        f"dependencies: {deps_yaml}\n"
        f"status: {status}\n"
        "---\n"
    )
    body = body or f"## Positioning\n\n{name} is for testing."
    (dna / "module.md").write_text(frontmatter + body, encoding="utf-8")
    return mod_dir


def _setup_index(root: Path, paths: list[str]) -> None:
    update_index(root, paths)


# ---------------------------------------------------------------------------
# Full-rebuild basics
# ---------------------------------------------------------------------------


def test_build_graph_emits_schema_v1(tmp_path: Path):
    _write_module(tmp_path, "a", name="a", deps=[])
    _write_module(tmp_path, "b", name="b", deps=["a"])
    _setup_index(tmp_path, ["a", "b"])

    g = build_graph(tmp_path)

    assert g["schema_version"] == 1
    assert g["build_mode"] == "full"
    assert "built_at" in g and g["built_at"].endswith("Z")
    assert set(g["nodes"]) == {"a", "b"}
    assert all(
        set(node) >= {"kind", "status", "name"}
        for node in g["nodes"].values()
    )


def test_build_graph_writes_graph_json(tmp_path: Path):
    _write_module(tmp_path, "a", name="a")
    _setup_index(tmp_path, ["a"])

    build_graph(tmp_path)

    out = _graph_path(tmp_path)
    assert out.exists()
    loaded = load_graph(tmp_path)
    assert loaded is not None
    assert "a" in loaded["nodes"]


def test_build_graph_no_modules_yields_empty_nodes(tmp_path: Path):
    g = build_graph(tmp_path)
    assert g["nodes"] == {}
    assert g["edges"] == []


# ---------------------------------------------------------------------------
# depends_on edges (frontmatter)
# ---------------------------------------------------------------------------


def test_build_graph_depends_on_from_frontmatter(tmp_path: Path):
    _write_module(tmp_path, "alpha", name="alpha")
    _write_module(tmp_path, "beta", name="beta", deps=["alpha"])
    _setup_index(tmp_path, ["alpha", "beta"])

    g = build_graph(tmp_path)

    dep_edges = [e for e in g["edges"] if e["kind"] == "depends_on"]
    assert {"src": "beta", "dst": "alpha", "kind": "depends_on"} in dep_edges
    assert g["adjacency_out"]["beta"] == ["alpha"]
    assert g["adjacency_in"]["alpha"] == ["beta"]


def test_build_graph_drops_dep_to_unknown_module(tmp_path: Path):
    """An unregistered dependency target is silently ignored, not synthesised."""
    _write_module(tmp_path, "alpha", name="alpha", deps=["ghost"])
    _setup_index(tmp_path, ["alpha"])

    g = build_graph(tmp_path)

    assert all(e["dst"] != "ghost" for e in g["edges"])
    assert "ghost" not in g["nodes"]


# ---------------------------------------------------------------------------
# contains edges (parent / child paths)
# ---------------------------------------------------------------------------


def test_build_graph_contains_parent_child(tmp_path: Path):
    parent_body = (
        "## Class Diagram\n\n"
        "```mermaid\n"
        "classDiagram\n"
        "    class core\n"
        "    class core_sub\n"
        "```\n"
    )
    _write_module(tmp_path, "core", name="core", body=parent_body)
    _write_module(tmp_path, "core/sub", name="core_sub")
    _setup_index(tmp_path, ["core", "core/sub"])

    g = build_graph(tmp_path)
    contains_edges = [e for e in g["edges"] if e["kind"] == "contains"]
    assert {"src": "core", "dst": "core/sub", "kind": "contains"} in contains_edges


def test_build_graph_contains_skips_unregistered_intermediate(tmp_path: Path):
    """contains hops over unregistered intermediate dirs to the nearest registered ancestor."""
    parent_body = (
        "## Class Diagram\n\n"
        "```mermaid\nclassDiagram\nclass root\n```\n"
    )
    _write_module(tmp_path, ".", name="root", body=parent_body)
    _write_module(tmp_path, "level1/level2/leaf", name="leaf")
    _setup_index(tmp_path, [".", "level1/level2/leaf"])

    g = build_graph(tmp_path)
    # level1 / level1/level2 are NOT registered modules → ".. → leaf" attaches to root.
    assert {"src": ".", "dst": "level1/level2/leaf", "kind": "contains"} in g["edges"]


def test_build_graph_leaf_kind_marked(tmp_path: Path):
    parent_body = "## Class Diagram\n\n```mermaid\nclassDiagram\nclass core\n```\n"
    _write_module(tmp_path, "core", name="core", body=parent_body)
    _write_module(tmp_path, "core/leaf", name="core_leaf")
    _setup_index(tmp_path, ["core", "core/leaf"])

    g = build_graph(tmp_path)
    assert g["nodes"]["core"]["kind"] == "parent"
    assert g["nodes"]["core/leaf"]["kind"] == "leaf"


# ---------------------------------------------------------------------------
# classDiagram ..> arrows
# ---------------------------------------------------------------------------


def test_build_graph_class_diagram_arrow_creates_depends_on(tmp_path: Path):
    parent_body = (
        "## Class Diagram\n\n"
        "```mermaid\n"
        "classDiagram\n"
        "    class svc\n"
        "    class util\n"
        "    svc ..> util\n"
        "```\n"
    )
    _write_module(tmp_path, "core", name="core", body=parent_body)
    _write_module(tmp_path, "core/svc", name="svc")
    _write_module(tmp_path, "core/util", name="util")
    _setup_index(tmp_path, ["core", "core/svc", "core/util"])

    g = build_graph(tmp_path)
    edges = {(e["src"], e["dst"], e["kind"]) for e in g["edges"]}
    assert ("core/svc", "core/util", "depends_on") in edges


def test_build_graph_class_diagram_arrow_with_backticks(tmp_path: Path):
    parent_body = (
        "## Class Diagram\n\n"
        "```mermaid\n"
        "classDiagram\n"
        "    `svc` ..> `util` : uses\n"
        "```\n"
    )
    _write_module(tmp_path, "core", name="core", body=parent_body)
    _write_module(tmp_path, "core/svc", name="svc")
    _write_module(tmp_path, "core/util", name="util")
    _setup_index(tmp_path, ["core", "core/svc", "core/util"])

    g = build_graph(tmp_path)
    edges = {(e["src"], e["dst"], e["kind"]) for e in g["edges"]}
    assert ("core/svc", "core/util", "depends_on") in edges


def test_build_graph_class_diagram_arrow_unknown_name_dropped(tmp_path: Path):
    parent_body = (
        "## Class Diagram\n\n"
        "```mermaid\n"
        "classDiagram\n"
        "    svc ..> ghost_class\n"
        "```\n"
    )
    _write_module(tmp_path, "core", name="core", body=parent_body)
    _write_module(tmp_path, "core/svc", name="svc")
    _setup_index(tmp_path, ["core", "core/svc"])

    g = build_graph(tmp_path)
    assert all(e["dst"] != "ghost_class" for e in g["edges"])


def test_build_graph_leaf_class_diagram_ignored(tmp_path: Path):
    """D7: leaf modules' class diagrams must NOT generate depends_on edges."""
    leaf_body = (
        "## Class Diagram\n\n"
        "```mermaid\n"
        "classDiagram\n"
        "    leafA ..> leafB\n"
        "```\n"
    )
    _write_module(tmp_path, "x", name="leafA", body=leaf_body)
    _write_module(tmp_path, "y", name="leafB")
    _setup_index(tmp_path, ["x", "y"])

    g = build_graph(tmp_path)
    edges = {(e["src"], e["dst"], e["kind"]) for e in g["edges"]}
    assert ("x", "y", "depends_on") not in edges


# ---------------------------------------------------------------------------
# Status / archived modules
# ---------------------------------------------------------------------------


def test_build_graph_archived_module_kept_with_status(tmp_path: Path):
    _write_module(tmp_path, "old", name="old", status="archived")
    _setup_index(tmp_path, ["old"])

    g = build_graph(tmp_path)
    assert "old" in g["nodes"]
    assert g["nodes"]["old"]["status"] == "archived"


# ---------------------------------------------------------------------------
# patch_graph
# ---------------------------------------------------------------------------


def test_patch_graph_falls_back_to_full_when_missing(tmp_path: Path):
    _write_module(tmp_path, "a", name="a")
    _setup_index(tmp_path, ["a"])

    g = patch_graph(tmp_path, tmp_path / "a")
    assert g is not None
    assert "a" in g["nodes"]
    # Full build mode because no prior graph existed.
    assert g["build_mode"] == "full"


def test_patch_graph_replaces_outgoing_edges(tmp_path: Path):
    _write_module(tmp_path, "a", name="a")
    _write_module(tmp_path, "b", name="b", deps=["a"])
    _setup_index(tmp_path, ["a", "b"])
    build_graph(tmp_path)

    # Add a third module 'c' and update b to also depend on c.
    _write_module(tmp_path, "c", name="c")
    _write_module(tmp_path, "b", name="b", deps=["a", "c"])
    _setup_index(tmp_path, ["a", "b", "c"])
    # Patch only 'b' — note 'c' isn't in the prior graph, so its node
    # appears via patch only after we patch c too. We test edge update.
    patch_graph(tmp_path, tmp_path / "c")
    g = patch_graph(tmp_path, tmp_path / "b")

    assert g["build_mode"] == "patch"
    edges = {(e["src"], e["dst"], e["kind"]) for e in g["edges"]}
    assert ("b", "a", "depends_on") in edges
    assert ("b", "c", "depends_on") in edges


def test_patch_graph_does_not_cascade_to_dependents(tmp_path: Path):
    """D9: incoming edges of a patched module are NOT re-cascaded."""
    _write_module(tmp_path, "a", name="a")
    _write_module(tmp_path, "b", name="b", deps=["a"])
    _setup_index(tmp_path, ["a", "b"])
    build_graph(tmp_path)

    # Patch only 'a' — the 'b → a depends_on' edge MUST persist (edge owned by b).
    patch_graph(tmp_path, tmp_path / "a")
    g = load_graph(tmp_path)

    edges = {(e["src"], e["dst"], e["kind"]) for e in g["edges"]}
    assert ("b", "a", "depends_on") in edges


# ---------------------------------------------------------------------------
# Adjacency lists
# ---------------------------------------------------------------------------


def test_build_graph_adjacency_lists_round_trip(tmp_path: Path):
    _write_module(tmp_path, "a", name="a")
    _write_module(tmp_path, "b", name="b", deps=["a"])
    _write_module(tmp_path, "c", name="c", deps=["a"])
    _setup_index(tmp_path, ["a", "b", "c"])

    g = build_graph(tmp_path)
    assert sorted(g["adjacency_in"]["a"]) == ["b", "c"]
    assert g["adjacency_out"]["b"] == ["a"]
    assert g["adjacency_out"]["c"] == ["a"]


# ---------------------------------------------------------------------------
# Performance smoke (1000 modules build < 100ms target)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("n_modules", [200])
def test_build_graph_scales_to_many_modules(tmp_path: Path, n_modules: int):
    """Smoke check: 200 modules build in well under a second.

    The 1000-module / 100ms target lives in the architect's perf spec;
    this is a regression guard against accidental quadratic walks.
    """
    paths: list[str] = []
    for i in range(n_modules):
        rel = f"m{i:04d}"
        deps = [f"m{(i - 1):04d}"] if i > 0 else []
        _write_module(tmp_path, rel, name=rel, deps=deps)
        paths.append(rel)
    _setup_index(tmp_path, paths)

    import time
    t0 = time.perf_counter()
    g = build_graph(tmp_path)
    elapsed = time.perf_counter() - t0

    assert len(g["nodes"]) == n_modules
    # Generous bound: just guard against accidental N^2 behaviour.
    assert elapsed < 5.0, f"build_graph too slow: {elapsed:.2f}s for {n_modules} modules"
