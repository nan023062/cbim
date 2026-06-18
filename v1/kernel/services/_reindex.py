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

    Phase 3 addendum: after the BM25/vector upsert succeeds, also
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
    except Exception:  # noqa: BLE001 — main write succeeded; reindex is side-effect, dream loop verify_consistency reconciles
        return

    # Phase 3 graph patch — out of the upsert try/except so a graph
    # write hiccup doesn't swallow legitimate retrieval errors above
    # (the upsert path uses its own broad except for the same reason).
    try:
        from cbi._primitives.modules.graph_builder import patch_graph
        patch_graph(root, module_dir)
    except Exception:  # noqa: BLE001 — same fault-tolerance contract as reindex itself; dream loop's full DnaGraphRebuild owns recovery
        return


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
