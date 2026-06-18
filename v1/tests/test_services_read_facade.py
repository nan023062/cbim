"""Batch 2 — services read façade smoke tests.

The facade exists so engine.* / mcp_server.* never need to import
from cbi._primitives directly. The banned-api ruff rule (TID251)
locks that boundary in; these tests pin the *behaviour* the boundary
preserves: each new service read function returns the right shape on
hit and the right empty-marker on miss.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def _make_project_with_module(tmp_path: Path) -> tuple[Path, Path]:
    """Minimal project + one .dna/ leaf module."""
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
        "keywords:\n"
        "  - alpha\n"
        "  - beta\n"
        "status: implemented\n"
        "---\n"
        "## Positioning\nbody text\n",
        encoding="utf-8",
    )
    return root, mod


def test_get_module_returns_full_shape(tmp_path):
    from services import get_module
    root, mod = _make_project_with_module(tmp_path)
    info = get_module(str(mod), cwd=str(root))
    assert info is not None
    assert info["name"] == "Foo"
    assert info["owner"] == "platform"
    assert info["description"] == "a foo"
    assert info["keywords"] == ["alpha", "beta"]
    # v2 dropped `dependencies` from the schema; the facade must not
    # surface it.
    assert "dependencies" not in info
    assert "body text" in info["body"]
    assert info["contract"] == ""  # missing contract.md is not an error
    assert info["workflows"] == []
    assert info["module_dir"] == mod.resolve()


def test_get_module_returns_none_when_missing(tmp_path):
    from services import get_module
    root = tmp_path / "proj"
    (root / ".cbim").mkdir(parents=True)
    assert get_module("nope", cwd=str(root)) is None


def test_build_snapshot_returns_string(tmp_path, monkeypatch):
    """Walk-up resolves the project root from a sub-directory.

    This is also the Batch-1 bug-fix gate: pre-Batch-1, snapshot took
    raw `cwd` and produced an empty tree when called from a sub-dir.
    """
    from services import build_snapshot
    root, mod = _make_project_with_module(tmp_path)
    out = build_snapshot(cwd=str(mod))  # invoke from sub-dir
    assert isinstance(out, str)
    # The snapshot must mention the module under its registered path,
    # which means the walk-up landed on `root` (not `mod`).
    assert "src/foo" in out or "src\\foo" in out or "Foo" in out


def test_get_module_fm_schema_shape():
    from services import get_module_fm_schema
    schema = get_module_fm_schema()
    assert "list_fields" in schema and "status_values" in schema
    # v2 schema (PR-1): only `keywords` and `links` are list-typed at
    # the schema level; `dependencies` / `includeDirs` were removed.
    assert "keywords" in schema["list_fields"]
    assert "links" in schema["list_fields"]
    assert "dependencies" not in schema["list_fields"]
    assert "includeDirs" not in schema["list_fields"]
    assert schema["status_values"] == ("spec", "planned", "implemented")
    # Must be hashable / immutable (stable contract for callers).
    assert isinstance(schema["list_fields"], frozenset)
    assert isinstance(schema["status_values"], tuple)


def test_get_agent_returns_full_shape(tmp_path):
    from services import get_agent
    root = tmp_path / "proj"
    (root / ".cbim").mkdir(parents=True)
    agent_dir = root / ".claude" / "agents" / "myagent"
    agent_dir.mkdir(parents=True)
    (agent_dir / "myagent.md").write_text(
        "---\nname: myagent\ndescription: a test agent\nmodel: claude-x\ntools: Read\n---\n"
        "Agent body content here.\n",
        encoding="utf-8",
    )
    info = get_agent("myagent", cwd=str(root))
    assert info is not None
    assert info["id"] == "myagent"
    assert info["description"] == "a test agent"
    assert info["model"] == "claude-x"
    assert info["tools"] == "Read"
    assert info["skills"] == []
    assert "Agent body content here." in info["body"]
    assert info["agent_md_path"] == (agent_dir / "myagent.md").resolve()


def test_get_agent_rejects_traversal(tmp_path):
    from services import get_agent
    assert get_agent("../escape", cwd=str(tmp_path)) is None
    assert get_agent("a/b", cwd=str(tmp_path)) is None
    assert get_agent("..", cwd=str(tmp_path)) is None


def test_get_agent_returns_none_when_missing(tmp_path):
    from services import get_agent
    root = tmp_path / "proj"
    (root / ".cbim").mkdir(parents=True)
    assert get_agent("ghost", cwd=str(root)) is None


def test_list_skills_returns_list_of_keys():
    from services import list_skills
    keys = list_skills()
    assert isinstance(keys, list)
    # Built-ins ship in code; we know coordinator skills exist (memory_*).
    assert any("." in k or k for k in keys)  # at least non-empty
    assert all(isinstance(k, str) for k in keys)


def test_get_skill_returns_body_dict():
    from services import get_skill, list_skills
    keys = list_skills()
    if not keys:
        pytest.skip("no built-in skills shipped")
    info = get_skill(keys[0])
    assert info is not None
    assert info["name"] == keys[0]
    assert isinstance(info["body"], str)
    assert info["body"]  # non-empty body for any real skill


def test_get_skill_returns_none_when_missing():
    from services import get_skill
    assert get_skill("definitely-not-a-skill-xyz") is None
