"""Tests for the note lifecycle branches of
``services.edit_module(target="note")`` and the underlying primitives
at ``cbi._primitives.modules.note_crud``.

Notes are the module-supplement layer:
    <module>/.dna/notes/<slug>.md    — single file (NOT a subdir)

Payload contract (mirrors workflow, plus `frontmatter` for create/update)::

    {"name": <slug>, "mode": "create", "content": <body>, "frontmatter": <dict>}
    {"name": <slug>, "mode": "update", "content": <body>, "frontmatter": <dict>}
    {"name": <slug>, "mode": "delete"}

Key invariants pinned by this suite:

  * slug must be kebab-case (`[a-z0-9-]+`); path separators refused.
  * frontmatter is validated via `_validate_note_frontmatter` — missing
    required fields, wrong enum values, wrong list-typedness all raise
    ``ValueError``; the message identifies the offending field.
  * create-on-existing → FileExistsError.
  * update-on-missing → FileNotFoundError.
  * delete is idempotent (missing file is a silent no-op).
  * delete NEVER removes the notes/ parent dir — its lifecycle follows
    the module, not any single note. (This is the structural difference
    vs workflow-delete.)
  * ``get_module`` returns a new ``notes`` list-of-dicts field.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from services import edit_module, get_module


# ---------------------------------------------------------------------------
# Fixture helpers (mirror the workflow test fixture — one dedicated helper
# per file keeps failure diagnostics deterministic).
# ---------------------------------------------------------------------------

def _make_project(tmp_path: Path) -> tuple[Path, Path]:
    root = tmp_path / "proj"
    (root / ".cbim").mkdir(parents=True)
    (root / ".cbim" / "config.json").write_text("{}", encoding="utf-8")
    mod = root / "src" / "foo"
    (mod / ".dna").mkdir(parents=True)
    (mod / ".dna" / "module.md").write_text(
        "---\n"
        "name: Foo\n"
        "owner: platform\n"
        "description: a foo\n"
        "keywords: []\n"
        "status: implemented\n"
        "---\n"
        "## Positioning\n\nbody\n",
        encoding="utf-8",
    )
    return root, mod


def _note_md(mod: Path, slug: str) -> Path:
    return mod / ".dna" / "notes" / f"{slug}.md"


def _fm(**overrides) -> dict:
    """Compose a valid note frontmatter, allowing per-test overrides."""
    base = {
        "title": "Sample Note",
        "intent": "rationale",
        "keywords": ["alpha", "beta"],
        "related_modules": ["src/foo"],
        "status": "draft",
        "last_reviewed": "2026-07-09",
        "authors": ["architect"],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def test_note_create_default_mode(tmp_path):
    root, mod = _make_project(tmp_path)
    out = edit_module(
        str(mod), "note",
        {"name": "why-single-file", "content": "# Why single file\n",
         "frontmatter": _fm()},
        cwd=str(root),
    )
    p = _note_md(mod, "why-single-file")
    assert Path(out).resolve() == p.resolve()
    assert p.is_file()
    raw = p.read_text(encoding="utf-8")
    assert raw.startswith("---\n")
    assert "title: Sample Note" in raw
    assert "status: draft" in raw
    assert "# Why single file" in raw


def test_note_create_explicit_mode(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "note",
        {"name": "rationale-1", "mode": "create",
         "content": "hi\n", "frontmatter": _fm()},
        cwd=str(root),
    )
    assert _note_md(mod, "rationale-1").is_file()


def test_note_create_duplicate_raises_file_exists(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "note",
        {"name": "dup", "content": "first\n", "frontmatter": _fm()},
        cwd=str(root),
    )
    with pytest.raises(FileExistsError):
        edit_module(
            str(mod), "note",
            {"name": "dup", "content": "second\n", "frontmatter": _fm()},
            cwd=str(root),
        )


def test_note_create_requires_content(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(ValueError, match="content is required"):
        edit_module(
            str(mod), "note",
            {"name": "x", "frontmatter": _fm()},
            cwd=str(root),
        )


def test_note_create_requires_frontmatter(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(ValueError, match="frontmatter"):
        edit_module(
            str(mod), "note",
            {"name": "x", "content": "hi\n"},
            cwd=str(root),
        )


def test_note_create_at_root_module(tmp_path):
    """Root-module note lives at ``<root>/.dna/notes/<slug>.md``."""
    root, _ = _make_project(tmp_path)
    (root / ".dna").mkdir()
    (root / ".dna" / "module.md").write_text(
        "---\n"
        "name: Root\n"
        "owner: platform\n"
        "description: root mod\n"
        "keywords: []\n"
        "status: implemented\n"
        "---\n"
        "## Positioning\n\nbody\n",
        encoding="utf-8",
    )
    edit_module(
        ".", "note",
        {"name": "root-note", "content": "at root\n", "frontmatter": _fm()},
        cwd=str(root),
    )
    assert (root / ".dna" / "notes" / "root-note.md").is_file()


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_note_update_replaces_body_and_frontmatter(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "note",
        {"name": "n1", "content": "original\n", "frontmatter": _fm()},
        cwd=str(root),
    )
    edit_module(
        str(mod), "note",
        {"name": "n1", "mode": "update", "content": "replaced\n",
         "frontmatter": _fm(title="Renamed", status="reviewed")},
        cwd=str(root),
    )
    raw = _note_md(mod, "n1").read_text(encoding="utf-8")
    assert "replaced" in raw
    assert "original" not in raw
    assert "title: Renamed" in raw
    assert "status: reviewed" in raw


def test_note_update_missing_raises_filenotfound(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(FileNotFoundError, match="does not exist"):
        edit_module(
            str(mod), "note",
            {"name": "ghost", "mode": "update", "content": "x\n",
             "frontmatter": _fm()},
            cwd=str(root),
        )


def test_note_update_requires_content(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "note",
        {"name": "n1", "content": "seed\n", "frontmatter": _fm()},
        cwd=str(root),
    )
    with pytest.raises(ValueError, match="content is required"):
        edit_module(
            str(mod), "note",
            {"name": "n1", "mode": "update", "frontmatter": _fm()},
            cwd=str(root),
        )


def test_note_update_requires_frontmatter(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "note",
        {"name": "n1", "content": "seed\n", "frontmatter": _fm()},
        cwd=str(root),
    )
    with pytest.raises(ValueError, match="frontmatter"):
        edit_module(
            str(mod), "note",
            {"name": "n1", "mode": "update", "content": "x\n"},
            cwd=str(root),
        )


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_note_delete_removes_file(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "note",
        {"name": "victim", "content": "byebye\n", "frontmatter": _fm()},
        cwd=str(root),
    )
    p = _note_md(mod, "victim")
    assert p.is_file()
    edit_module(
        str(mod), "note",
        {"name": "victim", "mode": "delete"},
        cwd=str(root),
    )
    assert not p.exists()


def test_note_delete_preserves_notes_dir(tmp_path):
    """Structural difference vs workflow-delete: deleting the last note
    MUST NOT remove the notes/ parent directory."""
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "note",
        {"name": "solo", "content": "only\n", "frontmatter": _fm()},
        cwd=str(root),
    )
    notes_dir = mod / ".dna" / "notes"
    assert notes_dir.is_dir()

    edit_module(
        str(mod), "note",
        {"name": "solo", "mode": "delete"},
        cwd=str(root),
    )
    assert notes_dir.is_dir(), (
        "notes/ dir lifecycle follows the module — must NOT be pruned "
        "when the last note is deleted"
    )


def test_note_delete_missing_is_idempotent(tmp_path):
    root, mod = _make_project(tmp_path)
    result = edit_module(
        str(mod), "note",
        {"name": "phantom", "mode": "delete"},
        cwd=str(root),
    )
    assert "phantom" in Path(result).as_posix()


def test_note_delete_rejects_content(tmp_path):
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "note",
        {"name": "n1", "content": "seed\n", "frontmatter": _fm()},
        cwd=str(root),
    )
    with pytest.raises(ValueError, match="not accepted for target=note, mode=delete"):
        edit_module(
            str(mod), "note",
            {"name": "n1", "mode": "delete", "content": "should not"},
            cwd=str(root),
        )


def test_note_delete_rejects_frontmatter(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(ValueError, match="not accepted for target=note, mode=delete"):
        edit_module(
            str(mod), "note",
            {"name": "n1", "mode": "delete", "frontmatter": _fm()},
            cwd=str(root),
        )


# ---------------------------------------------------------------------------
# Mode + slug validation
# ---------------------------------------------------------------------------

def test_note_rejects_unknown_mode(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(ValueError, match="must be one of"):
        edit_module(
            str(mod), "note",
            {"name": "n1", "mode": "obliterate",
             "content": "x\n", "frontmatter": _fm()},
            cwd=str(root),
        )


def test_note_rejects_missing_name(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(ValueError, match="name is required"):
        edit_module(
            str(mod), "note",
            {"content": "x\n", "frontmatter": _fm()},
            cwd=str(root),
        )


@pytest.mark.parametrize("bad_slug", [
    "Foo",                # uppercase
    "with_underscore",    # underscore
    "with space",         # space
    "trailing-",          # trailing hyphen
    "-leading",           # leading hyphen
    "double--hyphen",     # consecutive hyphens
    "a/b",                # path separator
    "..",                 # traversal
    "",                   # empty
])
def test_note_rejects_bad_slug(tmp_path, bad_slug):
    root, mod = _make_project(tmp_path)
    with pytest.raises(ValueError):
        edit_module(
            str(mod), "note",
            {"name": bad_slug, "content": "x\n", "frontmatter": _fm()},
            cwd=str(root),
        )


# ---------------------------------------------------------------------------
# Frontmatter validation (delegated to _validate_note_frontmatter)
# ---------------------------------------------------------------------------

def test_note_frontmatter_missing_title_raises(tmp_path):
    root, mod = _make_project(tmp_path)
    fm = _fm()
    del fm["title"]
    with pytest.raises(ValueError, match=r"'title'"):
        edit_module(
            str(mod), "note",
            {"name": "n1", "content": "x\n", "frontmatter": fm},
            cwd=str(root),
        )


def test_note_frontmatter_missing_status_raises(tmp_path):
    root, mod = _make_project(tmp_path)
    fm = _fm()
    del fm["status"]
    with pytest.raises(ValueError, match=r"'status'"):
        edit_module(
            str(mod), "note",
            {"name": "n1", "content": "x\n", "frontmatter": fm},
            cwd=str(root),
        )


def test_note_frontmatter_empty_title_raises(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(ValueError, match=r"'title'"):
        edit_module(
            str(mod), "note",
            {"name": "n1", "content": "x\n",
             "frontmatter": _fm(title="   ")},
            cwd=str(root),
        )


def test_note_frontmatter_bad_status_raises(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(ValueError, match=r"'status'"):
        edit_module(
            str(mod), "note",
            {"name": "n1", "content": "x\n",
             "frontmatter": _fm(status="finalized")},
            cwd=str(root),
        )


def test_note_frontmatter_bad_intent_raises(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(ValueError, match=r"'intent'"):
        edit_module(
            str(mod), "note",
            {"name": "n1", "content": "x\n",
             "frontmatter": _fm(intent="brain-dump")},
            cwd=str(root),
        )


def test_note_frontmatter_intent_none_is_legal(tmp_path):
    """`intent` is optional — None (explicit null) must pass validation."""
    root, mod = _make_project(tmp_path)
    fm = _fm(intent=None)
    edit_module(
        str(mod), "note",
        {"name": "n1", "content": "x\n", "frontmatter": fm},
        cwd=str(root),
    )
    assert _note_md(mod, "n1").is_file()


def test_note_frontmatter_intent_missing_is_legal(tmp_path):
    root, mod = _make_project(tmp_path)
    fm = _fm()
    del fm["intent"]
    edit_module(
        str(mod), "note",
        {"name": "n1", "content": "x\n", "frontmatter": fm},
        cwd=str(root),
    )
    assert _note_md(mod, "n1").is_file()


def test_note_frontmatter_bad_list_type_raises(tmp_path):
    root, mod = _make_project(tmp_path)
    with pytest.raises(ValueError, match=r"'keywords'"):
        edit_module(
            str(mod), "note",
            {"name": "n1", "content": "x\n",
             "frontmatter": _fm(keywords="alpha,beta")},
            cwd=str(root),
        )


def test_note_frontmatter_minimal_is_legal(tmp_path):
    """Only title + status required; everything else omitted must work."""
    root, mod = _make_project(tmp_path)
    edit_module(
        str(mod), "note",
        {"name": "n1", "content": "x\n",
         "frontmatter": {"title": "Minimal", "status": "draft"}},
        cwd=str(root),
    )
    raw = _note_md(mod, "n1").read_text(encoding="utf-8")
    assert "title: Minimal" in raw
    assert "status: draft" in raw
    # Optional fields must not appear when omitted.
    assert "intent:" not in raw
    assert "keywords:" not in raw
    assert "authors:" not in raw


# ---------------------------------------------------------------------------
# get_module surfaces the notes metadata
# ---------------------------------------------------------------------------

def test_get_module_returns_notes_field(tmp_path):
    root, mod = _make_project(tmp_path)
    info = get_module(str(mod), cwd=str(root))
    assert info is not None
    assert "notes" in info
    assert info["notes"] == []  # no notes yet

    edit_module(
        str(mod), "note",
        {"name": "n1", "content": "hello\n",
         "frontmatter": _fm(title="First note", status="reviewed")},
        cwd=str(root),
    )
    edit_module(
        str(mod), "note",
        {"name": "n2", "content": "second\n",
         "frontmatter": _fm(title="Second", status="draft", intent="current-state")},
        cwd=str(root),
    )

    info = get_module(str(mod), cwd=str(root))
    notes = info["notes"]
    assert len(notes) == 2
    # Sorted by slug (n1 before n2).
    assert notes[0]["slug"] == "n1"
    assert notes[0]["title"] == "First note"
    assert notes[0]["status"] == "reviewed"
    assert notes[1]["slug"] == "n2"
    assert notes[1]["intent"] == "current-state"
    # Body must NOT be part of the metadata payload.
    assert "body" not in notes[0]


# ---------------------------------------------------------------------------
# doc_id contract — Task 0 downstream tasks depend on this shape
# ---------------------------------------------------------------------------

def test_note_doc_id_root_module_no_dot_prefix():
    """Root module's note doc_id is ``notes/<slug>`` (NOT ``./notes/<slug>``)."""
    from services.knowledge_service import _note_doc_id
    root = Path("/tmp/proj").resolve()
    # Root module_dir == project root.
    assert _note_doc_id(root, root, "my-note") == "notes/my-note"


def test_note_doc_id_sub_module_relative():
    from services.knowledge_service import _note_doc_id
    root = Path("/tmp/proj").resolve()
    mod = (root / "src" / "foo").resolve()
    # Path may not exist at test time — resolve() is fine either way.
    assert _note_doc_id(root, mod, "my-note") == "src/foo/notes/my-note"


# ---------------------------------------------------------------------------
# Primitive-level validation (invoked from surface — but assert direct too)
# ---------------------------------------------------------------------------

def test_validate_note_frontmatter_direct():
    from cbi._primitives.modules import _validate_note_frontmatter

    _validate_note_frontmatter({"title": "T", "status": "draft"})
    _validate_note_frontmatter({"title": "T", "status": "stable", "intent": None})
    with pytest.raises(ValueError):
        _validate_note_frontmatter({"status": "draft"})
    with pytest.raises(ValueError):
        _validate_note_frontmatter({"title": "T"})
    with pytest.raises(ValueError):
        _validate_note_frontmatter({"title": 42, "status": "draft"})
    with pytest.raises(ValueError):
        _validate_note_frontmatter("not a dict")


def test_build_note_md_renders_frontmatter_and_body():
    from cbi._primitives.modules import _build_note_md
    out = _build_note_md(
        {"title": "T", "status": "draft"},
        "body line\n",
    )
    assert out.startswith("---\n")
    assert "title: T" in out
    assert "status: draft" in out
    assert out.endswith("body line\n")


def test_validate_note_slug_direct():
    from cbi._primitives.modules import _validate_note_slug
    _validate_note_slug("hello")
    _validate_note_slug("hello-world")
    _validate_note_slug("h1-2-3")
    with pytest.raises(ValueError):
        _validate_note_slug("")
    with pytest.raises(ValueError):
        _validate_note_slug("Hello")
    with pytest.raises(ValueError):
        _validate_note_slug("with space")
    with pytest.raises(ValueError):
        _validate_note_slug("a/b")
