"""Atomic-write fixtures for split_module (Batch 5.6).

Stage-1 narrowing (`source_tmp.write_text` block) was tightened to
`except OSError:`. Stage-2 (the broad rollback that wraps both
`_init_module` and `_write_module_doc`) is intentionally LEFT broad —
this file's `test_phase2_rollback_triggers_on_value_error` and
`test_phase2_rollback_triggers_on_oserror` prove that *any* sub-step
exception type unwinds disk state correctly.

Coverage:
  - Stage 1 (source_tmp.write_text): OSError caught and re-raised, tmp
    cleaned, source untouched. Stage 2 never enters.
  - Stage 1 (source_tmp.write_text): ValueError propagates (must not be
    swallowed by the now-narrowed catch).
  - Stage 2 (rollback): ValueError from _write_module_doc → full rollback
    (source untouched, .dna/ dirs unwound, index.md unwound).
  - Stage 2 (rollback): OSError from _init_module → full rollback.

The test_dna_split.py 'mid_execution_failure' test already covers the
RuntimeError case; these tests add ValueError + OSError to demonstrate
the broad-except is by design (not a forgotten narrow opportunity).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from cbi._primitives.modules import (
    ensure_registry,
    init_module,
    read_index,
    split_module,
)


THREE_SECTION_BODY = """
## Positioning

source positioning text.

## Class Diagram

```mermaid
classDiagram
    class A
```

## Key Decisions

source decision text.
"""


def _make_source(root: Path) -> Path:
    ensure_registry(root)
    src_mod = root / "src_mod"
    init_module(
        src_mod,
        name="src_mod",
        owner="alice",
        description="source module",
        type_="leaf",
        project_root=root,
    )
    md = src_mod / ".dna" / "module.md"
    raw = md.read_text(encoding="utf-8")
    fm_end = raw.find("\n---", 3)
    frontmatter = raw[:fm_end + 4]
    md.write_text(frontmatter + "\n" + THREE_SECTION_BODY.lstrip() + "\n",
                  encoding="utf-8")
    return src_mod


def _two_splits() -> list[dict]:
    return [
        {"path": "first_mod",  "name": "first",  "headings": ["Class Diagram"]},
        {"path": "second_mod", "name": "second", "headings": ["Key Decisions"]},
    ]


# --- Stage 1: source_tmp staging -----------------------------------------


def test_stage1_oserror_caught_tmp_cleaned(tmp_path, monkeypatch):
    """OSError from source_tmp.write_text → cleanup tmp + re-raise.
    Source untouched, no init/_write_module_doc reached."""
    src_mod = _make_source(tmp_path)
    src_before = (src_mod / ".dna" / "module.md").read_text(encoding="utf-8")

    real_write_text = Path.write_text

    def boom(self, *args, **kwargs):
        if self.name.endswith(".md.tmp"):
            raise OSError("simulated stage-1 disk failure")
        return real_write_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", boom)

    with pytest.raises(OSError, match="stage-1"):
        split_module(src_mod, _two_splits(), root=tmp_path)

    # Source untouched
    assert (src_mod / ".dna" / "module.md").read_text(encoding="utf-8") == src_before
    # No tmp left
    assert list((src_mod / ".dna").glob("*.tmp")) == []
    # No new modules created (stage-2 never entered)
    assert not (tmp_path / "first_mod" / ".dna").exists()
    assert not (tmp_path / "second_mod" / ".dna").exists()


def test_stage1_unrelated_exception_propagates(tmp_path, monkeypatch):
    """ValueError from source_tmp.write_text MUST propagate — narrowing
    OSError-only means real bugs aren't silently swallowed any more."""
    src_mod = _make_source(tmp_path)

    real_write_text = Path.write_text

    def boom(self, *args, **kwargs):
        if self.name.endswith(".md.tmp"):
            raise ValueError("not an OSError on purpose")
        return real_write_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", boom)

    with pytest.raises(ValueError, match="not an OSError"):
        split_module(src_mod, _two_splits(), root=tmp_path)

    # Stage-2 never entered → no half-baked splits.
    assert not (tmp_path / "first_mod" / ".dna").exists()
    assert not (tmp_path / "second_mod" / ".dna").exists()


# --- Stage 2: full rollback ---------------------------------------------


def test_phase2_rollback_triggers_on_value_error(tmp_path, monkeypatch):
    """ValueError from _write_module_doc → full rollback (proves stage-2
    broad except is by design — narrowing it would miss this type)."""
    src_mod = _make_source(tmp_path)
    src_before = (src_mod / ".dna" / "module.md").read_text(encoding="utf-8")
    idx_before = set(read_index(tmp_path))

    import cbi._primitives.modules as modeng
    real_wmd = modeng.write_module_doc
    n = {"i": 0}

    def flaky(*args, **kwargs):
        n["i"] += 1
        # First call (first_mod body write) succeeds; second one fails.
        if n["i"] >= 2:
            raise ValueError("simulated mid-sweep ValueError")
        return real_wmd(*args, **kwargs)

    monkeypatch.setattr(modeng, "write_module_doc", flaky)

    with pytest.raises(ValueError, match="simulated"):
        split_module(src_mod, _two_splits(), root=tmp_path)

    # Source rewrite reverted (os.replace never ran)
    assert (src_mod / ".dna" / "module.md").read_text(encoding="utf-8") == src_before
    # No .tmp residue
    for tmp_file in tmp_path.rglob("*.tmp"):
        pytest.fail(f"unexpected .tmp residue: {tmp_file}")
    # Both new .dna/ dirs unwound
    assert not (tmp_path / "first_mod" / ".dna").exists()
    assert not (tmp_path / "second_mod" / ".dna").exists()
    # index.md restored
    assert set(read_index(tmp_path)) == idx_before


def test_phase2_rollback_triggers_on_oserror_from_init(tmp_path, monkeypatch):
    """OSError from _init_module → full rollback (different exception
    class, same outcome — confirms stage-2 catches by design)."""
    src_mod = _make_source(tmp_path)
    src_before = (src_mod / ".dna" / "module.md").read_text(encoding="utf-8")
    idx_before = set(read_index(tmp_path))

    import cbi._primitives.modules as modeng
    real_init = modeng.init_module
    n = {"i": 0}

    def flaky(*args, **kwargs):
        n["i"] += 1
        if n["i"] >= 2:
            raise OSError("simulated mid-init OSError")
        return real_init(*args, **kwargs)

    monkeypatch.setattr(modeng, "init_module", flaky)

    with pytest.raises(OSError, match="simulated"):
        split_module(src_mod, _two_splits(), root=tmp_path)

    assert (src_mod / ".dna" / "module.md").read_text(encoding="utf-8") == src_before
    for tmp_file in tmp_path.rglob("*.tmp"):
        pytest.fail(f"unexpected .tmp residue: {tmp_file}")
    assert not (tmp_path / "first_mod" / ".dna").exists()
    assert not (tmp_path / "second_mod" / ".dna").exists()
    assert set(read_index(tmp_path)) == idx_before
