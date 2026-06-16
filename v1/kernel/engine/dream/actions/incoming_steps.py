"""actions/incoming_steps.py — Phase-5 incoming-queue triage scan leaf.

The Phase-4 hook layer drops per-turn realtime captures into

    <store>/medium/incoming/YYYY-MM-DD.jsonl

(see project/hooks_src/_lib/incoming_writer.py). Phase 5 consumes the
backlog of *prior-day* JSONL files: scan picks them up sorted by date,
the dispatch yields to the main agent for LLM-driven semantic triage,
the collect leaf moves successfully-processed files into a
``processed/`` archive subdirectory.

Today's file is intentionally excluded — the hook is still appending to
it. Only fully-quiesced JSONLs (older calendar dates) are eligible.

Pure stdlib. The leaf never raises: empty queue / unreadable directory
both produce a clean SUCCESS skip with the reason recorded on bb.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from engine.core.node import Node, Status


class IncomingScan(Node):
    """Scan ``<store>/medium/incoming/*.jsonl`` for prior-day JSONL files.

    Writes:
      - ``bb.incoming_paths``                — list[str] of absolute paths
        sorted by filename (which is YYYY-MM-DD, so chronological).
      - ``bb.incoming_triage_dispatched``    — True when the list is
        non-empty (Dispatch leaf will yield); False on the skip path.
      - ``bb.incoming_triage_result``        — pre-populated skip
        sentinel on the empty path; left None when dispatched (Collect
        owns it once the main-agent reply lands).

    Constructor args:
      store_dir   — ``.cbim/memory/`` (the incoming subdir is resolved
                    against ``<store>/medium/incoming/``).
      now_func    — test seam for the "today" exclusion. Defaults to
                    ``datetime.now`` (local-time, matching incoming_writer).

    Status: never FAILURE. The leaf is best-effort and the dream loop
    must not abort on a missing / unreadable queue dir.
    """

    def __init__(
        self,
        *,
        store_dir: Path,
        now_func=datetime.now,
        name: str = "IncomingScan",
    ) -> None:
        self.name = name
        self._store_dir = Path(store_dir)
        self._now_func = now_func

    def tick(self, bb) -> Status:
        queue_dir = self._store_dir / "medium" / "incoming"
        today_stem = self._now_func().strftime("%Y-%m-%d")

        if not queue_dir.exists() or not queue_dir.is_dir():
            bb.incoming_paths = []
            bb.incoming_triage_dispatched = False
            bb.incoming_triage_result = {
                "skipped": True,
                "reason": "no_incoming_dir",
            }
            return Status.SUCCESS

        eligible: list[Path] = []
        for p in queue_dir.glob("*.jsonl"):
            # ``processed/`` is a subdirectory, not a glob match — sibling
            # files only. Defensive isinstance guard for Path.is_file in
            # case a torn FS yields a stale entry.
            try:
                if not p.is_file():
                    continue
            except OSError:
                continue
            if p.stem == today_stem:
                continue
            eligible.append(p)

        eligible.sort(key=lambda p: p.name)  # YYYY-MM-DD lexical = chrono

        if not eligible:
            bb.incoming_paths = []
            bb.incoming_triage_dispatched = False
            bb.incoming_triage_result = {
                "skipped": True,
                "reason": "no_mature_incoming",
            }
            return Status.SUCCESS

        bb.incoming_paths = [str(p) for p in eligible]
        bb.incoming_triage_dispatched = True
        return Status.SUCCESS
