"""hooks_src/_lib/incoming_writer.py — append-line writer for the incoming queue.

Phase 4 lands per-turn realtime captures into a daily JSONL queue at:

    <project_root>/.cbim/memory/medium/incoming/YYYY-MM-DD.jsonl

The queue is consumed (later) by a dream `IncomingTriage` step that decides
whether to promote each line into a real `medium/*.md` entry. We use JSONL
(one record per line) so the file is true append-only, atomic per write,
and the existing `medium/*.md` mtime-walk in `crud/file_backend.py` does
not see it (mtime walk only globs ``*.md``).

Pure stdlib. The hook layer wraps the call in ``safe_run``; this module
itself opens the file in append mode under ``OSError`` swallowing only —
re-raising would bubble up to the safe_run boundary anyway.

We deliberately avoid file-locking. A multi-writer race on the same daily
file results in interleaved JSON lines at worst; since each write is a
single ``write()`` of a single line ending in ``\\n``, the kernel's
write buffering on POSIX guarantees atomicity below the typical PIPE_BUF
threshold (4 KiB). Captures are far smaller. Windows ``open(..., "a")``
serializes writes per-handle.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def append_capture(project_root: Path, record: dict, *, now: datetime | None = None) -> Path | None:
    """Append a single JSON record to today's incoming queue file.

    Returns the path written to, or ``None`` if the record was empty / the
    write failed (we never raise; the hook is exit-safe).
    """
    if not isinstance(record, dict) or not record:
        return None
    now = now or datetime.now()
    queue_dir = Path(project_root) / ".cbim" / "memory" / "medium" / "incoming"
    try:
        queue_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    target = queue_dir / f"{now.strftime('%Y-%m-%d')}.jsonl"

    # Stamp ``captured_at`` if the caller didn't pre-set it. We don't
    # overwrite an explicit value — tests may pin time for determinism.
    rec = dict(record)
    rec.setdefault("captured_at", now.isoformat(timespec="seconds"))

    try:
        line = json.dumps(rec, ensure_ascii=False)
    except (TypeError, ValueError):
        return None
    try:
        with open(target, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        return None
    return target
