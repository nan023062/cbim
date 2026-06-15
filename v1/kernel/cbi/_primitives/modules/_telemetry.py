"""Centralised import-log fallback for the modules package.

Single source of truth for the engine.import_log shim and the project-relative
log-path helper. All sub-modules under modules/ import these names from here
instead of duplicating the try/except dance.
"""

from pathlib import Path

try:
    from engine.import_log import log_import as _log_import
except ImportError:
    def _log_import(*a, **kw):  # type: ignore[no-redef]
        pass


def _rel_for_log(p: Path, root: Path) -> str:
    """Return path relative to project root for log entries (posix style)."""
    try:
        return p.resolve().relative_to(root.resolve()).as_posix()
    except (ValueError, OSError):
        return p.as_posix()


__all__ = ["_log_import", "_rel_for_log"]
