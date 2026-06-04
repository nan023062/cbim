"""actions/arch_check_gate/gate.py — the ArchCheckGate leaf.

Sits inside ``WorkLoop`` between ``DispatchWork`` and ``ConvergeJudge``.
Synchronously runs the read-only ``dna_tree`` + ``dna_fission`` audit
checks, filters the findings down to the architect-declared
``touched_modules``, classifies them against ``BaselineStore`` (lenient
ratchet — done inside ``run_audit``), reduces to a ``Verdict``, and
writes the report to ``bb.arch_check_report``.

INV-CHECK-GATE-1 (.dna/module.md Key Decisions — bullet 1):
    100% deterministic, zero LLM involvement. Enforced by four iron rules:

      (a) ``__init__`` signature is restricted to ``{self, name}``. No
          callback / llm_client / dispatcher parameter may ever be
          accepted — there is intentionally no LLM injection seam.
      (b) The class body MUST NOT define ``on_resume``. The gate never
          yields, so it never needs a resume callback.
      (c) The ``tick`` method body MUST NOT reference ``DispatchRequest``,
          MUST NOT use the ``yield`` keyword, and MUST NOT mention
          ``Status.RUNNING``. The only legal return is ``Status.SUCCESS``
          (or, in the FAILURE-of-audit-infra path, still ``SUCCESS``
          because pass/fail flows through the blackboard, not Status).
      (d) The whole package may not import any LLM SDK (anthropic,
          openai, …).

    A T7 AST test scans this module and the rest of the package to enforce
    these rules statically. Breaking any rule = CI red = PR rejected.

Status return contract (.dna/module.md decision "tick 永远返回 SUCCESS"):
    ``tick`` returns ``Status.SUCCESS`` on every code path. Pass/fail
    travels via ``bb.arch_check_report.verdict.pass_``; the downstream
    ``ConvergeJudge`` is the single arbiter of WorkLoop convergence and
    must not be bypassed by a FAILURE short-circuit. ``FAILURE`` is
    reserved for the (impossible-by-construction) case of a Status
    enum being needed beyond SUCCESS — which by spec never happens.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from context import project_root
from engine.audit import run_audit
from engine.core.node import Node, Status

from .scope import filter_by_scope
from .verdict import Verdict, build_verdict


# Single source of truth — see .dna/module.md decision "检查集合固定为
# [dna_tree, dna_fission]". Any change goes through a contract update,
# not a code edit here.
_DEFAULT_CHECKS: tuple[str, ...] = ("dna_tree", "dna_fission")

# Default ratchet mode — see .dna/module.md decision "baseline_compare
# 不在本叶硬编码 check 策略表". Echo of the audit module's own default.
_DEFAULT_RATCHET_MODE = "lenient"


class ArchCheckGate(Node):
    """Programmatic check gate — deterministic, sync, no LLM, no yield.

    See module docstring for INV-CHECK-GATE-1 details. ``__init__``
    intentionally exposes only ``name`` so no LLM injection seam exists.
    """

    name: str = "ArchCheckGate"

    def __init__(self, *, name: str = "ArchCheckGate") -> None:
        self.name = name

    # ------------------------------------------------------------------
    # tick (single entry point; no resume because no yield)
    # ------------------------------------------------------------------

    def tick(self, bb) -> Status:
        # Defensive blanket: any exception below collapses to a fail-mode
        # report so the LoopSeq always reaches ConvergeJudge with a usable
        # bb.arch_check_report. We never raise out of tick — that would
        # break the WorkLoop and force the engine to surface a stack
        # trace to the user.
        try:
            self._tick_impl(bb)
        except Exception as exc:  # noqa: BLE001 — see comment above
            bb.arch_check_report = _infra_failure_report(exc)
        return Status.SUCCESS

    # ------------------------------------------------------------------
    # Internal implementation (small, sequential, no branching surprises)
    # ------------------------------------------------------------------

    def _tick_impl(self, bb) -> None:
        touched = _collect_touched_modules(bb)
        ran_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

        if not touched:
            # arch_plan did not declare touched_modules. Per .dna decision
            # "scope_filter 是无关历史问题不误伤本次任务的护栏" + task
            # T5 spec, fall back to a full-tree scan so coverage never
            # silently disappears, but flag the protocol violation in
            # the verdict for ConvergeJudge to surface.
            result = run_audit(
                project_root(),
                checks=list(_DEFAULT_CHECKS),
                baseline_mode=_DEFAULT_RATCHET_MODE,
            )
            verdict = build_verdict(
                list(result.findings), ratchet_mode=_DEFAULT_RATCHET_MODE
            )
            bb.arch_check_report = {
                "touched_modules": [],
                "verdict": verdict.to_dict(),
                "scoped_findings": [f.to_dict() for f in result.findings],
                "baseline_meta": {
                    "mode": _DEFAULT_RATCHET_MODE,
                    "by_origin": (result.summary or {}).get("by_origin", {}),
                },
                "ran_at": ran_at,
                "checks_ran": list(_DEFAULT_CHECKS),
                "warning": (
                    "touched_modules missing in arch_plan — full-tree scan as "
                    "fallback; gate did not fail on this alone"
                ),
            }
            return

        # Normal path: scoped scan.
        result = run_audit(
            project_root(),
            checks=list(_DEFAULT_CHECKS),
            baseline_mode=_DEFAULT_RATCHET_MODE,
        )
        scoped = filter_by_scope(list(result.findings), touched)
        verdict = build_verdict(scoped, ratchet_mode=_DEFAULT_RATCHET_MODE)

        bb.arch_check_report = {
            "touched_modules": list(touched),
            "verdict": verdict.to_dict(),
            "scoped_findings": [f.to_dict() for f in scoped],
            "baseline_meta": {
                "mode": _DEFAULT_RATCHET_MODE,
                "by_origin": (result.summary or {}).get("by_origin", {}),
            },
            "ran_at": ran_at,
            "checks_ran": list(_DEFAULT_CHECKS),
        }


# ---------------------------------------------------------------------------
# Module-private helpers
# ---------------------------------------------------------------------------


def _collect_touched_modules(bb) -> list[str]:
    """Pull the union of ``params.touched_modules`` across arch_plan tasks.

    The architect declares ``touched_modules`` per-task in
    ``arch_plan[i].params.touched_modules``; the gate runs a single audit
    covering the union (audit infra cost is per-run, not per-module, so
    union is cheaper than per-task re-runs).

    Returns an order-preserving deduplicated list. Empty / missing /
    malformed inputs all collapse to ``[]`` so the caller can use the
    simple ``not touched`` check.
    """
    plan = getattr(bb, "arch_plan", None) or []
    if not isinstance(plan, list):
        return []

    seen: set[str] = set()
    out: list[str] = []
    for task in plan:
        if not isinstance(task, dict):
            continue
        params = task.get("params")
        if not isinstance(params, dict):
            continue
        raw = params.get("touched_modules")
        if not isinstance(raw, list):
            continue
        for item in raw:
            if not isinstance(item, str):
                continue
            s = item.strip()
            if not s:
                continue
            if s in seen:
                continue
            seen.add(s)
            out.append(s)
    return out


def _infra_failure_report(exc: BaseException) -> dict:
    """Build a fail-mode arch_check_report for the audit-infra-error path.

    Used only by the defensive ``except`` in ``tick``. We deliberately
    surface ``pass_=False`` so ConvergeJudge sees the failure; if the
    audit infrastructure can't run, we cannot prove cleanliness.
    """
    summary = f"audit infra error: {type(exc).__name__}: {exc}"
    verdict = Verdict(
        pass_=False,
        error_count=0,
        warn_count=0,
        info_count=0,
        new_error_count=0,
        new_warn_count=0,
        findings=[],
        unresolved=[],
        summary=summary,
        ratchet_mode=_DEFAULT_RATCHET_MODE,
    )
    return {
        "touched_modules": [],
        "verdict": verdict.to_dict(),
        "scoped_findings": [],
        "baseline_meta": {"mode": _DEFAULT_RATCHET_MODE, "by_origin": {}},
        "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "checks_ran": list(_DEFAULT_CHECKS),
        "error": summary,
    }


__all__ = ["ArchCheckGate"]
