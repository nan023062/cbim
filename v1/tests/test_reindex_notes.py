"""Tests for the ``.dna/notes/*.md`` scan appended to
:func:`services._reindex.reindex_dna`.

Task 0 landed the note primitives; the CRUD path in
:mod:`services.knowledge_service` and the batch rebuild path in
:mod:`services._reindex` both route through
:func:`services._reindex.reindex_notes`, which delegates metadata
assembly to :func:`services._reindex._note_index_payload` — a single
source of truth so the two paths cannot drift. This test suite pins
the *batch* path — the rebuild-all-modules invariant that keeps the
retrieval index in lock-step with disk when a ``cbim dna reindex``
sweep runs.

Contract pinned here:

  * zero notes → no note upserts (module.md still indexed)
  * N notes   → N upserts, one per note, each with a doc_id matching
                :func:`services.knowledge_service._note_doc_id` (so the
                batch path can't diverge from the single-CRUD path)
  * corrupt or missing frontmatter → note still upserted (body remains
                searchable) with intent/status collapsed to ``None`` —
                no ``"unknown"`` sentinel is invented; the retrieval
                weighting consumer treats missing and corrupt
                identically.
  * root-module note doc_id has no ``./`` prefix
  * ``header_content`` is NOT set for notes (only module.md gets one)
"""
from __future__ import annotations

from pathlib import Path


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _make_project(tmp_path: Path) -> tuple[Path, Path]:
    """Minimal CBIM layout: one sub-module at ``src/foo`` with a valid module.md."""
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


def _write_note(mod: Path, slug: str, body: str, **fm) -> Path:
    """Write a note file directly (bypasses the CRUD primitive so we can
    forge broken frontmatter for the fault-tolerance test)."""
    notes_dir = mod / ".dna" / "notes"
    notes_dir.mkdir(parents=True, exist_ok=True)
    lines = ["---"]
    for k, v in fm.items():
        if isinstance(v, list):
            if not v:
                lines.append(f"{k}: []")
                continue
            lines.append(f"{k}:")
            for item in v:
                lines.append(f"  - {item}")
        else:
            lines.append(f"{k}: {v}")
    lines.append("---")
    lines.append("")
    lines.append(body)
    p = notes_dir / f"{slug}.md"
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p


def _capture_upserts(monkeypatch) -> list[dict]:
    """Monkeypatch ``engine.retrieval.index_upsert`` and record every call.

    Also patches ``graph_builder.patch_graph`` — the graph path is
    orthogonal to notes reindex and requires a live project layout we
    don't need for these assertions.
    """
    calls: list[dict] = []

    def _record(source, doc_id, content, metadata=None, header_content=None):
        calls.append({
            "source": source,
            "doc_id": doc_id,
            "content": content,
            "metadata": metadata,
            "header_content": header_content,
        })

    import engine.retrieval as retrieval_pkg
    monkeypatch.setattr(retrieval_pkg, "index_upsert", _record)

    from cbi._primitives.modules import graph_builder
    monkeypatch.setattr(graph_builder, "patch_graph", lambda *a, **k: None)

    return calls


# ---------------------------------------------------------------------------
# Zero notes
# ---------------------------------------------------------------------------


def test_reindex_dna_no_notes_dir_no_extra_upserts(tmp_path, monkeypatch):
    """Modules without a ``notes/`` dir emit exactly one upsert (module.md)."""
    root, mod = _make_project(tmp_path)
    calls = _capture_upserts(monkeypatch)

    from services._reindex import reindex_dna
    reindex_dna(root, mod)

    assert len(calls) == 1, calls
    assert calls[0]["doc_id"] == "src/foo"


def test_reindex_dna_empty_notes_dir_no_extra_upserts(tmp_path, monkeypatch):
    """An empty ``notes/`` dir is treated the same as missing."""
    root, mod = _make_project(tmp_path)
    (mod / ".dna" / "notes").mkdir()
    calls = _capture_upserts(monkeypatch)

    from services._reindex import reindex_dna
    reindex_dna(root, mod)

    assert len(calls) == 1, calls
    assert calls[0]["doc_id"] == "src/foo"


# ---------------------------------------------------------------------------
# Happy path: one and multiple notes
# ---------------------------------------------------------------------------


def test_reindex_dna_single_note_upserts_with_matching_doc_id(tmp_path, monkeypatch):
    """One note → one extra upsert; doc_id matches ``_note_doc_id``."""
    root, mod = _make_project(tmp_path)
    _write_note(
        mod, "why-single-file",
        "# Why single file\n\nsome body prose\n",
        title="Why single file", status="draft", intent="rationale",
    )
    calls = _capture_upserts(monkeypatch)

    from services._reindex import reindex_dna
    from services.knowledge_service import _note_doc_id

    reindex_dna(root, mod)

    # 1 module.md + 1 note
    assert len(calls) == 2, calls
    note_call = next(c for c in calls if c["doc_id"] != "src/foo")

    expected_doc_id = _note_doc_id(root, mod, "why-single-file")
    assert note_call["doc_id"] == expected_doc_id
    assert note_call["source"] == "dna"
    # No header band for notes.
    assert note_call["header_content"] is None
    # Body content is the full note file (frontmatter + body prose).
    assert "Why single file" in note_call["content"]
    assert "some body prose" in note_call["content"]
    # Metadata carries note classification.
    md = note_call["metadata"]
    assert md["kind"] == "note"
    assert md["status"] == "draft"
    assert md["intent"] == "rationale"
    # source_path resolves to the actual file on disk.
    assert Path(md["source_path"]).name == "why-single-file.md"


def test_reindex_dna_multiple_notes_all_upserted(tmp_path, monkeypatch):
    root, mod = _make_project(tmp_path)
    _write_note(mod, "alpha", "alpha body\n",
                title="Alpha", status="draft")
    _write_note(mod, "beta", "beta body\n",
                title="Beta", status="reviewed", intent="current-state")
    calls = _capture_upserts(monkeypatch)

    from services._reindex import reindex_dna
    from services.knowledge_service import _note_doc_id

    reindex_dna(root, mod)

    note_calls = [c for c in calls if c["doc_id"] != "src/foo"]
    assert len(note_calls) == 2, calls
    doc_ids = {c["doc_id"] for c in note_calls}
    assert doc_ids == {
        _note_doc_id(root, mod, "alpha"),
        _note_doc_id(root, mod, "beta"),
    }
    by_id = {c["doc_id"]: c for c in note_calls}
    assert by_id[_note_doc_id(root, mod, "alpha")]["metadata"]["status"] == "draft"
    assert by_id[_note_doc_id(root, mod, "beta")]["metadata"]["intent"] == "current-state"


def test_reindex_dna_note_doc_id_matches_single_crud_helper(tmp_path, monkeypatch):
    """Batch path doc_id must equal the doc_id the single-CRUD side
    would compute. Both paths route through :func:`_note_doc_id`; if
    they diverge the retrieval index accumulates duplicate entries for
    the same note."""
    root, mod = _make_project(tmp_path)
    _write_note(mod, "shared", "body\n", title="Shared", status="draft")
    calls = _capture_upserts(monkeypatch)

    from services._reindex import reindex_dna
    from services.knowledge_service import _note_doc_id

    reindex_dna(root, mod)
    single_crud_doc_id = _note_doc_id(root, mod, "shared")
    note_doc_ids = [c["doc_id"] for c in calls if c["doc_id"] != "src/foo"]
    assert note_doc_ids == [single_crud_doc_id]


def test_reindex_dna_related_modules_metadata_passes_through(tmp_path, monkeypatch):
    root, mod = _make_project(tmp_path)
    _write_note(
        mod, "linkbait", "body\n",
        title="Link Bait", status="draft",
        related_modules=["src/foo", "src/bar"],
    )
    calls = _capture_upserts(monkeypatch)

    from services._reindex import reindex_dna
    reindex_dna(root, mod)

    note_call = next(c for c in calls if c["doc_id"] != "src/foo")
    assert note_call["metadata"]["related_modules"] == ["src/foo", "src/bar"]


# ---------------------------------------------------------------------------
# Root module: doc_id has no leading ``./``
# ---------------------------------------------------------------------------


def test_reindex_dna_root_module_note_doc_id_has_no_dot_prefix(tmp_path, monkeypatch):
    root, _ = _make_project(tmp_path)
    # Add a root-level module.md so reindex_dna(root, root) exercises
    # the root-module path.
    (root / ".dna").mkdir()
    (root / ".dna" / "module.md").write_text(
        "---\n"
        "name: Root\n"
        "owner: platform\n"
        "description: root mod\n"
        "keywords: []\n"
        "status: implemented\n"
        "---\n"
        "body\n",
        encoding="utf-8",
    )
    _write_note(
        root, "root-note", "root note body\n",
        title="Root Note", status="draft",
    )
    calls = _capture_upserts(monkeypatch)

    from services._reindex import reindex_dna
    reindex_dna(root, root)

    note_calls = [c for c in calls if c["doc_id"].startswith("notes/") or "/notes/" in c["doc_id"]]
    assert len(note_calls) == 1, calls
    assert note_calls[0]["doc_id"] == "notes/root-note", note_calls[0]["doc_id"]
    # Explicitly assert no accidental ``./`` prefix.
    assert not note_calls[0]["doc_id"].startswith("./")


# ---------------------------------------------------------------------------
# Fault tolerance
# ---------------------------------------------------------------------------


def test_reindex_dna_broken_note_frontmatter_still_indexed(tmp_path, monkeypatch):
    """A note whose frontmatter fails to parse must still land in the
    index (body remains searchable) with status/intent collapsed to
    ``None``. Architect ruling: retrieval weighting has no behavioural
    fork between "missing" and "corrupt", so no ``"unknown"`` sentinel
    is invented — both cases land as ``None``.
    """
    root, mod = _make_project(tmp_path)
    # Well-formed peer that should still be upserted normally.
    _write_note(mod, "healthy", "healthy body\n",
                title="Healthy", status="reviewed", intent="rationale")
    # Broken: our forgiving frontmatter parser rejects mixed
    # scalar+map list elements. Craft one deliberately.
    (mod / ".dna" / "notes" / "broken.md").write_text(
        "---\n"
        "title: Broken\n"
        "status: draft\n"
        "keywords:\n"
        "  - plain\n"
        "  - key: value\n"
        "---\n"
        "broken note body\n",
        encoding="utf-8",
    )
    calls = _capture_upserts(monkeypatch)

    from services._reindex import reindex_dna
    from services.knowledge_service import _note_doc_id

    reindex_dna(root, mod)

    note_calls = [c for c in calls if c["doc_id"] != "src/foo"]
    doc_ids = {c["doc_id"] for c in note_calls}
    # Both notes are represented — the broken one didn't sink the batch.
    assert _note_doc_id(root, mod, "healthy") in doc_ids
    assert _note_doc_id(root, mod, "broken") in doc_ids

    healthy = next(c for c in note_calls if c["doc_id"] == _note_doc_id(root, mod, "healthy"))
    broken = next(c for c in note_calls if c["doc_id"] == _note_doc_id(root, mod, "broken"))

    assert healthy["metadata"]["status"] == "reviewed"
    assert healthy["metadata"]["intent"] == "rationale"

    # Frontmatter unparseable → both enum-typed fields collapse to
    # None; body content is preserved so search still hits it, only
    # the metadata weighting signal is degraded.
    assert broken["metadata"]["status"] is None
    assert broken["metadata"]["intent"] is None
    # related_modules absent → natural empty list, not a sentinel.
    assert broken["metadata"]["related_modules"] == []
    assert "broken note body" in broken["content"]


def test_reindex_dna_note_with_out_of_enum_values_falls_to_none(tmp_path, monkeypatch):
    """Hand-edited frontmatter with out-of-enum status/intent must not
    crash — the note is indexed with ``None`` metadata for both fields
    (same fall-through rule as corrupt / missing frontmatter; no
    ``"unknown"`` sentinel).
    """
    root, mod = _make_project(tmp_path)
    # Skip _write_note's schema-consistent shape; craft dirty values
    # directly. parse_frontmatter accepts arbitrary strings here.
    (mod / ".dna" / "notes").mkdir(parents=True, exist_ok=True)
    (mod / ".dna" / "notes" / "dirty.md").write_text(
        "---\n"
        "title: Dirty\n"
        "status: finalized\n"       # not in Task 0 enum
        "intent: brain-dump\n"      # not in Task 0 enum
        "---\n"
        "dirty body\n",
        encoding="utf-8",
    )
    calls = _capture_upserts(monkeypatch)

    from services._reindex import reindex_dna
    from services.knowledge_service import _note_doc_id

    reindex_dna(root, mod)

    note_call = next(c for c in calls if c["doc_id"] == _note_doc_id(root, mod, "dirty"))
    assert note_call["metadata"]["status"] is None
    assert note_call["metadata"]["intent"] is None
    assert "dirty body" in note_call["content"]


def test_reindex_dna_note_with_bad_slug_filename_skipped(tmp_path, monkeypatch):
    """Files whose stem breaks the note-slug regex are skipped — their
    doc_id would not round-trip through the CRUD API."""
    root, mod = _make_project(tmp_path)
    _write_note(mod, "good", "good body\n",
                title="Good", status="draft")
    (mod / ".dna" / "notes" / "Bad_Slug.md").write_text(
        "---\ntitle: Bad\nstatus: draft\n---\nbad body\n",
        encoding="utf-8",
    )
    calls = _capture_upserts(monkeypatch)

    from services._reindex import reindex_dna
    from services.knowledge_service import _note_doc_id

    reindex_dna(root, mod)

    note_ids = [c["doc_id"] for c in calls if c["doc_id"] != "src/foo"]
    assert _note_doc_id(root, mod, "good") in note_ids
    # Bad slug never surfaces in the index.
    for doc_id in note_ids:
        assert "Bad_Slug" not in doc_id


# ---------------------------------------------------------------------------
# No header_content for notes (constraint #3 in the task)
# ---------------------------------------------------------------------------


def test_reindex_dna_note_upsert_does_not_pass_header_content(tmp_path, monkeypatch):
    """module.md uses header_content (name/description/keywords band);
    notes intentionally don't — they lack that structured slice."""
    root, mod = _make_project(tmp_path)
    _write_note(
        mod, "n1", "body\n",
        title="A note", status="draft",
        keywords=["k1", "k2"],
    )
    calls = _capture_upserts(monkeypatch)

    from services._reindex import reindex_dna
    reindex_dna(root, mod)

    note_call = next(c for c in calls if c["doc_id"] != "src/foo")
    assert note_call["header_content"] is None, note_call
