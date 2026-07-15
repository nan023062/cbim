"""Task F — engine.audit.checks.skill_scripts finding coverage.

Confirms each of the four finding codes the check emits fires when — and
only when — its trigger conditions are met, plus the empty-return
guarantee on a clean tree:

  SKILL_SCRIPT_UNTRACKED_EXTENSION     warn      exec-suffix asset with no
                                                  sibling .executable-declared
  SKILL_SCRIPT_SIZE                    info/warn/error
                                                  banded on size vs threshold
  SKILL_SCRIPT_OUTSIDE_ASSETS          error     exec-suffix file at skill root
                                                  (sibling of skill.md)
  SKILL_SCRIPT_CORE_AGENT_VIOLATION    error     any asset under a core agent's
                                                  skills/<skill>/assets/

Scope split (mirrors the check's own layout):
  * Non-core agent scenarios: the first three codes apply; the
    core-agent code must NOT fire.
  * Core agent scenarios: only the core-agent code fires; the check
    deliberately suppresses the finer-grained findings on core agents
    to avoid drowning the report.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from engine.audit.checks.skill_scripts import check


# ---------------------------------------------------------------------------
# Fixtures — bare filesystem, no CBIM project bootstrap needed.
# ---------------------------------------------------------------------------

def _skill_dir(root: Path, agent: str, skill: str) -> Path:
    """Materialise `<root>/.claude/agents/<agent>/skills/<skill>/skill.md`."""
    d = root / ".claude" / "agents" / agent / "skills" / skill
    d.mkdir(parents=True, exist_ok=True)
    (d / "skill.md").write_text("## Body\n", encoding="utf-8")
    return d


def _asset(skill_dir: Path, rel_path: str, content: bytes | str = b"x") -> Path:
    """Write an asset under `<skill>/assets/<rel_path>`. Returns absolute path."""
    target = skill_dir / "assets" / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, str):
        target.write_text(content, encoding="utf-8")
    else:
        target.write_bytes(content)
    return target


def _codes(findings) -> list[str]:
    return sorted(f.code for f in findings)


def _by_code(findings) -> dict[str, list]:
    out: dict[str, list] = {}
    for f in findings:
        out.setdefault(f.code, []).append(f)
    return out


# ---------------------------------------------------------------------------
# Empty state — clean tree yields no findings.
# ---------------------------------------------------------------------------

def test_no_agents_dir_returns_empty(tmp_path):
    """Project without `.claude/agents/` — the check must not crash."""
    assert check(tmp_path, {}) == []


def test_agent_with_no_skills_returns_empty(tmp_path):
    """Agent dir with no `skills/` subdirectory — no findings."""
    (tmp_path / ".claude" / "agents" / "worker").mkdir(parents=True)
    assert check(tmp_path, {}) == []


def test_clean_dir_form_skill_returns_empty(tmp_path):
    """Non-core agent, dir-form skill, one non-exec small asset — no findings."""
    d = _skill_dir(tmp_path, "worker", "s1")
    _asset(d, "notes.txt", b"tiny")
    assert check(tmp_path, {}) == []


def test_marker_present_suppresses_untracked_extension(tmp_path):
    """Exec-suffix asset WITH the sibling `.executable-declared` marker
    must NOT fire SKILL_SCRIPT_UNTRACKED_EXTENSION."""
    d = _skill_dir(tmp_path, "worker", "s1")
    asset = _asset(d, "run.ps1", b"Write-Host hi")
    asset.with_name(asset.name + ".executable-declared").write_bytes(b"")
    findings = check(tmp_path, {})
    assert "SKILL_SCRIPT_UNTRACKED_EXTENSION" not in _codes(findings)


# ---------------------------------------------------------------------------
# SKILL_SCRIPT_UNTRACKED_EXTENSION
# ---------------------------------------------------------------------------

def test_untracked_extension_fires_without_marker(tmp_path):
    d = _skill_dir(tmp_path, "worker", "s1")
    _asset(d, "run.ps1", b"Write-Host hi")

    findings = check(tmp_path, {})
    codes = _codes(findings)
    assert "SKILL_SCRIPT_UNTRACKED_EXTENSION" in codes

    # Exactly one finding of this code, pointing at the offending asset.
    matches = [f for f in findings if f.code == "SKILL_SCRIPT_UNTRACKED_EXTENSION"]
    assert len(matches) == 1
    f = matches[0]
    assert f.severity == "warn"
    assert f.target.endswith("worker/skills/s1/assets/run.ps1")
    assert f.metadata["suffix"] == ".ps1"


# ---------------------------------------------------------------------------
# SKILL_SCRIPT_SIZE
# ---------------------------------------------------------------------------

def test_size_finding_fires_at_or_above_threshold(tmp_path):
    """A 100-byte asset against a 100-byte threshold lands in the `warn` band."""
    d = _skill_dir(tmp_path, "worker", "s1")
    _asset(d, "big.md", b"x" * 100)  # non-exec suffix keeps size the only finding

    findings = check(tmp_path, {"skill_scripts": {"size_bytes": 100}})
    matches = [f for f in findings if f.code == "SKILL_SCRIPT_SIZE"]
    assert len(matches) == 1
    f = matches[0]
    assert f.severity == "warn"
    assert f.target.endswith("worker/skills/s1/assets/big.md")
    assert f.metadata["size_bytes"] == 100
    assert f.metadata["threshold_bytes"] == 100


def test_size_finding_below_info_band_is_silent(tmp_path):
    """`< 0.8 * threshold` bytes → no size finding."""
    d = _skill_dir(tmp_path, "worker", "s1")
    _asset(d, "small.md", b"x" * 50)  # 50 < 0.8 * 100 = 80
    findings = check(tmp_path, {"skill_scripts": {"size_bytes": 100}})
    assert not any(f.code == "SKILL_SCRIPT_SIZE" for f in findings)


# ---------------------------------------------------------------------------
# SKILL_SCRIPT_OUTSIDE_ASSETS
# ---------------------------------------------------------------------------

def test_outside_assets_fires_for_exec_suffix_at_skill_root(tmp_path):
    """Exec-suffix file at `<skill>/` (sibling of `skill.md`) → error."""
    d = _skill_dir(tmp_path, "worker", "s1")
    (d / "rogue.sh").write_text("#!/bin/sh\necho hi\n", encoding="utf-8")

    findings = check(tmp_path, {})
    matches = [f for f in findings if f.code == "SKILL_SCRIPT_OUTSIDE_ASSETS"]
    assert len(matches) == 1
    f = matches[0]
    assert f.severity == "error"
    assert f.target.endswith("worker/skills/s1/rogue.sh")


def test_outside_assets_ignores_non_exec_file_at_skill_root(tmp_path):
    """Non-exec-suffix root-level file at `<skill>/` is NOT the target of
    this check — the point is illicit *executable* placement."""
    d = _skill_dir(tmp_path, "worker", "s1")
    (d / "README.md").write_text("free-form readme", encoding="utf-8")
    findings = check(tmp_path, {})
    assert not any(f.code == "SKILL_SCRIPT_OUTSIDE_ASSETS" for f in findings)


# ---------------------------------------------------------------------------
# SKILL_SCRIPT_CORE_AGENT_VIOLATION
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("core_agent", ["architect", "auditor", "hr", "programmer"])
def test_core_agent_violation_fires_for_any_asset(tmp_path, core_agent):
    """Any asset under a core-agent's `skills/<skill>/assets/` — even a
    plain text file — is a violation."""
    d = _skill_dir(tmp_path, core_agent, "s1")
    _asset(d, "plain.txt", b"harmless-looking")

    findings = check(tmp_path, {})
    matches = [f for f in findings if f.code == "SKILL_SCRIPT_CORE_AGENT_VIOLATION"]
    assert len(matches) == 1
    f = matches[0]
    assert f.severity == "error"
    assert f.target.endswith(f"{core_agent}/skills/s1/assets/plain.txt")
    assert f.metadata["agent_name"] == core_agent


def test_core_agent_suppresses_other_findings(tmp_path):
    """When the agent is core, the finer-grained findings must NOT re-emit —
    the core-agent breach is the point, layering others would drown the report.
    """
    d = _skill_dir(tmp_path, "architect", "s1")
    _asset(d, "run.ps1", b"Write-Host hi")   # would normally fire UNTRACKED_EXTENSION
    _asset(d, "big.md", b"x" * 1000)          # would normally fire SIZE
    # Also a root-level exec file — would normally fire OUTSIDE_ASSETS.
    (d / "rogue.sh").write_text("#!/bin/sh\n", encoding="utf-8")

    findings = check(tmp_path, {"skill_scripts": {"size_bytes": 100}})
    codes = set(_codes(findings))
    assert "SKILL_SCRIPT_CORE_AGENT_VIOLATION" in codes
    # Sibling non-core-agent codes must NOT fire on a core agent.
    assert "SKILL_SCRIPT_UNTRACKED_EXTENSION" not in codes
    assert "SKILL_SCRIPT_SIZE" not in codes
    assert "SKILL_SCRIPT_OUTSIDE_ASSETS" not in codes


# ---------------------------------------------------------------------------
# All four in one project — the full-menu regression.
# ---------------------------------------------------------------------------

def test_all_four_codes_fire_simultaneously(tmp_path):
    """One project set up so every code trigger fires exactly once."""
    # Non-core agent: three findings (UNTRACKED_EXTENSION, SIZE, OUTSIDE_ASSETS).
    worker = _skill_dir(tmp_path, "worker", "s1")
    _asset(worker, "run.ps1", b"Write-Host hi")   # UNTRACKED_EXTENSION
    _asset(worker, "big.md", b"x" * 100)           # SIZE (100 == threshold)
    (worker / "rogue.sh").write_text("#!/bin/sh\n", encoding="utf-8")  # OUTSIDE_ASSETS

    # Core agent: one finding (CORE_AGENT_VIOLATION).
    core = _skill_dir(tmp_path, "architect", "s1")
    _asset(core, "note.txt", b"harmless")          # CORE_AGENT_VIOLATION

    findings = check(tmp_path, {"skill_scripts": {"size_bytes": 100}})
    grouped = _by_code(findings)

    assert set(grouped) == {
        "SKILL_SCRIPT_UNTRACKED_EXTENSION",
        "SKILL_SCRIPT_SIZE",
        "SKILL_SCRIPT_OUTSIDE_ASSETS",
        "SKILL_SCRIPT_CORE_AGENT_VIOLATION",
    }
    for code, items in grouped.items():
        assert len(items) == 1, f"{code} fired {len(items)} times, want 1"
