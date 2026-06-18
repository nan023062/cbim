"""Unit tests for cbi._primitives.modules.graph_builder.

Phase 3 (DNA business knowledge graph) full-rebuild + patch behaviour.
Hermetic — every fixture builds a tmp_path project, no shared state.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from cbi._primitives.modules.graph_builder import (
    _graph_path,
    _parse_placeholder_origins,
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
    """Create root/<rel>/.dna/module.md with v2 frontmatter + body.

    The legacy ``deps`` parameter is preserved for signature stability
    but no longer writes a frontmatter ``dependencies`` field — v2
    sources deps from the parent's class diagram. Tests that rely on
    deps must seed them via the parent's ``body`` instead.
    """
    mod_dir = root if rel == "." else root / rel
    dna = mod_dir / ".dna"
    dna.mkdir(parents=True, exist_ok=True)
    frontmatter = (
        "---\n"
        f"name: {name}\n"
        f"owner: tester\n"
        f"description: test module {name}\n"
        f"keywords: []\n"
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
    _write_module(tmp_path, "a", name="a")
    _write_module(tmp_path, "b", name="b")
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
# depends_on edges (parent class diagram — sole authoritative source)
# ---------------------------------------------------------------------------


def test_build_graph_depends_on_from_parent_diagram(tmp_path: Path):
    """v2: deps come from the parent module's classDiagram ..> arrows."""
    parent_body = (
        "## Class Diagram\n\n"
        "```mermaid\nclassDiagram\n"
        "    class alpha\n"
        "    class beta\n"
        "    beta ..> alpha\n"
        "```\n"
    )
    _write_module(tmp_path, ".", name="root", body=parent_body)
    _write_module(tmp_path, "alpha", name="alpha")
    _write_module(tmp_path, "beta", name="beta")
    _setup_index(tmp_path, [".", "alpha", "beta"])

    g = build_graph(tmp_path)

    dep_edges = [e for e in g["edges"] if e["kind"] == "depends_on"]
    assert {"src": "beta", "dst": "alpha", "kind": "depends_on"} in dep_edges
    assert g["adjacency_out"]["beta"] == ["alpha"]
    assert "beta" in g["adjacency_in"]["alpha"]


def test_build_graph_drops_dep_to_unknown_module(tmp_path: Path):
    """An unregistered diagram arrow target is silently dropped, not synthesised."""
    parent_body = (
        "## Class Diagram\n\n"
        "```mermaid\nclassDiagram\n"
        "    class alpha\n"
        "    alpha ..> ghost\n"
        "```\n"
    )
    _write_module(tmp_path, ".", name="root", body=parent_body)
    _write_module(tmp_path, "alpha", name="alpha")
    _setup_index(tmp_path, [".", "alpha"])

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
    """Patching the parent module updates its diagram-derived edges."""
    parent_body_v1 = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    class a\n    class b\n    b ..> a\n```\n"
    )
    _write_module(tmp_path, ".", name="root", body=parent_body_v1)
    _write_module(tmp_path, "a", name="a")
    _write_module(tmp_path, "b", name="b")
    _setup_index(tmp_path, [".", "a", "b"])
    build_graph(tmp_path)

    # Add a third module 'c' and update root diagram so b depends on a AND c.
    parent_body_v2 = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    class a\n    class b\n    class c\n"
        "    b ..> a\n    b ..> c\n```\n"
    )
    _write_module(tmp_path, "c", name="c")
    _write_module(tmp_path, ".", name="root", body=parent_body_v2)
    _setup_index(tmp_path, [".", "a", "b", "c"])
    # Patch the root (which carries the diagram). c gets patched first
    # so the registry knows about it before we recompute root's edges.
    patch_graph(tmp_path, tmp_path / "c")
    g = patch_graph(tmp_path, tmp_path)

    assert g["build_mode"] == "patch"
    edges = {(e["src"], e["dst"], e["kind"]) for e in g["edges"]}
    assert ("b", "a", "depends_on") in edges
    assert ("b", "c", "depends_on") in edges


def test_patch_graph_does_not_cascade_to_dependents(tmp_path: Path):
    """D9: incoming edges of a patched module are NOT re-cascaded.

    Edges from a parent diagram are owned by the parent's node entry; if
    we patch a *leaf* (``a``), the parent-owned ``b ..> a`` edge survives
    because the parent isn't re-scanned.
    """
    parent_body = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    class a\n    class b\n    b ..> a\n```\n"
    )
    _write_module(tmp_path, ".", name="root", body=parent_body)
    _write_module(tmp_path, "a", name="a")
    _write_module(tmp_path, "b", name="b")
    _setup_index(tmp_path, [".", "a", "b"])
    build_graph(tmp_path)

    patch_graph(tmp_path, tmp_path / "a")
    g = load_graph(tmp_path)

    edges = {(e["src"], e["dst"], e["kind"]) for e in g["edges"]}
    assert ("b", "a", "depends_on") in edges


# ---------------------------------------------------------------------------
# Adjacency lists
# ---------------------------------------------------------------------------


def test_build_graph_adjacency_lists_round_trip(tmp_path: Path):
    parent_body = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    class a\n    class b\n    class c\n"
        "    b ..> a\n    c ..> a\n```\n"
    )
    _write_module(tmp_path, ".", name="root", body=parent_body)
    _write_module(tmp_path, "a", name="a")
    _write_module(tmp_path, "b", name="b")
    _write_module(tmp_path, "c", name="c")
    _setup_index(tmp_path, [".", "a", "b", "c"])

    g = build_graph(tmp_path)
    # adjacency_in["a"] includes both the depends_on neighbours (b, c)
    # AND the structural contains edge from root (".") — graph mixes
    # both edge kinds in adjacency lists, see graph_builder.py D1.
    dep_in_a = {
        e["src"] for e in g["edges"]
        if e["dst"] == "a" and e["kind"] == "depends_on"
    }
    assert dep_in_a == {"b", "c"}
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

    Edges are declared in the root parent's class diagram (v2: deps come
    from parent diagrams, not frontmatter).
    """
    paths: list[str] = [".", *(f"m{i:04d}" for i in range(n_modules))]
    diagram_lines = ["## Class Diagram", "", "```mermaid", "classDiagram"]
    for i in range(n_modules):
        diagram_lines.append(f"    class m{i:04d}")
    for i in range(1, n_modules):
        diagram_lines.append(f"    m{i:04d} ..> m{(i - 1):04d}")
    diagram_lines.append("```")
    parent_body = "\n".join(diagram_lines) + "\n"
    _write_module(tmp_path, ".", name="root", body=parent_body)
    for i in range(n_modules):
        rel = f"m{i:04d}"
        _write_module(tmp_path, rel, name=rel)
    _setup_index(tmp_path, paths)

    import time
    t0 = time.perf_counter()
    g = build_graph(tmp_path)
    elapsed = time.perf_counter() - t0

    # +1 for the root parent itself.
    assert len(g["nodes"]) == n_modules + 1
    # Generous bound: just guard against accidental N^2 behaviour.
    assert elapsed < 5.0, f"build_graph too slow: {elapsed:.2f}s for {n_modules} modules"


# ---------------------------------------------------------------------------
# PR-1: cross-tree placeholder origin resolution
# ---------------------------------------------------------------------------


def test_parse_placeholder_origins_extracts_id_to_path_map():
    """``class <id> : .from(<path>)`` annotation is parsed into a dict."""
    body = (
        "## Class Diagram\n\n"
        "```mermaid\n"
        "classDiagram\n"
        "    %% --- 1. 直接管辖节点 ---\n"
        "    class src { <<module>> }\n"
        "    %% --- 2. 跨树占位节点 ---\n"
        "    class submodule_cbim_v2 { <<module>> }\n"
        "    class submodule_cbim_v2 : .from(submodule/cbim/v2)\n"
        "    class packages_core_event-bus { <<module>> }\n"
        "    class packages_core_event-bus : .from(packages/core/event-bus)\n"
        "```\n"
    )
    origins = _parse_placeholder_origins(body)
    assert origins == {
        "submodule_cbim_v2": "submodule/cbim/v2",
        "packages_core_event-bus": "packages/core/event-bus",
    }


def test_parse_placeholder_origins_ignores_non_classdiagram_blocks():
    """Annotations outside ``classDiagram`` blocks are ignored."""
    body = (
        "## Diagram\n\n"
        "```mermaid\n"
        "graph TD\n"
        "    class submodule_cbim_v2 : .from(submodule/cbim/v2)\n"
        "```\n"
    )
    assert _parse_placeholder_origins(body) == {}


def test_build_graph_cross_tree_placeholder_resolves_to_real_path(tmp_path: Path):
    """Parent's class diagram with cross-tree placeholder + .from annotation
    yields a depends_on edge whose endpoint is the *real* remote path,
    not the placeholder id.
    """
    parent_body = (
        "## Class Diagram\n\n"
        "```mermaid\n"
        "classDiagram\n"
        "    %% --- 1. 直接管辖节点 ---\n"
        "    class src { <<module>> }\n"
        "    class submodule { <<module>> }\n"
        "    %% --- 2. 跨树占位节点 ---\n"
        "    class submodule_cbim_v2 { <<module>> }\n"
        "    class submodule_cbim_v2 : .from(submodule/cbim/v2)\n"
        "    %% --- 3. 内部边 ---\n"
        "    %% --- 4. 跨树边 ---\n"
        "    src ..> submodule_cbim_v2 : reads\n"
        "```\n"
    )
    # Root parent carries the diagram. Real modules live at src,
    # submodule, and submodule/cbim/v2.
    _write_module(tmp_path, ".", name="root", body=parent_body)
    _write_module(tmp_path, "src", name="src")
    _write_module(tmp_path, "submodule", name="submodule")
    _write_module(tmp_path, "submodule/cbim/v2", name="cbim-v2")
    _setup_index(tmp_path, [".", "src", "submodule", "submodule/cbim/v2"])

    g = build_graph(tmp_path)

    edges = {(e["src"], e["dst"], e["kind"]) for e in g["edges"]}
    # The cross-tree edge resolves to the real remote path.
    assert ("src", "submodule/cbim/v2", "depends_on") in edges
    # The placeholder id MUST NOT appear in the graph node set or as an
    # edge endpoint — it's a diagram artefact, not a real module.
    assert "submodule_cbim_v2" not in g["nodes"]
    for e in g["edges"]:
        assert e["src"] != "submodule_cbim_v2"
        assert e["dst"] != "submodule_cbim_v2"


def test_placeholder_does_not_leak_across_modules(tmp_path: Path):
    """A placeholder declared in one parent's diagram MUST NOT resolve
    in another parent's diagram. The local override map is used and
    discarded per-call; the global ``name_to_path`` is never mutated.
    """
    # Parent A declares the placeholder.
    parent_a_body = (
        "## Class Diagram\n\n"
        "```mermaid\n"
        "classDiagram\n"
        "    class a_child { <<module>> }\n"
        "    class submodule_cbim_v2 { <<module>> }\n"
        "    class submodule_cbim_v2 : .from(submodule/cbim/v2)\n"
        "    a_child ..> submodule_cbim_v2 : reads\n"
        "```\n"
    )
    # Parent B references the same placeholder id WITHOUT declaring it.
    # Under correct local-only override semantics, this arrow drops.
    parent_b_body = (
        "## Class Diagram\n\n"
        "```mermaid\n"
        "classDiagram\n"
        "    class b_child { <<module>> }\n"
        "    b_child ..> submodule_cbim_v2 : reads\n"
        "```\n"
    )
    _write_module(tmp_path, "a", name="a", body=parent_a_body)
    _write_module(tmp_path, "a/a_child", name="a_child")
    _write_module(tmp_path, "b", name="b", body=parent_b_body)
    _write_module(tmp_path, "b/b_child", name="b_child")
    _write_module(tmp_path, "submodule/cbim/v2", name="cbim-v2")
    _setup_index(
        tmp_path,
        ["a", "a/a_child", "b", "b/b_child", "submodule/cbim/v2"],
    )

    g = build_graph(tmp_path)
    edges = {(e["src"], e["dst"], e["kind"]) for e in g["edges"]}

    # Parent A's diagram resolves correctly.
    assert ("a/a_child", "submodule/cbim/v2", "depends_on") in edges
    # Parent B's diagram has no .from annotation for the placeholder id,
    # so the arrow is dropped — no cross-tree edge from b/b_child.
    assert ("b/b_child", "submodule/cbim/v2", "depends_on") not in edges
    # And no spurious node leak.
    assert "submodule_cbim_v2" not in g["nodes"]
