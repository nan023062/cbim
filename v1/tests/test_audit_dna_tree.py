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
    mod = root if rel == "." else (root / rel)
    dna = mod / ".dna"
    dna.mkdir(parents=True)
    fm = ["---", f"name: {rel}", "owner: x", "description: m"]
    if deps:
        fm.append("dependencies:")
        for d in deps:
            fm.append(f"  - {d}")
    else:
        fm.append("dependencies: []")
    fm.append("---")
    (dna / "module.md").write_text(
        "\n".join(fm) + "\n\n" + body, encoding="utf-8"
    )


def test_clean_tree_no_findings(tmp_path):
    _seed(tmp_path, [".", "alpha", "beta"])
    _make_module(tmp_path, ".")
    _make_module(tmp_path, "alpha", deps=["beta"])
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
    _seed(tmp_path, [".", "alpha"])
    _make_module(tmp_path, ".")
    _make_module(tmp_path, "alpha", deps=["ghost"])
    findings = check(tmp_path, {})
    dangling = [f for f in findings if f.code == "TREE_DEP_DANGLING"]
    assert len(dangling) == 1


def test_dep_ancestor_declared(tmp_path):
    _seed(tmp_path, [".", "alpha", "alpha/child"])
    _make_module(tmp_path, ".")
    _make_module(tmp_path, "alpha")
    _make_module(tmp_path, "alpha/child", deps=["alpha"])
    findings = check(tmp_path, {})
    anc = [f for f in findings if f.code == "TREE_DEP_ANCESTOR_DECLARED"]
    assert len(anc) == 1
    assert anc[0].target == "alpha/child"
    assert anc[0].metadata["dep"] == "alpha"
    assert [f for f in findings if f.code == "TREE_DEP_UP_TREE"] == []


def test_dep_ancestor_declared_root(tmp_path):
    _seed(tmp_path, [".", "alpha"])
    _make_module(tmp_path, ".")
    _make_module(tmp_path, "alpha", deps=["."])
    findings = check(tmp_path, {})
    anc = [f for f in findings if f.code == "TREE_DEP_ANCESTOR_DECLARED"]
    assert len(anc) == 1
    assert anc[0].metadata["dep"] == "."


def test_dep_uncle_subtree_not_flagged(tmp_path):
    """Uncle-subtree deps are legal cross-boundary references.

    Tree shape:
        .
        +-- alpha
        |   +-- beta        (declares dep on gamma/delta)
        +-- gamma
            +-- delta

    ``gamma/delta`` is NOT an ancestor of ``alpha/beta`` — it lives in a
    sibling subtree of ``alpha/beta``'s ancestor ``alpha``. Such uncle-
    subtree references are the *intended* shape of cross-boundary deps;
    the audit must not raise TREE_DEP_ANCESTOR_DECLARED (ancestors only)
    nor TREE_DEP_UP_TREE (currently documented-but-unimplemented; if
    later wired up, must still skip uncle subtrees).
    """
    _seed(tmp_path, [".", "alpha", "alpha/beta", "gamma", "gamma/delta"])
    _make_module(tmp_path, ".")
    _make_module(tmp_path, "alpha")
    _make_module(tmp_path, "alpha/beta", deps=["gamma/delta"])
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

    # Sanity: the dep itself must not be reported as dangling either —
    # gamma/delta is a registered module, so the cross-boundary edge is
    # fully resolved.
    dangling = [
        f for f in findings
        if f.code == "TREE_DEP_DANGLING" and f.target == "alpha/beta"
    ]
    assert dangling == []


def test_dep_cycle_error(tmp_path):
    _seed(tmp_path, [".", "alpha", "beta"])
    _make_module(tmp_path, ".")
    _make_module(tmp_path, "alpha", deps=["beta"])
    _make_module(tmp_path, "beta", deps=["alpha"])
    findings = check(tmp_path, {})
    cycles = [f for f in findings if f.code == "TREE_CYCLE"]
    assert len(cycles) == 1
    assert cycles[0].severity == "error"
    assert set(cycles[0].metadata["cycle"]) == {"alpha", "beta"}


# ---------------------------------------------------------------------------
# TREE_DEP_DIAGRAM_MISMATCH (T4): frontmatter `dependencies` must match the
# parent module's classDiagram `..>` edges originating at this module.
# ---------------------------------------------------------------------------


def _classdiagram(body: str) -> str:
    return "## Class Diagram\n\n```mermaid\nclassDiagram\n" + body + "\n```\n"


def test_diagram_mismatch_consistent_no_finding(tmp_path):
    """Parent diagram declares `alpha ..> beta`; child frontmatter agrees."""
    _seed(tmp_path, [".", "alpha", "beta"])
    parent_body = _classdiagram("    alpha ..> beta")
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha", deps=["beta"])
    _make_module(tmp_path, "beta")
    findings = check(tmp_path, {})
    mm = [f for f in findings if f.code == "TREE_DEP_DIAGRAM_MISMATCH"]
    assert mm == [], [(f.target, f.metadata) for f in mm]


def test_diagram_mismatch_frontmatter_extra(tmp_path):
    """frontmatter lists [beta, gamma] but parent only draws `..> beta`.

    Expect one mismatch finding for gamma (declared but not drawn).
    """
    _seed(tmp_path, [".", "alpha", "beta", "gamma"])
    parent_body = _classdiagram("    alpha ..> beta")
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha", deps=["beta", "gamma"])
    _make_module(tmp_path, "beta")
    _make_module(tmp_path, "gamma")
    findings = check(tmp_path, {})
    mm = [f for f in findings if f.code == "TREE_DEP_DIAGRAM_MISMATCH"]
    assert len(mm) == 1, [(f.target, f.metadata) for f in mm]
    assert mm[0].target == "alpha"
    assert mm[0].severity == "warn"
    assert mm[0].metadata["dep"] == "gamma"
    assert mm[0].metadata["parent"] == "."


def test_diagram_mismatch_diagram_extra(tmp_path):
    """Parent draws `..> beta, ..> gamma` but frontmatter only lists [beta].

    Expect one mismatch finding for gamma (drawn but not declared).
    """
    _seed(tmp_path, [".", "alpha", "beta", "gamma"])
    parent_body = _classdiagram(
        "    alpha ..> beta\n    alpha ..> gamma"
    )
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha", deps=["beta"])
    _make_module(tmp_path, "beta")
    _make_module(tmp_path, "gamma")
    findings = check(tmp_path, {})
    mm = [f for f in findings if f.code == "TREE_DEP_DIAGRAM_MISMATCH"]
    assert len(mm) == 1, [(f.target, f.metadata) for f in mm]
    assert mm[0].target == "alpha"
    assert mm[0].severity == "warn"
    assert mm[0].metadata["dep"] == "gamma"


def test_diagram_mismatch_no_parent_skipped(tmp_path):
    """Orphan module with no registered parent: no mismatch finding, no crash."""
    _seed(tmp_path, ["alpha/beta"])
    _make_module(tmp_path, "alpha/beta", deps=["whatever"])
    findings = check(tmp_path, {})
    mm = [f for f in findings if f.code == "TREE_DEP_DIAGRAM_MISMATCH"]
    assert mm == []


def test_diagram_mismatch_parent_no_classdiagram_skipped(tmp_path):
    """Parent body has only a flowchart (no classDiagram): silently skip."""
    _seed(tmp_path, [".", "alpha", "beta"])
    parent_body = (
        "## Topology\n\n```mermaid\nflowchart TD\n    alpha --> beta\n```\n"
    )
    _make_module(tmp_path, ".", body=parent_body)
    # frontmatter declares a dep that the flowchart "draws" — must NOT
    # be reported as mismatch, because flowchart is not the source of truth.
    _make_module(tmp_path, "alpha", deps=["beta"])
    _make_module(tmp_path, "beta")
    findings = check(tmp_path, {})
    mm = [f for f in findings if f.code == "TREE_DEP_DIAGRAM_MISMATCH"]
    assert mm == []


def test_diagram_mismatch_unclosed_fence_skipped(tmp_path):
    """Parent has an unclosed ```mermaid fence: no crash, no finding."""
    _seed(tmp_path, [".", "alpha", "beta"])
    # Note: opening fence + classDiagram, but no terminating ```.
    parent_body = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    alpha ..> beta\n"
        "trailing prose without closing fence\n"
    )
    _make_module(tmp_path, ".", body=parent_body)
    _make_module(tmp_path, "alpha", deps=["beta"])
    _make_module(tmp_path, "beta")
    findings = check(tmp_path, {})
    mm = [f for f in findings if f.code == "TREE_DEP_DIAGRAM_MISMATCH"]
    assert mm == []
