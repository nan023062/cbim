"""RetrievalFacade — implements the 5 public functions in contract.md.

Per-source `SourceIndex` objects are cached per-process. Each holds:
  - IndexStore (on-disk handle)
  - BM25Index (always loaded)
  - VectorIndex (loaded iff embedding provider is available)
  - The DocRecord meta table

Public surface (frozen):
    index_upsert(source, doc_id, content, metadata) -> None
    index_delete(source, doc_id) -> None
    search(source, query, top_k=10, filters=None) -> list[Hit]
    verify_consistency(source, mode) -> DriftReport
    stats(source=None) -> IndexStats | list[IndexStats]

All other names in this module are internal.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock

# Minimum spread between top vector scores below which we treat the
# embedding as semantically collapsed (e.g. provider stuck returning a
# constant vector). At that point cosine ranking is just the VectorBlob
# insertion order, which is meaningless to the caller — degrade to BM25
# transparently per contract.md (fallback must be invisible).
_VECTOR_COLLAPSE_EPSILON = 1e-6

from engine.retrieval.config import RetrievalConfig, load_config
from engine.retrieval.drift import DriftReport, fast_check, full_check
from engine.retrieval.embedding.base import EmbeddingProvider
from engine.retrieval.embedding.factory import build_provider
from engine.retrieval.index.bm25 import BM25Index
from engine.retrieval.index.graph import GraphIndex
from engine.retrieval.index.vector import VectorIndex, rrf_fuse
from engine.retrieval.store import (
    VALID_SOURCES,
    DocRecord,
    IndexStore,
    VectorBlob,
    content_sha256,
    now_iso,
)

# Score decay applied per BFS hop when promoting a graph neighbour into
# the hit list. The seed's score is multiplied by 0.6**hop so hop-1
# neighbours rank below the weakest seed but above the next BM25 page;
# hop-2 neighbours are clearly tertiary. Empirical sweet spot — keeps
# the recall window from drowning in low-relevance graph fluff.
_GRAPH_HOP_SCORE_DECAY = 0.6

# --------------------------------------------------------------------------
# Public dataclasses
# --------------------------------------------------------------------------


class RetrievalError(Exception):
    """Raised for invalid source, missing args, or persistence failures."""


@dataclass(frozen=True)
class Hit:
    doc_id: str
    source: str
    score: float
    content: str
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "doc_id": self.doc_id,
            "source": self.source,
            "score": self.score,
            "content": self.content,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class IndexStats:
    source: str
    total_docs: int
    vector_dim: int | None
    embedding_provider: str
    fallback_active: bool
    index_size_bytes: int
    last_upsert_at: str
    last_verify_at: str | None
    last_drift_count: int | None

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "total_docs": self.total_docs,
            "vector_dim": self.vector_dim,
            "embedding_provider": self.embedding_provider,
            "fallback_active": self.fallback_active,
            "index_size_bytes": self.index_size_bytes,
            "last_upsert_at": self.last_upsert_at,
            "last_verify_at": self.last_verify_at,
            "last_drift_count": self.last_drift_count,
        }


# --------------------------------------------------------------------------
# Per-source state
# --------------------------------------------------------------------------


@dataclass
class _SourceState:
    source: str
    store: IndexStore
    bm25: BM25Index
    records: dict[str, DocRecord]
    vectors: VectorBlob | None   # None when provider unavailable / dim=0
    # PR-2 retrieval-Y: optional per-doc header-band vector store. Only
    # populated for source="dna" (other sources leave it None and behave
    # exactly as in PR-1). When non-None, search() blends header & body
    # cosine scores (0.7*header + 0.3*body); when None, body vector is
    # the sole signal. None on a dna source means "not yet written" —
    # PR-1 indices upgrade lazily on the next reindex.
    header_vectors: VectorBlob | None = None
    # Lazy-loaded only for source="dna"; remains None for the other three
    # sources. Wraps the on-disk graph.json built by graph_builder.
    # ``None`` here means "not yet loaded"; ``GraphIndex(None)`` would
    # mean "loaded but empty". We keep the distinction so search() can
    # late-bind the load and gracefully degrade if graph.json is absent.
    graph: GraphIndex | None = None
    last_upsert_at: str = ""
    last_verify_at: str | None = None
    last_drift_count: int | None = None


# --------------------------------------------------------------------------
# Facade — singleton-per-project, identified by the index_root path.
# --------------------------------------------------------------------------


class RetrievalFacade:
    def __init__(self, index_root: Path, config: RetrievalConfig | None = None) -> None:
        self.index_root = Path(index_root)
        self.config = config or load_config(self.index_root)
        self.provider: EmbeddingProvider = build_provider(self.config)
        self._sources: dict[str, _SourceState] = {}
        self._lock = RLock()

    # ---------------- internal helpers ----------------

    def _get(self, source: str) -> _SourceState:
        if source not in VALID_SOURCES:
            raise RetrievalError(f"unknown source: {source!r}")
        with self._lock:
            st = self._sources.get(source)
            if st is None:
                st = self._load_source(source)
                self._sources[source] = st
            return st

    def _load_source(self, source: str) -> _SourceState:
        store = IndexStore(self.index_root, source)
        records = store.load_meta()
        bm25_state = store.load_bm25_state()
        if bm25_state is not None:
            bm25 = BM25Index.from_dict(bm25_state)
        else:
            # First load — rebuild BM25 from doc snapshots (kept on disk).
            bm25 = BM25Index()
            for doc_id in records.keys():
                content = store.read_doc(doc_id)
                if content is not None:
                    bm25.upsert(doc_id, content)
        vectors = store.load_vectors() if self.provider.is_available() else None
        # Header-band vector blob is only meaningful when both (a) we have
        # an embedding provider and (b) the on-disk file exists. Loaders
        # for other sources never see this file.
        header_vectors = (
            store.load_header_vectors()
            if self.provider.is_available()
            else None
        )
        return _SourceState(
            source=source,
            store=store,
            bm25=bm25,
            records=records,
            vectors=vectors,
            header_vectors=header_vectors,
        )

    def _ensure_vector_blob(self, state: _SourceState) -> VectorBlob | None:
        if not self.provider.is_available():
            return None
        if state.vectors is None:
            state.vectors = VectorBlob(self.provider.dimension())
        return state.vectors

    def _ensure_header_vector_blob(
        self, state: _SourceState,
    ) -> VectorBlob | None:
        """Allocate the per-doc header-band vector blob on first write.

        Mirrors ``_ensure_vector_blob``. Only ever called from the dna
        source upsert path; non-dna sources never hit this method.
        """
        if not self.provider.is_available():
            return None
        if state.header_vectors is None:
            state.header_vectors = VectorBlob(self.provider.dimension())
        return state.header_vectors

    def _persist(self, state: _SourceState) -> None:
        if self.config.atomic_persist:
            # Single-shot transactional write of meta + bm25 + vectors
            # (+ optional header_vectors for the dna source).
            state.store.persist_atomic(
                state.records,
                state.bm25.to_dict(),
                state.vectors,
                state.header_vectors,
            )
            return
        # Legacy path — kept behind the atomic_persist=False feature
        # flag so an emergency rollback can switch back without code
        # changes.
        state.store.save_meta(state.records)
        state.store.save_bm25_state(state.bm25.to_dict())
        if state.vectors is not None:
            state.store.save_vectors(state.vectors)
        if state.header_vectors is not None:
            state.store.save_header_vectors(state.header_vectors)

    # ---------------- public: index_upsert ----------------

    def index_upsert(
        self,
        source: str,
        doc_id: str,
        content: str,
        metadata: dict | None = None,
        header_content: str | None = None,
    ) -> None:
        """Upsert ``doc_id`` with full document ``content``.

        ``header_content`` is the optional header band (PR-2 retrieval-Y
        — name + description + keywords for source="dna"). When supplied,
        BM25 weights its tokens 2x and a separate header-band vector is
        embedded for fused-cosine search; when None, behaviour is
        byte-identical to PR-1. Non-dna sources MUST NOT pass this
        argument — see store.VALID_SOURCES.
        """
        if not isinstance(source, str) or not source:
            raise RetrievalError("source must be a non-empty string")
        if not isinstance(doc_id, str) or not doc_id:
            raise RetrievalError("doc_id must be a non-empty string")
        if content is None:
            raise RetrievalError("content must not be None")
        if header_content is not None and source != "dna":
            # Belt-and-suspenders: header-band weighting only makes sense
            # for the dna source where the band is a structured
            # frontmatter slice. Refuse rather than silently weight a
            # header on transcripts / agents / memory.
            raise RetrievalError(
                "header_content is only supported for source='dna'"
            )
        metadata = dict(metadata or {})
        # source_path is an optional metadata field. We promote it to a
        # first-class DocRecord field so drift checking doesn't have to
        # peek into metadata.
        source_path = metadata.pop("source_path", None)

        with self._lock:
            state = self._get(source)
            with state.store._cross_process_lock():
                self._do_upsert(
                    state, source, doc_id, content, metadata,
                    source_path, header_content,
                )

    def _reload_under_lock(self, state: _SourceState) -> None:
        """Refresh the in-memory state from disk while the cross-process
        lock is held.

        Multiple cooperating processes can each hold their own facade
        cache; before mutating, we MUST load the current on-disk values
        so we don't overwrite a peer process's commit. Read-modify-write
        becomes correct because (a) we are inside ``_cross_process_lock``
        and (b) atomic_persist guarantees the on-disk triple is
        self-consistent.
        """
        state.records = state.store.load_meta()
        bm25_state = state.store.load_bm25_state()
        if bm25_state is not None:
            state.bm25 = BM25Index.from_dict(bm25_state)
        else:
            state.bm25 = BM25Index()
        if self.provider.is_available():
            state.vectors = state.store.load_vectors()
            state.header_vectors = state.store.load_header_vectors()
        else:
            state.vectors = None
            state.header_vectors = None

    def _do_upsert(
        self,
        state: _SourceState,
        source: str,
        doc_id: str,
        content: str,
        metadata: dict,
        source_path,
        header_content: str | None = None,
    ) -> None:
        # Reload-from-disk while we hold the cross-process lock so we
        # see any peer-process commits that landed since our cache was
        # populated.
        self._reload_under_lock(state)

        # mtime/size for fast-check: prefer the original source file
        # when known; otherwise derive from the in-memory content
        # directly. We deliberately do NOT stat the snapshot here — it
        # is written AFTER the transaction commits (see the tail of
        # this method), so at this point it either doesn't exist yet
        # or still holds a stale prior version.
        if source_path:
            try:
                st = Path(source_path).stat()
                mtime = st.st_mtime
                size = st.st_size
            except OSError:
                mtime = 0.0
                size = len(content.encode("utf-8"))
        else:
            mtime = time.time()
            size = len(content.encode("utf-8"))

        rec = DocRecord(
            doc_id=doc_id,
            mtime=mtime,
            size=size,
            sha256=content_sha256(content),
            indexed_at=now_iso(),
            metadata=metadata,
            source_path=str(source_path) if source_path else None,
        )
        state.records[doc_id] = rec

        # BM25 always. Header band (when supplied) gets a 2x tf weight
        # injected here so retrieval ranks header-matching docs higher.
        state.bm25.upsert(doc_id, content, header_content=header_content)

        # Vector when provider available.
        if self.provider.is_available():
            try:
                vec = self.provider.embed(content)
                blob = self._ensure_vector_blob(state)
                assert blob is not None
                blob.upsert(doc_id, vec)
                if header_content:
                    # Embed the header band separately so search() can
                    # blend ``0.7*cos(q,header) + 0.3*cos(q,body)``.
                    header_vec = self.provider.embed(header_content)
                    header_blob = self._ensure_header_vector_blob(state)
                    assert header_blob is not None
                    header_blob.upsert(doc_id, header_vec)
                elif state.header_vectors is not None:
                    # Caller switched off the header band for an existing
                    # doc (e.g. emptied keywords + description). Drop the
                    # stale header vector so it can't outrank the body.
                    state.header_vectors.delete(doc_id)
            except Exception:  # noqa: BLE001 — third-party embed provider may raise anything; must degrade to BM25
                # Embedding failed mid-flight — don't kill the upsert;
                # BM25 still works and drift will re-attempt later.
                # Logged via stats() / fallback_active for observability.
                pass

        state.last_upsert_at = rec.indexed_at
        try:
            self._persist(state)
        except OSError as e:
            raise RetrievalError(f"persist failed for source={source}: {e}") from e

        # Persist the content snapshot AFTER the meta/bm25/vectors
        # transaction commits. docs/<doc_id>.txt is deliberately
        # outside the persist_atomic boundary (see .dna/module.md Key
        # Decisions). Write-order tradeoff:
        #   * write BEFORE commit → on rollback the disk carries a
        #     fresh snapshot whose content no other index knows about
        #     (orphan snapshot leak, silently stale).
        #   * write AFTER commit  → a crash between commit and this
        #     write leaves meta referencing a missing snapshot;
        #     read_doc() returns None and Hit.content falls back to
        #     "" via the ``or ""`` guard in search(), and the next
        #     upsert / drift-repair rewrites it.
        # The second failure surface is strictly smaller — no fresh
        # content is written into an aborted transaction — so we
        # write last.
        state.store.write_doc(doc_id, content)

    # ---------------- public: index_delete ----------------

    def index_delete(self, source: str, doc_id: str) -> None:
        if not isinstance(source, str) or not source:
            raise RetrievalError("source must be a non-empty string")
        if not isinstance(doc_id, str) or not doc_id:
            raise RetrievalError("doc_id must be a non-empty string")
        with self._lock:
            state = self._get(source)
            with state.store._cross_process_lock():
                # Reload under lock — see _reload_under_lock for rationale.
                self._reload_under_lock(state)
                if doc_id not in state.records:
                    # Idempotent: not present == success (consistent with
                    # the pre-lock check that was here before).
                    return
                state.records.pop(doc_id, None)
                state.bm25.delete(doc_id)
                if state.vectors is not None:
                    state.vectors.delete(doc_id)
                if state.header_vectors is not None:
                    state.header_vectors.delete(doc_id)
                try:
                    self._persist(state)
                except OSError as e:
                    raise RetrievalError(
                        f"persist failed for source={source}: {e}"
                    ) from e
                # Unlink the content snapshot AFTER the transaction
                # commits. docs/<doc_id>.txt sits outside persist_atomic
                # (see .dna/module.md Key Decisions). Delete-order
                # tradeoff:
                #   * delete BEFORE commit → on rollback meta still
                #     references the doc but the snapshot is gone;
                #     read_doc() returns None and Hit.content becomes
                #     "" — the actual data-inconsistency case this
                #     fix targets.
                #   * delete AFTER commit  → a crash between commit
                #     and this unlink leaves an orphan snapshot with
                #     no meta reference (harmless disk leak; nothing
                #     reads it since it's not in meta).
                # The second failure surface is strictly smaller, so
                # we delete last.
                state.store.delete_doc(doc_id)

    # ---------------- public: search ----------------

    def search(
        self,
        source: str,
        query: str,
        top_k: int = 10,
        filters: dict | None = None,
    ) -> list[Hit]:
        if not isinstance(source, str) or not source:
            raise RetrievalError("source must be a non-empty string")
        if query is None:
            raise RetrievalError("query must not be None")
        if not isinstance(top_k, int) or top_k <= 0:
            raise RetrievalError("top_k must be a positive int")

        # Phase 3: extract the optional ``expand_hops`` filter directive
        # before metadata filtering, otherwise ``_filter_doc_ids`` would
        # treat it as a metadata equality test on a key that no record
        # carries — zeroing out the result set. ``expand_hops`` is the
        # ONLY non-metadata key recognised here; everything else stays
        # in ``filters`` and continues through the equality matcher.
        expand_hops, filters = _split_graph_directives(filters)
        if expand_hops is not None and source != "dna":
            raise RetrievalError(
                "expand_hops filter is only supported for source='dna'"
            )

        with self._lock:
            state = self._get(source)
            if not state.records:
                return []

            allowed_ids = _filter_doc_ids(state.records, filters)
            if allowed_ids is not None and not allowed_ids:
                return []

            ranked: list[tuple] = []

            use_vector = (
                self.provider.is_available()
                and state.vectors is not None
                and state.vectors.doc_ids
            )

            if use_vector:
                try:
                    q_vec = self.provider.embed(query)
                    # Pass the optional header-band blob so VectorIndex
                    # fuses ``0.7*cos(q, header) + 0.3*cos(q, body)`` per
                    # doc when available; falls back to body-only when
                    # the doc has no header vector.
                    vec_idx = VectorIndex(
                        state.vectors,
                        header_blob=state.header_vectors,
                    )
                    vec_ranked = vec_idx.search(q_vec, top_k, allowed_ids=allowed_ids)
                except Exception:  # noqa: BLE001 — third-party embed provider may raise anything; must degrade to BM25
                    vec_ranked = []
                bm_ranked = state.bm25.search(query, top_k, allowed_ids=allowed_ids)
                # Detect semantic collapse: if the top vector scores are all
                # tied (within epsilon) we are seeing insertion-order leakage,
                # not similarity. Treat exactly like an embed() exception —
                # drop vec_ranked so the BM25 path below is the sole ranker.
                if vec_ranked and _is_vector_collapsed(vec_ranked):
                    vec_ranked = []
                if self.config.hybrid_search and vec_ranked and bm_ranked:
                    ranked = rrf_fuse([vec_ranked, bm_ranked], top_k=top_k)
                elif vec_ranked:
                    ranked = vec_ranked
                else:
                    ranked = bm_ranked
            else:
                ranked = state.bm25.search(query, top_k, allowed_ids=allowed_ids)

            hits: list[Hit] = []
            seed_ids: list[str] = []
            seed_score: dict[str, float] = {}
            for doc_id, score in ranked:
                rec = state.records.get(doc_id)
                if rec is None:
                    continue
                content = state.store.read_doc(doc_id) or ""
                seed_ids.append(doc_id)
                seed_score[doc_id] = float(score)
                hits.append(
                    Hit(
                        doc_id=doc_id,
                        source=source,
                        score=float(score),
                        content=content,
                        metadata=dict(rec.metadata or {}),
                    )
                )

            # Phase 3: graph expansion. Only when caller asked for it
            # AND we're on source="dna" (validated above). Lazy-load the
            # GraphIndex once per source state. Failure modes (graph.json
            # missing or corrupt) leave ``state.graph`` as an empty
            # GraphIndex — bfs() returns {} so the seeds-only path is
            # the silent default.
            if expand_hops and seed_ids:
                if state.graph is None:
                    state.graph = GraphIndex.load(self.index_root.parent.parent)
                expansion = state.graph.bfs(seed_ids, hops=expand_hops)
                hits = _merge_seeded_neighbours(
                    hits=hits,
                    seed_ids=set(seed_ids),
                    seed_score=seed_score,
                    expansion=expansion,
                    state=state,
                    source=source,
                )

            return hits

    # ---------------- public: verify_consistency ----------------

    def verify_consistency(self, source: str, mode: str) -> DriftReport:
        if mode not in ("fast", "full"):
            raise RetrievalError(f"mode must be 'fast' or 'full', got {mode!r}")
        with self._lock:
            state = self._get(source)
            # Snapshot records — drift mutations re-enter index_upsert
            # which acquires the same RLock (reentrant).
            records_snapshot = dict(state.records)

            def _read(doc_id: str):
                return state.store.read_doc(doc_id)

            def _upsert(doc_id: str, content: str, metadata: dict):
                # Preserve source_path through the metadata channel.
                rec = state.records.get(doc_id)
                if rec is not None and rec.source_path and "source_path" not in metadata:
                    metadata = {**metadata, "source_path": rec.source_path}
                # Re-derive the header band on dna drift refresh so the
                # header-band weighting stays in sync with the on-disk
                # frontmatter. Other sources have no header band.
                header_content = None
                if source == "dna":
                    from services._reindex import _build_dna_header_band
                    header_content = _build_dna_header_band(content)
                self.index_upsert(
                    source, doc_id, content, metadata,
                    header_content=header_content,
                )

            def _delete(doc_id: str):
                self.index_delete(source, doc_id)

            if mode == "fast":
                report = fast_check(records_snapshot, _read, _upsert, _delete)
            else:
                report = full_check(records_snapshot, _read, _upsert, _delete)
            report.source = source
            state.last_verify_at = now_iso()
            state.last_drift_count = len(report.drifted)
            return report

    # ---------------- public: stats ----------------

    def stats(self, source: str | None = None) -> IndexStats | list[IndexStats]:
        if source is None:
            return [self._one_stats(s) for s in VALID_SOURCES]
        return self._one_stats(source)

    def _one_stats(self, source: str) -> IndexStats:
        if source not in VALID_SOURCES:
            raise RetrievalError(f"unknown source: {source!r}")
        with self._lock:
            state = self._get(source)
            dim = state.vectors.dim if state.vectors is not None else None
            return IndexStats(
                source=source,
                total_docs=len(state.records),
                vector_dim=dim,
                embedding_provider=self.provider.name,
                fallback_active=not self.provider.is_available(),
                index_size_bytes=state.store.total_size_bytes(),
                last_upsert_at=state.last_upsert_at,
                last_verify_at=state.last_verify_at,
                last_drift_count=state.last_drift_count,
            )


# --------------------------------------------------------------------------
# Module-level singleton + 5 public functions.
# --------------------------------------------------------------------------


def _is_vector_collapsed(vec_ranked: list[tuple]) -> bool:
    """True when the vector ranking carries no usable signal.

    Two failure modes the embedding layer can hand us silently:
      * provider returns a constant vector for every text (sims all equal),
      * provider returns a near-zero vector that survives the q_norm==0
        gate in VectorIndex but still produces effectively-equal sims.

    In both cases scored.sort() degenerates to VectorBlob insertion order,
    which is ~indexed_at order — useless for retrieval. We declare
    collapse when the spread between top-1 and bottom score in the
    returned slice is below epsilon, AND there is more than one result
    to compare. Single-hit results can't collapse by definition.
    """
    if len(vec_ranked) < 2:
        return False
    top = vec_ranked[0][1]
    bot = vec_ranked[-1][1]
    return (top - bot) < _VECTOR_COLLAPSE_EPSILON


def _filter_doc_ids(records: dict[str, DocRecord], filters: dict | None) -> set | None:
    """Return the set of doc_ids whose metadata matches all filter keys,
    or None if no filter was supplied (means: all docs allowed)."""
    if not filters:
        return None
    allowed = set()
    for doc_id, rec in records.items():
        md = rec.metadata or {}
        ok = True
        for k, v in filters.items():
            if md.get(k) != v:
                ok = False
                break
        if ok:
            allowed.add(doc_id)
    return allowed


# Reserved filter keys consumed by the facade itself rather than passed
# through to ``_filter_doc_ids``. ``expand_hops`` is the only member
# today (Phase 3 graph expansion); future graph-mode toggles attach here.
_GRAPH_DIRECTIVE_KEYS = {"expand_hops"}


def _split_graph_directives(filters: dict | None) -> tuple[int | None, dict | None]:
    """Pop the ``expand_hops`` directive from ``filters``.

    Returns ``(hops, remaining_filters)``. ``hops`` is None when not
    requested, an int >= 1 otherwise. ``remaining_filters`` is the
    metadata-only subset suitable for the equality matcher; we return
    None (== "no filters") when nothing remains so the existing
    short-circuit in ``_filter_doc_ids`` keeps working.
    """
    if not filters:
        return None, filters
    hops_raw = filters.get("expand_hops")
    if hops_raw is None:
        return None, filters
    try:
        hops = int(hops_raw)
    except (TypeError, ValueError):
        raise RetrievalError(
            f"expand_hops must be an int, got {type(hops_raw).__name__}"
        )
    if hops < 0:
        raise RetrievalError("expand_hops must be >= 0")
    remaining = {k: v for k, v in filters.items() if k not in _GRAPH_DIRECTIVE_KEYS}
    return hops, (remaining or None)


def _merge_seeded_neighbours(
    *,
    hits: list[Hit],
    seed_ids: set[str],
    seed_score: dict[str, float],
    expansion: dict[str, tuple[int, str]],
    state: "_SourceState",
    source: str,
) -> list[Hit]:
    """Append graph-expanded hits to the seeded list, seeds first.

    Each expanded hit:
      * doc_id      = neighbour module path (must exist in state.records;
                      stale entries — graph node without matching record —
                      are silently dropped, never poisoning the result)
      * score       = seed_score * 0.6**hop  (lower than its originator)
      * metadata    = original record metadata + ``expanded_from`` (the
                      seed that pulled it in) + ``hop`` distance
      * content     = full doc snapshot from the store, identical to
                      what a direct seed would carry

    Duplicates are dropped: a neighbour that's already a seed is skipped,
    and a neighbour that came in through multiple seeds keeps the
    first-recorded BFS path (closest hop wins by construction of bfs()).
    """
    out: list[Hit] = list(hits)
    already_emitted = set(seed_ids)
    for nb_id, (hop, origin) in expansion.items():
        if nb_id in already_emitted:
            continue
        rec = state.records.get(nb_id)
        if rec is None:
            # Graph references a module that retrieval doesn't know
            # about (e.g. dna source not yet rebuilt for that module).
            # Silently drop — graph expansion should never invent doc_ids.
            continue
        decay = _GRAPH_HOP_SCORE_DECAY ** hop
        base_score = seed_score.get(origin, 0.0)
        # Floor at a tiny positive value so downstream score-threshold
        # filters can still drop expansion hits when a min-score gate
        # is applied (e.g. the user_prompt_submit hook gates dna at 0.0
        # so this doesn't matter, but other callers may set min>0).
        score = max(base_score * decay, 1e-6)
        md = dict(rec.metadata or {})
        md["expanded_from"] = origin
        md["hop"] = hop
        content = state.store.read_doc(nb_id) or ""
        out.append(
            Hit(
                doc_id=nb_id,
                source=source,
                score=float(score),
                content=content,
                metadata=md,
            )
        )
        already_emitted.add(nb_id)
    return out


_default_facade: RetrievalFacade | None = None
_default_lock = RLock()


def _resolve_index_root() -> Path:
    # Lazy import to keep retrieval independent of the broader kernel
    # context.py for testability (tests can construct RetrievalFacade
    # directly without kernel context).
    from context import project_root  # type: ignore  # added to sys.path by cbim launcher
    return project_root() / ".cbim" / "index"


def _facade() -> RetrievalFacade:
    global _default_facade
    with _default_lock:
        if _default_facade is None:
            _default_facade = RetrievalFacade(_resolve_index_root())
        return _default_facade


def reset_default_facade() -> None:
    """Test hook: drop the cached singleton."""
    global _default_facade
    with _default_lock:
        _default_facade = None


def index_upsert(
    source: str,
    doc_id: str,
    content: str,
    metadata: dict | None = None,
    header_content: str | None = None,
) -> None:
    _facade().index_upsert(source, doc_id, content, metadata, header_content)


def index_delete(source: str, doc_id: str) -> None:
    _facade().index_delete(source, doc_id)


def search(
    source: str,
    query: str,
    top_k: int = 10,
    filters: dict | None = None,
) -> list[Hit]:
    return _facade().search(source, query, top_k, filters)


def verify_consistency(source: str, mode: str) -> DriftReport:
    return _facade().verify_consistency(source, mode)


def stats(source: str | None = None) -> IndexStats | list[IndexStats]:
    return _facade().stats(source)
