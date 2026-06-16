"""Phase 4 — pure-function tests for hooks_src/_lib/incoming_writer."""
from __future__ import annotations

import json
import sys
from datetime import datetime
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


def test_append_capture_creates_dir_and_file(tmp_path):
    from _lib import incoming_writer
    fixed = datetime(2026, 6, 15, 12, 0, 0)
    out = incoming_writer.append_capture(tmp_path, {"kind": "turn"}, now=fixed)
    assert out is not None
    assert out.exists()
    assert out.name == "2026-06-15.jsonl"
    assert out.parent == tmp_path / ".cbim" / "memory" / "medium" / "incoming"


def test_append_capture_appends_jsonl(tmp_path):
    from _lib import incoming_writer
    fixed = datetime(2026, 6, 15, 12, 0, 0)
    incoming_writer.append_capture(tmp_path, {"kind": "a"}, now=fixed)
    incoming_writer.append_capture(tmp_path, {"kind": "b"}, now=fixed)
    p = tmp_path / ".cbim" / "memory" / "medium" / "incoming" / "2026-06-15.jsonl"
    lines = [json.loads(ln) for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) == 2
    assert lines[0]["kind"] == "a"
    assert lines[1]["kind"] == "b"
    # captured_at gets stamped automatically
    assert "captured_at" in lines[0]


def test_append_capture_preserves_explicit_captured_at(tmp_path):
    from _lib import incoming_writer
    fixed = datetime(2026, 6, 15)
    incoming_writer.append_capture(
        tmp_path, {"kind": "x", "captured_at": "from-test"}, now=fixed
    )
    p = tmp_path / ".cbim" / "memory" / "medium" / "incoming" / "2026-06-15.jsonl"
    rec = json.loads(p.read_text(encoding="utf-8").strip())
    assert rec["captured_at"] == "from-test"


def test_append_capture_empty_record_returns_none(tmp_path):
    from _lib import incoming_writer
    assert incoming_writer.append_capture(tmp_path, {}) is None
    assert incoming_writer.append_capture(tmp_path, None) is None  # type: ignore[arg-type]


def test_append_capture_unicode_unescaped(tmp_path):
    from _lib import incoming_writer
    incoming_writer.append_capture(tmp_path, {"summary": "决定采用方案A"})
    p = next((tmp_path / ".cbim" / "memory" / "medium" / "incoming").glob("*.jsonl"))
    assert "决定" in p.read_text(encoding="utf-8")


def test_append_capture_unserializable_returns_none(tmp_path):
    from _lib import incoming_writer
    class X: ...
    out = incoming_writer.append_capture(tmp_path, {"x": X()})
    # json.dumps raises TypeError → swallowed → None
    assert out is None
    qdir = tmp_path / ".cbim" / "memory" / "medium" / "incoming"
    # Directory may exist (we mkdir before serialise), but file MUST NOT.
    if qdir.exists():
        assert list(qdir.glob("*.jsonl")) == []
