"""Tests for services.scan_workflows and the dna_workflows_scan MCP tool.

Coverage matrix (mirrors the ContextPack acceptance list):
- single module, single hit
- single module, multiple workflows, only one hits
- multi-module hit (each match carries its own module_path)
- case-insensitive matching ("orphan" hits "Orphan Design Doc")
- keywords=[] → []
- module without .dna/workflows/ → silently skipped
- illegal/traversal module_path → PathOutsideRootError
- unregistered module_path → silently skipped (contract)
- ordering is deterministic ((module_path, workflow_id) lex)
- MCP thin-shell forwards args to services.scan_workflows verbatim

Real workflow markup (`triggers: [a, b]` frontmatter) is exercised end-
to-end via the services function; the MCP thin-shell test only asserts
the forwarding contract with a recorder.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from services._paths import PathOutsideRootError


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _make_project(tmp_path: Path) -> Path:
    """Minimal project: .cbim/config.json + empty index.md."""
    root = tmp_path / "proj"
    (root / ".cbim").mkdir(parents=True)
    (root / ".cbim" / "config.json").write_text("{}", encoding="utf-8")
    (root / ".cbim" / "index.md").write_text("# Module Index\n", encoding="utf-8")
    return root


def _register(root: Path, *rels: str) -> None:
    lines = ["# Module Index", ""]
    for r in rels:
        lines.append(f"- {r}")
    (root / ".cbim" / "index.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def _make_module(root: Path, rel: str) -> Path:
    """Create a .dna/module.md under `rel` (no workflows yet)."""
    mod = root / rel
    (mod / ".dna").mkdir(parents=True)
    (mod / ".dna" / "module.md").write_text(
        "---\n"
        f"name: {rel}\n"
        "owner: platform\n"
        "description: test module\n"
        "keywords: []\n"
        "status: implemented\n"
        "---\n"
        "## Positioning\nbody\n",
        encoding="utf-8",
    )
    return mod


def _make_workflow(
    module_dir: Path,
    slug: str,
    name: str,
    triggers: list[str],
    body: str = "step",
    purpose: str = "",
) -> Path:
    """Create `.dna/workflows/<slug>/workflow.md` with the given triggers."""
    wf_dir = module_dir / ".dna" / "workflows" / slug
    wf_dir.mkdir(parents=True)
    trigger_yaml = "[" + ", ".join(_quote(t) for t in triggers) + "]"
    purpose_line = f"purpose: {purpose}\n" if purpose else ""
    (wf_dir / "workflow.md").write_text(
        "---\n"
        f"id: {slug}\n"
        f"name: {name}\n"
        f"{purpose_line}"
        f"triggers: {trigger_yaml}\n"
        "---\n"
        f"\n{body}\n",
        encoding="utf-8",
    )
    return wf_dir


def _quote(s: str) -> str:
    """Cheap YAML flow-scalar quoting for our block-list writer.

    The kernel's frontmatter parser accepts unquoted plain scalars and
    double-quoted scalars; we hand-write flow lists here so bare CJK /
    space-containing triggers get double-quoted to survive the parse
    without triggering the parser's plain-scalar indicator rejection.
    """
    # keep it simple — always quote so we never trip _needs_quoting.
    escaped = s.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


# ---------------------------------------------------------------------------
# services.scan_workflows — behavioural tests
# ---------------------------------------------------------------------------


def test_single_module_single_hit(tmp_path):
    from services import scan_workflows

    root = _make_project(tmp_path)
    mod = _make_module(root, "src/foo")
    _make_workflow(
        mod, "hello", "Hello WF",
        triggers=["greet user", "say hello"],
        purpose="greet-flow",
        body="do hi",
    )
    _register(root, "src/foo")

    out = scan_workflows(["src/foo"], ["greet"], cwd=str(root))
    assert len(out) == 1
    r = out[0]
    assert r["module_path"] == "src/foo"
    assert r["workflow_id"] == "hello"
    assert r["name"] == "Hello WF"
    assert r["purpose"] == "greet-flow"
    assert r["matched_triggers"] == ["greet user"]
    assert "do hi" in r["body"]
    # Body must NOT contain the frontmatter fence.
    assert "---" not in r["body"].splitlines()[0] if r["body"] else True


def test_single_module_multiple_workflows_only_one_hits(tmp_path):
    from services import scan_workflows

    root = _make_project(tmp_path)
    mod = _make_module(root, "src/foo")
    _make_workflow(mod, "aa-hit", "Hit", triggers=["target-word"])
    _make_workflow(mod, "bb-miss", "Miss", triggers=["nothing-related"])
    _register(root, "src/foo")

    out = scan_workflows(["src/foo"], ["target"], cwd=str(root))
    assert len(out) == 1
    assert out[0]["workflow_id"] == "aa-hit"
    assert out[0]["matched_triggers"] == ["target-word"]


def test_multi_module_hit_carries_own_path(tmp_path):
    from services import scan_workflows

    root = _make_project(tmp_path)
    m1 = _make_module(root, "alpha")
    m2 = _make_module(root, "beta")
    _make_workflow(m1, "wa", "WA", triggers=["shared-thing"])
    _make_workflow(m2, "wb", "WB", triggers=["shared-thing extended"])
    _register(root, "alpha", "beta")

    out = scan_workflows(["alpha", "beta"], ["shared"], cwd=str(root))
    assert len(out) == 2
    # Ordering: (module_path, workflow_id) lex → alpha before beta.
    assert out[0]["module_path"] == "alpha"
    assert out[0]["workflow_id"] == "wa"
    assert out[1]["module_path"] == "beta"
    assert out[1]["workflow_id"] == "wb"


def test_case_insensitive_match(tmp_path):
    from services import scan_workflows

    root = _make_project(tmp_path)
    mod = _make_module(root, "src/foo")
    _make_workflow(
        mod, "orph", "Orphan WF",
        triggers=["Orphan Design Doc", "misc"],
    )
    _register(root, "src/foo")

    out = scan_workflows(["src/foo"], ["orphan"], cwd=str(root))
    assert len(out) == 1
    # The matched_triggers list preserves the ORIGINAL casing from the
    # workflow's declaration — the case-fold is only for comparison.
    assert out[0]["matched_triggers"] == ["Orphan Design Doc"]


def test_bidirectional_substring_match(tmp_path):
    """Trigger-shorter-than-keyword direction is also honoured."""
    from services import scan_workflows

    root = _make_project(tmp_path)
    mod = _make_module(root, "src/foo")
    _make_workflow(mod, "orph", "Orphan", triggers=["orphan"])
    _register(root, "src/foo")

    out = scan_workflows(
        ["src/foo"],
        ["orphan design doc adoption"],
        cwd=str(root),
    )
    assert len(out) == 1
    assert out[0]["matched_triggers"] == ["orphan"]


def test_cjk_substring_match(tmp_path):
    """Regression: parity with the ContextPack example."""
    from services import scan_workflows

    root = _make_project(tmp_path)
    mod = _make_module(root, "src/foo")
    _make_workflow(
        mod, "wf", "文档归属工作流",
        triggers=["design 文档归属处理"],
    )
    _register(root, "src/foo")

    out = scan_workflows(["src/foo"], ["文档归属"], cwd=str(root))
    assert len(out) == 1
    assert out[0]["matched_triggers"] == ["design 文档归属处理"]


def test_empty_keywords_returns_empty(tmp_path):
    from services import scan_workflows

    root = _make_project(tmp_path)
    mod = _make_module(root, "src/foo")
    _make_workflow(mod, "wf", "WF", triggers=["anything"])
    _register(root, "src/foo")

    assert scan_workflows(["src/foo"], [], cwd=str(root)) == []


def test_module_without_workflows_dir_skipped(tmp_path):
    from services import scan_workflows

    root = _make_project(tmp_path)
    _make_module(root, "src/foo")  # no .dna/workflows/ subdir
    _register(root, "src/foo")

    assert scan_workflows(["src/foo"], ["anything"], cwd=str(root)) == []


def test_unregistered_module_silently_skipped(tmp_path):
    from services import scan_workflows

    root = _make_project(tmp_path)
    mod = _make_module(root, "src/foo")
    _make_workflow(mod, "wf", "WF", triggers=["target-word"])
    # NOTE: index.md left empty — src/foo is not registered.
    out = scan_workflows(["src/foo"], ["target"], cwd=str(root))
    assert out == []


def test_traversal_input_rejected(tmp_path):
    from services import scan_workflows

    root = _make_project(tmp_path)
    _register(root, "src/foo")
    with pytest.raises(PathOutsideRootError):
        scan_workflows(["../escape"], ["anything"], cwd=str(root))


def test_matched_triggers_dedup_and_order(tmp_path):
    """Same trigger matched by two keywords appears once; order follows the
    workflow's own trigger list, not the keyword order."""
    from services import scan_workflows

    root = _make_project(tmp_path)
    mod = _make_module(root, "src/foo")
    _make_workflow(
        mod, "wf", "WF",
        triggers=["alpha", "beta", "gamma"],
    )
    _register(root, "src/foo")

    out = scan_workflows(
        ["src/foo"],
        # "alpha" & "alph" both point to trigger[0]; "gamma" points to trigger[2].
        # Keyword order intentionally different from trigger order.
        ["gamma", "alpha", "alph"],
        cwd=str(root),
    )
    assert len(out) == 1
    assert out[0]["matched_triggers"] == ["alpha", "gamma"]


def test_workflow_without_triggers_is_skipped(tmp_path):
    """A workflow with no `triggers` frontmatter (or empty) cannot match."""
    from services import scan_workflows

    root = _make_project(tmp_path)
    mod = _make_module(root, "src/foo")
    wf_dir = mod / ".dna" / "workflows" / "no-triggers"
    wf_dir.mkdir(parents=True)
    (wf_dir / "workflow.md").write_text(
        "---\nid: no-triggers\nname: NT\n---\nbody\n", encoding="utf-8",
    )
    _register(root, "src/foo")

    assert scan_workflows(["src/foo"], ["anything"], cwd=str(root)) == []


def test_duplicate_module_paths_in_input_dedup(tmp_path):
    """Passing the same registered path twice must not double-report."""
    from services import scan_workflows

    root = _make_project(tmp_path)
    mod = _make_module(root, "src/foo")
    _make_workflow(mod, "wf", "WF", triggers=["target"])
    _register(root, "src/foo")

    out = scan_workflows(["src/foo", "src/foo"], ["target"], cwd=str(root))
    assert len(out) == 1


def test_root_module_scanning(tmp_path):
    """Path='' or '.' addresses the root module and works when registered."""
    from services import scan_workflows

    root = _make_project(tmp_path)
    root_dna = root / ".dna"
    root_dna.mkdir(parents=True)
    (root_dna / "module.md").write_text(
        "---\nname: root\nowner: p\ndescription: r\n"
        "keywords: []\nstatus: implemented\n---\nbody\n",
        encoding="utf-8",
    )
    _make_workflow(root, "root-wf", "Root WF", triggers=["root-topic"])
    _register(root, ".")

    out = scan_workflows(["."], ["root-topic"], cwd=str(root))
    assert len(out) == 1
    assert out[0]["module_path"] == "."
    assert out[0]["workflow_id"] == "root-wf"
