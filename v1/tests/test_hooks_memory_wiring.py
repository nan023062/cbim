"""Phase 4 — smoke wiring tests for the two memory hooks.

These confirm `cbim_stop` and `cbim_session_start` successfully resolve
the v2 `engine.retrieval` import layout and run without raising. We
import the hook modules directly and call the private helpers — no
subprocess, no event protocol — so a regression in import wiring shows
up as an ImportError at collection time, not a silent hook-log failure.

v2 behavioural assertions:

  - cbim_stop._index_transcript replaces the old _distill: it pushes
    the raw JSONL into engine.retrieval source="transcript" instead of
    materialising a short-tier memory file.

  - cbim_session_start._build_context still runs the dream banner / log
    start / snapshot pipeline. The previous "load recent memory into
    additionalContext" job has moved into the execution behaviour tree
    (ContextRetrieval node), so the function no longer queries memory.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest


_HOOKS_SRC = Path(__file__).resolve().parent.parent / "kernel" / "project" / "hooks_src"


@pytest.fixture(autouse=True)
def _hooks_on_path():
    s = str(_HOOKS_SRC)
    added = s not in sys.path
    if added:
        sys.path.insert(0, s)
    try:
        yield
    finally:
        if added:
            try:
                sys.path.remove(s)
            except ValueError:
                pass


def _make_min_transcript(tmp_path: Path, body: str = '{"role":"user","content":"hi"}\n') -> Path:
    transcript = tmp_path / "transcript.jsonl"
    transcript.write_text(body, encoding="utf-8")
    return transcript


def _isolate_index_root(monkeypatch, tmp_path: Path) -> Path:
    """Steer engine.retrieval's default facade at a per-test index root
    so the test doesn't bleed into (or read from) the real .cbim/index/."""
    from engine.retrieval import facade as _facade_mod

    index_root = tmp_path / ".cbim" / "index"
    monkeypatch.setattr(_facade_mod, "_resolve_index_root", lambda: index_root)
    _facade_mod.reset_default_facade()
    return index_root


def test_cbim_stop_index_transcript_wiring(monkeypatch, tmp_path):
    """cbim_stop._index_transcript reads the JSONL and routes it through
    engine.retrieval.index_upsert("transcript", ...). After the call,
    the transcript source should report total_docs >= 1."""
    import cbim_stop

    _isolate_index_root(monkeypatch, tmp_path)
    transcript = _make_min_transcript(tmp_path)

    cbim_stop._index_transcript(tmp_path, transcript)

    from engine.retrieval import stats
    s = stats("transcript")
    assert s.total_docs >= 1


def test_cbim_stop_index_transcript_swallows_unreadable(monkeypatch, tmp_path):
    """Missing file path must not raise — the hook MUST NOT block CC."""
    import cbim_stop

    _isolate_index_root(monkeypatch, tmp_path)
    cbim_stop._index_transcript(tmp_path, tmp_path / "missing.jsonl")


def test_cbim_stop_resolve_transcript_prefers_event_path(tmp_path):
    """When event supplies an existing transcript_path, that wins."""
    import cbim_stop

    transcript = _make_min_transcript(tmp_path)
    out = cbim_stop._resolve_transcript(tmp_path, str(transcript), session_id="abc")
    assert out == transcript


def test_cbim_stop_resolve_transcript_returns_none_when_missing(tmp_path):
    """Bad event path and no session_id => None, no raise."""
    import cbim_stop

    out = cbim_stop._resolve_transcript(tmp_path, "", session_id="")
    assert out is None


def test_cbim_session_start_wiring_resolves(monkeypatch, tmp_path):
    """cbim_session_start._build_context still composes and returns a
    str (possibly empty). It MUST NOT raise even when nothing exists on
    disk; the index sync paths are wrapped in safe_run."""
    import cbim_session_start

    _isolate_index_root(monkeypatch, tmp_path)
    (tmp_path / ".cbim" / "memory" / "medium").mkdir(parents=True)

    result = cbim_session_start._build_context(tmp_path, session_id="test-session")
    assert isinstance(result, str)


def test_cbim_session_start_refresh_indexes_handles_empty(monkeypatch, tmp_path):
    """_refresh_indexes runs the index passes; an empty project still
    completes cleanly."""
    import cbim_session_start

    _isolate_index_root(monkeypatch, tmp_path)
    cbim_session_start._refresh_indexes(tmp_path)


# ---------------------------------------------------------------------------
# _iter_dna_notes — Task 1 cold-start note discovery
# ---------------------------------------------------------------------------


def _make_module(tmp_path: Path, rel: str) -> Path:
    """Create a .dna/module.md at tmp_path/<rel>/ and return the module dir.

    rel == "" or "." creates a root module directly under tmp_path.
    """
    module_dir = tmp_path if rel in ("", ".") else (tmp_path / rel)
    dna = module_dir / ".dna"
    dna.mkdir(parents=True, exist_ok=True)
    (dna / "module.md").write_text(
        "---\nname: m\nowner: t\ndescription: d\n"
        "keywords: []\nstatus: implemented\n---\n## Positioning\n\nx.\n",
        encoding="utf-8",
    )
    return module_dir


def _write_note(module_dir: Path, slug: str, body: str = "hello note.\n") -> Path:
    notes_dir = module_dir / ".dna" / "notes"
    notes_dir.mkdir(parents=True, exist_ok=True)
    path = notes_dir / f"{slug}.md"
    path.write_text(
        f"---\ntitle: {slug}\nkeywords: []\n---\n\n{body}",
        encoding="utf-8",
    )
    return path


def test_iter_dna_notes_root_module_doc_id(tmp_path):
    """Root module note → doc_id `notes/<slug>` (no leading `./`)."""
    import cbim_session_start

    _make_module(tmp_path, "")
    note_path = _write_note(tmp_path, "alpha")

    result = cbim_session_start._iter_dna_notes(tmp_path)

    assert result == [("notes/alpha", note_path.resolve())]


def test_iter_dna_notes_sub_module_doc_id(tmp_path):
    """Sub module note → doc_id `<mod_rel>/notes/<slug>`, POSIX separator."""
    import cbim_session_start

    _make_module(tmp_path, "src/combat")
    note_path = _write_note(tmp_path / "src" / "combat", "damage-model")

    result = cbim_session_start._iter_dna_notes(tmp_path)

    assert result == [("src/combat/notes/damage-model", note_path.resolve())]


def test_iter_dna_notes_module_without_notes_dir(tmp_path):
    """Module without a .dna/notes/ directory contributes nothing, no raise."""
    import cbim_session_start

    _make_module(tmp_path, "src/foo")

    result = cbim_session_start._iter_dna_notes(tmp_path)

    assert result == []


def test_iter_dna_notes_multiple_notes_sorted_and_covers_multiple_modules(tmp_path):
    """Multiple modules, multiple notes each — sorted, correct doc_ids."""
    import cbim_session_start

    _make_module(tmp_path, "")
    _make_module(tmp_path, "src/a")
    _make_module(tmp_path, "src/b")

    _write_note(tmp_path, "root-note-2")
    _write_note(tmp_path, "root-note-1")
    _write_note(tmp_path / "src" / "a", "a-note")
    _write_note(tmp_path / "src" / "b", "b-note")

    result = cbim_session_start._iter_dna_notes(tmp_path)

    doc_ids = {doc_id for doc_id, _ in result}
    assert doc_ids == {
        "notes/root-note-1",
        "notes/root-note-2",
        "src/a/notes/a-note",
        "src/b/notes/b-note",
    }
    # Within a single module dir, results are sorted by note filename.
    root_ordering = [d for d, _ in result if d.startswith("notes/")]
    assert root_ordering == sorted(root_ordering)


def test_iter_dna_notes_ignores_non_md_files(tmp_path):
    """Only *.md files under .dna/notes/ are indexed."""
    import cbim_session_start

    _make_module(tmp_path, "modA")
    module_dir = tmp_path / "modA"
    _write_note(module_dir, "keep")
    (module_dir / ".dna" / "notes" / "draft.txt").write_text("nope", encoding="utf-8")

    result = cbim_session_start._iter_dna_notes(tmp_path)

    assert [d for d, _ in result] == ["modA/notes/keep"]


def test_iter_dna_notes_doc_id_matches_note_doc_id(tmp_path):
    """Cross-check the hook's doc_id formula against the canonical
    `_note_doc_id` in services.knowledge_service — the two must produce
    identical strings for every (module, slug) pair, otherwise the
    retrieval index picks up duplicate entries.

    This is the drift-check the manual doc_id duplication relies on.
    """
    import cbim_session_start
    from services.knowledge_service import _note_doc_id

    # Root module.
    _make_module(tmp_path, "")
    _write_note(tmp_path, "r1")
    # Sub module one-level.
    _make_module(tmp_path, "modX")
    _write_note(tmp_path / "modX", "x1")
    # Sub module nested.
    _make_module(tmp_path, "src/deep/nested")
    _write_note(tmp_path / "src" / "deep" / "nested", "n1")

    hook_result = dict(cbim_session_start._iter_dna_notes(tmp_path))

    expected = {
        _note_doc_id(tmp_path, tmp_path, "r1"): (tmp_path / ".dna" / "notes" / "r1.md").resolve(),
        _note_doc_id(tmp_path, tmp_path / "modX", "x1"):
            (tmp_path / "modX" / ".dna" / "notes" / "x1.md").resolve(),
        _note_doc_id(tmp_path, tmp_path / "src" / "deep" / "nested", "n1"):
            (tmp_path / "src" / "deep" / "nested" / ".dna" / "notes" / "n1.md").resolve(),
    }

    assert hook_result == expected


# ---------------------------------------------------------------------------
# _refresh_indexes wires the note pass in
# ---------------------------------------------------------------------------


def test_refresh_indexes_upserts_notes_into_dna_source(monkeypatch, tmp_path):
    """After _refresh_indexes runs, notes discovered on disk should be
    present in the `dna` retrieval source (verifies the wiring, not the
    doc_id formula — that's covered above)."""
    import cbim_session_start

    _isolate_index_root(monkeypatch, tmp_path)

    _make_module(tmp_path, "")
    _make_module(tmp_path, "modA")
    _write_note(tmp_path, "root-slug")
    _write_note(tmp_path / "modA", "a-slug")

    cbim_session_start._refresh_indexes(tmp_path)

    from engine.retrieval.facade import _facade
    state = _facade()._get("dna")
    known = set(state.records.keys())
    assert "notes/root-slug" in known
    assert "modA/notes/a-slug" in known
