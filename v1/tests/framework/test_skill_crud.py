"""Task F — services.skill_service write-facade CRUD tests.

Covers the five write methods introduced in Task B:

  create_agent_skill    update_agent_skill    delete_agent_skill
  add_skill_asset       remove_skill_asset

The primitive layer (cbi._primitives.skills) already has its own coverage
via other suites; here we pin the *service-layer* invariants: policy
guards (forbidden-agent list, executable-suffix gating, path-traversal
rejection) and the storage-form transitions (file-form → dir-form
auto-upgrade when the first asset lands).

Scope split (single-file test module):
  - Happy paths: create → update → add asset → delete, exercised on a
    real filesystem via tmp_path so both the primitive writes and the
    reindex side-effects run.
  - Policy guards: framework-owned agents rejected on every write path;
    executable-suffix assets without the flag rejected;
    path-traversal / absolute-path asset rel_paths rejected.
  - Storage form: `as_dir=True` creates dir-form directly; file-form
    skills promote to dir-form on the first `add_skill_asset` call.

We use ``scaffold_agent`` for bootstrap so the ``.claude/agents/<a>/``
tree is set up the way the real service layer expects (frontmatter,
skills/ dir). Framework-owned-agent tests skip bootstrap because the
guard fires before the agent directory is even inspected.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from services._fm import parse_frontmatter
from services._paths import PathOutsideRootError
from services.agent_service import scaffold_agent
from services.skill_service import (
    ExecutableAssetRequiresFlagError,
    ForbiddenAgentError,
    add_skill_asset,
    create_agent_skill,
    delete_agent_skill,
    remove_skill_asset,
    update_agent_skill,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_project(tmp_path: Path, agent: str = "worker") -> Path:
    """Bootstrap a minimal CBIM project with one user-owned agent.

    Returns the project root. The agent lives at
    ``<root>/.claude/agents/<agent>/<agent>.md``.
    """
    (tmp_path / ".cbim").mkdir()
    (tmp_path / ".cbim" / "config.json").write_text("{}", encoding="utf-8")
    scaffold_agent(agent, description="tester", cwd=str(tmp_path))
    return tmp_path


def _skills_dir(root: Path, agent: str) -> Path:
    return root / ".claude" / "agents" / agent / "skills"


# ---------------------------------------------------------------------------
# Happy path: create → update → add asset → delete
# ---------------------------------------------------------------------------

def test_full_lifecycle_file_form(tmp_path):
    """create (file-form) → update (body replace) → add non-exec asset → delete."""
    root = _make_project(tmp_path)

    # 1) create — file-form (default)
    created = create_agent_skill(
        "worker", "my_skill",
        body=(
            "---\n"
            "name: my_skill\n"
            "description: seed\n"
            "---\n\n"
            "## Original body\n"
        ),
        cwd=str(root),
    )
    md = Path(created)
    assert md.name == "my_skill.md"
    assert md.parent == _skills_dir(root, "worker").resolve()
    assert md.is_file()

    # 2) update — body replaced, frontmatter preserved
    update_agent_skill(
        "worker", "my_skill", "body",
        {"content": "## Replaced body\n\nfresh text\n"},
        cwd=str(root),
    )
    after = md.read_text(encoding="utf-8")
    assert "Original body" not in after
    assert "Replaced body" in after
    fm = parse_frontmatter(after)
    assert fm["name"] == "my_skill"
    assert fm["description"] == "seed"

    # 3) add asset — non-executable suffix, no flag; file-form auto-promotes.
    asset_path = add_skill_asset(
        "worker", "my_skill",
        "notes.txt",
        "hello asset\n",
        cwd=str(root),
    )
    ap = Path(asset_path)
    assert ap.is_file()
    assert ap.read_text(encoding="utf-8") == "hello asset\n"

    # After promotion the old file-form md is gone; dir-form skill.md holds body.
    assert not md.exists()
    dir_form = _skills_dir(root, "worker").resolve() / "my_skill"
    assert (dir_form / "skill.md").is_file()
    # Body preserved by the atomic promote-with-asset dance.
    assert "Replaced body" in (dir_form / "skill.md").read_text(encoding="utf-8")

    # No executable marker for a non-whitelisted suffix without the flag.
    marker = ap.with_name(ap.name + ".executable-declared")
    assert not marker.exists()

    # 4) delete — whole dir-form tree removed.
    removed = delete_agent_skill("worker", "my_skill", cwd=str(root))
    assert Path(removed) == dir_form
    assert not dir_form.exists()


def test_create_as_dir_true_makes_dir_form_directly(tmp_path):
    """`as_dir=True` yields `<skill>/skill.md` on first create, no file-form residue."""
    root = _make_project(tmp_path)
    created = create_agent_skill(
        "worker", "dir_skill",
        body="## Body\n",
        as_dir=True,
        cwd=str(root),
    )
    md = Path(created)
    assert md.name == "skill.md"
    assert md.parent.name == "dir_skill"
    assert md.parent.parent == _skills_dir(root, "worker").resolve()
    assert md.read_text(encoding="utf-8") == "## Body\n"
    # No file-form leftover.
    assert not (_skills_dir(root, "worker") / "dir_skill.md").exists()
    # assets/ is materialised lazily — not present until first add_skill_asset.
    assert not (md.parent / "assets").exists()


# ---------------------------------------------------------------------------
# Storage-form auto-upgrade on first asset
# ---------------------------------------------------------------------------

def test_add_asset_promotes_file_form_to_dir_form(tmp_path):
    """File-form → dir-form promotion is atomic and body-preserving."""
    root = _make_project(tmp_path)
    md = Path(create_agent_skill(
        "worker", "s1",
        body="## Content\nbody text\n",
        cwd=str(root),
    ))
    assert md.name == "s1.md" and md.is_file()

    add_skill_asset(
        "worker", "s1", "helper.md", "helper body\n",
        cwd=str(root),
    )

    # Original file-form md is gone; dir-form takes over.
    assert not md.exists()
    dir_path = _skills_dir(root, "worker").resolve() / "s1"
    assert dir_path.is_dir()
    assert (dir_path / "skill.md").is_file()
    assert "body text" in (dir_path / "skill.md").read_text(encoding="utf-8")
    assert (dir_path / "assets" / "helper.md").read_text(encoding="utf-8") == "helper body\n"


# ---------------------------------------------------------------------------
# Executable-suffix gating + marker file
# ---------------------------------------------------------------------------

def test_executable_suffix_with_flag_creates_marker(tmp_path):
    """Whitelisted suffix + `is_executable=True` → marker file appears."""
    root = _make_project(tmp_path)
    create_agent_skill("worker", "scripts", body="## S\n", as_dir=True, cwd=str(root))

    asset = Path(add_skill_asset(
        "worker", "scripts",
        "run.ps1", "Write-Host hi\n",
        is_executable=True,
        cwd=str(root),
    ))
    assert asset.is_file()
    marker = asset.with_name(asset.name + ".executable-declared")
    assert marker.exists()
    assert marker.stat().st_size == 0, "marker must be zero bytes"


def test_executable_suffix_without_flag_is_rejected(tmp_path):
    """Whitelisted suffix + `is_executable=False` → ExecutableAssetRequiresFlagError."""
    root = _make_project(tmp_path)
    create_agent_skill("worker", "scripts", body="## S\n", as_dir=True, cwd=str(root))

    with pytest.raises(ExecutableAssetRequiresFlagError, match="executable suffix"):
        add_skill_asset(
            "worker", "scripts",
            "run.sh", "#!/bin/sh\necho hi\n",
            is_executable=False,
            cwd=str(root),
        )
    # And no artifact should have landed.
    assert not (
        _skills_dir(root, "worker") / "scripts" / "assets" / "run.sh"
    ).exists()


def test_remove_asset_removes_marker_too(tmp_path):
    """`remove_skill_asset` clears both the asset and its sibling marker."""
    root = _make_project(tmp_path)
    create_agent_skill("worker", "scripts", body="## S\n", as_dir=True, cwd=str(root))
    asset = Path(add_skill_asset(
        "worker", "scripts",
        "run.ps1", "Write-Host hi\n",
        is_executable=True,
        cwd=str(root),
    ))
    marker = asset.with_name(asset.name + ".executable-declared")
    assert asset.exists() and marker.exists()

    removed = remove_skill_asset("worker", "scripts", "run.ps1", cwd=str(root))
    assert Path(removed) == asset
    assert not asset.exists()
    assert not marker.exists(), "marker must be cleaned up in the same call"


# ---------------------------------------------------------------------------
# Same-name conflict
# ---------------------------------------------------------------------------

def test_create_conflict_raises_file_exists(tmp_path):
    """Re-creating an existing skill (either form) is a FileExistsError."""
    root = _make_project(tmp_path)
    create_agent_skill("worker", "dup", body="## First\n", cwd=str(root))
    with pytest.raises(FileExistsError):
        create_agent_skill("worker", "dup", body="## Second\n", cwd=str(root))


# ---------------------------------------------------------------------------
# Framework-owned agents rejected on every write path
# ---------------------------------------------------------------------------

_FORBIDDEN = ("architect", "auditor", "hr", "programmer")


@pytest.mark.parametrize("agent", _FORBIDDEN)
def test_forbidden_agent_rejects_create(tmp_path, agent):
    (tmp_path / ".cbim").mkdir()
    with pytest.raises(ForbiddenAgentError):
        create_agent_skill(agent, "any", body="", cwd=str(tmp_path))


@pytest.mark.parametrize("agent", _FORBIDDEN)
def test_forbidden_agent_rejects_update(tmp_path, agent):
    (tmp_path / ".cbim").mkdir()
    with pytest.raises(ForbiddenAgentError):
        update_agent_skill(
            agent, "any", "body", {"content": "x"}, cwd=str(tmp_path),
        )


@pytest.mark.parametrize("agent", _FORBIDDEN)
def test_forbidden_agent_rejects_delete(tmp_path, agent):
    (tmp_path / ".cbim").mkdir()
    with pytest.raises(ForbiddenAgentError):
        delete_agent_skill(agent, "any", cwd=str(tmp_path))


@pytest.mark.parametrize("agent", _FORBIDDEN)
def test_forbidden_agent_rejects_add_asset(tmp_path, agent):
    (tmp_path / ".cbim").mkdir()
    with pytest.raises(ForbiddenAgentError):
        add_skill_asset(
            agent, "any", "a.txt", "x", cwd=str(tmp_path),
        )


@pytest.mark.parametrize("agent", _FORBIDDEN)
def test_forbidden_agent_rejects_remove_asset(tmp_path, agent):
    (tmp_path / ".cbim").mkdir()
    with pytest.raises(ForbiddenAgentError):
        remove_skill_asset(agent, "any", "a.txt", cwd=str(tmp_path))


# ---------------------------------------------------------------------------
# Path traversal / absolute paths rejected on asset writes
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad_path", [
    "../outside.txt",              # parent traversal
    "sub/../../oops.txt",           # multi-hop traversal
    "/etc/passwd",                  # absolute posix
    "\\Windows\\System32\\evil.dll",  # absolute windows (leading backslash)
    "C:\\Windows\\evil.dll",        # absolute drive-letter windows
    "C:foo",                        # drive-relative windows
    "",                             # empty
])
def test_path_traversal_rejected(tmp_path, bad_path):
    """Path escapes and drive-relative/absolute forms are rejected pre-write."""
    root = _make_project(tmp_path)
    create_agent_skill("worker", "s", body="## S\n", as_dir=True, cwd=str(root))
    # PathOutsideRootError <: ValueError; either matches the "ValueError族".
    with pytest.raises(ValueError):
        add_skill_asset(
            "worker", "s", bad_path, "payload\n", cwd=str(root),
        )


def test_remove_asset_path_traversal_rejected(tmp_path):
    """`remove_skill_asset` runs the same guard as `add_skill_asset`."""
    root = _make_project(tmp_path)
    create_agent_skill("worker", "s", body="## S\n", as_dir=True, cwd=str(root))
    with pytest.raises(PathOutsideRootError):
        remove_skill_asset("worker", "s", "../escape.txt", cwd=str(root))
