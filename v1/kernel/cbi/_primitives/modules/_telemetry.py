"""Path formatting helper for explicit diagnostics only."""
from pathlib import Path


def _log_import(*args, **kwargs):
    """Compatibility no-op; module loading has no lifecycle logging."""
    return None


def _rel_for_log(p: Path, root: Path) -> str:
    try:
        return p.resolve().relative_to(root.resolve()).as_posix()
    except (ValueError, OSError):
        return p.as_posix()


__all__ = ["_log_import", "_rel_for_log"]
