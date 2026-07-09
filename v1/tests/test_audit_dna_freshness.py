"""Unit tests for engine.audit.checks.dna_freshness.

Freshness compares each module.md's ``body_edited_at`` frontmatter stamp
against the newest git commit touching the module's code (with the
module's own ``.dna/`` subtree and any registered child module subtrees
excluded). The check must:

  * skip modules that have no ``body_edited_at`` (not yet migrated),
  * skip when the project isn't a git repo,
  * skip when the module has no git-tracked code under it,
  * ignore child-module commits when scoring a parent's freshness,
  * emit a fingerprint-stable finding — the ``message`` field is static;
    the mutable values live in ``metadata``. This is the invariant that
    lets the audit baseline mechanism accept a stale doc without churn
    on every subsequent run.
"""
from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

import pytest

from cbi._primitives.modules import ensure_registry
from cbi._primitives.modules.registry import _write_index
from engine.audit import run_audit
from engine.audit.baseline import BaselineStore, fingerprint
from engine.audit.checks.dna_freshness import check


# ---------------------------------------------------------------------------
# git + fs fixture helpers
# ---------------------------------------------------------------------------


def _run_git(root: Path, *args: str, when: str | None = None) -> None:
    """Run ``git <args>`` in ``root``. Optional ``when`` (ISO-8601 with tz)
    sets both author and committer timestamps for commits.

    Uses a minimal identity so the temp repo doesn't need global git config,
    and disables gpg signing which would otherwise pop up if the user's
    global config sets ``commit.gpgsign = true``.
    """
    env = os.environ.copy()
    env["GIT_AUTHOR_NAME"] = "cbim-test"
    env["GIT_AUTHOR_EMAIL"] = "test@cbim.local"
    env["GIT_COMMITTER_NAME"] = "cbim-test"
    env["GIT_COMMITTER_EMAIL"] = "test@cbim.local"
    if when is not None:
        env["GIT_AUTHOR_DATE"] = when
        env["GIT_COMMITTER_DATE"] = when
    subprocess.run(
        ["git", "-C", str(root), *args],
        check=True,
        capture_output=True,
        env=env,
    )


def _git_available() -> bool:
    try:
        subprocess.run(
            ["git", "--version"], check=True, capture_output=True, timeout=5
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return True


pytestmark = pytest.mark.skipif(
    not _git_available(),
    reason="git binary not available; dna_freshness check degrades to empty",
)


def _seed_repo(root: Path) -> None:
    """Initialize a bare git repo with the CBIM registry seeded."""
    ensure_registry(root)
    _run_git(root, "init", "-q", "-b", "main")
    _run_git(root, "config", "commit.gpgsign", "false")


def _register(root: Path, rel_paths: list[str]) -> None:
    _write_index(root, rel_paths)


def _write_module_md(
    root: Path,
    rel: str,
    *,
    name: str,
    body_edited_at: str | None,
    body: str = "body\n",
) -> Path:
    """Write a v2-conformant module.md, optionally including the stamp."""
    mod_dir = root if rel == "." else (root / rel)
    dna = mod_dir / ".dna"
    dna.mkdir(parents=True, exist_ok=True)
    lines = [
        "---",
        f"name: {name}",
        "owner: x",
        "description: m",
        "keywords: []",
        "status: implemented",
    ]
    if body_edited_at is not None:
        lines.append(f"body_edited_at: {body_edited_at}")
    lines.append("---")
    module_md = dna / "module.md"
    module_md.write_text("\n".join(lines) + "\n\n" + body, encoding="utf-8")
    return module_md


def _write_code_file(root: Path, rel_path: str, content: str = "code\n") -> Path:
    """Write a code file under the module directory."""
    target = root / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


def _commit_all(root: Path, *, when: str, message: str = "wip") -> None:
    _run_git(root, "add", "-A")
    _run_git(root, "commit", "-q", "-m", message, when=when)


# ---------------------------------------------------------------------------
# 1. body_edited_at missing -> skip
# ---------------------------------------------------------------------------


def test_missing_body_edited_at_is_skipped(tmp_path):
    _seed_repo(tmp_path)
    _register(tmp_path, ["alpha"])
    _write_module_md(tmp_path, "alpha", name="alpha", body_edited_at=None)
    _write_code_file(tmp_path, "alpha/src.py")
    _commit_all(tmp_path, when="2026-06-01T12:00:00+00:00")

    findings = check(tmp_path, {})
    assert findings == [], (
        "modules without body_edited_at must be skipped silently "
        "(pre-migration state)"
    )


# ---------------------------------------------------------------------------
# 2..5. severity bands
# ---------------------------------------------------------------------------


def _stamp_str(iso_utc: str) -> str:
    """Convert '2026-06-01T12:00:00+00:00' to '2026-06-01T12:00:00Z'."""
    return iso_utc.replace("+00:00", "Z")


def _setup_stale_module(
    tmp_path: Path,
    *,
    commit_when: str,
    stamp_when: str,
    rel: str = "alpha",
) -> None:
    _seed_repo(tmp_path)
    _register(tmp_path, [rel])
    _write_module_md(
        tmp_path, rel, name=rel, body_edited_at=_stamp_str(stamp_when)
    )
    _write_code_file(tmp_path, f"{rel}/src.py")
    _commit_all(tmp_path, when=commit_when)


def test_three_days_stale_no_finding(tmp_path):
    # 3 days < 0.8 * 7 = 5.6 → below info band → 0 findings.
    _setup_stale_module(
        tmp_path,
        commit_when="2026-06-10T12:00:00+00:00",
        stamp_when="2026-06-07T12:00:00+00:00",
    )
    assert check(tmp_path, {}) == []


def test_six_days_stale_info(tmp_path):
    _setup_stale_module(
        tmp_path,
        commit_when="2026-06-10T12:00:00+00:00",
        stamp_when="2026-06-04T12:00:00+00:00",
    )
    findings = check(tmp_path, {})
    assert len(findings) == 1
    f = findings[0]
    assert f.check == "dna_freshness"
    assert f.code == "DNA_FRESHNESS_STALE"
    assert f.severity == "info"
    assert f.target == "alpha"
    assert f.metadata["days_stale"] == 6


def test_seven_days_stale_warn(tmp_path):
    _setup_stale_module(
        tmp_path,
        commit_when="2026-06-10T12:00:00+00:00",
        stamp_when="2026-06-03T12:00:00+00:00",
    )
    findings = check(tmp_path, {})
    assert len(findings) == 1
    assert findings[0].severity == "warn"
    assert findings[0].metadata["days_stale"] == 7


def test_eleven_days_stale_error(tmp_path):
    _setup_stale_module(
        tmp_path,
        commit_when="2026-06-12T12:00:00+00:00",
        stamp_when="2026-06-01T12:00:00+00:00",
    )
    findings = check(tmp_path, {})
    assert len(findings) == 1
    assert findings[0].severity == "error"
    assert findings[0].metadata["days_stale"] == 11


# ---------------------------------------------------------------------------
# 6. non-git project degrades gracefully
# ---------------------------------------------------------------------------


def test_non_git_project_returns_empty(tmp_path):
    """No `git init` — check must not crash and must produce zero findings."""
    ensure_registry(tmp_path)
    _register(tmp_path, ["alpha"])
    _write_module_md(
        tmp_path, "alpha", name="alpha",
        body_edited_at="2020-01-01T00:00:00Z",
    )
    _write_code_file(tmp_path, "alpha/src.py")

    findings = check(tmp_path, {})
    assert findings == []


# ---------------------------------------------------------------------------
# 7. child module's commit must not age the parent
# ---------------------------------------------------------------------------


def test_child_module_commit_does_not_age_parent(tmp_path):
    """Parent's freshness scope excludes registered child subtrees.

    Layout: parent `alpha`, child `alpha/beta`. Parent has an ancient stamp
    and no *own* code changes; only the child has recent commits. The
    parent's freshness score must therefore be based on nothing (no code
    outside the excluded child) → 0 findings for the parent.
    """
    _seed_repo(tmp_path)
    _register(tmp_path, ["alpha", "alpha/beta"])
    _write_module_md(
        tmp_path, "alpha", name="alpha",
        body_edited_at="2020-01-01T00:00:00Z",
    )
    _write_module_md(
        tmp_path, "alpha/beta", name="alpha_beta",
        body_edited_at="2026-06-15T00:00:00Z",
    )
    # Child code commit is very recent; parent has NO code files of its own.
    _write_code_file(tmp_path, "alpha/beta/src.py")
    _commit_all(tmp_path, when="2026-06-20T12:00:00+00:00")

    findings = check(tmp_path, {})
    parent_findings = [f for f in findings if f.target == "alpha"]
    assert parent_findings == [], (
        "child commit spuriously aged parent — the exclude pathspec is broken"
    )


# ---------------------------------------------------------------------------
# 8. module with only .dna/ contents (no tracked code) -> skip
# ---------------------------------------------------------------------------


def test_dna_only_module_is_skipped(tmp_path):
    """A module whose only tracked files live under `.dna/` has no `code`
    for freshness math — the check must gracefully skip it."""
    _seed_repo(tmp_path)
    _register(tmp_path, ["alpha"])
    _write_module_md(
        tmp_path, "alpha", name="alpha",
        body_edited_at="2020-01-01T00:00:00Z",
    )
    # Commit only the .dna/ file itself.
    _commit_all(tmp_path, when="2026-06-20T12:00:00+00:00")

    findings = check(tmp_path, {})
    alpha_findings = [f for f in findings if f.target == "alpha"]
    assert alpha_findings == [], (
        "module without git-tracked code under it must be skipped"
    )


# ---------------------------------------------------------------------------
# 9. fingerprint stability across repeated runs
# ---------------------------------------------------------------------------


def _finding_fp_tuple(f) -> tuple[str, str, str, str]:
    """The (check, code, target, sha256(message)) fingerprint tuple."""
    return (
        f.check or "",
        f.code or "",
        f.target or "",
        hashlib.sha256((f.message or "").encode("utf-8")).hexdigest(),
    )


def test_fingerprint_is_stable_across_repeated_runs(tmp_path):
    """Run the check three times against the same stale scenario; the
    (check, code, target, sha256(message)) tuple MUST be identical every
    time.

    Regression guard against message wording drifting per run (e.g. mixing
    a day count or timestamp into the human text). The audit baseline
    keys off that fingerprint, so anything variable ruins acceptance.
    """
    _setup_stale_module(
        tmp_path,
        commit_when="2026-06-12T12:00:00+00:00",
        stamp_when="2026-06-01T12:00:00+00:00",
    )
    fp_tuples: list[tuple[str, str, str, str]] = []
    fp_hashes: list[str] = []
    for _ in range(3):
        findings = check(tmp_path, {})
        assert len(findings) == 1, findings
        fp_tuples.append(_finding_fp_tuple(findings[0]))
        fp_hashes.append(fingerprint(findings[0]))

    assert len(set(fp_tuples)) == 1, (
        f"fingerprint tuple drifted across runs: {fp_tuples}"
    )
    assert len(set(fp_hashes)) == 1, (
        f"baseline fingerprint hash drifted across runs: {fp_hashes}"
    )


def test_message_carries_no_mutable_values(tmp_path):
    """Belt-and-braces companion to the stability test: the message must
    not literally contain the day count or either timestamp. Those live
    in metadata; message stays static."""
    _setup_stale_module(
        tmp_path,
        commit_when="2026-06-12T12:00:00+00:00",
        stamp_when="2026-06-01T12:00:00+00:00",
    )
    findings = check(tmp_path, {})
    assert len(findings) == 1
    msg = findings[0].message
    md = findings[0].metadata
    # Days stale + both timestamps live in metadata.
    assert "days_stale" in md
    assert "body_edited_at" in md
    assert "latest_code_commit_at" in md
    # Absent from the human-facing message.
    assert str(md["days_stale"]) not in msg, msg
    assert md["body_edited_at"] not in msg, msg
    assert md["latest_code_commit_at"] not in msg, msg


# ---------------------------------------------------------------------------
# 10. lenient baseline: baselined findings downgrade one notch
# ---------------------------------------------------------------------------


def test_baseline_accept_downgrades_next_run(tmp_path):
    """`dna_freshness` is a lenient check → once accepted, subsequent runs
    surface the same finding with origin='baseline' and severity dropped
    one step (warn → info here).
    """
    _setup_stale_module(
        tmp_path,
        commit_when="2026-06-10T12:00:00+00:00",
        stamp_when="2026-06-03T12:00:00+00:00",
    )

    # Strict run to see the raw severity (warn @ 7 days).
    first = run_audit(tmp_path, baseline_mode="strict", checks=["dna_freshness"])
    raw = [f for f in first.findings if f.check == "dna_freshness"]
    assert len(raw) == 1
    assert raw[0].severity == "warn"
    assert raw[0].origin == "new"

    store = BaselineStore(tmp_path)
    store.accept(raw)

    # Lenient run: baseline-origin + downgrade (warn → info).
    second = run_audit(tmp_path, baseline_mode="lenient", checks=["dna_freshness"])
    baselined = [f for f in second.findings if f.check == "dna_freshness"]
    assert len(baselined) == 1
    assert baselined[0].origin == "baseline"
    assert baselined[0].severity == "info", (
        "lenient ratchet must drop dna_freshness baseline findings by one notch"
    )


# ---------------------------------------------------------------------------
# Config knob
# ---------------------------------------------------------------------------


def test_stale_days_zero_disables_check(tmp_path):
    """A config of `stale_days: 0` is the operator escape hatch — check
    must short-circuit and return no findings."""
    _setup_stale_module(
        tmp_path,
        commit_when="2026-06-12T12:00:00+00:00",
        stamp_when="2026-06-01T12:00:00+00:00",
    )
    assert check(tmp_path, {"dna_freshness": {"stale_days": 0}}) == []
