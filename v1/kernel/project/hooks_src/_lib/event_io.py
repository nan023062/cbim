"""
hooks_src/_lib/event_io.py — stdin/stdout helpers for Claude Code hook scripts.

stdlib-only. No business knowledge. Placeholder surface — Phase 3a rewrites
the seven hook scripts and consumes these helpers.

Public surface:
    read_event() -> dict
    write_additional_context(text)
"""

from __future__ import annotations

import json
import sys


def read_event() -> dict:
    """Read a single Claude Code hook event JSON object from stdin."""
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def write_additional_context(text: str, *, event_name: str = "SessionStart") -> None:
    """Emit an additionalContext payload on stdout for a given hook event.

    Default ``event_name="SessionStart"`` preserves the pre-existing caller
    contract; UserPromptSubmit (and any future event_name-bearing hook)
    passes the appropriate identifier explicitly.
    """
    payload = {
        "hookSpecificOutput": {
            "hookEventName": event_name,
            "additionalContext": text or "",
        }
    }
    # Force UTF-8 at the bytes layer so non-ASCII content (Chinese, emoji,
    # rare CJK glyphs) never trips over the platform default encoding
    # (e.g. GBK on Windows), which would otherwise raise UnicodeEncodeError
    # from sys.stdout.write and crash the hook. Matches the project-wide
    # convention of explicit UTF-8 for all stdout/file I/O.
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()
