"""Tests for kernel/_io.py — atomic_write_bytes / atomic_write_text / fsync_dir.

Covers:
- normal write round-trip (bytes + text)
- crash mid-write leaves the original file intact and removes <path>.tmp
- file fsync failure propagates and tmp is cleaned up
- directory fsync failure is swallowed (best-effort)
- bytes/text wrappers produce equivalent on-disk content
"""

from __future__ import annotations

import os
from pathlib import Path

import atomic_io as kernel_io  # kernel root leaf
import pytest
from atomic_io import atomic_write_bytes, atomic_write_text, fsync_dir


def test_atomic_write_text_round_trip(tmp_path: Path):
    target = tmp_path / "sub" / "file.txt"
    atomic_write_text(target, "hello world", fsync=True)
    assert target.read_text(encoding="utf-8") == "hello world"
    # No leftover tmp.
    assert not (target.with_suffix(target.suffix + ".tmp")).exists()


def test_atomic_write_bytes_round_trip(tmp_path: Path):
    target = tmp_path / "blob.bin"
    payload = bytes(range(256))
    atomic_write_bytes(target, payload, fsync=True)
    assert target.read_bytes() == payload


def test_atomic_write_text_no_fsync_path(tmp_path: Path):
    target = tmp_path / "nf.txt"
    atomic_write_text(target, "no fsync", fsync=False)
    assert target.read_text(encoding="utf-8") == "no fsync"


def test_atomic_write_text_preserves_original_on_write_failure(tmp_path: Path, monkeypatch):
    target = tmp_path / "keep.txt"
    target.write_text("original", encoding="utf-8")

    real_write = os.write

    def boom(fd, data):
        raise OSError("simulated write failure")

    monkeypatch.setattr(os, "write", boom)

    with pytest.raises(OSError, match="simulated write failure"):
        atomic_write_text(target, "new", fsync=True)

    # Original intact.
    assert target.read_text(encoding="utf-8") == "original"
    # tmp cleaned.
    assert not (target.with_suffix(target.suffix + ".tmp")).exists()

    # restore (paranoia)
    monkeypatch.setattr(os, "write", real_write)


def test_atomic_write_text_propagates_file_fsync_failure(tmp_path: Path, monkeypatch):
    target = tmp_path / "fsync.txt"

    real_fsync = os.fsync
    calls = {"n": 0}

    def fail_first_fsync(fd):
        calls["n"] += 1
        # First call is for the file fd → must propagate.
        if calls["n"] == 1:
            raise OSError("simulated fsync failure")
        return real_fsync(fd)

    monkeypatch.setattr(os, "fsync", fail_first_fsync)

    with pytest.raises(OSError, match="simulated fsync failure"):
        atomic_write_text(target, "payload", fsync=True)

    # File never replaced; tmp cleaned.
    assert not target.exists()
    assert not (target.with_suffix(target.suffix + ".tmp")).exists()


def test_fsync_dir_swallows_failure(tmp_path: Path, monkeypatch):
    # Force os.fsync to fail; fsync_dir must not raise.
    def fail(fd):
        raise OSError("nope")

    monkeypatch.setattr(os, "fsync", fail)
    fsync_dir(tmp_path)  # should not raise


def test_fsync_dir_handles_missing_dir(tmp_path: Path):
    missing = tmp_path / "does_not_exist"
    # Must not raise even if the directory is gone.
    fsync_dir(missing)


def test_text_and_bytes_equivalence(tmp_path: Path):
    """atomic_write_text(s) and atomic_write_bytes(s.encode()) produce the same bytes."""
    a = tmp_path / "a.txt"
    b = tmp_path / "b.txt"
    s = "abc — 中文 — é"
    atomic_write_text(a, s, fsync=True)
    atomic_write_bytes(b, s.encode("utf-8"), fsync=True)
    assert a.read_bytes() == b.read_bytes()


def test_kernel_io_module_exports():
    """Public API is exactly the three documented helpers."""
    assert set(kernel_io.__all__) == {
        "atomic_write_bytes",
        "atomic_write_text",
        "fsync_dir",
    }
