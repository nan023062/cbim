"""actions/mem_steps.py — memory governance step actions (in-process leaves).

Five pure-Python structural nodes:
  MemHealthScan      — in-process call to memory.HealthChecker.check()
  MemCompact         — in-process call to memory.compact()
  MemSweepExpired    — in-process call to memory.sweep_expired()
  MemRebuildIndex    — in-process call to memory.compaction.rebuilder
                       .rebuild_and_verify() (always runs in v2)
  DnaGraphRebuild    — in-process full rebuild of .cbim/index/dna/graph.json
                       via cbi._primitives.modules.graph_builder.build_graph
                       (Phase 3 — runs after MemRebuildIndex so the dna
                       business knowledge graph stays in sync with the
                       just-reconciled retrieval index)

The v2 distill triggering (TranscriptScan + DistillGate + the
DispatchMemDistill / CollectMemDistill / TranscriptDelete yield triad)
lives in ``actions/transcript_steps.py`` and the matching dispatch /
collect modules.

**Rule:** memory governance is mostly pure in-process Python — health
scan, compact, sweep, rebuild are deterministic and never yield.
Semantic short→medium compression is LLM-driven and runs via the
DispatchMemDistill self-yield to the main agent.

Any other node added here MUST be pure Python unless its inputs / outputs
are not enumerable (i.e. unless semantic judgment is intrinsic to the work).

Construction contract (per architect spec):
  - store_dir: Path is injected at construction time and stored as self._store_dir
  - backend: MemoryBackend is injected at construction time and stored as
    self._backend (omitted for the two calls that don't take a backend:
    compact() and HealthChecker.check())
  - neither is placed on bb
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from engine.core.node import Node, Status

from memory.compaction import (
    HealthChecker,
    compact,
    scan_for_promote_candidates,
    sweep_expired,
)
from memory.compaction.candidates import CandidatesArea
from memory.compaction.rebuilder import rebuild_and_verify
from memory.crud.backend import MemoryBackend


# ---------------------------------------------------------------------------
# MemHealthScan
# ---------------------------------------------------------------------------

class MemHealthScan(Node):
    """Run memory.HealthChecker.check() and store the report on bb.mem_health.

    HealthChecker is a Phase-4A skeleton; an empty/default report is a
    legal SUCCESS.
    """

    def __init__(self, *, store_dir: Path, name: str = "MemHealthScan") -> None:
        self.name = name
        self._store_dir = Path(store_dir)

    def tick(self, bb) -> Status:
        try:
            report = HealthChecker(self._store_dir).check()
        except Exception as e:  # noqa: BLE001 — Dream step writes error state to bb and continues; never crash dream tick
            bb.mem_health = {"error": f"{type(e).__name__}: {e}"}
            return Status.FAILURE
        bb.mem_health = _report_to_dict(report)
        return Status.SUCCESS


# ---------------------------------------------------------------------------
# MemCompact
# ---------------------------------------------------------------------------

class MemCompact(Node):
    """Run memory.compact(); skip-empty is SUCCESS per architect spec."""

    def __init__(self, *, store_dir: Path, name: str = "MemCompact") -> None:
        self.name = name
        self._store_dir = Path(store_dir)

    def tick(self, bb) -> Status:
        try:
            report = compact(self._store_dir)
        except Exception as e:  # noqa: BLE001 — Dream step writes error state to bb and continues; never crash dream tick
            bb.mem_compact_result = {"error": f"{type(e).__name__}: {e}"}
            return Status.FAILURE
        bb.mem_compact_result = _report_to_dict(report)
        return Status.SUCCESS


# MemDistillGate (v1) was removed in v2 — the distill triggering rule is
# now data-volume on bb.transcript_paths via DistillGate (see
# actions/transcript_steps.py). MemHealthScan no longer needs to feed a
# threshold check.


# ---------------------------------------------------------------------------
# MemPromoteScan
# ---------------------------------------------------------------------------

class MemPromoteScan(Node):
    """Run scan_for_promote_candidates() and surface pending candidates on bb.

    Phase 5 (rule C consumer side): after the scan stages new entries into
    ``CandidatesArea``, we ALSO read ``pull_pending()`` to expose every
    currently-staged candidate on ``bb.mem_promote_candidates``. The
    architect-governance prompt then renders one PROMOTE / HOLD / REJECT
    advice line per candidate. The candidates work area is the contract
    boundary — staging is idempotent, so re-emitting the same candidate
    across ticks is harmless until the architect explicitly REJECTs (which
    routes through ``CandidatesArea.clear``).

    SUCCESS even when feature flag is off (0 staged + empty pending is legal).
    """

    def __init__(self, *, store_dir: Path, name: str = "MemPromoteScan") -> None:
        self.name = name
        self._store_dir = Path(store_dir)

    def tick(self, bb) -> Status:
        try:
            staged = scan_for_promote_candidates(self._store_dir)
        except Exception as e:  # noqa: BLE001 — Dream step writes error state to bb and continues; never crash dream tick
            bb.mem_promote_result = {"error": f"{type(e).__name__}: {e}"}
            bb.mem_promote_candidates = []
            return Status.FAILURE
        try:
            pending = CandidatesArea(self._store_dir).pull_pending()
        except Exception as e:  # noqa: BLE001 — best-effort surface; flag-off path returns []
            pending = []
            bb.mem_promote_result = {
                "staged": int(staged),
                "pending_count": 0,
                "pull_error": f"{type(e).__name__}: {e}",
            }
            bb.mem_promote_candidates = []
            return Status.SUCCESS
        bb.mem_promote_candidates = pending
        bb.mem_promote_result = {
            "staged": int(staged),
            "pending_count": len(pending),
        }
        return Status.SUCCESS


# ---------------------------------------------------------------------------
# MemSweepExpired
# ---------------------------------------------------------------------------

class MemSweepExpired(Node):
    """Run memory.sweep_expired(store_dir, backend, keep_days)."""

    def __init__(
        self,
        *,
        store_dir: Path,
        backend: MemoryBackend,
        keep_days: int = 3,
        name: str = "MemSweepExpired",
    ) -> None:
        self.name = name
        self._store_dir = Path(store_dir)
        self._backend = backend
        self._keep_days = keep_days

    def tick(self, bb) -> Status:
        try:
            deleted = sweep_expired(self._store_dir, self._backend, keep_days=self._keep_days)
        except Exception as e:  # noqa: BLE001 — Dream step writes error state to bb and continues; never crash dream tick
            bb.mem_sweep_result = {"error": f"{type(e).__name__}: {e}"}
            return Status.FAILURE
        bb.mem_sweep_result = {"deleted": int(deleted), "keep_days": self._keep_days}
        return Status.SUCCESS


# ---------------------------------------------------------------------------
# MemRebuildIndex
# ---------------------------------------------------------------------------

class MemRebuildIndex(Node):
    """Run memory.compaction.rebuild_and_verify() unconditionally.

    v2 behaviour (per .dna/contract.md outbound table): always run the
    rebuild + drift-verify pair on the medium tier. The rebuild step is
    idempotent (re-feeds the per-entry retrieval upsert; a clean medium
    re-converges in one pass), and the verify step surfaces anything
    the rebuild couldn't reconcile. Skipping on "no drift" was a v1
    heuristic that depended on a HealthChecker indicator that the v2
    rebuilder makes redundant — every tick now does the full check.

    Writes the ``RebuildReport`` (as a dict) to ``bb.mem_index_result``.
    """

    def __init__(
        self,
        *,
        store_dir: Path,
        backend: MemoryBackend,
        tier: str | None = None,
        name: str = "MemRebuildIndex",
    ) -> None:
        self.name = name
        self._store_dir = Path(store_dir)
        self._backend = backend
        # ``tier`` kept for v1 signature compatibility; rebuild_and_verify
        # only addresses medium in v2.
        self._tier = tier

    def tick(self, bb) -> Status:
        try:
            report = rebuild_and_verify(self._store_dir, self._backend)
        except Exception as e:  # noqa: BLE001 — Dream step writes error state to bb and continues; never crash dream tick
            bb.mem_index_result = {"error": f"{type(e).__name__}: {e}"}
            return Status.FAILURE
        bb.mem_index_result = _report_to_dict(report)
        return Status.SUCCESS


# ---------------------------------------------------------------------------
# DnaGraphRebuild
# ---------------------------------------------------------------------------

class DnaGraphRebuild(Node):
    """Full-rebuild the DNA business knowledge graph (Phase 3).

    Calls ``cbi._primitives.modules.graph_builder.build_graph(project_root)``
    which scans every .dna/module.md, derives depends_on / contains
    edges, and atomically writes ``.cbim/index/dna/graph.json``. This is
    the authoritative path: incoming reindex_dna calls only patch the
    edited module's outgoing edges, so a periodic full rebuild keeps
    the graph from drifting under churn.

    No blackboard fields written. The rebuild is a side-effect on the
    filesystem (graph.json); SequenceTolerant captures the SUCCESS /
    FAILURE status into ``bb.step_results[<wrapper_name>]`` and
    EmitReport surfaces aggregate health from there. Adding a
    ``dna_graph_result`` field would require extending the
    DreamBlackboard schema (single-writer rule) for an output that
    isn't consumed by any downstream leaf.
    """

    def __init__(self, *, project_root: Path, name: str = "DnaGraphRebuild") -> None:
        self.name = name
        self._project_root = Path(project_root)

    def tick(self, bb) -> Status:
        try:
            from cbi._primitives.modules.graph_builder import build_graph
            build_graph(self._project_root)
        except Exception:  # noqa: BLE001 — Dream step never crashes dream tick; silent failure leaves the previous graph.json in place
            return Status.FAILURE
        return Status.SUCCESS


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _report_to_dict(obj: Any) -> dict:
    """Best-effort conversion of a dataclass/report to a plain dict.

    The 4A HealthChecker / CompactionReport are dataclass-ish; zero-value
    defaults convert cleanly. Unknown shapes return {} (still a legal SUCCESS).
    """
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return dict(obj)
    if hasattr(obj, "__dataclass_fields__"):
        out = {}
        for f in obj.__dataclass_fields__:
            try:
                out[f] = getattr(obj, f)
            except AttributeError:
                continue
        return out
    if hasattr(obj, "__dict__"):
        return {k: v for k, v in vars(obj).items() if not k.startswith("_")}
    return {"repr": repr(obj)[:200]}
