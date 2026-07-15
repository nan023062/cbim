"""audit/ratchet.py — severity downgrade policy for the baseline ratchet.

Table-driven, single source of truth for which checks may downgrade a
`baseline`-origin finding by one notch (error→warn→info) and which must
hold the line. `new`-origin findings are NEVER downgraded — that is the
fundamental ratchet guarantee: drift the team has not yet accepted always
shows at its full severity.

Per .dna/module.md Key Decisions:

  | check              | mode    |
  |--------------------|---------|
  | dna_tree           | lenient |
  | dna_fission        | lenient |
  | agent_fission      | lenient |
  | index_consistency  | strict  |
  | memory_threshold   | strict  |

`strict` = baseline-origin findings retain their original severity.
`lenient` = baseline-origin findings drop one notch
            (error→warn, warn→info, info→info).

Operator flag `baseline_mode`:
  * "lenient"  — apply the table as written. Default for `cbim audit run`.
  * "strict"   — force every check to strict (no downgrades anywhere).
  * "ignore"   — ratchet disabled upstream; this module is not called.

Severity floor: info. We deliberately do NOT drop below info because
"silently disappeared" is exactly the failure mode the ratchet exists to
prevent. A baseline-origin info finding stays an info finding.
"""

from __future__ import annotations

from typing import Literal

from .result import AuditFinding, Severity

BaselineMode = Literal["ignore", "lenient", "strict"]

# Source-of-truth downgrade table. Adding a new check defaults to "strict"
# via _CHECK_MODE.get(..., "strict") — explicit "lenient" opt-in only.
_CHECK_MODE: dict[str, str] = {
    "dna_tree": "lenient",
    "dna_fission": "lenient",
    "agent_fission": "lenient",
    "dna_freshness": "lenient",
    "skill_scripts": "lenient",
    "index_consistency": "strict",
    "memory_threshold": "strict",
}

# severity downgrade ladder. info is the floor.
_DOWNGRADE: dict[Severity, Severity] = {
    "error": "warn",
    "warn": "info",
    "info": "info",
}


def check_mode(check_name: str) -> str:
    """Return 'lenient' or 'strict' for a check. Unknown checks default to strict."""
    return _CHECK_MODE.get(check_name, "strict")


def downgrade(severity: Severity) -> Severity:
    """One-step ladder descent: error→warn, warn→info, info→info."""
    return _DOWNGRADE[severity]


def apply(
    findings: list[AuditFinding],
    *,
    baseline_mode: BaselineMode = "lenient",
) -> list[AuditFinding]:
    """Mutate `findings` in place, applying the ratchet per baseline_mode.

    Contract:
      - origin="new"      → severity NEVER changes.
      - origin="baseline" + baseline_mode="strict"  → severity unchanged.
      - origin="baseline" + baseline_mode="lenient" + check is lenient →
        severity drops one notch (floor: info).
      - origin="baseline" + baseline_mode="lenient" + check is strict →
        severity unchanged.
      - baseline_mode="ignore" is rejected here — the caller (`run_audit` or
        the CLI) is responsible for short-circuiting before reaching this
        function. We raise rather than silently no-op so the contract stays
        visible.

    Returns the same list reference for chaining.
    """
    if baseline_mode == "ignore":
        raise ValueError(
            "ratchet.apply must not be called with baseline_mode='ignore'; "
            "caller should skip the ratchet step entirely in that mode"
        )
    if baseline_mode not in ("lenient", "strict"):
        raise ValueError(
            f"unknown baseline_mode: {baseline_mode!r}; "
            f"expected one of 'ignore' | 'lenient' | 'strict'"
        )

    for f in findings:
        if f.origin != "baseline":
            continue
        if baseline_mode == "strict":
            continue
        if check_mode(f.check) != "lenient":
            continue
        f.severity = downgrade(f.severity)
    return findings


__all__ = [
    "BaselineMode",
    "apply",
    "check_mode",
    "downgrade",
]
