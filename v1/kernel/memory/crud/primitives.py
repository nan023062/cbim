"""Memory mutations synchronously maintain local and retrieval indices.

Only medium is writable. These primitives index already-persisted files;
resource/CLI callers validate containment before reading or writing them.
Index failures propagate; no automatic identification or compaction runs.
"""

from __future__ import annotations

import re
from pathlib import Path

from .backend import MemoryBackend


def resolve_entry_path(path: str | Path, store_dir: Path, *, writable: bool = False) -> Path:
    """Resolve an entry id inside the store, rejecting traversal and symlink escapes."""
    from pathlib import PureWindowsPath

    raw = str(path)
    p = Path(raw)
    win = PureWindowsPath(raw)
    if not raw or ".." in win.parts or ".." in p.parts:
        raise ValueError(f"invalid memory entry path: {raw!r}")
    if win.drive and not p.is_absolute():
        raise ValueError(f"drive-relative or foreign memory path: {raw!r}")
    if "\\" in raw and not p.is_absolute():
        raise ValueError(f"memory paths must use '/' separators: {raw!r}")
    store = Path(store_dir).resolve()
    if not p.is_absolute():
        p = store / (Path("medium") / p if len(p.parts) == 1 else p)
    resolved = p.resolve()
    try:
        rel = resolved.relative_to(store)
    except ValueError as exc:
        raise ValueError(f"memory entry must stay inside {store}: {raw!r}") from exc
    tiers = ("medium",) if writable else ("medium", "candidates")
    if len(rel.parts) != 2 or rel.parts[0] not in tiers:
        raise ValueError(f"memory entry must be directly under {tiers}: {raw!r}")
    if rel.parts[0] == "medium" and resolved.suffix != ".md":
        raise ValueError("medium entries must be Markdown files")
    if rel.parts[0] == "candidates" and not resolved.name.endswith(".candidate.json"):
        raise ValueError("candidate entries must end in .candidate.json")
    return resolved

MEDIUM = "medium"
TIERS = (MEDIUM,)

# Logical source name for engine.retrieval. Lives here so identifier /
# compaction / facade all refer to the same constant.
RETRIEVAL_SOURCE = "memory_medium"


def _check_tier(tier: str) -> None:
    if tier not in TIERS:
        raise ValueError(
            f"tier must be one of {TIERS}, got {tier!r}; "
            f"short tier was removed in v2 (CC transcripts are the short-term layer)"
        )


def _check_write_path(path: Path, tier: str) -> None:
    """Defence-in-depth: reject a write target that isn't a direct child of a
    ``<tier>/`` directory or that carries any ``..`` traversal segment.

    The primary entry point (``cbi.resources.Memory.create``) already
    sanitises the slug before constructing the path. This guard catches any
    caller that bypasses that facade and hands us an unsafe ``path`` (e.g. a
    future test or migration script). Not a full path-in-root check — the
    primitive has no ``store_dir`` parameter — but enough to trip the two
    concrete traversal shapes: ``..`` collapsed / uncollapsed, and a parent
    directory that doesn't match the declared tier.
    """
    if ".." in path.parts:
        raise ValueError(
            f"write path contains '..' traversal segment: {path!s}"
        )
    if path.parent.name != tier:
        raise ValueError(
            f"write path parent {path.parent.name!r} does not match tier "
            f"{tier!r}: {path!s}"
        )


def _read_frontmatter(text: str) -> dict:
    meta: dict = {}
    if not text.startswith("---"):
        return meta
    end = text.find("\n---", 3)
    if end == -1:
        return meta
    for line in text[3:end].strip().splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
    return meta


def _entry_text(path: Path) -> str:
    raw = path.read_text(encoding="utf-8")
    if raw.startswith("---"):
        end = raw.find("\n---", 3)
        if end != -1:
            raw = raw[end + 4:]
    return raw.strip()


def _build_metadata(path: Path, tier: str) -> dict:
    meta = _read_frontmatter(path.read_text(encoding="utf-8"))
    meta["tier"] = tier
    meta["path"] = str(path)
    meta["filename"] = path.name
    m = re.match(r"(\d{4}-\d{2}-\d{2})", path.name)
    if m:
        meta["date"] = m.group(1)
    return meta


# ---------------------------------------------------------------------------
# IndexMaintainer — sync local backend index on every CRUD primitive
# ---------------------------------------------------------------------------

class IndexMaintainer:
    """Keep the backend's index in lockstep with on-disk entries.

    Thin wrapper over backend.upsert / .delete. The seam stays in case a
    future backend wants a separate "store vs. index" split.
    """

    def __init__(self, backend: MemoryBackend) -> None:
        self._backend = backend

    def on_write(self, doc_id: str, text: str, metadata: dict) -> None:
        self._backend.upsert(doc_id=doc_id, text=text, metadata=metadata)

    def on_update(self, doc_id: str, text: str, metadata: dict) -> None:
        self._backend.upsert(doc_id=doc_id, text=text, metadata=metadata)

    def on_delete(self, doc_id: str) -> None:
        self._backend.delete(doc_id)


# ---------------------------------------------------------------------------
# engine.retrieval sync — third step of write/update, primary step of delete
# ---------------------------------------------------------------------------

def _retrieval_upsert(path: Path, text: str, metadata: dict) -> None:
    """Sync upsert to engine.retrieval. source_path is mandatory metadata.

    Errors propagate to the caller — retrieval consistency is a hard
    contract of memory.crud (see crud/.dna/module.md Key Decision #3).
    """
    # Deferred import: keeps the retrieval dependency a runtime call, and
    # lets the rest of memory.crud import even when retrieval isn't wired
    # (tests that stub it out, etc.).
    from engine.retrieval import index_upsert

    meta = dict(metadata)
    # Always carry source_path so retrieval.fast_check can stat the original.
    meta.setdefault("source_path", str(path))
    index_upsert(
        source=RETRIEVAL_SOURCE,
        doc_id=str(path),
        content=text,
        metadata=meta,
    )


def _retrieval_delete(doc_id: str) -> None:
    from engine.retrieval import index_delete
    index_delete(source=RETRIEVAL_SOURCE, doc_id=doc_id)


# ---------------------------------------------------------------------------
# 3 primitives — write / update / delete
# ---------------------------------------------------------------------------

def write(path: Path, tier: str, backend: MemoryBackend) -> None:
    """Index a markdown entry file at `path` into `tier`.

    Local and retrieval indexing are both required for success.
    """
    _check_tier(tier)
    _check_write_path(path, tier)
    text = _entry_text(path)
    if not text:
        return
    meta = _build_metadata(path, tier)

    # Step 1: persist + local index.
    index = IndexMaintainer(backend)
    index.on_write(doc_id=str(path), text=text, metadata=meta)

    # Synchronous write-triggered retrieval consistency; failures propagate.
    _retrieval_upsert(path, text, meta)


def update(path: Path, tier: str, backend: MemoryBackend) -> None:
    """Re-index a modified medium entry.
    """
    _check_tier(tier)
    _check_write_path(path, tier)
    text = _entry_text(path)
    if not text:
        return
    meta = _build_metadata(path, tier)

    index = IndexMaintainer(backend)
    index.on_update(doc_id=str(path), text=text, metadata=meta)

    _retrieval_upsert(path, text, meta)


def delete(path: Path, backend: MemoryBackend) -> None:
    """Remove an entry from the local backend index, the filesystem snapshot,
    and the external retrieval index.

    """
    index = IndexMaintainer(backend)
    index.on_delete(str(path))
    _retrieval_delete(str(path))
