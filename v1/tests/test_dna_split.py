"""Tests for `cbim dna split` — atomic cross-module decomposition.

Covers split_module in cbi._primitives.modules and
DNAModule.split / _handle_dna_split (CLI) in the resource + engine layers.

Test plan (per ContextPack):
  1. Happy path: split 3-section source into 2 new modules.
  2. Failure: target .dna/ pre-exists → reject before any write.
  3. Failure: source missing one named heading → reject, source untouched.
  4. Dependency report: sibling module's dependencies references source.
  5. Dry-run: prints plan, touches zero files.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

import pytest

from cbi._primitives.modules import (
    ensure_registry,
    init_module,
    split_module,
    read_index,
)


# --- helpers --------------------------------------------------------------

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


def _make_source(root: Path, *, body: str = THREE_SECTION_BODY) -> Path:
    """Create project root with .cbim/index.md + a 'src_mod' module containing
    the supplied body. Returns the source module dir."""
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
    # Overwrite the leaf-template body with our test body.
    md = src_mod / ".dna" / "module.md"
    raw = md.read_text(encoding="utf-8")
    # Keep frontmatter, replace body.
    fm_end = raw.find("\n---", 3)
    frontmatter = raw[:fm_end + 4]
    md.write_text(frontmatter + "\n" + body.lstrip() + "\n", encoding="utf-8")
    return src_mod


# --- 1. Happy path -------------------------------------------------------


def test_split_happy_path(tmp_path):
    src_mod = _make_source(tmp_path)

    splits = [
        {
            "path": "diag_mod",
            "name": "diag_mod",
            "headings": ["Class Diagram"],
            "description": "diagram split",
        },
        {
            "path": "dec_mod",
            "name": "dec_mod",
            "headings": ["Key Decisions"],
            "description": "decisions split",
        },
    ]

    report = split_module(src_mod, splits, root=tmp_path)

    # Two new modules with .dna/module.md created
    assert (tmp_path / "diag_mod" / ".dna" / "module.md").is_file()
    assert (tmp_path / "dec_mod" / ".dna" / "module.md").is_file()
    assert len(report["created"]) == 2
    assert report["updated_source"] is True

    # New modules carry the migrated section bodies
    diag_body = (tmp_path / "diag_mod" / ".dna" / "module.md").read_text(encoding="utf-8")
    assert "## Class Diagram" in diag_body
    assert "classDiagram" in diag_body

    dec_body = (tmp_path / "dec_mod" / ".dna" / "module.md").read_text(encoding="utf-8")
    assert "## Key Decisions" in dec_body
    assert "source decision text" in dec_body

    # Source still has Positioning + comments noting the migration
    src_after = (src_mod / ".dna" / "module.md").read_text(encoding="utf-8")
    assert "## Positioning" in src_after
    assert "<!-- split: moved 'Class Diagram' -> diag_mod -->" in src_after
    assert "<!-- split: moved 'Key Decisions' -> dec_mod -->" in src_after

    # index.md has all 3 (source + 2 splits)
    idx = read_index(tmp_path)
    assert "src_mod" in idx
    assert "diag_mod" in idx
    assert "dec_mod" in idx

    # No .tmp residue
    tmp_residue = list((src_mod / ".dna").glob("*.tmp"))
    assert tmp_residue == []


def test_split_new_modules_have_status_spec_when_supported(tmp_path):
    """ContextPack mandates new splits default to status='spec'. If task-12
    hasn't landed status support on init_module yet, this test documents the
    fallback (no status field present)."""
    src_mod = _make_source(tmp_path)
    splits = [{
        "path": "diag_mod",
        "name": "diag_mod",
        "headings": ["Class Diagram"],
    }]
    split_module(src_mod, splits, root=tmp_path)

    new_body = (tmp_path / "diag_mod" / ".dna" / "module.md").read_text(encoding="utf-8")
    # Either status: spec is present (task-12 landed) OR the file lacks a
    # status field entirely (task-12 not landed; documented fallback).
    if "status:" in new_body.split("---\n", 2)[1]:
        assert "status: spec" in new_body


# --- 2. Failure: target .dna/ pre-exists ---------------------------------


def test_split_rejects_when_target_dna_exists(tmp_path):
    src_mod = _make_source(tmp_path)

    # Pre-create the target .dna/ dir to provoke the precondition failure
    pre = tmp_path / "diag_mod" / ".dna"
    pre.mkdir(parents=True)
    (pre / "module.md").write_text("---\nname: pre\nowner: x\n---\n\n## Pre\n", encoding="utf-8")

    splits = [{
        "path": "diag_mod",
        "name": "diag_mod",
        "headings": ["Class Diagram"],
    }]

    src_before = (src_mod / ".dna" / "module.md").read_text(encoding="utf-8")

    with pytest.raises(FileExistsError, match="already has"):
        split_module(src_mod, splits, root=tmp_path)

    # ZERO side effects: source untouched, no .tmp anywhere
    src_after = (src_mod / ".dna" / "module.md").read_text(encoding="utf-8")
    assert src_after == src_before
    for tmp_file in tmp_path.rglob("*.tmp"):
        pytest.fail(f"unexpected .tmp residue: {tmp_file}")


# --- 3. Failure: source missing a named heading --------------------------


def test_split_rejects_when_heading_missing(tmp_path):
    src_mod = _make_source(tmp_path)

    splits = [{
        "path": "ghost_mod",
        "name": "ghost",
        "headings": ["Nonexistent Heading"],
    }]

    src_before = (src_mod / ".dna" / "module.md").read_text(encoding="utf-8")
    idx_before = read_index(tmp_path)

    with pytest.raises(LookupError, match="missing required H2 headings"):
        split_module(src_mod, splits, root=tmp_path)

    # ZERO side effects
    src_after = (src_mod / ".dna" / "module.md").read_text(encoding="utf-8")
    assert src_after == src_before
    assert not (tmp_path / "ghost_mod" / ".dna").exists()
    assert read_index(tmp_path) == idx_before
    for tmp_file in tmp_path.rglob("*.tmp"):
        pytest.fail(f"unexpected .tmp residue: {tmp_file}")


# --- 4. Dependency-refs report (SCAN ONLY) -------------------------------


def test_split_reports_dependency_refs_without_mutating_them(tmp_path):
    """v2: dependency refs come exclusively from parent class diagrams.

    Set up a sibling parent (``sib_parent``) whose class diagram has a
    ``..>`` arrow targeting ``src_mod``. The split command surfaces that
    edge in ``dependency_refs`` and must not mutate the parent's body.
    """
    src_mod = _make_source(tmp_path)

    # Build a sibling parent with a registered child that points at src_mod.
    sib_parent = tmp_path / "sib_parent"
    (sib_parent / ".dna").mkdir(parents=True)
    parent_diagram = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    class child { <<module>> }\n"
        "    class src_mod { <<module>> }\n"
        "    child ..> src_mod\n"
        "```\n"
    )
    (sib_parent / ".dna" / "module.md").write_text(
        "---\nname: sib_parent\nowner: bob\ndescription: parent\n"
        "keywords: [TODO]\nstatus: implemented\n---\n\n"
        + parent_diagram,
        encoding="utf-8",
    )
    child = sib_parent / "child"
    init_module(
        child,
        name="child",
        owner="bob",
        description="declared dependent in parent diagram",
        type_="leaf",
        project_root=tmp_path,
    )
    parent_before = (sib_parent / ".dna" / "module.md").read_text(encoding="utf-8")

    splits = [{
        "path": "diag_mod",
        "name": "diag_mod",
        "headings": ["Class Diagram"],
    }]

    report = split_module(src_mod, splits, root=tmp_path)

    # Report names the dependent child via its parent's class diagram.
    assert len(report["dependency_refs"]) == 1
    ref = report["dependency_refs"][0]
    assert ref["module"] == "sib_parent/child"
    assert ref["kind"] == "class-diagram"
    assert ref["diagram_host"] == "sib_parent"
    assert "action_required" in ref

    # Parent body BYTE-FOR-BYTE unchanged.
    parent_after = (sib_parent / ".dna" / "module.md").read_text(encoding="utf-8")
    assert parent_after == parent_before, (
        "dependency_refs must be REPORT ONLY; parent class diagram must not be mutated"
    )


def test_split_reports_class_diagram_refs(tmp_path):
    """v2: _scan_dependency_refs surfaces class-diagram edges only.

    Setup:
      * `parent_a` parent module's class diagram declares
            `child_a ..> src_mod`
        → kind="class-diagram", module="parent_a/child_a"
      * `parent_b` parent module's class diagram declares
            `child_b ..> src_mod`
        → kind="class-diagram", module="parent_b/child_b"

    Two reference entries are expected; the v2 schema removes
    frontmatter ``dependencies`` so legacy-style references no longer
    surface here.
    """
    src_mod = _make_source(tmp_path)

    def _write_module(rel: str, fm_extra: str = "", body: str = "body\n",
                      name: str | None = None) -> None:
        mod = tmp_path / rel
        (mod / ".dna").mkdir(parents=True)
        if name is None:
            name = rel.rsplit("/", 1)[-1]
        fm = (
            "---\n"
            f"name: {name}\n"
            "owner: x\n"
            "description: m\n"
            "keywords: [TODO]\n"
            "status: implemented\n"
            f"{fm_extra}"
            "---\n\n"
        )
        (mod / ".dna" / "module.md").write_text(fm + body, encoding="utf-8")

    parent_a_diagram = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    class child_a { <<module>> }\n"
        "    class src_mod { <<module>> }\n"
        "    child_a ..> src_mod\n"
        "```\n"
    )
    parent_b_diagram = (
        "## Class Diagram\n\n```mermaid\nclassDiagram\n"
        "    class child_b { <<module>> }\n"
        "    class src_mod { <<module>> }\n"
        "    child_b ..> src_mod\n"
        "```\n"
    )

    _write_module("parent_a", body=parent_a_diagram)
    _write_module("parent_b", body=parent_b_diagram)
    _write_module("parent_a/child_a")
    _write_module("parent_b/child_b")

    # Update the project index so list_modules sees the new modules.
    idx_path = tmp_path / ".cbim" / "index.md"
    existing = idx_path.read_text(encoding="utf-8").rstrip() + "\n"
    extra = (
        "- parent_a\n- parent_b\n"
        "- parent_a/child_a\n- parent_b/child_b\n"
    )
    idx_path.write_text(existing + extra, encoding="utf-8")

    splits = [{
        "path": "diag_mod",
        "name": "diag_mod",
        "headings": ["Class Diagram"],
    }]

    report = split_module(src_mod, splits, root=tmp_path)
    refs = report["dependency_refs"]

    by_kind = {(r["kind"], r["module"]) for r in refs}
    assert ("class-diagram", "parent_a/child_a") in by_kind, refs
    assert ("class-diagram", "parent_b/child_b") in by_kind, refs
    assert len(refs) == 2, refs

    # Class-diagram entries record which parent's diagram hosted the edge.
    cd_refs = [r for r in refs if r["kind"] == "class-diagram"]
    hosts = {r["diagram_host"] for r in cd_refs}
    assert hosts == {"parent_a", "parent_b"}


# --- 5. Dry-run ---------------------------------------------------------


def test_split_dry_run_touches_zero_files(tmp_path):
    src_mod = _make_source(tmp_path)

    src_before = (src_mod / ".dna" / "module.md").read_text(encoding="utf-8")
    idx_before = read_index(tmp_path)

    splits = [
        {
            "path": "diag_mod",
            "name": "diag_mod",
            "headings": ["Class Diagram"],
        },
        {
            "path": "dec_mod",
            "name": "dec_mod",
            "headings": ["Key Decisions"],
        },
    ]

    report = split_module(src_mod, splits, root=tmp_path, dry_run=True)

    # Plan reports the would-be paths
    assert len(report["created"]) == 2
    assert report["created"][0].name == "module.md"

    # ZERO files touched
    assert (src_mod / ".dna" / "module.md").read_text(encoding="utf-8") == src_before
    assert read_index(tmp_path) == idx_before
    assert not (tmp_path / "diag_mod" / ".dna").exists()
    assert not (tmp_path / "dec_mod" / ".dna").exists()


# --- Bonus: atomic rollback on mid-execution failure ---------------------


def test_split_rolls_back_on_mid_execution_failure(tmp_path, monkeypatch):
    """Inject a failure between the first and second init_module call;
    verify ALL new .dna/ dirs are unwound and source is untouched."""
    src_mod = _make_source(tmp_path)

    splits = [
        {
            "path": "first_mod",
            "name": "first",
            "headings": ["Class Diagram"],
        },
        {
            "path": "second_mod",
            "name": "second",
            "headings": ["Key Decisions"],
        },
    ]

    src_before = (src_mod / ".dna" / "module.md").read_text(encoding="utf-8")
    idx_before = set(read_index(tmp_path))

    # Inject failure on the second init_module call by monkey-patching
    # write_module_doc to raise when called for the second target.
    import cbi._primitives.modules as modeng
    real_write_module_doc = modeng.write_module_doc
    call_count = {"n": 0}

    def flaky(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] >= 2:
            raise RuntimeError("simulated mid-sweep failure")
        return real_write_module_doc(*args, **kwargs)

    monkeypatch.setattr(modeng, "write_module_doc", flaky)

    with pytest.raises(RuntimeError, match="simulated"):
        split_module(src_mod, splits, root=tmp_path)

    # Source untouched (os.replace never happened)
    assert (src_mod / ".dna" / "module.md").read_text(encoding="utf-8") == src_before
    # No .tmp residue
    for tmp_file in tmp_path.rglob("*.tmp"):
        pytest.fail(f"unexpected .tmp residue: {tmp_file}")
    # Both new .dna/ dirs rolled back
    assert not (tmp_path / "first_mod" / ".dna").exists()
    assert not (tmp_path / "second_mod" / ".dna").exists()
    # index.md rolled back too — no first_mod or second_mod entries leaked
    idx_after = set(read_index(tmp_path))
    assert "first_mod" not in idx_after
    assert "second_mod" not in idx_after
