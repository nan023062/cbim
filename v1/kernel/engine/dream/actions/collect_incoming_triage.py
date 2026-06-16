"""actions/collect_incoming_triage.py — post-yield collector for incoming-triage report.

Owns ``on_resume`` for the incoming-triage dispatch path. The Runner's
two-level (agent_type, subtask_id) routing table lands the
``("main", "governance_incoming_triage")`` resume here (see
``api/result.DREAM_AGENT_SUBTASK_TO_LEAF``).

Three-branch tick (mirror of CollectMemDistill):
  - Result already on bb (post-resume re-entry) → SUCCESS.
  - Dispatched but no payload delivered → write sentinel, FAILURE.
  - Scan decided to skip → SUCCESS no-op.

On resume:
  1. Parse the main-agent payload through
     ``loops.incoming_triage_governance.parse_response``.
  2. **Failure-safe semantic**: business failures (errors non-empty,
     parse-time error, non-dict report) all land as ``incoming_triage_result``
     with an ``error`` key set, but the leaf still returns SUCCESS via the
     ``tick`` re-entry path — downstream MemCompact MUST keep running.
  3. On success: move every path in ``processed_paths`` from
     ``<store>/medium/incoming/`` to ``<store>/medium/incoming/processed/``
     via ``os.replace`` (atomic on the same filesystem). Files mentioned
     under ``errors`` are left in place to be retried next tick.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from engine.core.node import Node, Status


def _loop():
    import engine.dream.loops.incoming_triage_governance as m
    return m


class CollectIncomingTriage(Node):
    def __init__(self, *, store_dir, name: str = "CollectIncomingTriage") -> None:
        self.name = name
        self._store_dir = Path(store_dir)

    def tick(self, bb) -> Status:
        if bb.incoming_triage_result is not None:
            return Status.SUCCESS
        if not bb.incoming_triage_dispatched:
            # Scan already wrote the skip result; safety branch only.
            bb.incoming_triage_result = {
                "skipped": True,
                "reason": "scan_skipped",
            }
            return Status.SUCCESS
        # Dispatched but on_resume never delivered — surface a sentinel so
        # EmitReport still has a render target. FAILURE here is engine-internal,
        # the @Catch wrapper at the step level absorbs it.
        bb.incoming_triage_result = {
            "error": "no_payload_received",
            "skipped": False,
        }
        return Status.FAILURE

    def on_resume(self, bb, payload: Any) -> None:
        parsed = _loop().parse_response(_extract_text(payload))

        # Branch 1: parse-time error — record sentinel, no file move.
        # Failure-safe: do NOT propagate FAILURE; downstream MemCompact must run.
        if parsed.get("error") and parsed.get("incoming_triage_report") is None:
            bb.incoming_triage_result = {
                "error": parsed["error"],
                "skipped": False,
            }
            bb.pending_dispatch = None
            return

        report = parsed.get("incoming_triage_report")
        if not isinstance(report, dict):
            bb.incoming_triage_result = {
                "error": "report_not_a_dict",
                "skipped": False,
            }
            bb.pending_dispatch = None
            return

        # Branch 2: business failure (errors list non-empty) — keep failed
        # files in place for the next tick to retry. Successful files (those
        # in processed_paths but NOT in any error path) still get archived.
        errors = report.get("errors") or []
        error_paths: set[str] = set()
        for err in errors:
            if isinstance(err, dict):
                p = err.get("path")
                if isinstance(p, str):
                    error_paths.add(p)

        moved: list[str] = []
        move_failures: list[dict] = []
        archive_dir = self._store_dir / "medium" / "incoming" / "processed"
        try:
            archive_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            # Archive dir creation failed — record but keep result intact;
            # files stay in incoming/ for the next tick.
            bb.incoming_triage_result = {
                **report,
                "error": f"archive_mkdir_failed: {type(e).__name__}: {e}",
                "skipped": False,
            }
            bb.pending_dispatch = None
            return

        for raw in report.get("processed_paths") or []:
            if not isinstance(raw, str) or not raw:
                continue
            if raw in error_paths:
                # Reported as both processed and erroring — leave in place.
                continue
            src = Path(raw)
            dst = archive_dir / src.name
            try:
                os.replace(src, dst)
                moved.append(str(dst))
            except FileNotFoundError:
                # Already gone — idempotent re-run path.
                pass
            except OSError as e:
                move_failures.append({
                    "path": raw,
                    "error": f"{type(e).__name__}: {e}",
                })

        bb.incoming_triage_result = {
            "skipped": False,
            **report,
            "archived_paths": moved,
            "move_failures": move_failures,
        }
        bb.pending_dispatch = None


def _extract_text(payload: Any) -> Any:
    """Mirror of CollectMemDistill / CollectArchAdvice unwrap."""
    if isinstance(payload, dict) and "output" in payload:
        return payload.get("output") or ""
    return payload
