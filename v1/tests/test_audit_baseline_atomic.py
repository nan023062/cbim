"""Atomic-write fixtures for engine.audit.baseline.BaselineStore.save (Batch 5.6).

The atomic save block was narrowed from `except Exception:` to
`except OSError:`. These tests exercise both arms of the contract:

  (a) OSError from os.replace — caught, tmp cleaned, re-raised.
  (b) Non-OSError (ValueError) — must propagate so real bugs aren't
      silently swallowed.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from engine.audit.baseline import BaselineStore
from engine.audit.result import AuditFinding


def _store(tmp_path: Path) -> BaselineStore:
    return BaselineStore(tmp_path)


def _finding() -> AuditFinding:
    return AuditFinding(
        check="dna_fission",
        severity="warn",
        target="some/module",
        message="placeholder",
        code="DNA_FISSION_OVER_BUDGET",
    )


def test_save_oserror_caught_tmp_cleaned_reraised(tmp_path, monkeypatch):
    store = _store(tmp_path)

    real_replace = __import__("os").replace

    def boom(src, dst):
        raise OSError("simulated baseline replace failure")

    monkeypatch.setattr("os.replace", boom)

    with pytest.raises(OSError, match="simulated"):
        store.save({"fp1": __import__(
            "engine.audit.baseline", fromlist=["BaselineEntry"]
        ).BaselineEntry(
            fingerprint="fp1", check="dna_fission", code="X",
            target="t", message="m", accepted_at="2026-06-15T00:00:00",
        )})

    monkeypatch.setattr("os.replace", real_replace)

    # No tmp residue
    baseline_dir = tmp_path / ".cbim" / "audit"
    leftovers = list(baseline_dir.glob(".baseline.*.json.tmp"))
    assert leftovers == [], f"tmp files leaked: {leftovers}"
    # Baseline file never created (replace failed before final landing).
    assert not (baseline_dir / "baseline.json").exists()


def test_save_unrelated_exception_propagates(tmp_path, monkeypatch):
    """ValueError from os.replace must propagate (narrowing's whole point)."""
    store = _store(tmp_path)

    def boom(src, dst):
        raise ValueError("not an OSError on purpose")

    monkeypatch.setattr("os.replace", boom)

    with pytest.raises(ValueError, match="not an OSError"):
        from engine.audit.baseline import BaselineEntry
        store.save({"fp1": BaselineEntry(
            fingerprint="fp1", check="dna_fission", code="X",
            target="t", message="m", accepted_at="2026-06-15T00:00:00",
        )})
