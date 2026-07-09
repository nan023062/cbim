"""checks/dna_freshness.py — DNA module.md doc-vs-code freshness drift.

Findings:
  DNA_FRESHNESS_STALE   info/warn/error   the module directory has newer code
                                           commits than the module.md's
                                           ``body_edited_at`` stamp

Detection:
  1. Load every registered module (:func:`services.list_modules`).
  2. Ask git for the most recent committer time (``git log -1 --format=%cI``)
     across the module's directory, excluding the module's own ``.dna/``
     subtree and any registered child modules' subtrees.
  3. If the module's ``body_edited_at`` stamp is older than that commit time,
     produce a finding whose severity is a function of the day gap.

Design constraints (from the check spec):
  * ``message`` must stay static — no day counts, no dates. The audit
    baseline fingerprint is ``hash(check | code | target | sha256(message))``;
    a message containing today's day count would produce a different
    fingerprint on every run, defeating baseline acceptance for a check
    that will fire daily. All mutating values (``body_edited_at``,
    ``latest_code_commit_at``, ``days_stale``) live in ``metadata``.
  * Missing ``body_edited_at`` on a module is treated as "not migrated yet"
    (existing modules that predate this feature) — the check silently
    skips them. Backfill via ``cbim dna stamp-freshness``.
  * Non-git projects and modules with no git-tracked code degrade
    gracefully (empty findings for that module / all modules).
"""

from __future__ import annotations

import subprocess
from datetime import datetime, timezone
from pathlib import Path

from services import list_modules as _service_list_modules
from services._fm import parse_frontmatter

from ..config import resolve_bands
from ..result import AuditFinding


_STAMP_KEY = "body_edited_at"


def check(project_root: Path, config: dict) -> list[AuditFinding]:
    findings: list[AuditFinding] = []
    cfg = config.get("dna_freshness", {})
    stale_days = int(cfg.get("stale_days", 7))
    if stale_days <= 0:
        return findings

    if not _is_git_repo(project_root):
        return findings

    modules = list(_service_list_modules(cwd=str(project_root)))
    if not modules:
        return findings

    # Set of every registered module's path (project-relative) — used to
    # subtract child modules from a parent's freshness scope so a child
    # commit doesn't spuriously age its ancestors.
    all_rel_paths = {
        (m.get("path") or m.get("id") or "").strip()
        for m in modules
    }

    for m in modules:
        rel_path = (m.get("path") or m.get("id") or "").strip()
        if not rel_path:
            continue
        module_dir_probe = (
            project_root if rel_path == "." else (project_root / rel_path)
        )
        body_edited_at_str = _read_stamp_from_disk(module_dir_probe)
        if body_edited_at_str is None:
            # Not migrated yet (or malformed) — skip silently.
            continue

        stamp_dt = _parse_iso_utc(body_edited_at_str)
        if stamp_dt is None:
            # Malformed stamp — skip; frontmatter schema validation is the
            # right place to complain, not the freshness check.
            continue

        module_dir = project_root if rel_path == "." else (project_root / rel_path)
        pathspecs = _pathspecs_for_module(rel_path, all_rel_paths, module_dir)
        latest_commit_iso = _latest_commit_iso(project_root, pathspecs)
        if latest_commit_iso is None:
            # No git-tracked files under this module's scope — nothing to
            # compare against; skip.
            continue

        commit_dt = _parse_iso_utc(latest_commit_iso)
        if commit_dt is None:
            continue

        days_stale = (commit_dt - stamp_dt).days
        if days_stale <= 0:
            continue

        severity = resolve_bands(days_stale, stale_days)
        if severity is None:
            continue

        findings.append(AuditFinding(
            check="dna_freshness",
            severity=severity,
            target=rel_path,
            message=(
                f"module {rel_path!r} body edited before newer code commits "
                "landed in this module directory"
            ),
            suggestion=(
                "Review the module and either re-edit `.dna/module.md` to "
                "reflect the new code (kernel will re-stamp `body_edited_at` "
                "automatically), or accept the current staleness into audit "
                "baseline if the body is intentionally abstract and "
                "unaffected by these code changes."
            ),
            code="DNA_FRESHNESS_STALE",
            metadata={
                "body_edited_at": body_edited_at_str,
                "latest_code_commit_at": latest_commit_iso,
                "days_stale": int(days_stale),
            },
        ))

    return findings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_stamp_from_disk(module_dir: Path) -> str | None:
    """Return ``body_edited_at`` from the on-disk frontmatter, if present.

    ``services.list_modules`` currently flattens only the schema-known
    fields (name / owner / description / keywords / status / links) onto
    its output dict, so the freshness stamp needs a direct frontmatter
    read. Any read / parse failure is treated as "no stamp" (returns None).
    """
    module_md = module_dir / ".dna" / "module.md"
    try:
        raw = module_md.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    try:
        meta = parse_frontmatter(raw)
    except ValueError:
        return None
    value = meta.get(_STAMP_KEY)
    if isinstance(value, str) and value:
        return value
    return None


def _pathspecs_for_module(
    rel_path: str,
    all_rel_paths: set[str],
    module_dir: Path,
) -> list[str]:
    """Compute git pathspecs covering this module's code territory.

    We want ``git log`` to consider everything under the module directory
    EXCEPT:
      * the module's own ``.dna/`` subtree (that's DNA, not code);
      * any registered child module's directory (that child owns its own
        freshness bookkeeping).

    Git ``log -- <pathspecs>`` treats each pathspec as an inclusion; we
    combine with exclude pathspecs (``:(exclude)<path>``) for the subtree
    subtractions. In git pathspec semantics ``foo/bar`` matches ``foo/bar``
    and everything under it, so a single exclude entry per subtree
    suffices. Pathspecs are always project-relative POSIX-style strings.
    """
    if rel_path == "." or rel_path == "":
        base = "."
        dna_exclude = ".dna"
    else:
        base = rel_path
        dna_exclude = f"{rel_path}/.dna"

    excludes: list[str] = [f":(exclude){dna_exclude}"]

    for other in all_rel_paths:
        if not other or other == rel_path:
            continue
        if _is_descendant(other, rel_path):
            excludes.append(f":(exclude){other}")

    return [base, *excludes]


def _is_descendant(candidate: str, ancestor: str) -> bool:
    if candidate == ancestor:
        return False
    if ancestor in ("", "."):
        return candidate not in ("", ".")
    return candidate.startswith(ancestor + "/")


def _is_git_repo(project_root: Path) -> bool:
    """True when ``project_root`` sits inside a git working tree.

    Any failure (git missing, permissions, non-repo) counts as False.
    """
    try:
        result = subprocess.run(
            ["git", "-C", str(project_root), "rev-parse", "--is-inside-work-tree"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    if result.returncode != 0:
        return False
    return result.stdout.strip() == "true"


def _latest_commit_iso(project_root: Path, pathspecs: list[str]) -> str | None:
    """Newest committer time (``%cI``) among commits touching ``pathspecs``.

    Returns None when git has no matching commits (empty output) or when
    the invocation fails for any reason.
    """
    cmd = [
        "git", "-C", str(project_root),
        "log", "-1", "--format=%cI", "--",
        *pathspecs,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    out = result.stdout.strip()
    return out or None


def _parse_iso_utc(value: str) -> datetime | None:
    """Parse an ISO-8601 timestamp into a tz-aware UTC datetime.

    Accepts both ``...Z`` and ``...+HH:MM`` forms. Naive timestamps are
    rejected (return None); freshness math must not mix naive and
    tz-aware values.
    """
    if not value:
        return None
    # Python 3.11 accepts the trailing "Z"; older versions need substitution.
    canonical = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        dt = datetime.fromisoformat(canonical)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return None
    return dt.astimezone(timezone.utc)
