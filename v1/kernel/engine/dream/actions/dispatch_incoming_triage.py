"""actions/dispatch_incoming_triage.py — incoming-triage governance dispatcher.

Yields a DispatchRequest(agent_type="main",
subtask_id="governance_incoming_triage") when ``bb.incoming_triage_dispatched``
is True (set by the upstream IncomingScan leaf when it found at least one
mature prior-day JSONL file) and ``bb.incoming_triage_result`` is not yet
populated.

Mirrors ``dispatch_mem_distill.DispatchMemDistill`` shape — main-agent
self-yield with the prompt rendered by the matching governance descriptor.
The Runner reads (agent_type="main", subtask_id="governance_incoming_triage")
from ``DREAM_AGENT_SUBTASK_TO_LEAF`` and resumes on ``CollectIncomingTriage``.

Why ``agent_type="main"``: the triage is a memory-source responsibility
that needs ``memory_create`` to land medium entries — same toolbelt
constraint as ``governance_memory_distill``.
"""

from __future__ import annotations

from pathlib import Path

from engine.core.node import Node, Status

from ..api.result import DispatchRequest


def _loop():
    # Lazy import to break the import cycle (mirror of dispatch_mem_distill).
    import engine.dream.loops.incoming_triage_governance as m
    return m


class DispatchIncomingTriage(Node):
    def __init__(
        self,
        *,
        store_dir,
        timeout_hint_s: int = 600,
        name: str = "DispatchIncomingTriage",
    ) -> None:
        self.name = name
        self._store_dir = Path(store_dir)
        self._timeout_hint_s = timeout_hint_s

    def tick(self, bb) -> Status:
        # Scan decided to skip — Scan already wrote the skip result.
        if not bb.incoming_triage_dispatched:
            return Status.SUCCESS
        # Already collected (post-resume re-entry) — no-op.
        if bb.incoming_triage_result is not None:
            return Status.SUCCESS
        bb.pending_dispatch = DispatchRequest(
            agent_type="main",
            agent_file=None,
            prompt=_loop().compose_prompt(bb, str(self._store_dir)),
            subtask_id="governance_incoming_triage",
            timeout_hint_s=self._timeout_hint_s,
        )
        return Status.RUNNING
