"""Fixtures for memory store_dir resolution narrowed-except (Batch 5.6).

Two functions were narrowed from `except Exception:` to `except ImportError:`:
  - memory._facade._resolve_store_dir
  - memory._migrations.v2_drop_short._resolve_store_dir

When the late `from context import cbim_dir` import fails, both must fall
back to `Path.cwd() / .cbim / memory`. Anything else (RuntimeError,
ValueError) MUST propagate.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

from memory import _facade
from memory._migrations import v2_drop_short


def _block_context_module(monkeypatch):
    """Force `from context import cbim_dir` inside the resolver to raise
    ImportError. We do this by inserting a sentinel that fails on attribute
    access into sys.modules."""
    real_import = __import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "context" or (name == "" and "cbim_dir" in (fromlist or ())):
            raise ImportError("simulated missing context module")
        if "context" in (fromlist or ()) and name == "":
            raise ImportError("simulated missing context module")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr("builtins.__import__", fake_import)


def test_facade_resolve_store_dir_explicit_path_wins(tmp_path):
    """When store_dir is provided, no import / no walk happens."""
    target = tmp_path / "custom_store"
    out = _facade._resolve_store_dir(target)
    assert out == target


def test_facade_resolve_store_dir_falls_back_on_import_error(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    _block_context_module(monkeypatch)

    out = _facade._resolve_store_dir()
    assert out == Path.cwd() / ".cbim" / "memory"


def test_facade_resolve_store_dir_unrelated_exception_propagates(monkeypatch):
    """If `from context import cbim_dir` somehow raises ValueError instead
    of ImportError, the narrowed except must NOT swallow it."""
    fake_ctx = type(sys)("context")

    def boom():
        raise ValueError("not an ImportError")

    fake_ctx.cbim_dir = boom
    monkeypatch.setitem(sys.modules, "context", fake_ctx)

    with pytest.raises(ValueError, match="not an ImportError"):
        _facade._resolve_store_dir()


def test_migration_resolve_store_dir_explicit_path_wins(tmp_path):
    out = v2_drop_short._resolve_store_dir(str(tmp_path / "explicit"))
    assert out == tmp_path / "explicit"


def test_migration_resolve_store_dir_falls_back_on_import_error(
    monkeypatch, tmp_path
):
    monkeypatch.chdir(tmp_path)
    _block_context_module(monkeypatch)

    out = v2_drop_short._resolve_store_dir(None)
    assert out == Path.cwd() / ".cbim" / "memory"
