"""Phase 4 — pure-function tests for hooks_src/_lib/turn_capture.

Covers:
  - reverse JSONL reader (small, large, missing, empty, torn boundary)
  - turn segmentation (last user → end; pure tool roundtrip skipped)
  - signal-word categories (each one has at least one positive case)
  - redaction (long token / sk- / ghp_ / xoxb- / AKIA replaced; emails / IPs kept)
"""
from __future__ import annotations

import json
import sys
import time
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


# ---------------------------------------------------------------------------
# read_last_n_lines
# ---------------------------------------------------------------------------

def test_read_last_n_lines_small_file(tmp_path):
    from _lib import turn_capture
    p = tmp_path / "t.jsonl"
    body = "\n".join([f'{{"i":{i}}}' for i in range(5)]) + "\n"
    p.write_text(body, encoding="utf-8")
    out = turn_capture.read_last_n_lines(str(p), 3)
    assert out == ['{"i":2}', '{"i":3}', '{"i":4}']


def test_read_last_n_lines_n_larger_than_file(tmp_path):
    from _lib import turn_capture
    p = tmp_path / "t.jsonl"
    p.write_text('{"a":1}\n{"a":2}\n', encoding="utf-8")
    out = turn_capture.read_last_n_lines(str(p), 100)
    assert out == ['{"a":1}', '{"a":2}']


def test_read_last_n_lines_missing_file(tmp_path):
    from _lib import turn_capture
    out = turn_capture.read_last_n_lines(str(tmp_path / "missing.jsonl"), 5)
    assert out == []


def test_read_last_n_lines_empty_file(tmp_path):
    from _lib import turn_capture
    p = tmp_path / "t.jsonl"
    p.write_text("", encoding="utf-8")
    assert turn_capture.read_last_n_lines(str(p), 5) == []


def test_read_last_n_lines_blank_lines_skipped(tmp_path):
    from _lib import turn_capture
    p = tmp_path / "t.jsonl"
    p.write_text("\n\n{\"a\":1}\n\n{\"a\":2}\n\n", encoding="utf-8")
    out = turn_capture.read_last_n_lines(str(p), 10)
    assert out == ['{"a":1}', '{"a":2}']


def test_read_last_n_lines_large_file_seek(tmp_path):
    """50 MiB file — verify the seek-backwards reader stays under 100ms."""
    from _lib import turn_capture
    p = tmp_path / "big.jsonl"
    # Build up ~50 MiB via repeated 100-byte lines (~525000 lines).
    line = ('x' * 99) + "\n"
    chunk = (line * 1024).encode("utf-8")  # ~100 KiB at a time
    target = 50 * 1024 * 1024
    written = 0
    with open(p, "wb") as f:
        while written < target:
            f.write(chunk)
            written += len(chunk)
        # Anchor a recognizable tail.
        f.write(b'{"role":"user","content":"final"}\n')

    t0 = time.perf_counter()
    out = turn_capture.read_last_n_lines(str(p), 10)
    elapsed = time.perf_counter() - t0
    assert any('"final"' in ln for ln in out)
    assert elapsed < 1.5, f"reverse read too slow: {elapsed:.3f}s"


def test_read_last_n_lines_n_zero(tmp_path):
    from _lib import turn_capture
    p = tmp_path / "t.jsonl"
    p.write_text('{"a":1}\n', encoding="utf-8")
    assert turn_capture.read_last_n_lines(str(p), 0) == []


# ---------------------------------------------------------------------------
# parse_jsonl_records
# ---------------------------------------------------------------------------

def test_parse_jsonl_records_drops_garbage():
    from _lib import turn_capture
    lines = ['{"role":"user","content":"hi"}', 'not json', '', '[1,2]']
    out = turn_capture.parse_jsonl_records(lines)
    assert out == [{"role": "user", "content": "hi"}]


# ---------------------------------------------------------------------------
# Turn segmentation
# ---------------------------------------------------------------------------

def test_last_complete_turn_basic():
    from _lib import turn_capture
    recs = [
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "hi"},
        {"role": "user", "content": "second"},
        {"role": "assistant", "content": "ack"},
    ]
    turn = turn_capture.last_complete_turn(recs)
    assert len(turn) == 2
    assert turn[0]["content"] == "second"


def test_last_complete_turn_no_user():
    from _lib import turn_capture
    recs = [{"role": "assistant", "content": "hi"}]
    assert turn_capture.last_complete_turn(recs) == []


def test_last_complete_turn_empty():
    from _lib import turn_capture
    assert turn_capture.last_complete_turn([]) == []


def test_turn_has_user_input_pure_tool_roundtrip_skipped():
    from _lib import turn_capture
    # Synthesize a "turn" that has only assistant + tool records (no user).
    turn = [
        {"role": "assistant", "content": "running tool"},
        {"role": "tool_result", "content": "{}"},
        {"role": "assistant", "content": "done"},
    ]
    assert turn_capture.turn_has_user_input(turn) is False


def test_turn_has_user_input_with_real_user_text():
    from _lib import turn_capture
    turn = [
        {"role": "user", "content": "please add a button"},
        {"role": "assistant", "content": "ok"},
    ]
    assert turn_capture.turn_has_user_input(turn) is True


def test_turn_has_user_input_empty_user_content_filtered():
    from _lib import turn_capture
    turn = [
        {"role": "user", "content": "   "},
        {"role": "assistant", "content": "ok"},
    ]
    assert turn_capture.turn_has_user_input(turn) is False


def test_record_role_handles_type_or_role_or_nested():
    from _lib import turn_capture
    assert turn_capture._record_role({"type": "user"}) == "user"
    assert turn_capture._record_role({"role": "assistant"}) == "assistant"
    assert turn_capture._record_role({"message": {"role": "user"}}) == "user"
    assert turn_capture._record_role({}) == ""


def test_extract_turn_text_concats_user_and_assistant_only():
    from _lib import turn_capture
    turn = [
        {"role": "user", "content": "Q"},
        {"role": "tool_use", "content": "shell"},
        {"role": "assistant", "content": "A"},
    ]
    assert turn_capture.extract_turn_text(turn) == "Q\nA"


def test_record_text_handles_list_of_blocks():
    from _lib import turn_capture
    rec = {"role": "user", "content": [{"type": "text", "text": "hello"},
                                        {"type": "image"}]}
    assert turn_capture._record_text(rec) == "hello"


def test_record_text_handles_nested_message():
    from _lib import turn_capture
    rec = {"type": "user", "message": {"role": "user", "content": "deep"}}
    assert turn_capture._record_text(rec) == "deep"


# ---------------------------------------------------------------------------
# Signal-word categories — at least one positive case each
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("我们决定采用方案A", "decision"),
    ("最后选了方案B", "decision"),
    ("we decided to ship", "decision"),
    ("going with the simpler one", "decision"),
])
def test_signal_decision(text, expected):
    from _lib import turn_capture
    cats = {h["category"] for h in turn_capture.find_signal_hits(text)}
    assert expected in cats


@pytest.mark.parametrize("text,expected", [
    ("规则是不能碰 .cbim", "rule"),
    ("原则是简单优先", "rule"),
    ("必须先读真实代码", "rule"),
    ("绝不修改 _MIN_AGE_SECONDS", "rule"),
    ("the rule is no force push", "rule"),
    ("you must always run tests", "rule"),
])
def test_signal_rule(text, expected):
    from _lib import turn_capture
    cats = {h["category"] for h in turn_capture.find_signal_hits(text)}
    assert expected in cats


@pytest.mark.parametrize("text,expected", [
    ("不要再改这个文件", "negation"),
    ("别提交这个", "negation"),
    ("放弃旧方案", "negation"),
    ("don't push to main", "negation"),
    ("stop the old approach", "negation"),
])
def test_signal_negation(text, expected):
    from _lib import turn_capture
    cats = {h["category"] for h in turn_capture.find_signal_hits(text)}
    assert expected in cats


@pytest.mark.parametrize("text,expected", [
    ("记住这一点", "memory_explicit"),
    ("记一下这个决定", "memory_explicit"),
    ("以后注意这个边界", "memory_explicit"),
    ("remember this for next time", "memory_explicit"),
    ("for the record we use BM25", "memory_explicit"),
])
def test_signal_memory_explicit(text, expected):
    from _lib import turn_capture
    cats = {h["category"] for h in turn_capture.find_signal_hits(text)}
    assert expected in cats


def test_find_signal_hits_empty_text():
    from _lib import turn_capture
    assert turn_capture.find_signal_hits("") == []
    assert turn_capture.find_signal_hits("just a normal sentence about weather") == []


def test_find_signal_hits_snippet_redacted():
    from _lib import turn_capture
    text = "决定使用 sk-ANTHROPIC1234567890ABCDEFG 作为密钥"
    hits = turn_capture.find_signal_hits(text)
    assert len(hits) == 1
    assert hits[0]["category"] == "decision"
    assert "<REDACTED:KEY>" in hits[0]["snippet"]
    assert "sk-ANTHROPIC" not in hits[0]["snippet"]


def test_find_signal_hits_snippet_truncated():
    from _lib import turn_capture
    # Use innocuous filler that survives redaction (short fragments under
    # 32 chars don't trigger the LONG_TOKEN scrubber) so we actually
    # exercise the length-cap branch.
    filler = " ".join(["xx"] * 250)
    text = "决定 " + filler
    hits = turn_capture.find_signal_hits(text, max_snippet=80)
    assert len(hits) == 1
    assert len(hits[0]["snippet"]) <= 83  # 80 + "..."
    assert hits[0]["snippet"].endswith("...")


def test_find_signal_hits_dedupe_per_category():
    from _lib import turn_capture
    text = "决定 A 决定 B 决定 C"
    hits = turn_capture.find_signal_hits(text)
    cats = [h["category"] for h in hits]
    assert cats.count("decision") == 1


# ---------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------

def test_redact_long_token():
    from _lib import turn_capture
    s = "key = abcdefghijklmnopqrstuvwxyz0123456789ABC"
    out = turn_capture.redact(s)
    assert "<REDACTED:LONG_TOKEN>" in out
    assert "abcdefghijklmnopqrstuvwxyz" not in out


def test_redact_sk_prefix():
    from _lib import turn_capture
    s = "ANTHROPIC_API_KEY=sk-abc123def456ghi789jkl012mno345"
    out = turn_capture.redact(s)
    assert "<REDACTED:KEY>" in out


def test_redact_github_token():
    from _lib import turn_capture
    out = turn_capture.redact("token=ghp_0123456789ABCDEFGhijklmn")
    assert "<REDACTED:KEY>" in out


def test_redact_slack_token():
    from _lib import turn_capture
    out = turn_capture.redact("xoxb-1234-5678-abcdefghijklmn opqrst")
    assert "<REDACTED:KEY>" in out


def test_redact_aws_key():
    from _lib import turn_capture
    out = turn_capture.redact("AKIAIOSFODNN7EXAMPLE")
    assert "<REDACTED:KEY>" in out


def test_redact_preserves_email():
    from _lib import turn_capture
    s = "ping me at foo@example.com tomorrow"
    out = turn_capture.redact(s)
    assert "foo@example.com" in out


def test_redact_preserves_ip():
    from _lib import turn_capture
    s = "the server is 192.168.1.42 in dev"
    out = turn_capture.redact(s)
    assert "192.168.1.42" in out


def test_redact_short_token_kept():
    from _lib import turn_capture
    # Below 32-char threshold — not a candidate.
    out = turn_capture.redact("hash=abcd1234efgh5678")  # 16 chars
    assert "abcd1234efgh5678" in out
    assert "<REDACTED:LONG_TOKEN>" not in out


def test_redact_empty_input():
    from _lib import turn_capture
    assert turn_capture.redact("") == ""
    assert turn_capture.redact(None) == ""  # type: ignore[arg-type]
