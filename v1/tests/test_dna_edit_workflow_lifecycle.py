"""Tests for the workflow lifecycle branches of
`services.edit_module(target="workflow")` — create / update / delete.

Before this suite, workflows had only a create path (`m.workflows.add`)
in the service layer; update and delete had to be done by direct
resource-API poking, so surface callers (CLI + MCP) could only ever
create. These tests pin the extended payload contract:

    {"name": str, "content": str}                          — create (default)
    {"name": str, "mode": "create", "content": str}        — create (explicit)
    {"name": str, "mode": "update", "content": str}        — update body
    {"name": str, "mode": "delete"}                        — remove file + dir

Delete's dir-cleanup responsibility lives in the services layer (not in
`WorkflowCollection.remove`, which stays file-only per the primitives
layer contract).

Reindex is expected to fire once per write (create / update / delete)
so the retrieval index stays warm on workflow churn — same behaviour
the create path already had.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from services import edit_module


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _make_project(tmp_path: Path) -> tuple[Path, Path]:
    """Minimum project: `.cbim/config.json` + one leaf module with `.dna/`."""
    root = tmp_path / "proj"
    (root / ".cbim").mkdir(parents=True)
    (root / ".cbim" / "config.json").write_text("{}", encoding="utf-8")
    mod = root / "src" / "foo"
    (mod / ".dna").mkdir(parents=True)
    (mod / ".dna" / "module.md").write_text(
        "---\n"
        "name: Foo\n"
        "owner: platform\n"
        "description: a foo\n"
        "keywords: []\n"
        "status: implemented\n"
        "---\n"
        "## Positioning\n\nbody\n",
        encoding="utf-8",
    )
    return root, mod


def _workflow_md(mod: Path, wf_name: str) -> Path:
    return mod / ".dna" / "workflows" / wf_name / "workflow.md"


# ---------------------------------------------------------------------------
# Create (regression — the pre-existing single branch)
# ---------------------------------------------------------------------------

def test_workflow_create_default_mode(tmp_path):
    root, mod = _make_project(tmp_path)
    out = edit_module(
        str(mod),
        "workflow",
        {"name": "hello", "content": "# Hello workflow\n"},
        cwd=str(root),
    )
    wf = _workflow_md(mod, "hello")
    assert Path(out).resolve() == wf.resolve()
    assert wf.is_file()
    assert "# Hello workflow" in wf.read_text(encoding="utf-8")


def test_workflow_create_explicit_mode(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod),
        "workflow",
        {"name": "hello", "mode": "create", "content": "# Hello\n"},
        cwd=str(root),
    )
    assert _workflow_md(mod, "hello").is_file()


def test_workflow_create_duplicate_raises(tmp_path):
    """FileExistsError from Workflow.create must propagate — the
    services layer never swallows create-on-existing."""
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "workflow",
        {"name": "dup", "content": "first\n"},
        cwd=str(root),
    )
    with pytest.raises(FileExistsError):
        edit_module(
            str(mod), "workflow",
            {"name": "dup", "content": "second\n"},
            cwd=str(root),
        )


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_workflow_update_replaces_body(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "workflow",
        {"name": "wf1", "content": "original body\n"},
        cwd=str(root),
    )
    edit_module(
        str(mod), "workflow",
        {"name": "wf1", "mode": "update", "content": "replaced body\n"},
        cwd=str(root),
    )
    contents = _workflow_md(mod, "wf1").read_text(encoding="utf-8")
    assert "replaced body" in contents
    assert "original body" not in contents


def test_workflow_update_missing_raises_filenotfound(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(FileNotFoundError, match="does not exist"):
        edit_module(
            str(mod), "workflow",
            {"name": "ghost", "mode": "update", "content": "x\n"},
            cwd=str(root),
        )


def test_workflow_update_requires_content(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "workflow",
        {"name": "wf1", "content": "seed\n"},
        cwd=str(root),
    )
    with pytest.raises(ValueError, match="content is required"):
        edit_module(
            str(mod), "workflow",
            {"name": "wf1", "mode": "update"},
            cwd=str(root),
        )


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_workflow_delete_removes_file(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "workflow",
        {"name": "victim", "content": "byebye\n"},
        cwd=str(root),
    )
    wf = _workflow_md(mod, "victim")
    assert wf.is_file()

    edit_module(
        str(mod), "workflow",
        {"name": "victim", "mode": "delete"},
        cwd=str(root),
    )
    assert not wf.exists()


def test_workflow_delete_removes_empty_parent_dir(tmp_path):
    """The dir cleanup is a services-layer responsibility (not primitives)."""
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "workflow",
        {"name": "solo", "content": "one and only\n"},
        cwd=str(root),
    )
    wf_dir = mod / ".dna" / "workflows" / "solo"
    assert wf_dir.is_dir()

    edit_module(
        str(mod), "workflow",
        {"name": "solo", "mode": "delete"},
        cwd=str(root),
    )
    assert not wf_dir.exists(), (
        "services-layer delete must rmdir the now-empty <name>/ parent"
    )


def test_workflow_delete_missing_is_idempotent(tmp_path):
    """WorkflowCollection.remove is silently idempotent when the file is
    absent (see cbi.resources.dna_module.WorkflowCollection.remove); the
    services delete path must preserve that idempotency, not turn it
    into an error."""
    root, mod = _make_project(tmp_path)
    # No workflow named "phantom" has ever been created.
    result = edit_module(
        str(mod), "workflow",
        {"name": "phantom", "mode": "delete"},
        cwd=str(root),
    )
    # Path is returned; the workflow dir simply doesn't exist.
    assert "phantom" in Path(result).as_posix()


def test_workflow_delete_rejects_content(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "workflow",
        {"name": "wf1", "content": "seed\n"},
        cwd=str(root),
    )
    with pytest.raises(ValueError, match="not accepted for target=workflow, mode=delete"):
        edit_module(
            str(mod), "workflow",
            {"name": "wf1", "mode": "delete", "content": "should not be here"},
            cwd=str(root),
        )


def test_workflow_delete_raises_on_residual_files(tmp_path):
    """If the <name>/ dir still contains other files after workflow.md
    is unlinked, services must raise (never silently rmtree)."""
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "workflow",
        {"name": "wf1", "content": "seed\n"},
        cwd=str(root),
    )
    wf_dir = mod / ".dna" / "workflows" / "wf1"
    (wf_dir / "extra.txt").write_text("stowaway\n", encoding="utf-8")

    with pytest.raises(RuntimeError, match="not empty"):
        edit_module(
            str(mod), "workflow",
            {"name": "wf1", "mode": "delete"},
            cwd=str(root),
        )
    # Stowaway must survive — no destructive fallback.
    assert (wf_dir / "extra.txt").is_file()


# ---------------------------------------------------------------------------
# Mode validation
# ---------------------------------------------------------------------------

def test_workflow_rejects_unknown_mode(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(ValueError, match="must be one of"):
        edit_module(
            str(mod), "workflow",
            {"name": "wf1", "mode": "obliterate", "content": "x\n"},
            cwd=str(root),
        )


# ---------------------------------------------------------------------------
# Reindex — every write path re-warms the retrieval index
# ---------------------------------------------------------------------------

def test_workflow_create_triggers_reindex(tmp_path, monkeypatch):
    from services import _reindex
    root, mod = _make_project(tmp_path)
    calls: list[tuple[Path, Path]] = []
    monkeypatch.setattr(_reindex, "reindex_dna",
                        lambda r, m: calls.append((Path(r), Path(m))))
    edit_module(
        str(mod), "workflow",
        {"name": "wf1", "content": "seed\n"},
        cwd=str(root),
    )
    assert len(calls) == 1


def test_workflow_update_triggers_reindex(tmp_path, monkeypatch):
    from services import _reindex
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "workflow",
        {"name": "wf1", "content": "seed\n"},
        cwd=str(root),
    )
    calls: list[tuple[Path, Path]] = []
    monkeypatch.setattr(_reindex, "reindex_dna",
                        lambda r, m: calls.append((Path(r), Path(m))))
    edit_module(
        str(mod), "workflow",
        {"name": "wf1", "mode": "update", "content": "new\n"},
        cwd=str(root),
    )
    assert len(calls) == 1


def test_workflow_delete_triggers_reindex(tmp_path, monkeypatch):
    from services import _reindex
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "workflow",
        {"name": "wf1", "content": "seed\n"},
        cwd=str(root),
    )
    calls: list[tuple[Path, Path]] = []
    monkeypatch.setattr(_reindex, "reindex_dna",
                        lambda r, m: calls.append((Path(r), Path(m))))
    edit_module(
        str(mod), "workflow",
        {"name": "wf1", "mode": "delete"},
        cwd=str(root),
    )
    assert len(calls) == 1
