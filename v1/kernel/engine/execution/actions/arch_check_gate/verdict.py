"""actions/arch_check_gate/verdict.py — reduce findings to a pass/fail Verdict.

Decision contract (task T5 spec + .dna/module.md decision "fail →
ConvergeJudge灌 unresolved 作为只读修改指令"):

    pass_ = no ``origin == "new"`` finding has severity ``error`` or ``warn``.

Rationale: the baseline ratchet's whole point is to let already-accepted
drift continue to compile while blocking on *new* regressions only.
``baseline``-origin findings have already been folded by the ratchet
(``lenient`` checks dropped one severity notch); whatever leaks through
is by definition tolerated. The gate's pass/fail signal therefore looks
only at ``new``-origin findings.

``info`` severity never blocks — it is the early-warning band per the
audit module's tri-band convention (info / warn / error). A new-origin
info finding still appears in ``Verdict.findings`` for observability,
but does not flip ``pass_``.

Determinism: this function has zero side effects, zero I/O, no randomness.
INV-CHECK-GATE-1 guarantee starts here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from engine.audit import AuditFinding

# Severity name re-exported for ergonomic typing; mirrors audit/result.Severity.
RatchetMode = Literal["ignore", "lenient", "strict"]


@dataclass
class Verdict:
    """Pass/fail summary plus counts and the raw finding list.

    Attributes
    ----------
    pass_ :
        ``True`` iff no new-origin finding has severity ``error`` or ``warn``.
        Suffixed ``_`` to avoid shadowing the Python keyword while still
        reading naturally at the call site (``verdict.pass_``).
    error_count / warn_count / info_count :
        Totals across ALL findings in scope (baseline + new). Used by
        downstream rendering (Respond / dashboards) for at-a-glance health.
    new_error_count / new_warn_count :
        Totals across only ``origin == "new"`` findings. These are the
        numbers that actually drove the ``pass_`` decision; surfacing them
        separately lets debuggers verify the verdict without re-iterating
        the findings list.
    findings :
        The exact in-scope finding list, untouched. Order preserved.
    unresolved :
        Subset of ``findings`` with ``severity >= warn``, kept for the
        downstream ``ConvergeJudge`` → ``arch_redo_context`` pipeline
        (the architect's redo prompt receives the full unresolved set
        verbatim as a read-only modification directive).
    summary :
        Short human string describing the verdict; safe to render in
        receipts and dashboards.
    ratchet_mode :
        Echo of the mode the gate ran the audit in; useful for trace logs
        to distinguish a strict-mode fail from a lenient-mode fail.
    """

    pass_: bool
    error_count: int
    warn_count: int
    info_count: int
    new_error_count: int
    new_warn_count: int
    findings: list[AuditFinding] = field(default_factory=list)
    unresolved: list[AuditFinding] = field(default_factory=list)
    summary: str = ""
    ratchet_mode: str = "lenient"

    def to_dict(self) -> dict:
        return {
            "pass": self.pass_,
            "error_count": self.error_count,
            "warn_count": self.warn_count,
            "info_count": self.info_count,
            "new_error_count": self.new_error_count,
            "new_warn_count": self.new_warn_count,
            "findings": [f.to_dict() for f in self.findings],
            "unresolved": [f.to_dict() for f in self.unresolved],
            "summary": self.summary,
            "ratchet_mode": self.ratchet_mode,
        }


def build_verdict(
    findings: list[AuditFinding],
    ratchet_mode: RatchetMode = "lenient",
) -> Verdict:
    """Reduce a scoped finding list to a Verdict.

    The input is expected to be already scope-filtered by
    ``scope.filter_by_scope`` and already ratchet-folded by
    ``engine.audit.run_audit`` (the ratchet runs inside ``run_audit``).
    This function only counts and decides — no severity mutation.

    Parameters
    ----------
    findings :
        In-scope findings, post-ratchet. Order preserved on the
        ``Verdict.findings`` field.
    ratchet_mode :
        Echo of the mode the audit was run in. Stored on the verdict
        for trace visibility; does not change counting.
    """
    error_count = 0
    warn_count = 0
    info_count = 0
    new_error_count = 0
    new_warn_count = 0
    unresolved: list[AuditFinding] = []

    for f in findings:
        sev = f.severity
        if sev == "error":
            error_count += 1
        elif sev == "warn":
            warn_count += 1
        elif sev == "info":
            info_count += 1

        origin = getattr(f, "origin", "new") or "new"
        if origin == "new":
            if sev == "error":
                new_error_count += 1
            elif sev == "warn":
                new_warn_count += 1

        if sev in ("error", "warn"):
            unresolved.append(f)

    pass_ = (new_error_count == 0 and new_warn_count == 0)

    if pass_:
        summary = (
            f"pass ({len(findings)} in-scope findings; "
            f"new error/warn = 0)"
        )
    else:
        summary = (
            f"fail ({new_error_count} new-origin errors, "
            f"{new_warn_count} new-origin warns in scope; "
            f"{len(findings)} total in-scope findings)"
        )

    return Verdict(
        pass_=pass_,
        error_count=error_count,
        warn_count=warn_count,
        info_count=info_count,
        new_error_count=new_error_count,
        new_warn_count=new_warn_count,
        findings=list(findings),
        unresolved=unresolved,
        summary=summary,
        ratchet_mode=ratchet_mode,
    )


__all__ = ["Verdict", "build_verdict", "RatchetMode"]
