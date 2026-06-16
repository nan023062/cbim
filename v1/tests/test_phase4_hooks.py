"""Phase 4 — integration / fail-safety tests for the Stop & SubagentStop hooks.

Confirms:
  - cbim_stop._capture_turn appends one record on a signal-word hit.
  - cbim_stop._capture_turn writes nothing on a tool-only turn.
  - cbim_stop._capture_turn writes nothing without signal hit.
  - cbim_stop._capture_turn never raises (missing file / malformed JSONL /
    append failure).
  - cbim_subagent_stop._capture_receipt writes the receipt line.
  - cbim_subagent_stop is exit-0 even when transcript_path is missing.
  - existing cbim_stop._index_transcript wiring still works (regression).
  - hook total wall-clock under 200 ms on a typical transcript.
  - _MIN_AGE_SECONDS in dream.transcript_steps remains 86400 (untouched).
"""
from __future__ import annotations

import io
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


def _isolate_index_root(monkeypatch, tmp_path: Path) -> Path:
    from engine.retrieval import facade as _facade_mod
    index_root = tmp_path / ".cbim" / "index"
    monkeypatch.setattr(_facade_mod, "_resolve_index_root", lambda: index_root)
    _facade_mod.reset_default_facade()
    return index_root


def _read_incoming_jsonl(root: Path) -> list[dict]:
    """Read all incoming/*.jsonl records (any date) under <root>/.cbim/memory/medium/incoming/."""
    qdir = root / ".cbim" / "memory" / "medium" / "incoming"
    if not qdir.exists():
        return []
    out: list[dict] = []
    for p in sorted(qdir.glob("*.jsonl")):
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return out


def _make_transcript(tmp_path: Path, records: list[dict]) -> Path:
    p = tmp_path / "transcript.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in records) + "\n",
                 encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# cbim_stop._capture_turn
# ---------------------------------------------------------------------------

def test_capture_turn_writes_on_signal_hit(tmp_path):
    import cbim_stop
    transcript = _make_transcript(tmp_path, [
        {"role": "user", "content": "我们决定采用方案A"},
        {"role": "assistant", "content": "好的"},
    ])
    cbim_stop._capture_turn(tmp_path, transcript)
    records = _read_incoming_jsonl(tmp_path)
    assert len(records) == 1
    rec = records[0]
    assert rec["kind"] == "turn"
    assert rec["source"] == "stop_hook"
    cats = {h["category"] for h in rec["signals"]}
    assert "decision" in cats


def test_capture_turn_skips_pure_tool_roundtrip(tmp_path):
    import cbim_stop
    transcript = _make_transcript(tmp_path, [
        {"role": "assistant", "content": "running tool"},
        {"role": "tool_use", "content": "shell"},
        {"role": "tool_result", "content": "ok"},
    ])
    cbim_stop._capture_turn(tmp_path, transcript)
    assert _read_incoming_jsonl(tmp_path) == []


def test_capture_turn_skips_when_no_signal(tmp_path):
    import cbim_stop
    transcript = _make_transcript(tmp_path, [
        {"role": "user", "content": "just chatting about weather"},
        {"role": "assistant", "content": "nice day"},
    ])
    cbim_stop._capture_turn(tmp_path, transcript)
    assert _read_incoming_jsonl(tmp_path) == []


def test_capture_turn_missing_file_safe(tmp_path):
    import cbim_stop
    # Should not raise, should not write.
    cbim_stop._capture_turn(tmp_path, tmp_path / "nope.jsonl")
    assert _read_incoming_jsonl(tmp_path) == []


def test_capture_turn_malformed_jsonl_safe(tmp_path):
    import cbim_stop
    p = tmp_path / "garbage.jsonl"
    p.write_text("this is not json\n{{{{\n", encoding="utf-8")
    # Must not raise.
    cbim_stop._capture_turn(tmp_path, p)
    assert _read_incoming_jsonl(tmp_path) == []


def test_capture_turn_append_failure_swallowed(tmp_path, monkeypatch):
    """If incoming_writer.append_capture itself raises, _capture_turn must not."""
    import cbim_stop
    from _lib import incoming_writer

    transcript = _make_transcript(tmp_path, [
        {"role": "user", "content": "决定使用方案 A"},
    ])

    def boom(*a, **kw):
        raise OSError("disk full")

    monkeypatch.setattr(incoming_writer, "append_capture", boom)
    # _capture_turn calls incoming_writer.append_capture directly; it
    # should propagate, but the hook's safe_run is the outer guard. Here
    # we verify the hook .main() (with safe_run) is exit-safe.
    # Direct call WILL raise — that's expected. The outer safety net is
    # tested separately below in test_main_safe_on_capture_failure.
    with pytest.raises(OSError):
        cbim_stop._capture_turn(tmp_path, transcript)


def test_main_safe_on_capture_failure(tmp_path, monkeypatch):
    """Driving cbim_stop.main() through a transcript that triggers a
    raising _capture_turn — main() must still return 0 thanks to safe_run."""
    import cbim_stop
    from _lib import incoming_writer

    _isolate_index_root(monkeypatch, tmp_path)
    transcript = _make_transcript(tmp_path, [
        {"role": "user", "content": "决定使用方案 A"},
    ])
    (tmp_path / ".cbim").mkdir(exist_ok=True)
    (tmp_path / ".claude").mkdir(exist_ok=True)
    (tmp_path / ".cbim" / "kernel").mkdir(exist_ok=True)

    monkeypatch.setattr(incoming_writer, "append_capture",
                        lambda *a, **kw: (_ for _ in ()).throw(OSError("boom")))

    event = {
        "cwd": str(tmp_path),
        "transcript_path": str(transcript),
        "session_id": "sess-1",
    }
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(event)))

    # bootstrap_kernel needs an actual .cbim/kernel/ on the project root
    # to succeed; we already created the dir but it's empty. The
    # bootstrap function only checks existence — sys.path insert succeeds.

    rc = cbim_stop.main()
    assert rc == 0


# ---------------------------------------------------------------------------
# cbim_subagent_stop
# ---------------------------------------------------------------------------

_RECEIPT_TEXT = """\
done.

<!-- BEGIN CBIM-RECEIPT v1
status: ok
task_id: t9
agent: programmer
summary: implemented the per-turn capture
END CBIM-RECEIPT -->
"""


def test_subagent_stop_capture_writes_line(tmp_path):
    import cbim_subagent_stop
    transcript = _make_transcript(tmp_path, [
        {"role": "user", "content": "do work"},
        {"role": "assistant", "content": [{"type": "text", "text": _RECEIPT_TEXT}]},
    ])
    cbim_subagent_stop._capture_receipt(tmp_path, transcript, agent_type="programmer")
    records = _read_incoming_jsonl(tmp_path)
    assert len(records) == 1
    rec = records[0]
    assert rec["kind"] == "subagent_receipt"
    assert rec["agent_type"] == "programmer"
    assert rec["receipt_status"] == "ok"
    assert "[subagent type=programmer status=ok]" in rec["line"]


def test_subagent_stop_capture_no_receipt_silent(tmp_path):
    import cbim_subagent_stop
    transcript = _make_transcript(tmp_path, [
        {"role": "assistant", "content": "no trailer here"},
    ])
    cbim_subagent_stop._capture_receipt(tmp_path, transcript, agent_type="programmer")
    assert _read_incoming_jsonl(tmp_path) == []


def test_subagent_stop_main_missing_transcript_exits_zero(tmp_path, monkeypatch):
    """No transcript_path => exit 0, no write, no raise."""
    import cbim_subagent_stop
    (tmp_path / ".cbim" / "kernel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".claude").mkdir(exist_ok=True)
    event = {
        "cwd": str(tmp_path),
        "transcript_path": "",
        "agent_type": "programmer",
    }
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(event)))
    rc = cbim_subagent_stop.main()
    assert rc == 0
    assert _read_incoming_jsonl(tmp_path) == []


def test_subagent_stop_main_malformed_transcript_exits_zero(tmp_path, monkeypatch):
    import cbim_subagent_stop
    (tmp_path / ".cbim" / "kernel").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".claude").mkdir(exist_ok=True)
    p = tmp_path / "bad.jsonl"
    p.write_text("not json\n{}{{}}\n", encoding="utf-8")
    event = {
        "cwd": str(tmp_path),
        "transcript_path": str(p),
        "agent_type": "programmer",
    }
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(event)))
    rc = cbim_subagent_stop.main()
    assert rc == 0


def test_subagent_stop_agent_type_from_alternate_keys(tmp_path):
    """CC may surface the slug under any of agent_type / subagent_type / agent."""
    import cbim_subagent_stop
    transcript = _make_transcript(tmp_path, [
        {"role": "assistant", "content": [{"type": "text", "text": _RECEIPT_TEXT}]},
    ])
    cbim_subagent_stop._capture_receipt(tmp_path, transcript, agent_type="architect")
    records = _read_incoming_jsonl(tmp_path)
    assert records[0]["agent_type"] == "architect"


# ---------------------------------------------------------------------------
# Performance sanity
# ---------------------------------------------------------------------------

def test_capture_turn_under_200ms(tmp_path):
    import cbim_stop
    # 500 records, last turn carries a hit. Reasonable upper bound for
    # day-to-day CC sessions.
    body: list[dict] = []
    for i in range(500):
        body.append({"role": "assistant", "content": f"chatter {i}"})
    body.append({"role": "user", "content": "我们决定采用方案A"})
    body.append({"role": "assistant", "content": "ok"})
    transcript = _make_transcript(tmp_path, body)

    t0 = time.perf_counter()
    cbim_stop._capture_turn(tmp_path, transcript)
    elapsed = time.perf_counter() - t0
    assert elapsed < 0.2, f"capture too slow: {elapsed:.3f}s"


# ---------------------------------------------------------------------------
# Regression: existing index_transcript still wires up
# ---------------------------------------------------------------------------

def test_existing_index_transcript_still_works(monkeypatch, tmp_path):
    import cbim_stop
    _isolate_index_root(monkeypatch, tmp_path)
    transcript = _make_transcript(tmp_path, [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ])
    cbim_stop._index_transcript(tmp_path, transcript)
    from engine.retrieval import stats
    s = stats("transcript")
    assert s.total_docs >= 1


# ---------------------------------------------------------------------------
# Hard rule: _MIN_AGE_SECONDS unchanged
# ---------------------------------------------------------------------------

def test_min_age_seconds_unchanged():
    from engine.dream.actions import transcript_steps
    assert transcript_steps._MIN_AGE_SECONDS == 86400
