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


def reindex_dna(root: Path, module_dir: Path) -> None:
    """Read `<module_dir>/.dna/module.md` and push it into the retrieval index.

    No-ops cleanly when the module file is missing, unreadable, empty,
    or when the retrieval subsystem itself raises (broad except: the
    project may legitimately have no `.cbim/` set up yet — common in
    `tmp_path` test layouts that exercise services without booting the
    full retrieval store).
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
        from engine.retrieval import index_upsert
        index_upsert(
            "dna",
            _module_doc_id(root, module_dir),
            content,
            {"source_path": str(md.resolve())},
        )
    except Exception:  # noqa: BLE001 — main write succeeded; reindex is side-effect, dream loop verify_consistency reconciles
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
