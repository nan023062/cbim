"""IndexStore — on-disk layout per contract.md §Index Storage Paths.

Layout (frozen public contract):
    .cbim/index/
      config.json
      <source>/
        meta.json       # {doc_id: {mtime, size, sha256, indexed_at, metadata, source_path?}}
        vectors.bin     # binary [N, dim] float32 (provider available only)
        bm25.json       # inverted index + doc-length table
        docs/<doc_id>.txt  # full text snapshot

doc_id sanitization: doc_ids may contain path separators / slashes, so we
percent-encode unsafe chars to make them filesystem-safe. The original
doc_id is the lookup key in meta.json.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import shutil
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from atomic_io import (  # kernel root leaf, see context.py convention
    atomic_write_bytes,
    atomic_write_text,
)

VALID_SOURCES = ("transcript", "memory_medium", "dna", "agents")


def _rename_with_retry(src: Path, dst: Path, attempts: int = 10, delay: float = 0.05) -> None:
    """``os.replace`` with bounded retry to absorb Windows handle-lag.

    On Windows ``os.replace`` can fail with ``PermissionError`` when
    another process / antivirus / search-indexer briefly holds a stray
    handle to the destination, even after the read-side has nominally
    closed. Retry a few times with a short sleep before propagating.
    """
    last_err: OSError | None = None
    for _ in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError as e:
            last_err = e
            time.sleep(delay)
    if last_err is not None:
        raise last_err
    # Should be unreachable, but appease the type checker.
    os.replace(src, dst)


class StoreError(Exception):
    pass


_SAFE = re.compile(r"[A-Za-z0-9._-]")


def _safe_doc_filename(doc_id: str) -> str:
    """Percent-encode characters not in [A-Za-z0-9._-]. Pure ASCII output.

    Reversible: e.g. 'a/b c' -> 'a%2Fb%20c'. Used for both docs/*.txt and
    in meta.json the original doc_id is preserved as the lookup key.
    """
    out = []
    for ch in doc_id:
        if _SAFE.match(ch):
            out.append(ch)
        else:
            for b in ch.encode("utf-8"):
                out.append(f"%{b:02X}")
    name = "".join(out)
    # Avoid empty / dot-only names
    if not name or name in (".", ".."):
        name = "_" + name
    return name


@dataclass
class DocRecord:
    doc_id: str
    mtime: float
    size: int
    sha256: str
    indexed_at: str
    metadata: dict = field(default_factory=dict)
    source_path: str | None = None  # absolute path of original file (when known)

    def to_dict(self) -> dict:
        return {
            "mtime": self.mtime,
            "size": self.size,
            "sha256": self.sha256,
            "indexed_at": self.indexed_at,
            "metadata": self.metadata,
            "source_path": self.source_path,
        }

    @classmethod
    def from_dict(cls, doc_id: str, data: dict) -> DocRecord:
        return cls(
            doc_id=doc_id,
            mtime=float(data.get("mtime", 0.0)),
            size=int(data.get("size", 0)),
            sha256=str(data.get("sha256", "")),
            indexed_at=str(data.get("indexed_at", "")),
            metadata=dict(data.get("metadata") or {}),
            source_path=data.get("source_path"),
        )


def content_sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


class IndexStore:
    """Per-source on-disk store. Single source = single directory."""

    def __init__(self, index_root: Path, source: str) -> None:
        if source not in VALID_SOURCES:
            raise StoreError(f"unknown source: {source!r}")
        self.index_root = index_root
        self.source = source
        self.source_dir = index_root / source
        self.docs_dir = self.source_dir / "docs"
        self.meta_path = self.source_dir / "meta.json"
        self.bm25_path = self.source_dir / "bm25.json"
        self.vectors_path = self.source_dir / "vectors.bin"
        # Optional sibling — only the dna source ever populates it. When
        # present, it carries one float32 vector per doc_id (same dim as
        # vectors.bin) embedding the header band (name + description +
        # keywords). Missing file is fine; the search path falls back to
        # body-only similarity. Not part of the legacy on-disk contract:
        # readers tolerate its absence and writers produce it lazily.
        self.header_vectors_path = self.source_dir / "header_vectors.bin"
        self.lock_path = self.source_dir / ".lock"
        self.staging_dir = self.source_dir / ".staging"
        # NB: no orphan cleanup on init. Removing stale ``.staging/``
        # or ``*.bak`` without holding the cross-process lock races
        # ``persist_atomic`` in a peer process: the peer's live file
        # sitting at ``*.bak`` waiting to be renamed back on rollback
        # would be deleted from under it, permanently losing that
        # index file. Cleanup is instead performed inside
        # ``persist_atomic`` under the lock — Phase 1 always wipes
        # ``.staging/``, and Phase 2 pre-flight unlinks any ``*.bak``
        # for the files it is about to promote.

    # ---------------- meta.json ----------------

    def load_meta(self) -> dict[str, DocRecord]:
        if not self.meta_path.exists():
            return {}
        try:
            raw = json.loads(self.meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        out: dict[str, DocRecord] = {}
        for doc_id, rec in (raw.get("docs") or {}).items():
            out[doc_id] = DocRecord.from_dict(doc_id, rec)
        return out

    def save_meta(self, records: dict[str, DocRecord]) -> None:
        self.source_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": 1,
            "source": self.source,
            "docs": {doc_id: rec.to_dict() for doc_id, rec in records.items()},
        }
        _atomic_write_json(self.meta_path, payload)

    # ---------------- docs/<doc_id>.txt ----------------

    def doc_path(self, doc_id: str) -> Path:
        return self.docs_dir / (_safe_doc_filename(doc_id) + ".txt")

    def write_doc(self, doc_id: str, content: str) -> None:
        self.docs_dir.mkdir(parents=True, exist_ok=True)
        path = self.doc_path(doc_id)
        atomic_write_text(path, content, fsync=True)

    def read_doc(self, doc_id: str) -> str | None:
        path = self.doc_path(doc_id)
        if not path.exists():
            return None
        try:
            return path.read_text(encoding="utf-8")
        except OSError:
            return None

    def delete_doc(self, doc_id: str) -> None:
        path = self.doc_path(doc_id)
        if path.exists():
            try:
                path.unlink()
            except OSError:
                pass

    # ---------------- bm25.json ----------------

    def load_bm25_state(self) -> dict | None:
        if not self.bm25_path.exists():
            return None
        try:
            return json.loads(self.bm25_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def save_bm25_state(self, state: dict) -> None:
        self.source_dir.mkdir(parents=True, exist_ok=True)
        _atomic_write_json(self.bm25_path, state)

    # ---------------- vectors.bin ----------------

    def load_vectors(self) -> VectorBlob | None:
        if not self.vectors_path.exists():
            return None
        try:
            return VectorBlob.load(self.vectors_path)
        except (OSError, ValueError):
            return None

    def save_vectors(self, blob: VectorBlob) -> None:
        self.source_dir.mkdir(parents=True, exist_ok=True)
        blob.save(self.vectors_path)

    # ---------------- header_vectors.bin (optional) ----------------

    def load_header_vectors(self) -> VectorBlob | None:
        """Read the optional header-band vector blob.

        Returns ``None`` when the sibling file is absent (the canonical
        state for non-dna sources, and for dna sources written before
        PR-2). The PR-1 / pre-PR-2 on-disk shape stays loadable: missing
        header file → search degrades to body-only similarity, no error.
        """
        if not self.header_vectors_path.exists():
            return None
        try:
            return VectorBlob.load(self.header_vectors_path)
        except (OSError, ValueError):
            return None

    def save_header_vectors(self, blob: VectorBlob) -> None:
        self.source_dir.mkdir(parents=True, exist_ok=True)
        blob.save(self.header_vectors_path)

    # ---------------- atomic three-file persist ----------------

    @contextlib.contextmanager
    def _cross_process_lock(self) -> Iterator[None]:
        """Acquire an exclusive cross-process lock on ``<source_dir>/.lock``.

        Implementation differs per platform:
          * POSIX: ``fcntl.flock`` with ``LOCK_EX`` — advisory but honoured
            by every cooperating cbim process.
          * Windows: ``msvcrt.locking`` with ``LK_LOCK`` on the first byte
            of the file — mandatory, blocks indefinitely.

        The .lock file is created on demand and never deleted. A 1-byte
        sentinel is written so Windows has a byte to lock; the file's
        existence is irrelevant to correctness.
        """
        self.source_dir.mkdir(parents=True, exist_ok=True)
        # Touch + ensure 1 byte for msvcrt.locking on Windows.
        if not self.lock_path.exists():
            with open(self.lock_path, "wb") as f:
                f.write(b"\x00")
        elif self.lock_path.stat().st_size < 1:
            with open(self.lock_path, "ab") as f:
                f.write(b"\x00")

        if sys.platform == "win32":
            import msvcrt
            f = open(self.lock_path, "r+b")
            try:
                # Park at byte 0 and lock 1 byte. LK_LOCK retries
                # internally until granted (no caller-visible spin).
                f.seek(0)
                while True:
                    try:
                        msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
                        break
                    except OSError:
                        # LK_LOCK retries up to ~10 times then raises;
                        # loop forever per contract (no timeout).
                        time.sleep(0.05)
                try:
                    yield
                finally:
                    f.seek(0)
                    try:
                        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
                    except OSError:
                        pass
            finally:
                f.close()
        else:
            import fcntl
            f = open(self.lock_path, "r+b")
            try:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    try:
                        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
                    except OSError:
                        pass
            finally:
                f.close()

    def _cleanup_orphans(self) -> None:
        """Best-effort: remove any leftover staging dir or .bak files.

        Runs on IndexStore init so we never enter persist_atomic with
        stale rollback artefacts. Failures are swallowed — this is
        opportunistic housekeeping, not a precondition.
        """
        try:
            if self.staging_dir.exists():
                shutil.rmtree(self.staging_dir, ignore_errors=True)
        except OSError:
            pass
        for bak_name in (
            "meta.json.bak",
            "bm25.json.bak",
            "vectors.bin.bak",
            "header_vectors.bin.bak",
        ):
            p = self.source_dir / bak_name
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass

    def persist_atomic(
        self,
        records: dict[str, DocRecord],
        bm25_state: dict,
        vectors: VectorBlob | None,
        header_vectors: VectorBlob | None = None,
    ) -> None:
        """Write meta.json + bm25.json (+ vectors.bin + optional
        header_vectors.bin) as one transaction.

        Strategy: stage every involved file inside ``<source_dir>/.staging/``,
        then for each existing live file rename it to ``<name>.bak`` and
        rename the staged copy into place. On any failure inside the
        rename phase, roll back by restoring ``*.bak``. On success, drop
        the ``*.bak`` files.

        After a crash anywhere mid-transaction, the next call into
        ``persist_atomic`` cleans up under the lock: Phase 1 wipes
        ``.staging/``, Phase 2 pre-flight unlinks any ``*.bak`` for
        the files being promoted this round. A reader opening the
        directory between crash and recovery sees either the old set
        (``*.bak`` not yet renamed away) or the new set, never a mix.

        ``header_vectors`` is optional and only used for source="dna" in
        the PR-2 retrieval-Y design. When omitted, the live
        header_vectors.bin (if any) is left untouched.
        """
        self.source_dir.mkdir(parents=True, exist_ok=True)
        # Always start from a clean staging dir.
        if self.staging_dir.exists():
            shutil.rmtree(self.staging_dir, ignore_errors=True)
        self.staging_dir.mkdir(parents=True, exist_ok=True)

        meta_payload = {
            "schema_version": 1,
            "source": self.source,
            "docs": {doc_id: rec.to_dict() for doc_id, rec in records.items()},
        }
        meta_staged = self.staging_dir / "meta.json"
        bm25_staged = self.staging_dir / "bm25.json"
        vectors_staged = self.staging_dir / "vectors.bin"
        header_vectors_staged = self.staging_dir / "header_vectors.bin"

        # Phase 1: stage. Any failure here is clean — nothing is renamed.
        try:
            atomic_write_text(
                meta_staged,
                json.dumps(meta_payload, indent=2, ensure_ascii=False),
                fsync=True,
            )
            atomic_write_text(
                bm25_staged,
                json.dumps(bm25_state, indent=2, ensure_ascii=False),
                fsync=True,
            )
            if vectors is not None:
                vectors.save(vectors_staged)
            if header_vectors is not None:
                header_vectors.save(header_vectors_staged)
        except BaseException:
            shutil.rmtree(self.staging_dir, ignore_errors=True)
            raise

        # Phase 2: rename live -> *.bak, then staged -> live. Track
        # progress so we can roll back on partial failure.
        ops: list[tuple[Path, Path]] = []
        # (live, staged) pairs, in commit order.
        ops.append((self.meta_path, meta_staged))
        ops.append((self.bm25_path, bm25_staged))
        if vectors is not None:
            ops.append((self.vectors_path, vectors_staged))
        if header_vectors is not None:
            ops.append((self.header_vectors_path, header_vectors_staged))

        renamed_to_bak: list[Path] = []
        committed_live: list[Path] = []
        try:
            # Pre-flight: clear any existing *.bak so the rename target
            # is free.
            for live, _ in ops:
                bak = live.with_suffix(live.suffix + ".bak")
                if bak.exists():
                    try:
                        bak.unlink()
                    except OSError:
                        pass

            # Move live -> *.bak (skip when live doesn't exist yet).
            for live, _ in ops:
                if live.exists():
                    bak = live.with_suffix(live.suffix + ".bak")
                    _rename_with_retry(live, bak)
                    renamed_to_bak.append(live)

            # Promote staged -> live.
            for live, staged in ops:
                _rename_with_retry(staged, live)
                committed_live.append(live)
        except BaseException:
            # Roll back: undo any staged->live promotions, then restore
            # *.bak -> live for the ones we moved aside.
            for live in committed_live:
                try:
                    if live.exists():
                        live.unlink()
                except OSError:
                    pass
            for live in renamed_to_bak:
                bak = live.with_suffix(live.suffix + ".bak")
                if bak.exists():
                    try:
                        os.replace(bak, live)
                    except OSError:
                        pass
            shutil.rmtree(self.staging_dir, ignore_errors=True)
            raise

        # Phase 3: success — remove *.bak and the staging dir.
        for live in renamed_to_bak:
            bak = live.with_suffix(live.suffix + ".bak")
            if bak.exists():
                try:
                    bak.unlink()
                except OSError:
                    pass
        shutil.rmtree(self.staging_dir, ignore_errors=True)

    # ---------------- diagnostics ----------------

    def total_size_bytes(self) -> int:
        if not self.source_dir.exists():
            return 0
        total = 0
        for p in self.source_dir.rglob("*"):
            if p.is_file():
                try:
                    total += p.stat().st_size
                except OSError:
                    pass
        return total


def _atomic_write_json(path: Path, payload: Any) -> None:
    """Thin wrapper over kernel._io.atomic_write_text for JSON payloads."""
    atomic_write_text(
        path,
        json.dumps(payload, indent=2, ensure_ascii=False),
        fsync=True,
    )


# --------------------------------------------------------------------------
# VectorBlob — minimal float32 [N, dim] container, pure stdlib.
# --------------------------------------------------------------------------
#
# Format (little-endian):
#   magic        : 4 bytes b"CBIV"
#   version      : uint32
#   dim          : uint32
#   count        : uint32
#   id_table_len : uint32  (length in bytes of UTF-8 JSON array of doc_ids)
#   id_table     : UTF-8 JSON array of doc_ids (length = count)
#   vectors      : float32 * count * dim
#
# numpy is optional; if absent we use array.array("f", ...).
# --------------------------------------------------------------------------

import struct


class VectorBlob:
    MAGIC = b"CBIV"
    VERSION = 1

    def __init__(self, dim: int) -> None:
        self.dim = int(dim)
        self.doc_ids: list[str] = []
        self.vectors: list[list[float]] = []

    def upsert(self, doc_id: str, vec: list) -> None:
        if len(vec) != self.dim:
            raise StoreError(f"vector dim mismatch: expected {self.dim}, got {len(vec)}")
        vec = [float(x) for x in vec]
        if doc_id in self.doc_ids:
            idx = self.doc_ids.index(doc_id)
            self.vectors[idx] = vec
        else:
            self.doc_ids.append(doc_id)
            self.vectors.append(vec)

    def delete(self, doc_id: str) -> None:
        if doc_id in self.doc_ids:
            idx = self.doc_ids.index(doc_id)
            del self.doc_ids[idx]
            del self.vectors[idx]

    def get(self, doc_id: str) -> list[float] | None:
        if doc_id in self.doc_ids:
            return self.vectors[self.doc_ids.index(doc_id)]
        return None

    def save(self, path: Path) -> None:
        import array
        import io
        id_blob = json.dumps(self.doc_ids, ensure_ascii=False).encode("utf-8")
        header = struct.pack(
            "<4sIIII",
            self.MAGIC,
            self.VERSION,
            self.dim,
            len(self.doc_ids),
            len(id_blob),
        )
        flat = array.array("f")
        for v in self.vectors:
            flat.extend(v)
        buf = io.BytesIO()
        buf.write(header)
        buf.write(id_blob)
        flat.tofile(buf)
        atomic_write_bytes(path, buf.getvalue(), fsync=True)

    @classmethod
    def load(cls, path: Path) -> VectorBlob:
        import array
        with open(path, "rb") as f:
            header = f.read(struct.calcsize("<4sIIII"))
            if len(header) < struct.calcsize("<4sIIII"):
                raise ValueError("truncated vectors.bin header")
            magic, version, dim, count, id_len = struct.unpack("<4sIIII", header)
            if magic != cls.MAGIC:
                raise ValueError(f"bad magic: {magic!r}")
            if version != cls.VERSION:
                raise ValueError(f"unsupported version: {version}")
            id_blob = f.read(id_len)
            if len(id_blob) < id_len:
                raise ValueError("truncated id table")
            doc_ids = json.loads(id_blob.decode("utf-8"))
            if len(doc_ids) != count:
                raise ValueError("id table count mismatch")
            flat = array.array("f")
            flat.fromfile(f, count * dim)
        blob = cls(dim)
        blob.doc_ids = list(doc_ids)
        for i in range(count):
            blob.vectors.append(list(flat[i * dim : (i + 1) * dim]))
        return blob
