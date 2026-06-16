"""Phase 4 — pure-function tests for hooks_src/_lib/receipt_capture."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


_HOOKS_SRC = Path(__file__).resolve().parent.parent / "kernel" / "project" / "hooks_src"


@pytest.fixture(autouse=True)
def _hooks_on_path():
    s = str(_HOOKS_SRC)
    added = s not in sys.path
    if added:
        sys.path.insert(0, s)
    try:
        yield
    finally:
        if added:
            try:
                sys.path.remove(s)
            except ValueError:
                pass


_RECEIPT_OK = """\
The work is done.

<!-- BEGIN CBIM-RECEIPT v1
status: ok
task_id: t1
agent: programmer
summary: implemented the Stop hook capture path
artifacts: cbim_stop.py
END CBIM-RECEIPT -->
"""


_RECEIPT_FAILED = """\
<!-- BEGIN CBIM-RECEIPT v1
status: failed
task_id: t2
agent: programmer
summary: pytest crashed
failure_kind: test_failed
END CBIM-RECEIPT -->
"""


def test_parse_last_receipt_ok():
    from _lib import receipt_capture
    r = receipt_capture.parse_last_receipt(_RECEIPT_OK)
    assert r is not None
    assert r["status"] == "ok"
    assert r["agent"] == "programmer"
    assert "implemented" in r["summary"]


def test_parse_last_receipt_no_trailer():
    from _lib import receipt_capture
    assert receipt_capture.parse_last_receipt("just prose") is None


def test_parse_last_receipt_no_end_sentinel():
    from _lib import receipt_capture
    s = "<!-- BEGIN CBIM-RECEIPT v1\nstatus: ok\n"
    assert receipt_capture.parse_last_receipt(s) is None


def test_parse_last_receipt_two_blocks_last_wins():
    from _lib import receipt_capture
    text = _RECEIPT_OK + "\n\n" + _RECEIPT_FAILED
    r = receipt_capture.parse_last_receipt(text)
    assert r is not None
    assert r["status"] == "failed"
    assert r["task_id"] == "t2"


def test_parse_last_receipt_no_status_key():
    from _lib import receipt_capture
    s = "<!-- BEGIN CBIM-RECEIPT v1\nagent: programmer\nEND CBIM-RECEIPT -->"
    assert receipt_capture.parse_last_receipt(s) is None


def test_find_last_receipt_in_transcript(tmp_path):
    from _lib import receipt_capture
    p = tmp_path / "subagent.jsonl"
    rec_user = {"role": "user", "content": "do thing"}
    rec_asst = {
        "role": "assistant",
        "content": [
            {"type": "text", "text": _RECEIPT_OK},
        ],
    }
    p.write_text("\n".join([json.dumps(rec_user), json.dumps(rec_asst)]) + "\n",
                 encoding="utf-8")
    r = receipt_capture.find_last_receipt_in_transcript(str(p), last_n_lines=10)
    assert r is not None
    assert r["status"] == "ok"
    assert r["agent"] == "programmer"


def test_find_last_receipt_in_transcript_missing_file(tmp_path):
    from _lib import receipt_capture
    out = receipt_capture.find_last_receipt_in_transcript(
        str(tmp_path / "missing.jsonl")
    )
    assert out is None


def test_find_last_receipt_in_transcript_no_receipt(tmp_path):
    from _lib import receipt_capture
    p = tmp_path / "subagent.jsonl"
    p.write_text(json.dumps({"role": "assistant", "content": "no trailer here"}) + "\n",
                 encoding="utf-8")
    assert receipt_capture.find_last_receipt_in_transcript(str(p)) is None


def test_render_receipt_line_redacts():
    from _lib import receipt_capture
    receipt = {
        "status": "ok",
        "agent": "programmer",
        "summary": "leaked sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 in summary",
    }
    line = receipt_capture.render_receipt_line(receipt, agent_type="programmer")
    assert "<REDACTED:KEY>" in line
    assert "sk-ABCDEF" not in line
    assert "[subagent type=programmer status=ok]" in line


def test_render_receipt_line_unknown_fields():
    from _lib import receipt_capture
    line = receipt_capture.render_receipt_line({}, agent_type="")
    assert "[subagent type=unknown status=unknown]" in line
    assert "unknown:" in line


def test_render_receipt_line_summary_newlines_collapsed():
    from _lib import receipt_capture
    receipt = {"status": "ok", "agent": "x", "summary": "a\nb\nc"}
    line = receipt_capture.render_receipt_line(receipt, agent_type="t")
    assert "\n" not in line
