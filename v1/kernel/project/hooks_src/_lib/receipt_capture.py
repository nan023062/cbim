"""hooks_src/_lib/receipt_capture.py — pure helpers for SubagentStop receipt capture.

Reads a sub-agent transcript JSONL and pulls the *last* CBIM-RECEIPT trailer
out of the most recent assistant text. The wire format is the one specced
in ``v1/kernel/cbi/agents/work/skills/receipt_trailer/skill.py`` (read by
``v1/kernel/engine/execution/actions/receipt.py``):

    <!-- BEGIN CBIM-RECEIPT v1
    status: <enum>
    task_id: <id>
    agent: <slug>
    summary: <one-line>
    ...
    END CBIM-RECEIPT -->

This module's job is intentionally narrower than ``receipt.py``: we only
need ``status``, ``agent``, and ``summary`` for the per-turn capture line.
Full schema validation belongs in the engine, not the hook.

Pure stdlib. No engine imports. Failure stance: missing / malformed
trailer returns ``None`` (the hook then writes nothing).

[CC-API 待核] SubagentStop event payload shape — Claude Code's docs do not
yet confirm whether the event carries `transcript_path` plus the sub-agent
output, or only one of them. We design conservatively: parse the
transcript path's tail; if no receipt trailer is present, write nothing.
"""

from __future__ import annotations

import re

from . import turn_capture


_BEGIN_RE = re.compile(r"<!--\s*BEGIN\s+CBIM-RECEIPT\s+v1")
_END_RE = re.compile(r"END\s+CBIM-RECEIPT\s*-->")
_FIELD_RE = re.compile(r"^([a-z_][a-z0-9_]*)\s*:\s*(.*)$", re.IGNORECASE)


def parse_last_receipt(text: str) -> dict | None:
    """Pull the last CBIM-RECEIPT block out of ``text`` and return its fields.

    Returns ``None`` when no BEGIN sentinel is present, when END is missing,
    or when ``status`` is absent. Returns a dict containing whatever
    recognized keys were present (``status`` / ``agent`` / ``summary``
    plus anything else as a flat string→string map).
    """
    if not isinstance(text, str) or not text:
        return None
    begin_matches = list(_BEGIN_RE.finditer(text))
    if not begin_matches:
        return None
    last_begin = begin_matches[-1]
    end_match = _END_RE.search(text, last_begin.end())
    if end_match is None:
        return None
    body = text[last_begin.end():end_match.start()]
    fields: dict[str, str] = {}
    for raw_line in body.splitlines():
        m = _FIELD_RE.match(raw_line.strip())
        if not m:
            continue
        key = m.group(1).strip().lower()
        value = m.group(2).strip()
        if key:
            fields[key] = value
    if "status" not in fields:
        return None
    return fields


def find_last_receipt_in_transcript(path: str, last_n_lines: int = 10) -> dict | None:
    """Read the tail of a transcript JSONL and return the last receipt dict.

    Walks the last ``last_n_lines`` records from newest backward, decoding
    each record's text content and asking ``parse_last_receipt`` for a
    trailer. The first hit wins (newest receipt).

    Returns ``None`` when the transcript can't be read, has no records,
    or no record contains a recognizable trailer.
    """
    raw_lines = turn_capture.read_last_n_lines(path, last_n_lines)
    if not raw_lines:
        return None
    records = turn_capture.parse_jsonl_records(raw_lines)
    if not records:
        return None
    # Iterate newest-first so the most recent receipt wins.
    for rec in reversed(records):
        text = _record_text(rec)
        if not text:
            continue
        receipt = parse_last_receipt(text)
        if receipt is not None:
            return receipt
    return None


def _record_text(rec: dict) -> str:
    """Re-export turn_capture._record_text so callers don't dip into _-module internals."""
    return turn_capture._record_text(rec)


def render_receipt_line(receipt: dict, *, agent_type: str = "") -> str:
    """Format a parsed receipt as the single redacted append-line.

    Output shape:
        [subagent type=<t> status=<s>] <agent>: <redacted summary>

    Empty / unknown fields collapse to ``"unknown"``. Summary is redacted
    via ``turn_capture.redact``.
    """
    if not isinstance(receipt, dict):
        return ""
    status = receipt.get("status") or "unknown"
    agent = receipt.get("agent") or "unknown"
    summary = receipt.get("summary") or ""
    redacted = turn_capture.redact(summary).replace("\n", " ").strip()
    type_label = (agent_type or "unknown").strip() or "unknown"
    return f"[subagent type={type_label} status={status}] {agent}: {redacted}"
