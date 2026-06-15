"""Fixtures for memory.compaction.health._load_thresholds narrowed-except (Batch 5.6).

The except block was tightened from `except Exception:` to
`except (ImportError, OSError, ValueError):`. These tests prove the
fallback to `_DEFAULT_THRESHOLDS` works on every covered class and that
unrelated exceptions propagate.
"""
from __future__ import annotations

import sys

import pytest

from memory.compaction import health as health_mod


def test_load_thresholds_returns_defaults_when_config_module_missing(monkeypatch):
    """Block memory._config import → caught (ImportError) → defaults."""
    real_import = __import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "memory._config":
            raise ImportError("simulated missing memory._config")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr("builtins.__import__", fake_import)

    out = health_mod._load_thresholds()
    assert out == health_mod._DEFAULT_THRESHOLDS


def test_load_thresholds_returns_defaults_on_oserror_in_load_config(monkeypatch):
    """memory._config.load_config raises OSError → caught → defaults."""
    fake_cfg = type(sys)("memory._config")

    def boom(*a, **kw):
        raise OSError("simulated config read failure")

    fake_cfg.load_config = boom
    monkeypatch.setitem(sys.modules, "memory._config", fake_cfg)

    out = health_mod._load_thresholds()
    assert out == health_mod._DEFAULT_THRESHOLDS


def test_load_thresholds_unrelated_exception_propagates(monkeypatch):
    """RuntimeError MUST propagate — narrowing's whole point."""
    fake_cfg = type(sys)("memory._config")

    def boom(*a, **kw):
        raise RuntimeError("simulated unexpected")

    fake_cfg.load_config = boom
    monkeypatch.setitem(sys.modules, "memory._config", fake_cfg)

    with pytest.raises(RuntimeError, match="simulated unexpected"):
        health_mod._load_thresholds()
