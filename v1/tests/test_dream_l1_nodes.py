"""L1 — dream-loop Action node unit tests.

Pure in-memory, no MCP, no Runner — each Action exercised through tick() /
on_resume() directly.
"""
from __future__ import annotations

from pathlib import Path

import pytest

import json

from engine.core.node import Status
from engine.dream.actions.collect_arch_advice import CollectArchAdvice
from engine.dream.actions.collect_hr_advice import CollectHRAdvice
from engine.dream.actions.dispatch_arch import DispatchArchGovern
from engine.dream.actions.dispatch_hr import DispatchHRGovern
from engine.dream.actions.emit_report import EmitReport
from engine.dream.actions.finalize import FinalizeDreamTick
from engine.dream.actions.init_tick import InitDreamTick
from engine.dream.actions.mem_steps import (
    MemCompact,
    MemHealthScan,
    MemRebuildIndex,
    MemSweepExpired,
)
from engine.dream.core.blackboard import DreamBlackboard
from memory.crud.file_backend import FileBackend


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def bb() -> DreamBlackboard:
    b = DreamBlackboard()
    b.run_id = "test-run"
    b.trigger_reason = "manual"
    return b


@pytest.fixture
def store_dir(tmp_path: Path) -> Path:
    d = tmp_path / "memory"
    (d / "short").mkdir(parents=True)
    (d / "medium").mkdir(parents=True)
    return d


@pytest.fixture
def backend(store_dir: Path) -> FileBackend:
    return FileBackend(store_dir)


# ---------------------------------------------------------------------------
# InitDreamTick
# ---------------------------------------------------------------------------

def test_init_dream_tick_fills_defaults(bb):
    node = InitDreamTick()
    assert node.tick(bb) is Status.SUCCESS
    assert bb.step_results == {}
    assert bb.bb_status == "running"
    assert bb.started_at is not None


def test_init_dream_tick_is_idempotent(bb):
    bb.started_at = "2026-01-01T00:00:00+00:00"
    bb.step_results = {"memory": "success"}
    node = InitDreamTick()
    assert node.tick(bb) is Status.SUCCESS
    # Should NOT clobber pre-existing values.
    assert bb.started_at == "2026-01-01T00:00:00+00:00"
    assert bb.step_results == {"memory": "success"}


# ---------------------------------------------------------------------------
# Memory step actions
# ---------------------------------------------------------------------------

def test_mem_health_scan_returns_success_with_skeleton(bb, store_dir):
    node = MemHealthScan(store_dir=store_dir)
    assert node.tick(bb) is Status.SUCCESS
    # HealthChecker 4A skeleton returns a HealthReport — _report_to_dict converts.
    assert isinstance(bb.mem_health, dict)


def test_mem_compact_returns_success_with_skeleton(bb, store_dir):
    node = MemCompact(store_dir=store_dir)
    assert node.tick(bb) is Status.SUCCESS
    assert isinstance(bb.mem_compact_result, dict)


def test_mem_sweep_expired_returns_success_with_empty_store(bb, store_dir, backend):
    node = MemSweepExpired(store_dir=store_dir, backend=backend)
    assert node.tick(bb) is Status.SUCCESS
    assert bb.mem_sweep_result == {"deleted": 0, "keep_days": 3}


def test_mem_rebuild_index_always_runs(bb, store_dir, backend):
    """v2: rebuild_and_verify runs every tick (no index_drift skip path).

    Returns a RebuildReport dict containing indexed_count + drift_*
    fields. Empty store → indexed_count=0 but the call still succeeds.
    """
    node = MemRebuildIndex(store_dir=store_dir, backend=backend)
    assert node.tick(bb) is Status.SUCCESS
    assert "indexed_count" in bb.mem_index_result
    assert "drift_checked" in bb.mem_index_result


# ---------------------------------------------------------------------------
# Emit / Finalize
# ---------------------------------------------------------------------------

def test_emit_report_writes_markdown(bb, tmp_path):
    scheduler_root = tmp_path / "scheduler"
    bb.step_results = {"memory": "success", "knowledge": "failure", "capability": "success"}
    node = EmitReport(scheduler_root=scheduler_root)
    assert node.tick(bb) is Status.SUCCESS
    report = Path(bb.report_path)
    assert report.exists()
    content = report.read_text(encoding="utf-8")
    assert "Dream Tick Report" in content
    assert "memory" in content and "knowledge" in content
    assert bb.summary_for_session.startswith("[CBIM dream test-run]")


def test_finalize_writes_last_success_json(bb, tmp_path):
    scheduler_root = tmp_path / "scheduler"
    bb.report_path = str(tmp_path / "report.md")
    bb.step_results = {"memory": "success"}
    node = FinalizeDreamTick(scheduler_root=scheduler_root)
    assert node.tick(bb) is Status.SUCCESS
    last = scheduler_root / "dream" / "last_success.json"
    assert last.exists()
    import json
    payload = json.loads(last.read_text(encoding="utf-8"))
    assert payload["run_id"] == "test-run"
    assert payload["summary_path"] == str(tmp_path / "report.md")
    assert payload["step_results"] == {"memory": "success"}
    assert bb.finished_at is not None


# ---------------------------------------------------------------------------
# Architect governance dispatch + collect
# ---------------------------------------------------------------------------

def test_dispatch_arch_yields_on_first_tick_then_succeeds(bb):
    node = DispatchArchGovern()
    # First tick → yield: fills bb.pending_dispatch and sets the flag.
    assert node.tick(bb) is Status.RUNNING
    assert bb.arch_governance_dispatched is True
    pd = bb.pending_dispatch
    assert pd is not None
    assert pd.agent_type == "architect"
    assert pd.subtask_id == "governance_knowledge"
    assert pd.prompt.lstrip().startswith("## 治理模式")
    # Second tick (idempotent path) → SUCCESS, no re-dispatch.
    bb.pending_dispatch = None
    assert node.tick(bb) is Status.SUCCESS


def test_collect_arch_advice_parses_payload_on_resume(bb):
    node = CollectArchAdvice()
    bb.arch_governance_dispatched = True
    payload = json.dumps({
        "arch_governance_report": {
            "safe_actions_applied": ["dna_edit src/foo 补 owner"],
            "advice_pending": [],
        }
    })
    node.on_resume(bb, payload)
    assert bb.arch_governance_report == {
        "safe_actions_applied": ["dna_edit src/foo 补 owner"],
        "advice_pending": [],
    }
    assert bb.pending_dispatch is None
    # Tick after resume is SUCCESS (report present).
    assert node.tick(bb) is Status.SUCCESS


def test_collect_arch_advice_no_dispatch_is_noop(bb):
    node = CollectArchAdvice()
    # Never dispatched → SUCCESS no-op, no error report written.
    assert node.tick(bb) is Status.SUCCESS
    assert bb.arch_governance_report is None


def test_collect_arch_advice_dispatched_but_no_resume_is_failure(bb):
    node = CollectArchAdvice()
    bb.arch_governance_dispatched = True
    # Tick without on_resume having been called → FAILURE with placeholder.
    assert node.tick(bb) is Status.FAILURE
    assert bb.arch_governance_report["error"] == "no_payload_received"


# ---------------------------------------------------------------------------
# HR governance dispatch + collect (mirror of arch)
# ---------------------------------------------------------------------------

def test_dispatch_hr_yields_on_first_tick_then_succeeds(bb):
    node = DispatchHRGovern()
    assert node.tick(bb) is Status.RUNNING
    assert bb.hr_governance_dispatched is True
    pd = bb.pending_dispatch
    assert pd is not None
    assert pd.agent_type == "hr"
    assert pd.subtask_id == "governance_capability"
    assert pd.prompt.lstrip().startswith("## 治理模式")
    bb.pending_dispatch = None
    assert node.tick(bb) is Status.SUCCESS


def test_collect_hr_advice_parses_payload_on_resume(bb):
    node = CollectHRAdvice()
    bb.hr_governance_dispatched = True
    payload = json.dumps({
        "hr_governance_report": {
            "safe_actions_applied": [],
            "advice_pending": ["translator agent 14 天闲置，建议归档"],
        }
    })
    node.on_resume(bb, payload)
    assert bb.hr_governance_report == {
        "safe_actions_applied": [],
        "advice_pending": ["translator agent 14 天闲置，建议归档"],
    }
    assert bb.pending_dispatch is None
    assert node.tick(bb) is Status.SUCCESS


def test_collect_hr_advice_extracts_dict_payload_output(bb):
    """on_resume should unwrap the Task-tool dict shape {status, output, ...}."""
    node = CollectHRAdvice()
    bb.hr_governance_dispatched = True
    raw = {
        "status": "ok",
        "output": json.dumps({
            "hr_governance_report": {
                "safe_actions_applied": ["agent_edit translator 补 description"],
                "advice_pending": [],
            }
        }),
    }
    node.on_resume(bb, raw)
    assert bb.hr_governance_report["safe_actions_applied"] == [
        "agent_edit translator 补 description"
    ]


# ---------------------------------------------------------------------------
# Baseline burn-down advice (T8) — collect_arch_advice piggybacks burn-down
# reminders onto arch_governance_report.advice_pending.
# ---------------------------------------------------------------------------

from engine.dream.actions import baseline_burndown as _bd


def _seed_baseline(project_root: Path, entries: list[dict]) -> None:
    """Write a baseline.json under <project_root>/.cbim/audit/ for tests.

    Tests bypass BaselineStore.save() to avoid pulling the audit module's
    write path into a test that lives in dream's territory; instead we
    drop the JSON file directly with the schema BaselineStore.load()
    reads.
    """
    import json as _json
    audit_dir = project_root / ".cbim" / "audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "saved_at": "2026-01-01T00:00:00+00:00",
        "entries": entries,
    }
    (audit_dir / "baseline.json").write_text(
        _json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def test_burndown_returns_empty_when_baseline_missing(tmp_path):
    """Project never initialised baseline → advice list is empty."""
    advice = _bd.collect_burndown_advice(project_root_override=tmp_path)
    assert advice == []


def test_burndown_returns_empty_when_baseline_empty(tmp_path):
    """Baseline file exists but holds no entries → empty advice."""
    _seed_baseline(tmp_path, entries=[])
    advice = _bd.collect_burndown_advice(project_root_override=tmp_path)
    assert advice == []


def test_burndown_groups_per_check_and_appends_rollup(tmp_path):
    """Three entries across two checks → 2 per-check lines + 1 rollup."""
    _seed_baseline(tmp_path, entries=[
        {
            "fingerprint": "a" * 64, "check": "dna_tree", "code": "TREE_X",
            "target": "src/foo", "message": "m1",
            "accepted_at": "2026-01-01T00:00:00+00:00",
        },
        {
            "fingerprint": "b" * 64, "check": "dna_tree", "code": "TREE_Y",
            "target": "src/bar", "message": "m2",
            "accepted_at": "2026-01-01T00:00:00+00:00",
        },
        {
            "fingerprint": "c" * 64, "check": "memory_threshold", "code": "MEM_Z",
            "target": None, "message": "m3",
            "accepted_at": "2026-01-01T00:00:00+00:00",
        },
    ])
    advice = _bd.collect_burndown_advice(project_root_override=tmp_path)
    # Per-check lines come first (alphabetical), rollup last.
    assert len(advice) == 3
    assert advice[0].startswith("baseline burn-down: dna_tree 下还有 2 条")
    assert advice[1].startswith("baseline burn-down: memory_threshold 下还有 1 条")
    assert advice[2].startswith("baseline burn-down 汇总：共 3 条")
    # Every line names the manual CLI as the consumption path — burn-down
    # is advisory only; dream never writes the baseline.
    assert all("cbim audit baseline clear" in line or "CLI" in line for line in advice)


def test_burndown_advice_merged_into_arch_report_on_resume(bb, tmp_path, monkeypatch):
    """on_resume populates arch_governance_report and appends burn-down advice."""
    _seed_baseline(tmp_path, entries=[
        {
            "fingerprint": "d" * 64, "check": "dna_tree", "code": "TREE_X",
            "target": "src/foo", "message": "m1",
            "accepted_at": "2026-01-01T00:00:00+00:00",
        },
    ])
    # Pin the project_root that collect_burndown_advice resolves to.
    monkeypatch.setattr(_bd, "_project_root", lambda: tmp_path)

    node = CollectArchAdvice()
    bb.arch_governance_dispatched = True
    node.on_resume(bb, json.dumps({
        "arch_governance_report": {
            "safe_actions_applied": ["dna_edit src/foo 补 owner"],
            "advice_pending": ["既有建议 A"],
        }
    }))

    report = bb.arch_governance_report
    assert report["safe_actions_applied"] == ["dna_edit src/foo 补 owner"]
    # Existing advice survives; burn-down lines are appended after it.
    assert report["advice_pending"][0] == "既有建议 A"
    assert any("baseline burn-down: dna_tree" in s for s in report["advice_pending"])
    assert any("baseline burn-down 汇总" in s for s in report["advice_pending"])


def test_burndown_advice_merged_into_placeholder_on_no_payload(bb, tmp_path, monkeypatch):
    """Even the no_payload_received FAILURE path picks up burn-down advice."""
    _seed_baseline(tmp_path, entries=[
        {
            "fingerprint": "e" * 64, "check": "memory_threshold", "code": "MEM_Z",
            "target": None, "message": "m3",
            "accepted_at": "2026-01-01T00:00:00+00:00",
        },
    ])
    monkeypatch.setattr(_bd, "_project_root", lambda: tmp_path)

    node = CollectArchAdvice()
    bb.arch_governance_dispatched = True
    # No on_resume call → tick produces placeholder error report.
    assert node.tick(bb) is Status.FAILURE
    report = bb.arch_governance_report
    assert report["error"] == "no_payload_received"
    assert any("baseline burn-down: memory_threshold" in s for s in report["advice_pending"])


def test_burndown_advice_skipped_when_arch_step_short_circuits(bb, tmp_path, monkeypatch):
    """Dispatch never fired → no architect report → no burn-down advice attached.

    Burn-down advice piggybacks on the architect's report. If the arch step
    didn't dispatch (e.g. pre-seeded or skipped), there's no report to attach
    to and bb.arch_governance_report stays None. This is by design: burn-down
    advice surfaces through the architect's existing advice_pending block, not
    via a new blackboard field.
    """
    _seed_baseline(tmp_path, entries=[
        {
            "fingerprint": "f" * 64, "check": "dna_tree", "code": "TREE_X",
            "target": "src/foo", "message": "m1",
            "accepted_at": "2026-01-01T00:00:00+00:00",
        },
    ])
    monkeypatch.setattr(_bd, "_project_root", lambda: tmp_path)

    node = CollectArchAdvice()
    # arch_governance_dispatched left as None / falsy.
    assert node.tick(bb) is Status.SUCCESS
    assert bb.arch_governance_report is None


def test_burndown_advice_handles_corrupt_baseline_gracefully(tmp_path):
    """Corrupt baseline.json → helper returns empty list, no exception."""
    audit_dir = tmp_path / ".cbim" / "audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    (audit_dir / "baseline.json").write_text("{not json", encoding="utf-8")
    # Helper must swallow JSON errors — it's advisory only.
    advice = _bd.collect_burndown_advice(project_root_override=tmp_path)
    assert advice == []


def test_burndown_never_calls_save_or_accept(tmp_path, monkeypatch):
    """Hard invariant (T8): dream-side baseline access is load()-only.

    We patch BaselineStore.accept / save / clear to raise; if collect_burndown_advice
    touches any of them we get a noisy failure. Production wiring (CollectArchAdvice
    → collect_burndown_advice → BaselineStore.load) is asserted by the other tests
    in this group; this one nails down the read-only contract by detection.
    """
    _seed_baseline(tmp_path, entries=[
        {
            "fingerprint": "g" * 64, "check": "dna_tree", "code": "TREE_X",
            "target": "src/foo", "message": "m1",
            "accepted_at": "2026-01-01T00:00:00+00:00",
        },
    ])
    from engine.audit import BaselineStore

    def _explode(*a, **kw):
        raise AssertionError("dream burn-down helper must never mutate baseline")

    monkeypatch.setattr(BaselineStore, "accept", _explode)
    monkeypatch.setattr(BaselineStore, "save", _explode)
    monkeypatch.setattr(BaselineStore, "clear", _explode)

    advice = _bd.collect_burndown_advice(project_root_override=tmp_path)
    assert advice  # non-empty → load() was reached and produced output
    assert any("dna_tree" in line for line in advice)
