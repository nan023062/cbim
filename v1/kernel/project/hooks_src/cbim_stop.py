#!/usr/bin/env python3
"""Stop hook — in-process bridge to kernel.

Phase 4 (memory v2) redesign:
The legacy responsibility was to call session_writer.write_session() which
materialised the just-ended Claude Code transcript into a short-tier memory
file. The short tier was removed in memory v2, so this hook now does the
post-session indexing job instead:

  1. Resolve the transcript JSONL Claude Code wrote for this session
     (event.transcript_path; fall back to deriving from
     ~/.claude/projects/<slug>/<session_id>.jsonl).
  2. Read it and push it into engine.retrieval as source="transcript".
     The dream loop's TranscriptScan / DispatchMemDistill steps consume
     those indexed transcripts during the next governance tick.
  3. (Phase 4 addition) Per-turn realtime capture: read the tail of the
     same transcript, locate the last complete user-anchored turn, run
     the signal-word filter, and on a hit append one redacted JSON
     record to ``.cbim/memory/medium/incoming/<date>.jsonl``. The dream
     loop's IncomingTriage step (future) consumes that queue.

Failures are swallowed (hook MUST NOT block CC shutdown) but logged to
stderr via safe_run.
"""
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _lib.event_io import read_event
from _lib.paths import project_root_from_cwd
from _lib.bridge import bootstrap_kernel, safe_run


def _resolve_transcript(root: Path, event_path: str, session_id: str) -> Path | None:
    """Pick the transcript JSONL for the just-ended session.

    Preference order:
      1. event.transcript_path (CC supplies this on Stop).
      2. ~/.claude/projects/<slug>/<session_id>.jsonl (best-effort derivation).

    Returns None when neither lands on an existing readable file. The
    slug-derivation path imports ``memory._lib.paths.cc_transcripts_dir``
    lazily — bootstrap_kernel must have put the kernel on sys.path first.
    """
    if event_path:
        p = Path(event_path)
        if p.is_file():
            return p
    if session_id:
        try:
            from memory._lib.paths import cc_transcripts_dir
        except ImportError:
            return None
        try:
            cand = cc_transcripts_dir(root) / f"{session_id}.jsonl"
        except (RuntimeError, OSError):
            return None
        if cand.is_file():
            return cand
    return None


def _index_transcript(root: Path, transcript: Path) -> None:
    """Upsert the transcript JSONL into engine.retrieval source='transcript'.

    doc_id  = absolute transcript path string (matches the conventions
              used by dream.TranscriptDelete -> index_delete).
    content = full JSONL file body.
    metadata.source_path = same absolute path, so retrieval's fast-check
                           can stat it on later drift verification.
    """
    from engine.retrieval import index_upsert

    try:
        content = transcript.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        # Don't kill the whole hook — log and skip indexing this transcript.
        print(
            f"[CBIM:hook] stop.index_transcript: cannot read {transcript}: "
            f"{type(e).__name__}: {e}",
            file=sys.stderr,
        )
        return
    if not content:
        return
    abs_path = str(transcript.resolve())
    index_upsert(
        "transcript",
        abs_path,
        content,
        {"source_path": abs_path},
    )


def _mark_idle(root: Path) -> None:
    cbim = root / ".cbim"
    cbim.mkdir(parents=True, exist_ok=True)
    (cbim / ".cc-status").write_text(
        f"idle {datetime.now().isoformat()}\n", encoding="utf-8"
    )


def _log_assist(root: Path, transcript_path: str) -> None:
    from engine.logger import log_assist
    log_assist(transcript_path, cbim=root / ".cbim")


def _capture_turn(root: Path, transcript: Path) -> None:
    """Per-turn realtime capture: signal-word grep on the last turn.

    On a signal-word hit, append one redacted JSON record to
    ``<root>/.cbim/memory/medium/incoming/<YYYY-MM-DD>.jsonl``. Skips
    silently when:
      - transcript file is unreadable / empty
      - the last turn carries no real user input (pure tool roundtrip)
      - no signal word matches

    Never raises — this is wrapped in ``safe_run`` by the caller anyway,
    but the function is also written defensively so a malformed JSONL row
    doesn't take out the whole hook.
    """
    from _lib import turn_capture, incoming_writer

    raw_lines = turn_capture.read_last_n_lines(str(transcript), 20)
    if not raw_lines:
        return
    records = turn_capture.parse_jsonl_records(raw_lines)
    turn = turn_capture.last_complete_turn(records)
    if not turn:
        return
    if not turn_capture.turn_has_user_input(turn):
        return
    text = turn_capture.extract_turn_text(turn)
    hits = turn_capture.find_signal_hits(text)
    if not hits:
        return
    incoming_writer.append_capture(root, {
        "kind": "turn",
        "source": "stop_hook",
        "transcript": str(transcript.resolve()),
        "signals": hits,
    })


def main() -> int:
    event = read_event()
    cwd = event.get("cwd") or "."
    transcript_path = event.get("transcript_path", "") or ""
    session_id = event.get("session_id", "") or ""
    root = project_root_from_cwd(cwd)

    if not bootstrap_kernel(root):
        return 0

    if transcript_path:
        safe_run(lambda: _log_assist(root, transcript_path),
                 on_error_label="stop.log_assist")

    transcript = _resolve_transcript(root, transcript_path, session_id)
    if transcript is not None:
        safe_run(lambda: _index_transcript(root, transcript),
                 on_error_label="stop.index_transcript")
        safe_run(lambda: _capture_turn(root, transcript),
                 on_error_label="stop.capture_turn")

    safe_run(lambda: _mark_idle(root), on_error_label="stop.mark_idle")
    return 0


if __name__ == "__main__":
    sys.exit(main())
