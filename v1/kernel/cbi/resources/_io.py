"""
_io.py — Atomic write helpers shared across resource objects.

Compatibility shim: forwards to :func:`kernel._io.atomic_write_text`. Kept
in place so existing ``from kernel.cbi.resources._io import
atomic_write_text`` callers continue to work without churn.
"""

from __future__ import annotations

from pathlib import Path

from atomic_io import (
    atomic_write_text as _atomic_write_text,  # kernel root leaf, see context.py convention
)


def atomic_write_text(path: Path, text: str, encoding: str = "utf-8") -> None:
    """Write text to path atomically, with fsync."""
    _atomic_write_text(path, text, encoding=encoding, fsync=True)
