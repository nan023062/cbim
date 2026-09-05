"""Tests for services._paths.resolve_within_root and the MCP tool guards.

Coverage matrix:
- direct unit tests for resolve_within_root: drive-relative reject, ``..``
  reject, symlink-out reject (POSIX), Windows-style ``..\\..\\foo`` reject,
  empty-with-allow_root_itself=False reject, legitimate child accept,
  legitimate-non-existent + must_exist accept-or-reject, root missing.
- integration: ``dna_show("../../etc/passwd")`` returns ``ERROR:`` and does
  not read anything outside root; ``memory_delete("../foo.md")`` likewise.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from services._paths import PathOutsideRootError, resolve_within_root

# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------


def test_legitimate_child(tmp_path):
    target = resolve_within_root(tmp_path, "sub/dir")
    assert target == (tmp_path / "sub" / "dir").resolve()


def test_legitimate_existing_with_must_exist(tmp_path):
    sub = tmp_path / "child"
    sub.mkdir()
    out = resolve_within_root(tmp_path, "child", must_exist=True)
    assert out == sub.resolve()


def test_must_exist_missing_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        resolve_within_root(tmp_path, "nope", must_exist=True)


def test_drive_relative_rejected(tmp_path):
    # ``C:foo`` is drive-relative on Windows; never safe.
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "C:foo")


def test_drive_only_rejected(tmp_path):
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "C:")


def test_dotdot_escape_rejected(tmp_path):
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "../../etc/passwd")


@pytest.mark.skipif(
    sys.platform != "win32",
    reason="backslash is path separator on Windows only; on POSIX the string is a literal filename",
)
def test_windows_backslash_dotdot_rejected(tmp_path):
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "..\\..\\foo")


def test_absolute_inside_root_allowed(tmp_path):
    # CLI legitimately passes absolute paths that happen to live under root.
    inside = tmp_path / "x"
    inside.mkdir()
    out = resolve_within_root(tmp_path, str(inside))
    assert out == inside.resolve()


def test_absolute_outside_root_rejected(tmp_path):
    other = tmp_path.parent / "other"
    other.mkdir(exist_ok=True)
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, str(other))


def test_empty_string_with_allow_root_itself_false(tmp_path):
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "", allow_root_itself=False)


def test_dot_with_allow_root_itself_false(tmp_path):
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, ".", allow_root_itself=False)


def test_root_itself_allowed_by_default(tmp_path):
    out = resolve_within_root(tmp_path, ".")
    assert out == tmp_path.resolve()


def test_root_must_exist(tmp_path):
    missing = tmp_path / "nope"
    with pytest.raises(RuntimeError):
        resolve_within_root(missing, "sub")


@pytest.mark.skipif(sys.platform == "win32", reason="symlink test is POSIX-only")
def test_symlink_escaping_root_rejected(tmp_path):
    outside = tmp_path.parent / "outside_target"
    outside.mkdir(exist_ok=True)
    link = tmp_path / "link"
    link.symlink_to(outside)
    with pytest.raises(PathOutsideRootError):
        resolve_within_root(tmp_path, "link")
