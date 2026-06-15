"""kernel/atomic_io.py — atomic file writes with optional fsync.

Sibling of ``context.py``: a leaf module with zero business dependencies
(stdlib only). Any layer in the kernel may import it; it imports nothing
from the kernel itself.

Contract
--------
- ``atomic_write_bytes(path, data, *, fsync=True)`` and
  ``atomic_write_text(path, text, *, encoding="utf-8", fsync=True)`` write to
  ``<path>.tmp`` first, then ``os.replace`` to the final path.
- When ``fsync`` is true the file payload is fsync'd before rename and the
  parent directory is fsync'd after rename (best-effort on Windows where
  ``os.fsync`` on a directory raises ``OSError``).
- File-level fsync failures propagate (the data is genuinely not on disk);
  directory-level fsync failures are silently swallowed.
- Any failure path tries to remove the leftover ``.tmp`` so the workspace
  never accumulates partial files. Exceptions from cleanup are suppressed.
- ``<path>.tmp`` is on the same parent as ``path``, guaranteeing the
  ``os.replace`` is same-volume on every supported platform.
"""

from __future__ import annotations

import contextlib
import os
from pathlib import Path

__all__ = ["atomic_write_bytes", "atomic_write_text", "fsync_dir"]


def fsync_dir(path: Path) -> None:
    """Best-effort directory fsync.

    POSIX: opens the directory, calls ``os.fsync``. On Windows ``os.fsync``
    on a directory handle raises ``OSError`` (or ``PermissionError``); we
    swallow it because Windows does not provide an equivalent guarantee
    via this API.
    """
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except OSError:
        # e.g. directory disappeared, or platform refuses to open dir
        return
    try:
        # Windows directories: os.fsync raises; treat as no-op.
        with contextlib.suppress(OSError):
            os.fsync(fd)
    finally:
        with contextlib.suppress(OSError):
            os.close(fd)


def _cleanup_tmp(tmp: Path) -> None:
    try:
        if tmp.exists():
            tmp.unlink()
    except OSError:
        pass


def atomic_write_bytes(path: Path, data: bytes, *, fsync: bool = True) -> None:
    """Atomically write ``data`` to ``path``.

    Sequence: mkdir -p parent → write+fsync ``<path>.tmp`` → ``os.replace``
    → fsync parent. On any failure, the ``.tmp`` is removed and the
    original ``path`` is left untouched.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        # Open with low-level API so we can fsync the file descriptor.
        # Force binary mode on Windows (O_BINARY); no-op on POSIX.
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_BINARY", 0)
        fd = os.open(str(tmp), flags, 0o644)
        try:
            # write_all loop: os.write may return short on POSIX.
            mv = memoryview(data)
            written = 0
            while written < len(mv):
                n = os.write(fd, mv[written:])
                if n <= 0:
                    raise OSError("os.write returned 0 (no progress)")
                written += n
            if fsync:
                # File-level fsync failure must propagate — caller's data
                # is not durable yet.
                os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(tmp, path)
        if fsync:
            fsync_dir(path.parent)
    except BaseException:
        _cleanup_tmp(tmp)
        raise


def atomic_write_text(
    path: Path,
    text: str,
    *,
    encoding: str = "utf-8",
    fsync: bool = True,
) -> None:
    """Atomically write ``text`` to ``path`` using ``encoding``.

    Thin wrapper over :func:`atomic_write_bytes`.
    """
    atomic_write_bytes(Path(path), text.encode(encoding), fsync=fsync)
