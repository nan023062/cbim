"""actions/converge_judge.py — aggregate bb.work_results and set bb.convergence.

PR-C decision point 2. Pure code; no LLM, no filesystem, no network.

Reads:
  - bb.work_results (dict[task_id, {status, ...}])  — written by DispatchWork
  - bb.work_loop_iter (int)                          — written by LoopSeq
  - bb.arch_plan (list[dict])                        — for arch_redo_context
  - bb.arch_check_report (dict | None)               — written by ArchCheckGate
                                                       in v3.9; STRICTLY READ-ONLY
                                                       here (single-writer
                                                       invariant) — verdict.pass
                                                       == False has top priority

Writes:
  - bb.convergence (closed enum: "done" | "arch_redo" | "user_input" | "exhausted")
  - bb.arch_redo_context (dict, only on arch_redo / exhausted paths)
  - bb.work_results (purged of needs_arch_decision entries on arch_redo path)
  - bb.trace (event entries for arch_redo_stashed / work_results_purged /
              arch_check_redo_stashed)

  NOTE: bb.arch_check_report is NEVER mutated here. The .dna invariant
  is "single writer = ArchCheckGate"; T7 ships a byte-equality assertion
  that the report dict object is identical before and after ConvergeJudge
  ticks. Don't reorder, re-classify, or "filter" findings.

Priority (top wins) — v3.9:
  1. arch_check_report.verdict.pass == False   → arch_redo (or exhausted
                                                  at max_iters); seed
                                                  arch_redo_context.unresolved
                                                  with audit findings.
  2. work-side needs_user_input                → user_input.
  3. work-side needs_arch_decision             → arch_redo (or exhausted).
  4. terminal (all ok/failed/empty)            → done.

Return contract:
  - SUCCESS — exit the LoopSeq (convergence in {"done", "user_input",
              "exhausted"})
  - FAILURE — re-loop (convergence == "arch_redo"); LoopSeq is expected
              to catch this and bump bb.work_loop_iter

Back-compat: when bb.arch_check_report is missing / not a dict / lacks a
verdict / verdict.pass is truthy, the gate is treated as PASS and the
old needs_user / needs_arch / done priority chain runs unchanged.
"""

from __future__ import annotations

from engine.core._trace_utils import _append_trace_event, _now_iso_ms
from engine.core.node import Node, Status


DEFAULT_MAX_ITERS = 3


class ConvergeJudge(Node):
    """Aggregate bb.work_results into bb.convergence with bounded retry."""

    def __init__(
        self,
        *,
        max_iters: int = DEFAULT_MAX_ITERS,
        name: str = "ConvergeJudge",
    ) -> None:
        self.name = name
        self._max_iters = max_iters

    def tick(self, bb) -> Status:
        try:
            return self._tick_impl(bb)
        except Exception as e:  # noqa: BLE001 — defensive blanket per §4.6
            # Defensive: never break the loop. Force "done" so EscalationGate
            # renders whatever we have, and log for post-mortem.
            try:
                bb.convergence = "done"
            except AttributeError:
                pass
            _append_trace_event(bb, {
                "event": "converge_internal_error",
                "node": self.name,
                "error": f"{type(e).__name__}: {e}",
                "ts": _now_iso_ms(),
            })
            return Status.SUCCESS

    # ------------------------------------------------------------------
    # Aggregation
    # ------------------------------------------------------------------

    def _tick_impl(self, bb) -> Status:
        results = bb.work_results or {}
        iter_no = int(getattr(bb, "work_loop_iter", 1) or 1)

        # v3.9 — architectural compliance gate has highest priority.
        # A failing verdict means the architect's plan introduced a
        # dna_tree / dna_fission regression on the touched modules; any
        # work-side needs_user / needs_arch is moot until the architect
        # rewrites the .dna. We read arch_check_report verbatim — never
        # mutate it; the single-writer invariant is enforced by .dna and
        # by a T7 byte-equality assertion.
        gate_failed, audit_unresolved = self._read_arch_check_verdict(bb)
        if gate_failed:
            if iter_no < self._max_iters:
                bb.convergence = "arch_redo"
                self._stash_arch_check_redo_context(
                    bb, iter_no, audit_unresolved,
                )
                # Purge needs_arch_decision entries too — they would be
                # re-emitted (or moot) after the architect rewrites the
                # plan against the audit findings.
                self._purge_arch_decision_entries(bb)
                return Status.FAILURE
            # Exhausted at gate fail — still surface the audit findings.
            bb.convergence = "exhausted"
            self._stash_arch_check_redo_context(
                bb, iter_no, audit_unresolved,
            )
            return Status.SUCCESS

        needs_user = any(
            self._status(r) == "needs_user_input" for r in results.values()
        )
        needs_arch = any(
            self._status(r) == "needs_arch_decision" for r in results.values()
        )

        # Priority order (top wins) — see §4.3.
        if needs_user:
            bb.convergence = "user_input"
            return Status.SUCCESS

        if needs_arch:
            if iter_no < self._max_iters:
                bb.convergence = "arch_redo"
                self._stash_redo_context(bb, iter_no)
                self._purge_arch_decision_entries(bb)
                return Status.FAILURE
            # Exhausted — still surface the unresolved escalations.
            bb.convergence = "exhausted"
            self._stash_redo_context(bb, iter_no)
            return Status.SUCCESS

        # Terminal: all ok / failed / empty.
        bb.convergence = "done"
        return Status.SUCCESS

    # ------------------------------------------------------------------
    # arch_check_report read helpers (READ-ONLY; never mutate the report)
    # ------------------------------------------------------------------

    @staticmethod
    def _read_arch_check_verdict(bb) -> tuple[bool, list[dict]]:
        """Return (gate_failed, unresolved_findings) for arch_check_report.

        Back-compat: report missing / not a dict / verdict absent / verdict
        not a dict / pass field missing → treat as PASS (gate_failed=False,
        unresolved=[]). Anything mutation-shaped on this path is forbidden.
        """
        report = getattr(bb, "arch_check_report", None)
        if not isinstance(report, dict):
            return False, []
        verdict = report.get("verdict")
        if not isinstance(verdict, dict):
            return False, []
        # ArchCheckGate.Verdict.to_dict() emits the key as "pass" (the
        # trailing underscore is a Python-keyword workaround only).
        passed = verdict.get("pass")
        if passed is None or bool(passed):
            return False, []
        raw_unresolved = verdict.get("unresolved")
        if not isinstance(raw_unresolved, list):
            return True, []
        # Shallow-copy each finding dict so downstream consumers (the
        # architect redo prompt) cannot accidentally mutate the report
        # via aliased references. The keys are all primitives; copy is
        # cheap and the invariant is paid for.
        copied: list[dict] = []
        for f in raw_unresolved:
            if isinstance(f, dict):
                copied.append(dict(f))
        return True, copied

    @staticmethod
    def _status(entry) -> str:
        if not isinstance(entry, dict):
            return "failed"
        s = entry.get("status")
        if s in ("ok", "failed", "needs_arch_decision", "needs_user_input"):
            return s
        # Defensive: malformed trailer → treat as failed (parser already
        # collapses malformed receipts to failed; this is belt-and-braces).
        return "failed"

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _stash_arch_check_redo_context(
        self,
        bb,
        iter_no: int,
        audit_unresolved: list[dict],
    ) -> None:
        """Seed arch_redo_context with audit findings on gate-fail path.

        Each finding lands as an "audit_finding"-kind entry in
        arch_redo_context.unresolved so the architect's redo prompt
        (arch_exec_yield._compose_prompt) can render the suggestion
        verbatim under a read-only "must-fix" banner.

        We do NOT touch bb.arch_check_report — only read from
        audit_unresolved (already shallow-copied at the call site).
        """
        unresolved: list[dict] = []
        for f in audit_unresolved:
            unresolved.append({
                "kind": "audit_finding",
                "check": f.get("check") or "unknown",
                "severity": f.get("severity") or "warn",
                "target": f.get("target"),
                "message": f.get("message") or "",
                "suggestion": f.get("suggestion"),
                "code": f.get("code"),
                "origin": f.get("origin") or "new",
            })
        bb.arch_redo_context = {
            "iter": iter_no,
            "unresolved": unresolved,
            "previous_plan": list(bb.arch_plan or []),
            "reason": "arch_check_gate_fail",
        }
        _append_trace_event(bb, {
            "event": "arch_check_redo_stashed",
            "node": self.name,
            "iter": iter_no,
            "unresolved_count": len(unresolved),
            "ts": _now_iso_ms(),
        })

    def _stash_redo_context(self, bb, iter_no: int) -> None:
        unresolved = []
        for tid, r in (bb.work_results or {}).items():
            if not isinstance(r, dict):
                continue
            if r.get("status") != "needs_arch_decision":
                continue
            unresolved.append({
                "task_id": tid,
                "blocking_module": r.get("blocking_module"),
                "question": r.get("question") or "",
                "agent": r.get("agent") or "unknown",
                "summary": r.get("summary") or "",
            })
        bb.arch_redo_context = {
            "iter": iter_no,
            "unresolved": unresolved,
            "previous_plan": list(bb.arch_plan or []),
        }
        _append_trace_event(bb, {
            "event": "arch_redo_stashed",
            "node": self.name,
            "iter": iter_no,
            "unresolved_count": len(unresolved),
            "ts": _now_iso_ms(),
        })

    def _purge_arch_decision_entries(self, bb) -> None:
        results = dict(bb.work_results or {})
        purged = [
            tid for tid, r in results.items()
            if isinstance(r, dict) and r.get("status") == "needs_arch_decision"
        ]
        for tid in purged:
            del results[tid]
        bb.work_results = results
        _append_trace_event(bb, {
            "event": "work_results_purged",
            "node": self.name,
            "task_ids": purged,
            "ts": _now_iso_ms(),
        })


__all__ = ["ConvergeJudge", "DEFAULT_MAX_ITERS"]
