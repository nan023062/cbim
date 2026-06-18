"""Unit tests for engine.audit.checks.dna_fission."""
from __future__ import annotations

from pathlib import Path

from engine.audit.checks.dna_fission import check


def _seed(root: Path) -> None:
    (root / ".cbim").mkdir(parents=True)
    (root / ".cbim" / "index.md").write_text("# Module Index\n\n- alpha\n", encoding="utf-8")


def _make_module(root: Path, rel: str, body_lines: int, workflows: int) -> None:
    mod = root / rel
    dna = mod / ".dna"
    dna.mkdir(parents=True)
    body = "\n".join(f"line {i}" for i in range(body_lines)) if body_lines > 0 else ""
    dna.joinpath("module.md").write_text(
        f"---\nname: {rel}\nowner: x\ndescription: m\n"
        f"keywords: []\nstatus: implemented\n---\n\n{body}\n",
        encoding="utf-8",
    )
    if workflows > 0:
        wf_dir = dna / "workflows"
        wf_dir.mkdir()
        for i in range(workflows):
            d = wf_dir / f"wf{i}"
            d.mkdir()
            d.joinpath("workflow.md").write_text(
                f"---\nname: wf{i}\n---\n\nstep\n", encoding="utf-8"
            )


def test_clean_module_no_findings(tmp_path):
    _seed(tmp_path)
    _make_module(tmp_path, "alpha", body_lines=10, workflows=1)
    findings = check(tmp_path, {"dna_fission": {"max_body_lines": 350, "max_workflow_count": 8}})
    assert findings == []


def test_body_oversize_warn(tmp_path):
    _seed(tmp_path)
    _make_module(tmp_path, "alpha", body_lines=120, workflows=0)
    findings = check(tmp_path, {"dna_fission": {"max_body_lines": 100, "max_workflow_count": 8}})
    body_f = [f for f in findings if f.code == "DNA_BODY_OVERSIZE"]
    assert len(body_f) == 1
    assert body_f[0].severity == "warn"


def test_body_oversize_error_band(tmp_path):
    _seed(tmp_path)
    _make_module(tmp_path, "alpha", body_lines=160, workflows=0)
    findings = check(tmp_path, {"dna_fission": {"max_body_lines": 100, "max_workflow_count": 8}})
    body_f = next(f for f in findings if f.code == "DNA_BODY_OVERSIZE")
    assert body_f.severity == "error"


def test_body_info_band(tmp_path):
    _seed(tmp_path)
    _make_module(tmp_path, "alpha", body_lines=85, workflows=0)
    findings = check(tmp_path, {"dna_fission": {"max_body_lines": 100, "max_workflow_count": 8}})
    body_f = next(f for f in findings if f.code == "DNA_BODY_OVERSIZE")
    assert body_f.severity == "info"


def test_workflow_overload(tmp_path):
    _seed(tmp_path)
    _make_module(tmp_path, "alpha", body_lines=5, workflows=10)
    findings = check(tmp_path, {"dna_fission": {"max_body_lines": 999, "max_workflow_count": 8}})
    wf = [f for f in findings if f.code == "DNA_WORKFLOW_OVERLOAD"]
    assert len(wf) == 1
    assert wf[0].severity == "warn"


# ---------------------------------------------------------------------------
# DNA_PARENT_DIAGRAM_OVERLOAD — cross-tree placeholder count on parent diagrams
# ---------------------------------------------------------------------------


def _seed_with_root(root: Path, registered: list[str]) -> None:
    """Variant of `_seed` that registers a custom set of modules in index.md."""
    (root / ".cbim").mkdir(parents=True)
    lines = ["# Module Index", ""] + [f"- {e}" for e in registered]
    (root / ".cbim" / "index.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def _write_parent_with_placeholders(
    root: Path, rel: str, placeholder_paths: list[str]
) -> None:
    """Create a parent module whose class diagram lists N cross-tree
    placeholder annotations.

    Each placeholder gets the canonical pair of lines:
        class <id> { <<module>> }
        class <id> : .from(<path>)

    so graph_builder._parse_placeholder_origins picks them all up.
    """
    mod = root if rel == "." else (root / rel)
    dna = mod / ".dna"
    dna.mkdir(parents=True)
    diagram_lines = ["## Class Diagram", "", "```mermaid", "classDiagram"]
    for path in placeholder_paths:
        pid = path.replace("/", "_")
        diagram_lines.append(f"    class {pid} {{ <<module>> }}")
        diagram_lines.append(f"    class {pid} : .from({path})")
    diagram_lines.append("```")
    body = "\n".join(diagram_lines) + "\n"
    fm = (
        "---\n"
        f"name: {rel}\n"
        "owner: x\n"
        "description: m\n"
        "keywords: [TODO]\n"
        "status: implemented\n"
        "---\n\n"
    )
    (dna / "module.md").write_text(fm + body, encoding="utf-8")


def test_parent_diagram_overload_error_band(tmp_path):
    """≥11 placeholder nodes on a parent diagram → error severity."""
    # Eleven placeholder paths; the parent must register a child so it
    # qualifies as a parent module (else _is_parent returns False).
    placeholders = [f"ext/mod{i}" for i in range(11)]
    _seed_with_root(tmp_path, [".", "alpha"])
    _write_parent_with_placeholders(tmp_path, ".", placeholders)
    # Empty leaf child — makes `.` a parent in the graph sense.
    (tmp_path / "alpha" / ".dna").mkdir(parents=True)
    (tmp_path / "alpha" / ".dna" / "module.md").write_text(
        "---\nname: alpha\nowner: x\ndescription: m\nkeywords: [TODO]\n"
        "status: implemented\n---\n\nbody\n",
        encoding="utf-8",
    )

    findings = check(tmp_path, {})
    overloads = [f for f in findings if f.code == "DNA_PARENT_DIAGRAM_OVERLOAD"]
    assert len(overloads) == 1, [
        (f.code, f.target, f.metadata) for f in findings
    ]
    f = overloads[0]
    assert f.severity == "error"
    assert f.target == "."
    assert f.metadata["placeholder_count"] == 11
    assert f.metadata["threshold"] == 10


def test_parent_diagram_overload_warn_band(tmp_path):
    """6–10 placeholder nodes → warn severity."""
    placeholders = [f"ext/mod{i}" for i in range(7)]
    _seed_with_root(tmp_path, [".", "alpha"])
    _write_parent_with_placeholders(tmp_path, ".", placeholders)
    (tmp_path / "alpha" / ".dna").mkdir(parents=True)
    (tmp_path / "alpha" / ".dna" / "module.md").write_text(
        "---\nname: alpha\nowner: x\ndescription: m\nkeywords: [TODO]\n"
        "status: implemented\n---\n\nbody\n",
        encoding="utf-8",
    )

    findings = check(tmp_path, {})
    overloads = [f for f in findings if f.code == "DNA_PARENT_DIAGRAM_OVERLOAD"]
    assert len(overloads) == 1
    assert overloads[0].severity == "warn"
    assert overloads[0].metadata["placeholder_count"] == 7


def test_parent_diagram_healthy_no_finding(tmp_path):
    """≤5 placeholder nodes → healthy, no finding."""
    placeholders = [f"ext/mod{i}" for i in range(3)]
    _seed_with_root(tmp_path, [".", "alpha"])
    _write_parent_with_placeholders(tmp_path, ".", placeholders)
    (tmp_path / "alpha" / ".dna").mkdir(parents=True)
    (tmp_path / "alpha" / ".dna" / "module.md").write_text(
        "---\nname: alpha\nowner: x\ndescription: m\nkeywords: [TODO]\n"
        "status: implemented\n---\n\nbody\n",
        encoding="utf-8",
    )

    findings = check(tmp_path, {})
    overloads = [f for f in findings if f.code == "DNA_PARENT_DIAGRAM_OVERLOAD"]
    assert overloads == []


def test_leaf_module_with_placeholder_text_skipped(tmp_path):
    """Leaf module bodies are NOT scanned, even if they happen to contain a
    `class X : .from(...)` line — the check is parent-scoped by design."""
    placeholders = [f"ext/mod{i}" for i in range(11)]
    # Only register the one module so it's the only registered path → leaf.
    _seed_with_root(tmp_path, ["leafy"])
    _write_parent_with_placeholders(tmp_path, "leafy", placeholders)

    findings = check(tmp_path, {})
    overloads = [f for f in findings if f.code == "DNA_PARENT_DIAGRAM_OVERLOAD"]
    assert overloads == []


def test_parent_diagram_overload_threshold_override(tmp_path):
    """Project-level config can lower the threshold."""
    placeholders = [f"ext/mod{i}" for i in range(4)]
    _seed_with_root(tmp_path, [".", "alpha"])
    _write_parent_with_placeholders(tmp_path, ".", placeholders)
    (tmp_path / "alpha" / ".dna").mkdir(parents=True)
    (tmp_path / "alpha" / ".dna" / "module.md").write_text(
        "---\nname: alpha\nowner: x\ndescription: m\nkeywords: [TODO]\n"
        "status: implemented\n---\n\nbody\n",
        encoding="utf-8",
    )

    # warn_max=3 → healthy_ceiling=1, value=4 ≥ error_min=4 → error.
    findings = check(
        tmp_path,
        {"dna_fission": {"max_cross_tree_placeholders": 3}},
    )
    overloads = [f for f in findings if f.code == "DNA_PARENT_DIAGRAM_OVERLOAD"]
    assert len(overloads) == 1
    assert overloads[0].severity == "error"
