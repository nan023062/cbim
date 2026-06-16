#!/usr/bin/env python3
"""SubagentStop hook — in-process bridge to kernel.

Phase 4 of the memory redesign. Fires when a Claude Code sub-agent (Task
tool) finishes. We pull the *last* CBIM-RECEIPT trailer out of the
sub-agent's transcript JSONL, redact it, and append one summary line to
the incoming queue at:

    <project_root>/.cbim/memory/medium/incoming/<YYYY-MM-DD>.jsonl

Why parse the transcript rather than the event payload directly?
  [CC-API 待核] The exact shape of CC's SubagentStop event isn't fully
  pinned down — it definitely supplies ``transcript_path`` (same key the
  Stop event uses), but whether it also surfaces the sub-agent's reply
  text inline is undocumented as of writing. Reading the transcript is
  the conservative path: it works regardless.

Failures are swallowed (hook MUST NOT block CC shutdown / sub-agent
return) but logged to stderr via safe_run. Exit code is always 0.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _lib.event_io import read_event
from _lib.paths import project_root_from_cwd
from _lib.bridge import bootstrap_kernel, safe_run


def _resolve_transcript(event_path: str) -> Path | None:
    """Pick the transcript JSONL the sub-agent wrote.

    Unlike the Stop hook, we don't try to derive the path from a session
    id — sub-agent transcripts are written under the same project slug
    but with their own session id we don't have here. Fall back: None
    (skip capture).
    """
    if not event_path:
        return None
    p = Path(event_path)
    if p.is_file():
        return p
    return None


def _capture_receipt(root: Path, transcript: Path, agent_type: str) -> None:
    """Parse the last receipt trailer from the transcript and append.

    Skips silently when no receipt is present (legacy / first-call /
    malformed sub-agents). Reuses ``turn_capture`` for the seek-backwards
    JSONL reader, ``receipt_capture`` for the trailer parse, and
    ``incoming_writer`` for the append.
    """
    from _lib import receipt_capture, turn_capture, incoming_writer

    receipt = receipt_capture.find_last_receipt_in_transcript(
        str(transcript), last_n_lines=10
    )
    if receipt is None:
        return
    line = receipt_capture.render_receipt_line(receipt, agent_type=agent_type)
    if not line:
        return
    incoming_writer.append_capture(root, {
        "kind": "subagent_receipt",
        "source": "subagent_stop_hook",
        "agent_type": agent_type or "unknown",
        "transcript": str(transcript.resolve()),
        "receipt_status": receipt.get("status", "unknown"),
        "receipt_agent": receipt.get("agent", "unknown"),
        "summary_redacted": turn_capture.redact(receipt.get("summary") or ""),
        "line": line,
    })


def main() -> int:
    event = read_event()
    cwd = event.get("cwd") or "."
    transcript_path = event.get("transcript_path", "") or ""
    # CC may surface the sub-agent's slug under a few keys; try each.
    agent_type = (
        event.get("agent_type")
        or event.get("subagent_type")
        or event.get("agent")
        or ""
    )
    if isinstance(agent_type, dict):
        agent_type = agent_type.get("name") or agent_type.get("type") or ""
    if not isinstance(agent_type, str):
        agent_type = str(agent_type)

    root = project_root_from_cwd(cwd)
    if not bootstrap_kernel(root):
        return 0

    transcript = _resolve_transcript(transcript_path)
    if transcript is None:
        return 0

    safe_run(lambda: _capture_receipt(root, transcript, agent_type),
             on_error_label="subagent_stop.capture_receipt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
