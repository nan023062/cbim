"""Atomic-write fixtures for cbi._primitives.modules.section_writer (Batch 5.6).

The atomic write block (write_module_section) was narrowed from
`except Exception:` to `except OSError:`. These tests exercise both
arms of the contract:

  (a) Trigger an OSError under the narrowed catch — the function must
      re-raise it and the cleanup branch must drop the half-written .tmp.
  (b) Trigger a non-OSError (ValueError raised by a misbehaving write_text
      patch) — the narrowing must let it propagate, otherwise we are back
      to silently swallowing bugs.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from cbi._primitives.modules import write_module_section


_FRONTMATTER = (
    "---\n"
    "name: mymod\n"
    "owner: someone\n"
    "description: placeholder\n"
    "keywords: []\n"
    "dependencies: []\n"
    "---\n\n"
    "## Section A\n\noriginal A body\n\n"
    "## Section B\n\noriginal B body\n"
)


def _make_module(tmp_path: Path) -> Path:
    mod = tmp_path / "mymod"
    (mod / ".dna").mkdir(parents=True)
    (mod / ".dna" / "module.md").write_text(_FRONTMATTER, encoding="utf-8")
    return mod


def test_atomic_write_oserror_cleans_tmp_and_reraises(tmp_path, monkeypatch):
    """OSError on os.replace must propagate; tmp residue must be cleaned."""
    import os

    mod = _make_module(tmp_path)
    target = mod / ".dna" / "module.md"
    original = target.read_text(encoding="utf-8")

    def boom(src, dst):
        raise OSError("simulated disk failure")

    monkeypatch.setattr("os.replace", boom)

    with pytest.raises(OSError, match="simulated"):
        write_module_section(
            mod, "module.md", "Section A", level=2,
            mode="replace", content="new A body\n",
        )

    # Original untouched
    assert target.read_text(encoding="utf-8") == original
    # No .tmp residue
    assert list((mod / ".dna").glob("*.tmp")) == []


def test_atomic_write_unrelated_exception_propagates(tmp_path, monkeypatch):
    """Non-OSError (e.g. ValueError) must NOT be caught — narrowing's whole
    point is that real bugs surface instead of being swallowed."""
    real_write_text = Path.write_text

    def boom(self, *args, **kwargs):
        if self.suffix == ".tmp":
            raise ValueError("not an OSError on purpose")
        return real_write_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", boom)

    mod = _make_module(tmp_path)

    with pytest.raises(ValueError, match="not an OSError"):
        write_module_section(
            mod, "module.md", "Section A", level=2,
            mode="replace", content="new A body\n",
        )

    # No tmp residue (write_text raised before any partial write landed).
    assert list((mod / ".dna").glob("*.tmp")) == []
