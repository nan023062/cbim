"""tree/dream_loop.py — build_dream_root: governance loop root constructor.

Topology (per WORKFLOW-DREAM §三 + v2 transcript-driven memory step):

    Root (Sequence) @Trace @Timeout(global=30min)
      ├── InitDreamTick
      ├── GovernanceSteps (SequenceTolerant)
      │     ├── MemoryGovernanceStep (Sequence) @Timeout(10min) @Catch
      │     │     ├── MemHealthScan          (in-process)
      │     │     ├── TranscriptScan         (~/.claude/projects/<slug>/*.jsonl,
      │     │     │                           mtime > 1 day)
      │     │     ├── DistillGate            (no mature transcripts → skip
      │     │     │                           Dispatch / Collect / Delete)
      │     │     ├── DispatchMemDistill     (yields agent_type="main",
      │     │     │                           subtask_id="governance_memory_distill"
      │     │     │                           — coordinator executes the skill itself)
      │     │     ├── CollectMemDistill      (owns on_resume → bb.mem_distill_result)
      │     │     ├── TranscriptDelete       (unlinks distilled_paths +
      │     │     │                           retrieval.index_delete)
      │     │     ├── MemPromoteScan         (stage rule/flow tagged medium
      │     │     │                           entries into candidates/;
      │     │     │                           feature-flag default off → no-op)
      │     │     ├── MemCompact             (medium-tier file compaction)
      │     │     ├── MemSweepExpired
      │     │     ├── MemRebuildIndex        (rebuild_and_verify)
      │     │     └── DnaGraphRebuild        (.cbim/index/dna/graph.json
      │     │                                 — Phase 3 business knowledge graph)
      │     ├── ArchitectGovernanceStep (Sequence) @Timeout(10min) @Catch
      │     │     ├── DispatchArchGovern     (yields agent_type="architect")
      │     │     └── CollectArchAdvice      (owns on_resume → bb.arch_governance_report)
      │     └── HRGovernanceStep (Sequence) @Timeout(10min) @Catch
      │           ├── DispatchHRGovern       (yields agent_type="hr",
      │           │                           subtask_id="governance_capability")
      │           └── CollectHRAdvice        (owns on_resume → bb.hr_governance_report)
      ├── EmitReport
      └── FinalizeDreamTick

EmitReport + FinalizeDreamTick live OUTSIDE the SequenceTolerant container
so they ALWAYS run, even if every governance step failed.

The memory governance step is now 14 nodes. The v1 ``MemDistillGate`` —
which read a HealthChecker short_count threshold — was retired alongside
the short-tier in memory v2. The v2 gate (``DistillGate``) is a pure
data-volume check on ``bb.transcript_paths``; the distill input is now
the user's mature CC transcript JSONLs, and the post-distill
``TranscriptDelete`` leaf removes the consumed transcripts (both on
disk and from the retrieval index). Batch 7 inserted ``MemPromoteScan``
between TranscriptDelete and MemCompact: it identifies medium entries
worth promoting to the knowledge system (rule/flow tagged) and stages
them into the candidates/ work area. The feature flag
``promote.enabled`` defaults to off — when off, the scan returns 0 and
touches nothing on disk.

Architect / HR governance steps remain sub-agent dispatches via the Task
tool; the MemDistill yield is a self-dispatch — on receiving a yield with
``agent_type="main"`` the coordinator runs the prompt in-place instead of
spawning a sub-agent. Combined with the optional MemDistill yield, a
single dream_tick can still yield up to **three** times before reaching Done.
"""

from __future__ import annotations

from pathlib import Path

from engine.core.composite import Sequence
from engine.core.decorator import Catch, Timeout, Trace
from engine.dream.core.composite_tolerant import SequenceTolerant

from memory.crud.backend import MemoryBackend
from memory.crud.file_backend import FileBackend

from ..actions.collect_arch_advice import CollectArchAdvice
from ..actions.collect_hr_advice import CollectHRAdvice
from ..actions.collect_incoming_triage import CollectIncomingTriage
from ..actions.collect_mem_distill import CollectMemDistill
from ..actions.dispatch_arch import DispatchArchGovern
from ..actions.dispatch_hr import DispatchHRGovern
from ..actions.dispatch_incoming_triage import DispatchIncomingTriage
from ..actions.dispatch_mem_distill import DispatchMemDistill
from ..actions.emit_report import EmitReport
from ..actions.finalize import FinalizeDreamTick
from ..actions.incoming_steps import IncomingScan
from ..actions.init_tick import InitDreamTick
from ..actions.mem_steps import (
    DnaGraphRebuild,
    MemCompact,
    MemHealthScan,
    MemPromoteScan,
    MemRebuildIndex,
    MemSweepExpired,
)
from ..actions.transcript_steps import (
    DistillGate,
    TranscriptDelete,
    TranscriptScan,
)


def build_dream_root(
    *,
    scheduler_root: Path,
    memory_store_dir: Path,
    memory_backend: MemoryBackend | None = None,
    transcripts_dir: Path | None = None,
    project_root: Path | None = None,
    global_timeout_s: int = 1800,
    step_timeout_s: int = 600,
):
    """Construct the governance loop root.

    Parameters
    ----------
    scheduler_root : Path
        Root for persistence (`.cbim/scheduler/`). EmitReport + FinalizeDreamTick
        write under `<scheduler_root>/dream/`.
    memory_store_dir : Path
        `.cbim/memory/` directory; passed to each MemoryGovernanceStep child.
    memory_backend : MemoryBackend, optional
        Storage backend for sweep / rebuild. Defaults to FileBackend(memory_store_dir).
    transcripts_dir : Path, optional
        Override for the TranscriptScan source directory. Production
        leaves this None and the scan resolves to
        ``~/.claude/projects/<slug>/`` against the process CWD; tests
        pass a tmp dir to keep the scan hermetic.
    project_root : Path, optional
        Project root passed to the DnaGraphRebuild leaf. Defaults to
        ``memory_store_dir.parent.parent`` (i.e. the directory whose
        ``.cbim/memory/`` we were handed). Tests that exercise the
        sub-loop with a mock memory dir should pass an explicit value.
    global_timeout_s : int
        Hard ceiling for the whole tick (default 30min).
    step_timeout_s : int
        Per-step ceiling (default 10min).
    """
    backend = memory_backend or FileBackend(memory_store_dir)
    if project_root is None:
        # memory_store_dir is conventionally <root>/.cbim/memory/. Two
        # parents up gives us the project root used by graph_builder.
        project_root = Path(memory_store_dir).parent.parent

    init = InitDreamTick(name="InitDreamTick")

    # ---- Memory governance step ----
    # Phase-5 14-node sequence (Batch 7 + incoming-queue triage + Phase 3
    # DNA graph rebuild):
    #
    #   MemHealthScan            — read memory.HealthChecker indicators
    #   TranscriptScan           — list ~/.claude/projects/<slug>/*.jsonl
    #                              with mtime > 1 day → bb.transcript_paths
    #   DistillGate              — non-empty paths? if not, skip Dispatch /
    #                              Collect / Delete via bb.mem_distill_dispatched=False
    #   DispatchMemDistill       — yield to main agent (agent_type="main",
    #                              subtask_id="governance_memory_distill")
    #   CollectMemDistill        — on_resume → bb.mem_distill_result
    #   TranscriptDelete         — unlink distilled paths + retrieval.index_delete
    #   MemPromoteScan           — stage rule/flow tagged medium entries into
    #                              candidates/ + surface pending list on bb
    #                              (architect_governance.compose_prompt renders it)
    #   IncomingScan             — Phase 5: list <store>/medium/incoming/*.jsonl
    #                              (excluding today's file) → bb.incoming_paths
    #   DispatchIncomingTriage   — yield to main agent (agent_type="main",
    #                              subtask_id="governance_incoming_triage")
    #   CollectIncomingTriage    — on_resume → bb.incoming_triage_result;
    #                              moves processed_paths to incoming/processed/
    #   MemCompact               — medium-tier file compaction
    #   MemSweepExpired          — archive-and-delete expired entries
    #   MemRebuildIndex          — rebuild_and_verify(store, backend)
    #   DnaGraphRebuild          — full rebuild of
    #                              .cbim/index/dna/graph.json
    #                              (Phase 3 — runs LAST so the graph
    #                              reflects the just-reconciled
    #                              retrieval index state)
    #
    # Order rationale: distill consumes transcripts → delete transcripts →
    # promote scan stages and exposes candidates → incoming triage runs
    # AFTER promote scan so newly-arriving high-signal records can land in
    # medium and *next-tick* promote scan picks them up → compact medium →
    # sweep expired → rebuild/verify index. Each leaf is independent under
    # the @Catch wrapper; a single failure (including the incoming-triage
    # business-failure path) annotates bb but does not abort the sequence.
    mem_seq = Sequence(
        [
            MemHealthScan(store_dir=memory_store_dir, name="MemHealthScan"),
            TranscriptScan(transcripts_dir=transcripts_dir, name="TranscriptScan"),
            DistillGate(name="DistillGate"),
            DispatchMemDistill(store_dir=memory_store_dir, name="DispatchMemDistill"),
            CollectMemDistill(store_dir=memory_store_dir, name="CollectMemDistill"),
            TranscriptDelete(name="TranscriptDelete"),
            MemPromoteScan(store_dir=memory_store_dir, name="MemPromoteScan"),
            IncomingScan(store_dir=memory_store_dir, name="IncomingScan"),
            DispatchIncomingTriage(store_dir=memory_store_dir, name="DispatchIncomingTriage"),
            CollectIncomingTriage(store_dir=memory_store_dir, name="CollectIncomingTriage"),
            MemCompact(store_dir=memory_store_dir, name="MemCompact"),
            MemSweepExpired(store_dir=memory_store_dir, backend=backend, name="MemSweepExpired"),
            MemRebuildIndex(store_dir=memory_store_dir, backend=backend, name="MemRebuildIndex"),
            DnaGraphRebuild(project_root=project_root, name="DnaGraphRebuild"),
        ],
        name="MemoryGovernanceStep",
    )
    mem_step = Catch(
        Timeout(mem_seq, seconds=step_timeout_s, name="MemoryStepTimeout"),
        fallback="swallow",
        name="MemoryStepCatch",
    )

    # ---- Knowledge governance step (yield to architect agent) ----
    arch_seq = Sequence(
        [
            DispatchArchGovern(name="DispatchArchGovern"),
            CollectArchAdvice(name="CollectArchAdvice"),
        ],
        name="ArchitectGovernanceStep",
    )
    arch_step = Catch(
        Timeout(arch_seq, seconds=step_timeout_s, name="ArchStepTimeout"),
        fallback="swallow",
        name="ArchStepCatch",
    )

    # ---- Capability governance step (yield to HR agent) ----
    hr_seq = Sequence(
        [
            DispatchHRGovern(name="DispatchHRGovern"),
            CollectHRAdvice(name="CollectHRAdvice"),
        ],
        name="HRGovernanceStep",
    )
    hr_step = Catch(
        Timeout(hr_seq, seconds=step_timeout_s, name="HRStepTimeout"),
        fallback="swallow",
        name="HRStepCatch",
    )

    governance_steps = SequenceTolerant(
        [mem_step, arch_step, hr_step],
        name="GovernanceSteps",
    )

    emit = EmitReport(scheduler_root=scheduler_root, name="EmitReport")
    finalize = FinalizeDreamTick(scheduler_root=scheduler_root, name="FinalizeDreamTick")

    body = Sequence(
        [init, governance_steps, emit, finalize],
        name="DreamBody",
    )

    return Trace(
        Timeout(body, seconds=global_timeout_s, name="DreamGlobalTimeout"),
        name="DreamRoot",
    )
