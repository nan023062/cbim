"""
services/_reindex.py — retrieval-index side-effects shared across services.

Per the engine/retrieval Key Decision: every governance write tool is
responsible for upserting/dropping its corresponding retrieval entry.
The functions here implement that side-effect once, so both the
knowledge_service and agent_service write paths can call them inline
after their data write succeeds — without each surface (CLI, MCP)
re-implementing the same try/except wrapper.

doc_id contracts (must match what `cbim dna list` / agent listing
print, since retrieval clients query by those identifiers):

  source="dna"     doc_id = module dir relative to project root, POSIX
                   separators; "" for the root module is rendered as ".".
  source="agents"  doc_id = agent name (== `.claude/agents/<name>/`).

Failure mode is uniform: every entry point swallows on broad exception
(BaseException-class noise like KeyboardInterrupt naturally still
propagates because Exception is the bound). The data write already
succeeded; the dream loop's MemRebuildIndex reconciles on the next
governance pass. Callers MUST NOT depend on the index being current
after a single write.
"""

from __future__ import annotations

from pathlib import Path
import warnings


def _reindex_warning(kind: str, exc: Exception) -> None:
    warnings.warn(
        f"{kind} data was saved, but retrieval index refresh failed: {exc}. "
        "Run the explicit reindex command to repair it.",
        RuntimeWarning,
        stacklevel=3,
    )


def _module_doc_id(root: Path, module_dir: Path) -> str:
    try:
        rel = module_dir.resolve().relative_to(root.resolve())
    except ValueError:
        return str(module_dir.resolve())
    s = rel.as_posix()
    return s or "."


def _build_dna_header_band(content: str) -> str | None:
    """Derive the dna header band (name + description + keywords).

    PR-2 retrieval-Y: the header band is the structured slice the user
    cares about most for retrieval relevance, distinct from the prose
    body. Parses frontmatter through the same ``services._fm`` parser
    the loader uses, so the band stays in lock-step with what's actually
    indexable. Returns None for files without a frontmatter block, which
    drops the upsert into the PR-1 body-only ranking path.
    """
    try:
        from services._fm import parse_frontmatter
    except Exception:  # noqa: BLE001 — defensive: services is on sys.path everywhere we run
        return None
    fm = parse_frontmatter(content)
    if not fm:
        return None
    parts: list[str] = []
    name = fm.get("name")
    if isinstance(name, str) and name.strip():
        parts.append(name.strip())
    description = fm.get("description")
    if isinstance(description, str) and description.strip():
        parts.append(description.strip())
    keywords = fm.get("keywords")
    if isinstance(keywords, list):
        parts.extend(str(k).strip() for k in keywords if str(k).strip())
    elif isinstance(keywords, str) and keywords.strip():
        parts.append(keywords.strip())
    if not parts:
        return None
    return " ".join(parts)


def reindex_dna(root: Path, module_dir: Path) -> None:
    """Read `<module_dir>/.dna/module.md` and push it into the retrieval index.

    No-ops cleanly when the module file is missing, unreadable, empty,
    or when the retrieval subsystem itself raises (broad except: the
    project may legitimately have no `.cbim/` set up yet — common in
    `tmp_path` test layouts that exercise services without booting the
    full retrieval store).

    Notes addendum: after the module.md upsert succeeds, also scan
    ``<module_dir>/.dna/notes/*.md`` and upsert each note as its own
    dna doc (doc_id = ``<mod_rel>/notes/<slug>`` or ``notes/<slug>`` for
    the root module — same contract as
    :func:`services.knowledge_service._note_doc_id`). Notes are indexed
    per-file (never merged into the module.md doc) because they carry
    different doc_ids and merging would silently overwrite one with the
    other. Per-note failures do not sink the batch — the surrounding
    module.md upsert already succeeded, and the dream loop reconciles.
    Both this batch path and the single-CRUD path in
    :mod:`services.knowledge_service` route through
    :func:`reindex_notes`, which delegates metadata assembly to a single
    helper — the two paths cannot drift.

    Phase 3 addendum: after the BM25/vector upserts succeed, also
    refresh the DNA graph for this module (single-module patch). Failure
    here is silently swallowed — the dream loop's authoritative
    DnaGraphRebuild leaf reconciles on the next governance pass.
    """
    try:
        md = module_dir / ".dna" / "module.md"
        if not md.is_file():
            return
        try:
            content = md.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return
        if not content:
            return
        # PR-2 retrieval-Y: derive the header band (name + description +
        # keywords) from the parsed frontmatter so BM25 / vector ranking
        # weights this slice higher than body prose. Pulled from the
        # already-parsed dict, NOT re-extracted from the YAML text — the
        # rendered band is what callers see at search time. Falls back
        # cleanly to None when the doc has no frontmatter (legacy / new
        # format errors), keeping the upsert path PR-1 compatible.
        header_content = _build_dna_header_band(content)
        from engine.retrieval import index_upsert
        index_upsert(
            "dna",
            _module_doc_id(root, module_dir),
            content,
            {"source_path": str(md.resolve())},
            header_content=header_content,
        )
    except Exception as exc:  # noqa: BLE001 — data write already succeeded
        _reindex_warning("DNA", exc)
        return

    # Notes pass — best-effort, one doc per note. Outer try/except is a
    # belt-and-suspenders wrapper on top of the per-note guards inside
    # ``reindex_notes`` so any escaped exception can't sink the graph
    # patch that follows.
    try:
        reindex_notes(root, module_dir)
    except Exception:  # noqa: BLE001 — index side-effect only; dream loop reconciles
        pass

    # Phase 3 graph patch — out of the upsert try/except so a graph
    # write hiccup doesn't swallow legitimate retrieval errors above
    # (the upsert path uses its own broad except for the same reason).
    try:
        from cbi._primitives.modules.graph_builder import patch_graph
        patch_graph(root, module_dir)
    except Exception:  # noqa: BLE001 — same fault-tolerance contract as reindex itself; dream loop's full DnaGraphRebuild owns recovery
        return


def _note_index_payload(
    root: Path,
    module_dir: Path,
    note_path: Path,
) -> tuple[str, str, dict] | None:
    """Read one note file and assemble its retrieval-index payload.

    Returns ``(doc_id, content, metadata)`` on success, or ``None`` when
    the note should be skipped (unreadable / empty / bad slug / retrieval
    subsystem absent). This is the single source of truth for note
    metadata — both the batch-rebuild path (``reindex_notes`` with
    ``only_slug=None``) and the single-CRUD path (``only_slug=<slug>``,
    invoked from :mod:`services.knowledge_service`) MUST route through
    this helper so the two paths cannot drift on metadata shape.

    Metadata shape (Task 0 contract, tightened by architect ruling):
      * ``kind``             — literal ``"note"``.
      * ``intent``           — enum value from
                               :data:`_NOTE_FM_INTENT_VALUES` when the
                               frontmatter carries a legal value;
                               otherwise ``None``. Missing, corrupted,
                               and out-of-enum all collapse to ``None``
                               — retrieval's weighting consumer does not
                               distinguish these cases, so no
                               ``"unknown"`` sentinel is emitted.
      * ``status``           — same rule as ``intent``, keyed against
                               :data:`_NOTE_FM_STATUS_VALUES`.
      * ``related_modules``  — the frontmatter list filtered to string
                               elements; missing / non-list defaults to
                               ``[]`` (a list-typed field's natural
                               empty state, not a sentinel).
      * ``source_path``      — resolved on-disk path of the note file.

    Import notes:
      * ``_note_doc_id`` is fetched via lazy import — a top-level
        ``from services.knowledge_service import _note_doc_id`` would
        deadlock the module-load order (``knowledge_service`` does
        ``from . import _reindex`` before ``_note_doc_id`` is defined).
    """
    try:
        from services._fm import parse_frontmatter
        from services.knowledge_service import _note_doc_id
        from cbi._primitives.modules import _NOTE_SLUG_RE
        from cbi._primitives.modules.notes_frontmatter_schema import (
            _NOTE_FM_INTENT_VALUES,
            _NOTE_FM_STATUS_VALUES,
        )
    except Exception:  # noqa: BLE001 — retrieval subsystem may be absent (bare tmp_path layouts)
        return None

    if not note_path.is_file():
        return None
    slug = note_path.stem
    # Skip files with slugs that don't satisfy the note-slug convention
    # — same filter list_notes() applies. Their doc_id would be
    # non-round-trippable via the CRUD API, so indexing them would just
    # create orphans.
    if not _NOTE_SLUG_RE.match(slug):
        return None
    try:
        content = note_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    if not content:
        return None

    # parse_frontmatter raises on unrecognised shapes; treat as
    # broken-frontmatter so we still index the body. Missing, corrupt,
    # and out-of-enum enum values all collapse to None — retrieval
    # weighting has no behavioural fork for the three cases, so no
    # "unknown" sentinel is invented.
    try:
        fm = parse_frontmatter(content)
    except Exception:  # noqa: BLE001 — corrupt frontmatter, keep body indexable
        fm = {}
    if not isinstance(fm, dict):
        fm = {}

    raw_intent = fm.get("intent")
    intent_meta = (
        raw_intent
        if isinstance(raw_intent, str) and raw_intent in _NOTE_FM_INTENT_VALUES
        else None
    )

    raw_status = fm.get("status")
    status_meta = (
        raw_status
        if isinstance(raw_status, str) and raw_status in _NOTE_FM_STATUS_VALUES
        else None
    )

    raw_related = fm.get("related_modules")
    related_meta = (
        [x for x in raw_related if isinstance(x, str)]
        if isinstance(raw_related, list)
        else []
    )

    doc_id = _note_doc_id(root, module_dir, slug)
    metadata = {
        "kind": "note",
        "intent": intent_meta,
        "status": status_meta,
        "related_modules": related_meta,
        "source_path": str(note_path.resolve()),
    }
    return doc_id, content, metadata


def reindex_notes(
    root: Path,
    module_dir: Path,
    only_slug: str | None = None,
) -> None:
    """Upsert ``<module_dir>/.dna/notes/*.md`` into the retrieval index.

    Two modes, one metadata pipeline (via :func:`_note_index_payload`):

      * ``only_slug=None`` — batch mode. Scan every ``notes/*.md`` under
        the module. Used by :func:`reindex_dna` (cold-start / bulk
        rebuild).
      * ``only_slug=<slug>`` — single-note mode. Upsert just that one
        note. Used by the CRUD path in
        :mod:`services.knowledge_service` after ``create``/``update``
        successfully lands the file.

    Both modes produce identical metadata for the same on-disk file —
    that is the whole point of factoring the metadata assembly into
    :func:`_note_index_payload`.

    Header band weighting is NOT applied here — notes lack the
    structured name/description/keywords slice that module.md uses for
    header-band ranking, so ``index_upsert`` is called without the
    ``header_content`` argument.

    Fault tolerance: per-note read/parse/upsert failures are swallowed
    so a single corrupted note can't sink a batch. In single-note mode
    the same swallowing applies — the primary file write already
    succeeded on the caller's side, and the dream loop's
    ``verify_consistency`` reconciles on the next governance pass.
    """
    notes_dir = module_dir / ".dna" / "notes"
    if not notes_dir.is_dir():
        return

    try:
        from engine.retrieval import index_upsert
    except Exception:  # noqa: BLE001 — retrieval subsystem may be absent (bare tmp_path layouts)
        return

    if only_slug is not None:
        candidates = [notes_dir / f"{only_slug}.md"]
    else:
        candidates = sorted(notes_dir.glob("*.md"))

    for note_path in candidates:
        try:
            payload = _note_index_payload(root, module_dir, note_path)
            if payload is None:
                continue
            doc_id, content, metadata = payload
            index_upsert("dna", doc_id, content, metadata)
        except Exception:  # noqa: BLE001 — one note failure must not sink the batch
            continue


def reindex_agent(root: Path, name: str) -> None:
    """Read the agent's .md and push it into the retrieval index.

    The `name` is treated as already-validated by the caller (services'
    `_validate_identifier` runs upstream); the redundant separator check
    here is defensive — if it ever fires it just no-ops, since every
    failure path is best-effort anyway.
    """
    try:
        if not name or "/" in name or "\\" in name or name in (".", ".."):
            return
        md = root / ".claude" / "agents" / name / f"{name}.md"
        if not md.is_file():
            return
        try:
            content = md.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return
        if not content:
            return
        from engine.retrieval import index_upsert
        index_upsert(
            "agents",
            name,
            content,
            {"source_path": str(md.resolve())},
        )
    except Exception:  # noqa: BLE001 — main write succeeded; reindex is side-effect, dream loop verify_consistency reconciles
        return


def drop_agent(name: str) -> None:
    """Remove an agent from the retrieval index (called from archive paths)."""
    try:
        from engine.retrieval import index_delete
        index_delete("agents", name)
    except Exception:  # noqa: BLE001 — main write succeeded; reindex is side-effect, dream loop verify_consistency reconciles
        return
