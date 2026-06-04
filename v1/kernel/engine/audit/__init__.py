"""audit — read-only governance drift checks across .dna, .claude/agents, .cbim/memory.

Public API:
  run_audit(project_root, *, checks=None, baseline_mode="lenient") -> AuditResult
  list_checks() -> list[str]
  AuditResult, AuditFinding, BaselineStore
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from . import ratchet as _ratchet
from .baseline import BaselineStore
from .config import load_audit_config
from .registry import CHECKS, list_check_names
from .result import AuditFinding, AuditResult

BaselineMode = Literal["ignore", "lenient", "strict"]


def list_checks() -> list[str]:
    return list_check_names()


def run_audit(
    project_root: Path | str,
    *,
    checks: list[str] | None = None,
    baseline_mode: BaselineMode = "lenient",
) -> AuditResult:
    """Run drift checks. Always read-only.

    `baseline_mode` controls how the BaselineStore tags + downgrades findings:
      - "ignore"  : skip baseline classification entirely; every finding's
                    origin stays the dataclass default ("new"); no ratchet
                    downgrade is applied. Use for one-shot total inspection.
      - "lenient" : (default) classify findings against the baseline; for
                    checks marked lenient in `ratchet._CHECK_MODE`, baseline-
                    origin findings drop one severity notch.
      - "strict"  : classify against the baseline (so callers can still
                    distinguish baseline from new) but skip the downgrade
                    step everywhere.

    `run_audit` NEVER writes the baseline file. All baseline mutation is
    explicit human action through `cbim audit baseline accept|clear`.
    """
    root = Path(project_root).resolve()
    cfg = load_audit_config()

    selected = checks or list_check_names()
    unknown = [c for c in selected if c not in CHECKS]
    if unknown:
        raise ValueError(
            f"unknown check(s): {unknown}; available: {list_check_names()}"
        )

    if baseline_mode not in ("ignore", "lenient", "strict"):
        raise ValueError(
            f"unknown baseline_mode: {baseline_mode!r}; "
            f"expected one of 'ignore' | 'lenient' | 'strict'"
        )

    findings: list[AuditFinding] = []
    for name in selected:
        findings.extend(CHECKS[name](root, cfg))

    # Baseline classification + ratchet downgrade. The default mode keeps
    # the old "every finding is new" behaviour invisible to callers who
    # never set up a baseline file (load() returns empty dict).
    if baseline_mode != "ignore":
        store = BaselineStore(root)
        store.classify(findings)
        if baseline_mode == "lenient":
            _ratchet.apply(findings, baseline_mode="lenient")
        # strict mode: classification done, no downgrade.

    summary = _summarise(findings, selected, baseline_mode)

    return AuditResult(
        findings=findings,
        summary=summary,
        ran_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        project_root=str(root),
        config_snapshot=cfg,
    )


def _summarise(
    findings: list[AuditFinding],
    selected: list[str],
    baseline_mode: str,
) -> dict:
    """Build the summary dict.

    Backward-compatible: the original keys (`total`, `error`, `warn`, `info`,
    `checks_ran`, `by_check`) stay; new `by_origin` and `baseline_mode` are
    additive so existing consumers (CLI report.py, MCP audit_run) keep
    working without a code change.
    """
    return {
        "total": len(findings),
        "error": sum(1 for f in findings if f.severity == "error"),
        "warn": sum(1 for f in findings if f.severity == "warn"),
        "info": sum(1 for f in findings if f.severity == "info"),
        "checks_ran": list(selected),
        "by_check": {
            n: sum(1 for f in findings if f.check == n) for n in selected
        },
        "by_origin": {
            "new": sum(1 for f in findings if f.origin == "new"),
            "baseline": sum(1 for f in findings if f.origin == "baseline"),
        },
        "baseline_mode": baseline_mode,
    }


__all__ = [
    "run_audit",
    "list_checks",
    "AuditResult",
    "AuditFinding",
    "BaselineStore",
    "BaselineMode",
]
