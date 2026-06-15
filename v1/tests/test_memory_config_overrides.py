"""Fixtures for memory._config.load_config narrowed-except (Batch 5.6).

The exception block in load_config was tightened from `except Exception:`
to `except (OSError, ValueError, KeyError, ImportError) as exc:` and a
stderr breadcrumb was added. These tests prove:

  (a) Engine config import failure (ImportError) → caught → defaults
      returned + stderr breadcrumb printed.
  (b) Malformed JSON survives end-to-end (engine.config.load_config has
      its own swallow for JSONDecodeError; memory._config never sees the
      exception). Documents the layered behaviour.
  (c) An unrelated exception (RuntimeError) raised by load_config MUST
      propagate.
"""
from __future__ import annotations

import sys
from pathlib import Path  # noqa: F401  (kept for future drift tests)

import pytest

from memory import _config as mem_config


def _isolate_user_overrides(monkeypatch):
    """memory.config.CONFIG is layered before the global config; clear it
    so the test only exercises the global-config branch we care about."""
    monkeypatch.setattr(mem_config, "_USER_CONFIG", {})


def test_load_config_malformed_json_handled_by_engine_layer(
    tmp_path, monkeypatch, capsys
):
    """Malformed .cbim/config.json is caught one level deeper by
    engine.config.load_config (which returns {}), so memory._config never
    sees an exception. This test pins that contract: defaults flow,
    no stderr noise from memory._config."""
    _isolate_user_overrides(monkeypatch)
    cbim = tmp_path / ".cbim"
    cbim.mkdir()
    (cbim / "config.json").write_text("{not valid json", encoding="utf-8")

    cfg = mem_config.load_config(cwd=str(tmp_path))

    assert cfg["short_term"]["keep_days"] == 3
    assert cfg["query"]["default_top_k"] == 5

    err = capsys.readouterr().err
    # engine.config swallows the JSON error, so memory._config's stderr
    # breadcrumb does NOT fire here (correct: no double-reporting).
    assert "[memory._config] config override skipped" not in err


def test_load_config_falls_back_when_engine_config_missing(
    tmp_path, monkeypatch, capsys
):
    """Simulate engine.config import failure: the late-import must trigger
    ImportError, get caught, and load_config returns defaults."""
    _isolate_user_overrides(monkeypatch)

    # Block the late-import inside load_config.
    real_import = __builtins__["__import__"] if isinstance(__builtins__, dict) else __builtins__.__import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "engine.config" or (name == "engine" and "config" in fromlist):
            raise ImportError("simulated missing engine.config")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr("builtins.__import__", fake_import)

    cfg = mem_config.load_config(cwd=str(tmp_path))

    assert cfg["query"]["default_top_k"] == 5
    err = capsys.readouterr().err
    assert "config override skipped" in err
    assert "ImportError" in err


def test_load_config_unrelated_exception_propagates(tmp_path, monkeypatch):
    """RuntimeError raised inside the try block MUST propagate — narrowing's
    point is that real bugs no longer get hidden behind a blanket except."""
    _isolate_user_overrides(monkeypatch)

    # Patch the late-import target so it explodes with RuntimeError.
    fake_engine_config = type(sys)("engine.config")

    def boom(_=None):
        raise RuntimeError("simulated unexpected bug")

    fake_engine_config.load_config = boom
    monkeypatch.setitem(sys.modules, "engine.config", fake_engine_config)

    with pytest.raises(RuntimeError, match="simulated unexpected bug"):
        mem_config.load_config(cwd=str(tmp_path))
