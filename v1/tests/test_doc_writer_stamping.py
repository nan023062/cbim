"""Tests for the ``body_edited_at`` freshness stamp on module.md writes.

Every module.md write path in the kernel routes through
``doc_writer.stamp_module_md_content`` before the atomic write hits disk.
These tests cover:

  - ``write_module_doc(mod, "module.md", body)`` stamps.
  - ``write_module_doc(mod, "contract.md", body)`` does NOT stamp module.md.
  - ``write_module_section(mod, "module.md", ...)`` stamps.
  - ``DNAModule.save()`` stamps.
  - ``init_module`` writes an initial stamp.
  - Editing a workflow does NOT stamp module.md.
  - Successive module.md writes always overwrite the previous stamp.

The stamp shape (`YYYY-MM-DDTHH:MM:SSZ`) is validated end-to-end.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from cbi._primitives.modules import (
    ensure_registry,
    init_module,
    write_module_doc,
    write_module_section,
)
from cbi.resources import DNAModule
from services._fm import parse_frontmatter


_ISO_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def _seed_project(tmp_path: Path) -> None:
    ensure_registry(tmp_path)


def _read_fm(module_md: Path) -> dict:
    return parse_frontmatter(module_md.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# init_module
# ---------------------------------------------------------------------------


def test_init_module_writes_initial_stamp(tmp_path):
    _seed_project(tmp_path)
    mod = tmp_path / "alpha"
    init_module(mod, name="alpha", owner="linan", type_="leaf", project_root=tmp_path)

    fm = _read_fm(mod / ".dna" / "module.md")
    stamp = fm.get("body_edited_at")
    assert isinstance(stamp, str) and stamp, "init_module must emit body_edited_at"
    assert _ISO_UTC_RE.match(stamp), stamp


# ---------------------------------------------------------------------------
# write_module_doc (body-only replace)
# ---------------------------------------------------------------------------


def test_write_module_doc_module_md_stamps(tmp_path, monkeypatch):
    """A module.md rewrite advances body_edited_at."""
    _seed_project(tmp_path)
    mod = tmp_path / "alpha"
    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: "2020-01-01T00:00:00Z",
    )
    init_module(mod, name="alpha", owner="x", type_="leaf", project_root=tmp_path)
    initial = _read_fm(mod / ".dna" / "module.md")["body_edited_at"]
    assert initial == "2020-01-01T00:00:00Z"

    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: "2026-07-09T12:00:00Z",
    )
    write_module_doc(mod, "module.md", "## Body\n\nrewritten\n")

    fm = _read_fm(mod / ".dna" / "module.md")
    assert fm["body_edited_at"] == "2026-07-09T12:00:00Z"


def test_write_module_doc_contract_md_does_not_touch_module_md(tmp_path, monkeypatch):
    """contract.md writes must NOT re-stamp module.md."""
    _seed_project(tmp_path)
    mod = tmp_path / "alpha"
    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: "2020-01-01T00:00:00Z",
    )
    init_module(mod, name="alpha", owner="x", type_="leaf", project_root=tmp_path)
    initial = _read_fm(mod / ".dna" / "module.md")["body_edited_at"]

    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: "2099-12-31T23:59:59Z",
    )
    write_module_doc(mod, "contract.md", "# Contract\n\n## Interfaces\n")

    fm = _read_fm(mod / ".dna" / "module.md")
    assert fm["body_edited_at"] == initial, "contract writes must not stamp module.md"


# ---------------------------------------------------------------------------
# write_module_section
# ---------------------------------------------------------------------------


def test_write_module_section_module_md_stamps(tmp_path, monkeypatch):
    _seed_project(tmp_path)
    mod = tmp_path / "alpha"
    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: "2020-01-01T00:00:00Z",
    )
    init_module(mod, name="alpha", owner="x", type_="leaf", project_root=tmp_path)
    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: "2026-07-09T12:00:00Z",
    )
    write_module_section(
        mod, "module.md", "Positioning", level=2,
        mode="replace", content="fresh positioning\n",
    )
    fm = _read_fm(mod / ".dna" / "module.md")
    assert fm["body_edited_at"] == "2026-07-09T12:00:00Z"


def test_write_module_section_contract_md_does_not_touch_module_md(tmp_path, monkeypatch):
    _seed_project(tmp_path)
    mod = tmp_path / "alpha"
    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: "2020-01-01T00:00:00Z",
    )
    init_module(
        mod, name="alpha", owner="x", type_="leaf",
        project_root=tmp_path, with_contract=True,
    )
    initial = _read_fm(mod / ".dna" / "module.md")["body_edited_at"]

    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: "2099-12-31T23:59:59Z",
    )
    write_module_section(
        mod, "contract.md", "Interfaces", level=2,
        mode="replace", content="- new()\n",
    )
    fm = _read_fm(mod / ".dna" / "module.md")
    assert fm["body_edited_at"] == initial, "contract section writes must not stamp module.md"


# ---------------------------------------------------------------------------
# DNAModule.save (frontmatter-only edit still stamps)
# ---------------------------------------------------------------------------


def test_dna_module_save_stamps_even_on_frontmatter_only_edit(tmp_path, monkeypatch):
    """Editing only the frontmatter (no body change) still stamps — the
    stamp semantically records 'the file was written', not 'the body
    changed'."""
    _seed_project(tmp_path)
    mod_dir = tmp_path / "alpha"
    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: "2020-01-01T00:00:00Z",
    )
    init_module(mod_dir, name="alpha", owner="x", type_="leaf", project_root=tmp_path)

    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: "2026-07-09T12:00:00Z",
    )
    m = DNAModule.load(mod_dir, root=tmp_path)
    m.frontmatter.set("description", "new description")
    m.save()

    fm = _read_fm(m.path)
    assert fm["body_edited_at"] == "2026-07-09T12:00:00Z"


# ---------------------------------------------------------------------------
# Workflow writes don't touch module.md
# ---------------------------------------------------------------------------


def test_workflow_write_does_not_touch_module_md(tmp_path, monkeypatch):
    _seed_project(tmp_path)
    mod_dir = tmp_path / "alpha"
    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: "2020-01-01T00:00:00Z",
    )
    init_module(mod_dir, name="alpha", owner="x", type_="leaf", project_root=tmp_path)
    initial = _read_fm(mod_dir / ".dna" / "module.md")["body_edited_at"]

    # Simulate a workflow write via the resource API — workflows.add writes
    # its own file only, so module.md must stay untouched.
    m = DNAModule.load(mod_dir, root=tmp_path)
    m.workflows.add("hello", "# Hello workflow\n")

    fm = _read_fm(mod_dir / ".dna" / "module.md")
    assert fm["body_edited_at"] == initial, "workflow writes must not stamp module.md"


# ---------------------------------------------------------------------------
# Multiple writes: last stamp wins
# ---------------------------------------------------------------------------


def test_repeated_module_md_writes_overwrite_stamp(tmp_path, monkeypatch):
    _seed_project(tmp_path)
    mod = tmp_path / "alpha"

    times = iter([
        "2020-01-01T00:00:00Z",
        "2021-06-15T12:30:00Z",
        "2026-07-09T12:00:00Z",
    ])
    monkeypatch.setattr(
        "cbi._primitives.modules.doc_writer._now_body_edited_at",
        lambda: next(times),
    )
    init_module(mod, name="alpha", owner="x", type_="leaf", project_root=tmp_path)
    assert _read_fm(mod / ".dna" / "module.md")["body_edited_at"] == "2020-01-01T00:00:00Z"

    write_module_doc(mod, "module.md", "## Body\n\nfirst rewrite\n")
    assert _read_fm(mod / ".dna" / "module.md")["body_edited_at"] == "2021-06-15T12:30:00Z"

    write_module_doc(mod, "module.md", "## Body\n\nsecond rewrite\n")
    assert _read_fm(mod / ".dna" / "module.md")["body_edited_at"] == "2026-07-09T12:00:00Z"


# ---------------------------------------------------------------------------
# Missing frontmatter is a no-op for the stamp helper
# ---------------------------------------------------------------------------


def test_stamp_helper_noop_on_bodyless_input():
    """When called on content that has no frontmatter, the stamper returns
    the input unchanged. Guards against corrupting free-form markdown that
    happens to flow through the same helper."""
    from cbi._primitives.modules.doc_writer import stamp_module_md_content
    body = "just a body, no frontmatter here\n"
    assert stamp_module_md_content(body) == body
