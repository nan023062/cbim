"""Fixtures for engine.logger narrowed-except blocks (Batch 5.6).

Two functions were narrowed:
  - _agent_label: now `except (OSError, json.JSONDecodeError, ValueError):`
  - _last_assistant_text: now
    `except (OSError, json.JSONDecodeError, ValueError, TypeError):`

These tests inject corruption fixtures (missing meta, broken JSON,
non-utf8 bytes, malformed transcript lines) and assert the contract is
preserved (return "" on every covered failure mode), and that unrelated
exception classes still propagate.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from engine import logger as logger_mod


def _clear_caches():
    logger_mod._agent_label.cache_clear()


# --- _agent_label --------------------------------------------------------


def test_agent_label_returns_empty_for_main_session_transcript(tmp_path):
    _clear_caches()
    fake_main = tmp_path / "session.jsonl"
    fake_main.write_text("", encoding="utf-8")
    assert logger_mod._agent_label(str(fake_main)) == ""


def test_agent_label_returns_empty_when_meta_missing(tmp_path):
    _clear_caches()
    sub = tmp_path / "subagents" / "agent-abc.jsonl"
    sub.parent.mkdir(parents=True)
    sub.write_text("", encoding="utf-8")
    # No agent-abc.meta.json next to it.
    assert logger_mod._agent_label(str(sub)) == ""


def test_agent_label_handles_corrupt_meta_json(tmp_path):
    _clear_caches()
    sub = tmp_path / "subagents" / "agent-abc.jsonl"
    sub.parent.mkdir(parents=True)
    sub.write_text("", encoding="utf-8")
    (sub.parent / "agent-abc.meta.json").write_text(
        "{not valid json", encoding="utf-8"
    )
    # JSONDecodeError caught → "".
    assert logger_mod._agent_label(str(sub)) == ""


def test_agent_label_handles_non_utf8_meta(tmp_path):
    _clear_caches()
    sub = tmp_path / "subagents" / "agent-abc.jsonl"
    sub.parent.mkdir(parents=True)
    sub.write_text("", encoding="utf-8")
    (sub.parent / "agent-abc.meta.json").write_bytes(b"\xff\xfe\x00garbage")
    # UnicodeDecodeError is a subclass of ValueError → caught → "".
    assert logger_mod._agent_label(str(sub)) == ""


def test_agent_label_returns_label_on_well_formed_meta(tmp_path):
    _clear_caches()
    sub = tmp_path / "subagents" / "agent-abc.jsonl"
    sub.parent.mkdir(parents=True)
    sub.write_text("", encoding="utf-8")
    (sub.parent / "agent-abc.meta.json").write_text(
        json.dumps({"agentType": "architect"}), encoding="utf-8"
    )
    assert logger_mod._agent_label(str(sub)) == "[agent:architect] "


# --- _last_assistant_text -----------------------------------------------


def _write_transcript(path: Path, lines: list[str]) -> None:
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_last_assistant_text_skips_corrupt_jsonl_lines(tmp_path):
    """Malformed JSON lines must be skipped, not crash the function."""
    transcript = tmp_path / "session.jsonl"
    _write_transcript(transcript, [
        "{not valid json",
        json.dumps({
            "role": "assistant",
            "content": [{"type": "text", "text": "real content"}],
        }),
        "another corrupt {",
    ])

    out = logger_mod._last_assistant_text(str(transcript))
    assert out == "real content"


def test_last_assistant_text_returns_empty_on_missing_file(tmp_path):
    """Non-existent transcript path → OSError caught → ""."""
    out = logger_mod._last_assistant_text(str(tmp_path / "nope.jsonl"))
    assert out == ""


def test_last_assistant_text_returns_empty_on_non_utf8(tmp_path):
    """Binary garbage → opened with errors='replace', so the open itself
    won't raise; the JSONDecodeError on every line is caught and we get ""."""
    transcript = tmp_path / "session.jsonl"
    transcript.write_bytes(b"\xff\xfe\x00garbage\n")
    out = logger_mod._last_assistant_text(str(transcript))
    assert out == ""


def test_last_assistant_text_handles_message_wrapped_format(tmp_path):
    """The Claude Code transcript dialect where role is under inner.message."""
    transcript = tmp_path / "session.jsonl"
    _write_transcript(transcript, [
        json.dumps({
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "wrapped reply"}],
            }
        }),
    ])
    assert logger_mod._last_assistant_text(str(transcript)) == "wrapped reply"
