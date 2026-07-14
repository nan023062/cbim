"""checks/skill_scripts.py — agent-private skill asset script safety scan.

Findings:
  SKILL_SCRIPT_UNTRACKED_EXTENSION   warn              executable-suffix asset
                                                        under ``<skill>/assets/``
                                                        lacks a sibling
                                                        ``.executable-declared``
                                                        marker file
  SKILL_SCRIPT_SIZE                  info/warn/error   single asset file
                                                        exceeds the configured
                                                        byte-size threshold
                                                        (bands via
                                                        :func:`resolve_bands`)
  SKILL_SCRIPT_OUTSIDE_ASSETS        error             executable-suffix file
                                                        sits at ``<skill>/``
                                                        root instead of under
                                                        ``<skill>/assets/`` —
                                                        the HR skill-asset API
                                                        only provisions files
                                                        into ``assets/``
  SKILL_SCRIPT_CORE_AGENT_VIOLATION  error             any asset file present
                                                        under a built-in
                                                        agent's skill
                                                        directory
                                                        (architect / auditor /
                                                        hr / programmer) —
                                                        those skills are
                                                        kernel-owned and must
                                                        never carry HR-CRUD
                                                        assets, regardless of
                                                        file suffix

Message contract:
  Every finding's ``message`` is fixed text; volatile data (asset path,
  byte size, agent name, suffix) lives in ``metadata`` so the audit
  baseline fingerprint (``hash(check | code | target | sha256(message))``)
  stays stable across runs. The offending path is duplicated into
  ``target`` so operators can locate the artefact from the CLI report
  without inspecting metadata.

Scope split:
  * Non-core agents ({@} architect / auditor / hr / programmer excluded)
    → the first three findings apply. Core-agent-only violation
    (fourth finding) is suppressed here.
  * Core agents → only ``SKILL_SCRIPT_CORE_AGENT_VIOLATION`` fires; the
    other three are not re-emitted to avoid duplicate noise, since the
    core-agent violation is the point.
"""

from __future__ import annotations

from pathlib import Path

from ..config import resolve_bands
from ..result import AuditFinding


# Executable-suffix set — deliberately duplicated as a hardcoded constant
# rather than imported from ``services``. Task A / D run independently of
# whether the services layer is already implemented; the two copies must
# stay in sync by convention.
_EXECUTABLE_ASSET_SUFFIXES = frozenset({
    ".ps1", ".sh", ".py", ".js", ".ts", ".rb", ".pl",
    ".bat", ".cmd", ".exe", ".dll", ".so", ".dylib",
    ".command", ".app",
})

# Built-in framework agents. Their skills are kernel-vendored and must
# never accumulate HR-CRUD assets. Mirrors
# ``services.agent_service._BUILTIN_AGENTS`` — kept local to keep the
# audit check self-contained (no cross-package import cycle risk).
_CORE_AGENTS = frozenset({"architect", "auditor", "hr", "programmer"})

# Sibling marker file suffix — see
# ``cbi._primitives.skills.remove_skill_asset`` for the on-disk contract.
_MARKER_SUFFIX = ".executable-declared"


def check(project_root: Path, config: dict) -> list[AuditFinding]:
    findings: list[AuditFinding] = []
    cfg = config.get("skill_scripts", {})
    size_threshold = int(cfg.get("size_bytes", 200000))

    agents_dir = project_root / ".claude" / "agents"
    if not agents_dir.is_dir():
        return findings

    for agent_dir in sorted(agents_dir.iterdir()):
        if not agent_dir.is_dir():
            continue
        agent_name = agent_dir.name
        skills_dir = agent_dir / "skills"
        if not skills_dir.is_dir():
            continue

        if agent_name in _CORE_AGENTS:
            findings.extend(
                _scan_core_agent_skills(project_root, agent_name, skills_dir)
            )
        else:
            findings.extend(
                _scan_user_agent_skills(
                    project_root, skills_dir, size_threshold
                )
            )

    return findings


# ---------------------------------------------------------------------------
# Scanners
# ---------------------------------------------------------------------------

def _scan_core_agent_skills(
    project_root: Path,
    agent_name: str,
    skills_dir: Path,
) -> list[AuditFinding]:
    """Any file under ``<core-agent>/skills/**/assets/`` is a violation.

    Fires one finding per asset file (marker files included: their very
    presence proves the HR skill-asset API touched a kernel-owned skill,
    which is precisely what we want to catch). Suffix / size / placement
    are deliberately NOT re-checked here — the core-agent breach is the
    point, and layering additional findings on top would drown the report.
    """
    out: list[AuditFinding] = []
    for skill_dir in sorted(p for p in skills_dir.iterdir() if p.is_dir()):
        assets_dir = skill_dir / "assets"
        if not assets_dir.is_dir():
            continue
        for asset in sorted(assets_dir.rglob("*")):
            if not asset.is_file():
                continue
            rel = asset.relative_to(project_root).as_posix()
            out.append(AuditFinding(
                check="skill_scripts",
                severity="error",
                target=rel,
                message=(
                    "core-agent skill directory carries an HR-owned asset "
                    "artefact; kernel-vendored skills must not accumulate "
                    "assets"
                ),
                suggestion=(
                    "Remove the asset (and any sibling "
                    "`.executable-declared` marker). If the asset legitimately "
                    "belongs to the built-in agent, ship it inside the "
                    "vendored kernel release rather than through the HR CRUD "
                    "tools."
                ),
                code="SKILL_SCRIPT_CORE_AGENT_VIOLATION",
                metadata={
                    "agent_name": agent_name,
                    "asset_path": rel,
                },
            ))
    return out


def _scan_user_agent_skills(
    project_root: Path,
    skills_dir: Path,
    size_threshold: int,
) -> list[AuditFinding]:
    """Scan a non-core agent's skills for the first three finding types."""
    out: list[AuditFinding] = []
    for skill_dir in sorted(p for p in skills_dir.iterdir() if p.is_dir()):
        # 1) SKILL_SCRIPT_OUTSIDE_ASSETS — root-level (skill.md's sibling)
        #    files with executable suffix. Only checked at the immediate
        #    root; deeper directories at skill root (should not exist by
        #    convention) are ignored here — that shape is out of the
        #    scope this check is designed to police.
        for entry in sorted(skill_dir.iterdir()):
            if not entry.is_file():
                continue
            if entry.name == "skill.md":
                continue
            if entry.suffix.lower() not in _EXECUTABLE_ASSET_SUFFIXES:
                continue
            rel = entry.relative_to(project_root).as_posix()
            out.append(AuditFinding(
                check="skill_scripts",
                severity="error",
                target=rel,
                message=(
                    "executable-suffix file sits at a skill directory root "
                    "instead of under `assets/`; the HR skill-asset API "
                    "only provisions files under `<skill>/assets/**`"
                ),
                suggestion=(
                    "Move the file under `<skill>/assets/` (and, if it is "
                    "legitimately executable, re-provision it through the "
                    "HR skill-asset API with `is_executable=True` so the "
                    "`.executable-declared` marker is created). If the "
                    "file landed here by mistake, delete it."
                ),
                code="SKILL_SCRIPT_OUTSIDE_ASSETS",
                metadata={"asset_path": rel},
            ))

        # 2) & 3) Walk `<skill>/assets/**` for extension / size findings.
        assets_dir = skill_dir / "assets"
        if not assets_dir.is_dir():
            continue
        for asset in sorted(assets_dir.rglob("*")):
            if not asset.is_file():
                continue
            name = asset.name
            # Marker files are metadata, not scripts — never audit them.
            if name.endswith(_MARKER_SUFFIX):
                continue
            rel = asset.relative_to(project_root).as_posix()

            # 2) SKILL_SCRIPT_UNTRACKED_EXTENSION — executable suffix but
            #    no sibling declaration marker. Either someone bypassed
            #    the HR skill-asset API or the marker was deleted after
            #    the fact.
            suffix = asset.suffix.lower()
            if suffix in _EXECUTABLE_ASSET_SUFFIXES:
                marker = asset.with_name(f"{name}{_MARKER_SUFFIX}")
                if not marker.exists():
                    out.append(AuditFinding(
                        check="skill_scripts",
                        severity="warn",
                        target=rel,
                        message=(
                            "asset carries an executable file extension but "
                            "has no sibling `.executable-declared` marker; "
                            "either the HR skill-asset API was bypassed or "
                            "the marker was removed out of band"
                        ),
                        suggestion=(
                            "If the asset is intentionally executable, "
                            "re-provision it through the HR skill-asset "
                            "API with `is_executable=True` to (re-)create "
                            "the marker. If it should not be treated as "
                            "executable, rename it away from an executable "
                            "extension or delete it."
                        ),
                        code="SKILL_SCRIPT_UNTRACKED_EXTENSION",
                        metadata={"asset_path": rel, "suffix": suffix},
                    ))

            # 3) SKILL_SCRIPT_SIZE — banded via ``resolve_bands`` around
            #    the configured byte threshold. Standard 80% / 100% /
            #    150% bands (info / warn / error).
            try:
                size_bytes = asset.stat().st_size
            except OSError:
                continue
            severity = resolve_bands(size_bytes, size_threshold)
            if severity is not None:
                out.append(AuditFinding(
                    check="skill_scripts",
                    severity=severity,
                    target=rel,
                    message=(
                        "skill asset exceeds the configured size budget; "
                        "large scripts are hard to audit and usually mean "
                        "the logic should live in first-class kernel code"
                    ),
                    suggestion=(
                        "Split the asset into smaller helpers, promote "
                        "long-lived logic into a proper Python module "
                        "under the kernel, or raise "
                        "`audit.skill_scripts.size_bytes` in "
                        "`.cbim/config.json` if the current threshold is "
                        "unrealistic for this project."
                    ),
                    code="SKILL_SCRIPT_SIZE",
                    metadata={
                        "asset_path": rel,
                        "size_bytes": int(size_bytes),
                        "threshold_bytes": size_threshold,
                    },
                ))

    return out
