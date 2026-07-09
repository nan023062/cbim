"""Tests for IndexStore.persist_atomic + cross-process lock.

Coverage:
- happy path: meta + bm25 + vectors all written, *.bak / .staging cleaned.
- mid-write failure: simulate vectors.bin write failure -> meta.json must
  still be the OLD content (three-file rollback).
- multiprocessing: 3 workers concurrently upsert distinct doc_ids; final
  meta.json must contain all three; no half-written file detectable.
- legacy fallback: ``RetrievalConfig.atomic_persist=False`` exercises the
  serial-write path (sanity check that the flag still works).
"""

from __future__ import annotations

import json
import multiprocessing as mp
from pathlib import Path

import pytest
from engine.retrieval.config import RetrievalConfig
from engine.retrieval.facade import RetrievalFacade
from engine.retrieval.store import DocRecord, IndexStore, VectorBlob


def _read_meta(store: IndexStore) -> dict:
    raw = store.meta_path.read_text(encoding="utf-8")
    return json.loads(raw)


def test_persist_atomic_happy_path(tmp_path):
    store = IndexStore(tmp_path, "dna")
    rec = DocRecord(
        doc_id="m1",
        mtime=1.0,
        size=2,
        sha256="abc",
        indexed_at="2026-06-15T00:00:00Z",
        metadata={},
    )
    bm25_state = {"docs": {"m1": {"len": 2}}}
    blob = VectorBlob(dim=3)
    blob.upsert("m1", [0.1, 0.2, 0.3])

    store.persist_atomic({"m1": rec}, bm25_state, blob)

    assert store.meta_path.is_file()
    assert store.bm25_path.is_file()
    assert store.vectors_path.is_file()
    # No staging / *.bak left behind.
    assert not store.staging_dir.exists()
    for bak_name in ("meta.json.bak", "bm25.json.bak", "vectors.bin.bak"):
        assert not (store.source_dir / bak_name).exists()


def test_persist_atomic_rolls_back_on_vector_failure(tmp_path, monkeypatch):
    """Simulate vector save failure -> meta.json must remain the OLD value."""
    store = IndexStore(tmp_path, "dna")
    # First, write a baseline.
    rec_v1 = DocRecord(
        doc_id="m1", mtime=1.0, size=2, sha256="aaa",
        indexed_at="2026-06-15T00:00:00Z", metadata={},
    )
    blob_v1 = VectorBlob(dim=3)
    blob_v1.upsert("m1", [0.1, 0.2, 0.3])
    store.persist_atomic({"m1": rec_v1}, {"docs": {"m1": {"len": 2}}}, blob_v1)
    baseline_meta = _read_meta(store)

    # Now arrange a v2 write where the vector save raises mid-flight.
    rec_v2 = DocRecord(
        doc_id="m1", mtime=2.0, size=99, sha256="bbb",
        indexed_at="2026-06-15T01:00:00Z", metadata={},
    )

    class _ExplodingBlob:
        dim = 3

        def __init__(self):
            self.doc_ids = ["m1"]

        def save(self, path):
            raise OSError("simulated vector write failure")

    with pytest.raises(OSError, match="simulated vector write failure"):
        store.persist_atomic(
            {"m1": rec_v2},
            {"docs": {"m1": {"len": 99}}},
            _ExplodingBlob(),
        )

    # Meta.json must be the v1 content — the failed transaction left
    # the old state intact.
    after = _read_meta(store)
    assert after == baseline_meta
    # No leftover staging / *.bak.
    assert not store.staging_dir.exists()
    assert not (store.source_dir / "meta.json.bak").exists()
    assert not (store.source_dir / "bm25.json.bak").exists()


def test_legacy_path_when_atomic_persist_false(tmp_path):
    """atomic_persist=False -> _persist falls back to serial writes."""
    cfg = RetrievalConfig(atomic_persist=False)
    f = RetrievalFacade(tmp_path, config=cfg)
    f.index_upsert("dna", "m1", "hello world", {"source_path": str(tmp_path / "x")})
    state = f._sources["dna"]
    assert "m1" in state.records
    assert state.store.meta_path.is_file()


def _worker_upsert(index_root_str: str, doc_id: str, content: str) -> None:
    """Multiprocessing worker: instantiate facade and do one upsert."""
    import sys
    # Re-import sys.path setup. conftest in pytest sets it up; child
    # processes need it manually.
    here = Path(__file__).resolve().parent
    v1 = here.parent
    kernel_src = v1 / "kernel"
    for p in (str(kernel_src), str(here)):
        if p not in sys.path:
            sys.path.insert(0, p)
    from engine.retrieval.config import RetrievalConfig
    from engine.retrieval.facade import RetrievalFacade

    f = RetrievalFacade(Path(index_root_str), config=RetrievalConfig())
    f.index_upsert("dna", doc_id, content, {})


def test_concurrent_upsert_no_loss(tmp_path):
    """Three concurrent processes upsert distinct doc_ids — none must be lost."""
    procs = []
    ctx = mp.get_context("spawn")
    for i in range(3):
        p = ctx.Process(
            target=_worker_upsert,
            args=(str(tmp_path), f"doc-{i}", f"content body number {i}"),
        )
        p.start()
        procs.append(p)
    for p in procs:
        p.join(timeout=60)
        assert not p.is_alive(), "worker did not finish in time"
        assert p.exitcode == 0, f"worker exit={p.exitcode}"

    # Re-open the store and confirm all three doc_ids are present.
    store = IndexStore(tmp_path, "dna")
    records = store.load_meta()
    assert set(records.keys()) == {"doc-0", "doc-1", "doc-2"}
    # No staging residue and no *.bak left behind from any worker.
    assert not store.staging_dir.exists()
    for bak_name in ("meta.json.bak", "bm25.json.bak", "vectors.bin.bak"):
        assert not (store.source_dir / bak_name).exists()


def test_orphan_cleanup_on_persist_atomic(tmp_path):
    """Stale .staging/ + *.bak from a crashed run get swept by the next
    persist_atomic call (cleanup used to run in IndexStore.__init__ but
    that race-with-live-persists could delete a peer process's *.bak
    mid-rollback — see the store.py __init__ comment)."""
    store_dir = tmp_path / "dna"
    store_dir.mkdir()
    (store_dir / ".staging").mkdir()
    (store_dir / ".staging" / "meta.json").write_text("{}", encoding="utf-8")
    (store_dir / "meta.json.bak").write_text("{}", encoding="utf-8")
    (store_dir / "bm25.json.bak").write_text("{}", encoding="utf-8")

    store = IndexStore(tmp_path, "dna")

    # Init deliberately leaves stale artefacts alone — no unlocked
    # cleanup — so they survive the constructor.
    assert (store_dir / ".staging").exists()
    assert (store_dir / "meta.json.bak").exists()
    assert (store_dir / "bm25.json.bak").exists()

    # Next persist_atomic call reclaims them: Phase 1 wipes .staging/,
    # Phase 2 pre-flight unlinks *.bak for every file it's about to
    # promote (meta + bm25 always).
    rec = DocRecord(
        doc_id="m1", mtime=1.0, size=2, sha256="abc",
        indexed_at="2026-06-15T00:00:00Z", metadata={},
    )
    store.persist_atomic({"m1": rec}, {"docs": {"m1": {"len": 2}}}, None)

    assert not (store_dir / ".staging").exists()
    assert not (store_dir / "meta.json.bak").exists()
    assert not (store_dir / "bm25.json.bak").exists()


def test_cross_process_lock_serialises_in_thread(tmp_path):
    """Within a single process two facade upserts complete (re-entry-safe)."""
    f = RetrievalFacade(tmp_path, config=RetrievalConfig())
    f.index_upsert("dna", "a", "alpha content", {})
    f.index_upsert("dna", "b", "beta content", {})
    state = f._sources["dna"]
    assert {"a", "b"} == set(state.records.keys())
