"""services/_paths.py — path-traversal guard.

Single helper to convert a user-provided path string into an absolute
:class:`Path` that is provably contained inside ``root``.

Security goals
--------------
- Reject Windows drive-relative forms like ``C:foo`` (no slash after the
  drive letter); the OS interprets them against the drive's per-process
  CWD, not against ``root``, so they are always unsafe in this context.
- Reject any path — absolute or relative — that resolves outside
  ``root`` via ``..`` traversal.
- Reject paths that escape ``root`` through symlinks (POSIX) or NTFS
  reparse points (Windows) by resolving both root and target and using
  ``Path.relative_to`` followed by ``os.path.commonpath`` as a second
  defence layer.

Absolute paths that point INSIDE ``root`` are allowed: the CLI surface
routinely passes absolute module paths (e.g. ``/tmp/test/mymod``) that
happen to live under the project root, and that is legitimate.

Failure modes
-------------
- :class:`PathOutsideRootError` — caller-visible signal that the path
  escapes the root. Subclasses :class:`ValueError` so existing code that
  catches ``ValueError`` for path inputs keeps working.
- :class:`FileNotFoundError` — only when ``must_exist=True`` and the
  resolved target does not exist.
- :class:`RuntimeError` — when ``root`` itself is missing or not a
  directory; signals a programming error in the caller (the calling
  service forgot to bootstrap the workspace).
"""

from __future__ import annotations

import os
from pathlib import Path

__all__ = ["PathOutsideRootError", "resolve_within_root"]


class PathOutsideRootError(ValueError):
    """Raised when a user-supplied relative path escapes the allowed root."""


def _is_drive_relative_windows(rel: str) -> bool:
    """Detect Windows drive-relative forms (``C:foo``, ``C:``).

    A drive-letter without a following separator is interpreted by the
    OS against the drive's per-process current working directory, not
    against ``root`` — so we always reject it. Absolute drive paths
    (``C:\\foo`` / ``C:/foo``) are NOT caught here; those are normal
    absolute paths and are validated by the resolve+commonpath check.
    """
    if len(rel) < 2:
        return False
    if rel[1] != ":":
        return False
    if not rel[0].isalpha():
        return False
    # rel[2:] must start with a separator to be a normal absolute path.
    if len(rel) == 2:
        return True  # bare "C:"
    return rel[2] not in ("/", "\\")


def resolve_within_root(
    root: Path,
    rel: str | Path,
    *,
    must_exist: bool = False,
    allow_root_itself: bool = True,
) -> Path:
    """Resolve ``rel`` against ``root`` with traversal protection.

    Parameters
    ----------
    root
        Anchoring directory. Must exist and be a directory; otherwise
        :class:`RuntimeError` is raised (caller bug).
    rel
        Relative path supplied by an external caller (LLM tool, CLI
        argument, HTTP request body). Strings or :class:`Path` accepted.
    must_exist
        When ``True``, the resolved target must already exist on disk;
        otherwise :class:`FileNotFoundError` is raised.
    allow_root_itself
        When ``False``, ``rel`` resolving to ``root`` itself (e.g. ``""``,
        ``"."``) is rejected with :class:`PathOutsideRootError`.

    Returns
    -------
    Path
        Absolute, resolved path that is provably inside ``root``.
    """
    root = Path(root)
    if not root.is_dir():
        raise RuntimeError(
            f"resolve_within_root: root {root!s} does not exist or is not a directory"
        )

    rel_str = str(rel)
    if _is_drive_relative_windows(rel_str):
        raise PathOutsideRootError(
            f"drive-relative path not allowed: {rel_str!r}"
        )

    # Resolve target. Absolute paths are honoured as-is; relative paths
    # are anchored to ``root``. ``Path / abs_path`` already returns the
    # absolute path, so a single concat works for both cases. Use
    # non-strict resolve so non-existent paths still normalise ``..``.
    root_resolved = root.resolve()
    target = (root / rel_str).resolve()

    # First defence: relative_to. Raises ValueError if target is not a
    # descendant. Translate to PathOutsideRootError.
    try:
        target.relative_to(root_resolved)
    except ValueError as exc:
        raise PathOutsideRootError(
            f"path escapes root: {rel_str!r} -> {target!s}"
        ) from exc

    # Second defence: commonpath. relative_to can in principle be tricked
    # by symlinks / NTFS junctions on some platforms; commonpath
    # double-checks the literal prefix after resolution.
    try:
        common = os.path.commonpath([str(root_resolved), str(target)])
    except ValueError as exc:
        # Different drives on Windows — commonpath raises.
        raise PathOutsideRootError(
            f"path on different volume than root: {rel_str!r}"
        ) from exc
    if Path(common) != root_resolved:
        raise PathOutsideRootError(
            f"path escapes root (commonpath check): {rel_str!r}"
        )

    if not allow_root_itself and target == root_resolved:
        raise PathOutsideRootError(
            "rel must address a child path, not the root itself"
        )

    if must_exist and not target.exists():
        raise FileNotFoundError(str(target))

    return target
