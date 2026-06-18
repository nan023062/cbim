"""Unit tests for engine.audit.checks.dna_tree."""
from __future__ import annotations

from pathlib import Path

from engine.audit.checks.dna_tree import check


def _seed(root: Path, index_entries: list[str]) -> None:
    (root / ".cbim").mkdir(parents=True)
    lines = ["# Module Index", ""] + [f"- {e}" for e in index_entries]
    (root / ".cbim" / "index.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _make_module(
    root: Path,
    rel: str,
    deps: list[str] | None = None,
    body: str = "body\n",
) -> None:
    """Build a v2-conformant .dna/module.md.

    The legacy `deps` parameter is preserved for test signature stability
    but no longer writes a frontmatter `dependencies` field — v2 sources
    deps from the parent's class diagram. Tests that need topology checks
    must pass the corresponding ``..>`` arrows in ``body`` instead.
    """
    mod = root if rel == "." else (root / rel)
    dna = mod / ".dna"
    dna.mkdir(parents=True)
    fm = [
        "---",
        f"name: {rel}",
        "owner: x",
        "description: m",
        "keywords: []",
        "status: implemented",
        "---",
    ]
    (dna / "module.md").write_text(
        "\n".join(fm) + "\n\n" + body, encoding="utf-8"
    )


def _classdiagram(body: str) -> str:
    return "## Class Diagram\n\n```mermaid\nclassDiagram\n" + body + "\n```\n"


def test_clean_tree_no_findings(tmp_path):
    _seed(tmp_path, [".", "alpha", "beta"])
    _make_module(tmp_path, ".", body=_classdiagram("    alpha ..> beta"))
    _make_module(tmp_path, "alpha")
    _make_module(tmp_path, "beta")
    assert check(tmp_path, {}) == []


def test_orphan_warn(tmp_path):
    _seed(tmp_path, ["alpha/beta"])
    _make_module(tmp_path, "alpha/beta")
    findings = check(tmp_path, {})
    orphans = [f for f in findings if f.code == "TREE_ORPHAN"]
    assert len(orphans) == 1
    assert orphans[0].severity == "warn"
    assert orphans[0].target == "alpha/beta"


def test_dep_dangling(tmp_path):
    """Parent class diagram declares an edge to an unregistered path."""
    _seed(tmp_path, [".", "alpha", "ghost"])
    # Root parent diagram references alpha and ghost, then ghost gets
    # deregistered from the index so the dep is dangling. We achieve this
    # by writing the diagram with an explicit cross-tree placeholder
    # whose .from() points at a registered-but-then-removed path.
    parent_body = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    class alpha { <<module>> }\n"
        "    class ghost_ph { <<module>> }\n"
        "    class ghost_ph : .from(ghost_path)\n"
        "    alpha ..> ghost_ph : reads\n"
        "```\n"
    )
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha")
    findings = check(tmp_path, {})
    dangling = [f for f in findings if f.code == "TREE_DEP_DANGLING"]
    assert len(dangling) == 1
    assert dangling[0].metadata["dep"] == "ghost_path"
    assert dangling[0].metadata["origin"] == "diagram"


def test_dep_ancestor_declared(tmp_path):
    """`alpha`'s class diagram has `child ..> alpha` — child declares its
    ancestor alpha as dep."""
    _seed(tmp_path, [".", "alpha", "alpha/child"])
    _make_module(tmp_path, ".")
    alpha_body = _classdiagram("    child ..> alpha")
    _make_module(tmp_path, "alpha", body=alpha_body)
    _make_module(tmp_path, "alpha/child")
    findings = check(tmp_path, {})
    anc = [f for f in findings if f.code == "TREE_DEP_ANCESTOR_DECLARED"]
    assert len(anc) == 1
    assert anc[0].target == "alpha/child"
    assert anc[0].metadata["dep"] == "alpha"
    assert [f for f in findings if f.code == "TREE_DEP_UP_TREE"] == []


def test_dep_uncle_subtree_not_flagged(tmp_path):
    """Uncle-subtree deps are legal cross-boundary references.

    Tree shape:
        .
        +-- alpha
        |   +-- beta        (root diagram declares ``beta ..> gamma_delta``
        |                    via cross-tree placeholder)
        +-- gamma
            +-- delta

    ``gamma/delta`` is NOT an ancestor of ``alpha/beta`` — it lives in a
    sibling subtree of ``alpha/beta``'s ancestor ``alpha``. Such uncle-
    subtree references are the *intended* shape of cross-boundary deps.
    """
    _seed(tmp_path, [".", "alpha", "alpha/beta", "gamma", "gamma/delta"])
    # Root diagram is the common ancestor that hosts the cross-tree edge.
    parent_body = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    %% --- 1. ---\n"
        "    class alpha { <<module>> }\n"
        "    class gamma { <<module>> }\n"
        "    class alpha_beta { <<module>> }\n"
        "    class alpha_beta : .from(alpha/beta)\n"
        "    class gamma_delta { <<module>> }\n"
        "    class gamma_delta : .from(gamma/delta)\n"
        "    %% --- 2. ---\n"
        "    %% --- 3. ---\n"
        "    %% --- 4. ---\n"
        "    alpha_beta ..> gamma_delta : reads\n"
        "```\n"
    )
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha")
    _make_module(tmp_path, "alpha/beta")
    _make_module(tmp_path, "gamma")
    _make_module(tmp_path, "gamma/delta")

    findings = check(tmp_path, {})

    ancestor_flags = [f for f in findings if f.code == "TREE_DEP_ANCESTOR_DECLARED"]
    up_tree_flags = [f for f in findings if f.code == "TREE_DEP_UP_TREE"]
    assert ancestor_flags == [], (
        "uncle-subtree dep falsely flagged as ancestor-declared: "
        f"{[(f.target, f.metadata) for f in ancestor_flags]}"
    )
    assert up_tree_flags == [], (
        "uncle-subtree dep falsely flagged as up-tree: "
        f"{[(f.target, f.metadata) for f in up_tree_flags]}"
    )
    dangling = [
        f for f in findings
        if f.code == "TREE_DEP_DANGLING" and f.target == "alpha/beta"
    ]
    assert dangling == []


def test_dep_cycle_error(tmp_path):
    """Root diagram declares ``alpha ..> beta`` and ``beta ..> alpha``."""
    _seed(tmp_path, [".", "alpha", "beta"])
    parent_body = _classdiagram(
        "    alpha ..> beta\n    beta ..> alpha"
    )
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha")
    _make_module(tmp_path, "beta")
    findings = check(tmp_path, {})
    cycles = [f for f in findings if f.code == "TREE_CYCLE"]
    assert len(cycles) == 1
    assert cycles[0].severity == "error"
    assert set(cycles[0].metadata["cycle"]) == {"alpha", "beta"}


# ---------------------------------------------------------------------------
# Topology checks fed by parent class diagrams (v2: diagram-only; no fallback).
# ---------------------------------------------------------------------------


def test_topology_uses_class_diagram_when_present(tmp_path):
    """Parent class diagram is authoritative; unresolved diagram tokens
    are dropped (treated as external) — no TREE_DEP_DANGLING."""
    _seed(tmp_path, [".", "alpha"])
    parent_body = _classdiagram("    alpha ..> ghost")
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha")
    findings = check(tmp_path, {})
    dangling = [f for f in findings if f.code == "TREE_DEP_DANGLING"]
    # `ghost` is unregistered; the resolver drops the unresolved arrow,
    # so no dep is recorded. (Unregistered tokens are treated as external
    # placeholders, not dangling registered paths.)
    assert dangling == []


def test_topology_diagram_dep_origin_metadata(tmp_path):
    """All v2 dep findings carry origin='diagram'."""
    _seed(tmp_path, [".", "alpha", "alpha/child"])
    alpha_body = _classdiagram("    child ..> alpha")
    _make_module(tmp_path, ".")
    _make_module(tmp_path, "alpha", body=alpha_body)
    _make_module(tmp_path, "alpha/child")
    findings = check(tmp_path, {})
    anc = [f for f in findings if f.code == "TREE_DEP_ANCESTOR_DECLARED"]
    assert len(anc) == 1
    assert anc[0].metadata["origin"] == "diagram"


def test_no_diagram_no_deps(tmp_path):
    """v2 has no frontmatter fallback: a parent without a classDiagram
    contributes zero edges."""
    _seed(tmp_path, [".", "alpha"])
    _make_module(tmp_path, ".", body="just prose, no diagram")
    _make_module(tmp_path, "alpha")
    findings = check(tmp_path, {})
    dangling = [f for f in findings if f.code == "TREE_DEP_DANGLING"]
    assert dangling == []


# ---------------------------------------------------------------------------
# R1 / R2 / R3 sub-checks
# ---------------------------------------------------------------------------


def test_r1_placeholder_expanded_warn(tmp_path):
    """A placeholder annotation pointing at a path inside the parent's own
    subtree is an R1 violation: should be a regular sub-node, not a
    placeholder."""
    _seed(tmp_path, [".", "alpha"])
    # `.` parent declares a placeholder pointing at `alpha`, which IS its
    # direct child. R1 violation — placeholders are reserved for cross-tree
    # references.
    parent_body = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    class alpha { <<module>> }\n"
        "    class alpha : .from(alpha)\n"
        "```\n"
    )
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha")
    findings = check(tmp_path, {})
    r1 = [f for f in findings if f.code == "TREE_DIAGRAM_R1_PLACEHOLDER_EXPANDED"]
    assert len(r1) == 1
    assert r1[0].severity == "warn"
    assert r1[0].metadata["placeholder"] == "alpha"
    assert r1[0].metadata["origin"] == "alpha"


def test_r1_cross_tree_placeholder_no_finding(tmp_path):
    """A placeholder pointing OUT of the parent's subtree is exactly the
    R1-compliant case — no finding."""
    _seed(tmp_path, [".", "alpha"])
    # Placeholder `farside_thing` points at `farside/thing`, which is NOT
    # registered nor a descendant of `.`. (This is unusual — typically `.`
    # is everyone's ancestor — but in this test setup `.` only registers
    # `alpha`, and `farside/thing` is neither registered nor a descendant
    # path of any registered module, simulating an external mount.)
    parent_body = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    %% --- 1. ---\n"
        "    class alpha { <<module>> }\n"
        "    %% --- 2. ---\n"
        "    class farside_thing { <<module>> }\n"
        "    class farside_thing : .from(/external/farside/thing)\n"
        "    %% --- 3. ---\n"
        "    %% --- 4. ---\n"
        "```\n"
    )
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha")
    findings = check(tmp_path, {})
    r1 = [f for f in findings if f.code == "TREE_DIAGRAM_R1_PLACEHOLDER_EXPANDED"]
    assert r1 == []


def test_r2_deep_source_warn(tmp_path):
    """An arrow originating at a path > 1 level below the parent is R2:
    should be rendered using its top-level ancestor under that parent."""
    _seed(tmp_path, [".", "a", "a/b", "x"])
    # `.` parent diagram has `a/b ..> x`. R2 violation: source `a/b` is
    # 2 levels below the host parent `.`; should be rendered as `a`.
    parent_body = _classdiagram("    a_b ..> x")
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "a")
    # Give a/b a name that the resolver will pick up — the canonical
    # convention is `a_b` for path `a/b`.
    (tmp_path / "a/b/.dna").mkdir(parents=True)
    (tmp_path / "a/b/.dna/module.md").write_text(
        "---\nname: a_b\nowner: x\ndescription: m\n"
        "keywords: []\nstatus: implemented\n---\n\nbody\n",
        encoding="utf-8",
    )
    _make_module(tmp_path, "x")
    findings = check(tmp_path, {})
    r2 = [f for f in findings if f.code == "TREE_DIAGRAM_R2_DEEP_SOURCE"]
    assert len(r2) == 1, [
        (f.code, f.target, f.metadata) for f in findings
    ]
    assert r2[0].severity == "warn"
    assert r2[0].metadata["resolved"] == "a/b"
    assert r2[0].metadata["depth"] == 2


def test_r2_direct_child_source_no_finding(tmp_path):
    """An arrow whose source is a direct child of the parent is R2-compliant."""
    _seed(tmp_path, [".", "a", "x"])
    parent_body = _classdiagram("    a ..> x")
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "a")
    _make_module(tmp_path, "x")
    findings = check(tmp_path, {})
    r2 = [f for f in findings if f.code == "TREE_DIAGRAM_R2_DEEP_SOURCE"]
    assert r2 == []


def test_r3_missing_group_markers_info(tmp_path):
    """A diagram with cross-tree placeholders but no four-section group
    markers raises R3 (info)."""
    _seed(tmp_path, [".", "alpha"])
    parent_body = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    class alpha { <<module>> }\n"
        "    class farside_thing { <<module>> }\n"
        "    class farside_thing : .from(/external/farside/thing)\n"
        "    alpha ..> farside_thing : reads\n"
        "```\n"
    )
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha")
    findings = check(tmp_path, {})
    r3 = [f for f in findings if f.code == "TREE_DIAGRAM_R3_UNGROUPED"]
    assert len(r3) == 1
    assert r3[0].severity == "info"
    assert r3[0].metadata["placeholder_count"] == 1


def test_r3_grouped_diagram_no_finding(tmp_path):
    """A diagram with all four group markers passes R3."""
    _seed(tmp_path, [".", "alpha"])
    parent_body = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    %% --- 1. direct ---\n"
        "    class alpha { <<module>> }\n"
        "    %% --- 2. cross-tree placeholders ---\n"
        "    class farside_thing { <<module>> }\n"
        "    class farside_thing : .from(/external/farside/thing)\n"
        "    %% --- 3. internal edges ---\n"
        "    %% --- 4. cross-tree edges ---\n"
        "    alpha ..> farside_thing : reads\n"
        "```\n"
    )
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha")
    findings = check(tmp_path, {})
    r3 = [f for f in findings if f.code == "TREE_DIAGRAM_R3_UNGROUPED"]
    assert r3 == []


def test_r3_no_placeholders_no_finding(tmp_path):
    """A diagram with NO cross-tree placeholders need not carry the four
    group markers — R3 doesn't fire."""
    _seed(tmp_path, [".", "alpha", "beta"])
    parent_body = _classdiagram("    alpha ..> beta")
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha", deps=["beta"])
    _make_module(tmp_path, "beta")
    findings = check(tmp_path, {})
    r3 = [f for f in findings if f.code == "TREE_DIAGRAM_R3_UNGROUPED"]
    assert r3 == []
