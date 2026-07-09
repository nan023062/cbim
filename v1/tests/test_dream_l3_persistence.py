"""L3 — dream-loop persistence + 20h-window gate tests.

Uses tmp_path for the scheduler root so each test is isolated.
Monkey-patches engine.dream.api.dream_tick._scheduler_root and _memory_store_dir
to route writes under tmp_path.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from engine.dream.api import dream_tick as api


@pytest.fixture
def isolated_dirs(tmp_path: Path, monkeypatch):
    scheduler_root = tmp_path / "scheduler"
    memory_root = tmp_path / "memory"
    transcripts_root = tmp_path / "transcripts"
    (memory_root / "medium").mkdir(parents=True)
    scheduler_root.mkdir(parents=True)
    transcripts_root.mkdir(parents=True)
    # v2: point TranscriptScan at an empty dir so DistillGate skips, keeping
    # the persistence tests on the original 2-yield trajectory
    # (architect → HR). Distill-specific behaviour is exercised separately.
    monkeypatch.setattr(api, "_scheduler_root", lambda: scheduler_root)
    monkeypatch.setattr(api, "_memory_store_dir", lambda: memory_root)
    monkeypatch.setattr(api, "_transcripts_dir", lambda: transcripts_root)
    return scheduler_root, memory_root


# ---------------------------------------------------------------------------
# Window gate
# ---------------------------------------------------------------------------

def test_catchup_within_20h_window_returns_skipped(isolated_dirs):
    scheduler_root, _ = isolated_dirs
    dream_root = scheduler_root / "dream"
    dream_root.mkdir(parents=True, exist_ok=True)
    last = datetime.now(timezone.utc) - timedelta(hours=2)
    (dream_root / "last_success.json").write_text(
        json.dumps({"finished_at": last.isoformat(timespec="seconds")}),
        encoding="utf-8",
    )
    res = api.dream_tick("catchup")
    assert res.kind == "skipped"
    assert res.reason == "within_window"


def test_catchup_outside_20h_window_runs(isolated_dirs):
    scheduler_root, _ = isolated_dirs
    dream_root = scheduler_root / "dream"
    dream_root.mkdir(parents=True, exist_ok=True)
    long_ago = datetime.now(timezone.utc) - timedelta(hours=25)
    (dream_root / "last_success.json").write_text(
        json.dumps({"finished_at": long_ago.isoformat(timespec="seconds")}),
        encoding="utf-8",
    )
    res = api.dream_tick("catchup")
    # First yield is Architect dispatch (memory step runs in-process and
    # succeeds; arch step's first action is the yield to the architect agent).
    assert res.kind == "yield", f"unexpected: {res.to_dict()}"
    assert res.dispatch_request is not None
    assert res.dispatch_request.agent_type == "architect"


# ---------------------------------------------------------------------------
# Single-flight
# ---------------------------------------------------------------------------
#
# A fresh dream_tick yields at the architect-dispatch leaf; after that
# yield the engine has written `current.json` and the persistent RUNNING
# state we need to test single-flight / abort / list_runs against.
# `_seed_running_tick` still synthesizes a stuck tick on disk so tests
# don't depend on a real mid-tick suspension survival.


def _seed_running_tick(
    scheduler_root,
    run_id: str = "stuck-run",
    *,
    heartbeat: str | None = None,
    include_heartbeat: bool = True,
) -> None:
    """Write a minimal bb.json + current.json that look like a tick in
    flight, without ever invoking the engine.

    ``heartbeat`` — ISO-8601 UTC string for `last_heartbeat`. Defaults to
    "now" so the seeded tick looks alive by default and the engine's
    heartbeat-stale self-heal in `_current_running_run_id()` won't fire
    (single-flight tests need this). Pass an explicit old timestamp to
    trigger self-heal in stale-heartbeat tests.

    ``include_heartbeat`` — set False to omit the `last_heartbeat` field
    entirely (simulates legacy `current.json` format or a partial write);
    the engine must treat that as expired and self-heal.
    """
    dream_dir = scheduler_root / "dream"
    tick_dir = dream_dir / run_id
    tick_dir.mkdir(parents=True, exist_ok=True)
    (tick_dir / "bb.json").write_text(json.dumps({
        "schema_version": 2,
        "tick_id": run_id,
        "bb_status": "running",
        "created_at": "2026-05-25T00:00:00+00:00",
        "updated_at": "2026-05-25T00:00:00+00:00",
        "fields": {
            "tick_id": run_id,
            "trigger_reason": "manual",
            "started_at": "2026-05-25T00:00:00+00:00",
            "step_results": {},
        },
    }), encoding="utf-8")
    current_payload = {
        "run_id": run_id,
        "status": "running",
        "started_at": "2026-05-25T00:00:00+00:00",
    }
    if include_heartbeat:
        current_payload["last_heartbeat"] = heartbeat or datetime.now(
            timezone.utc
        ).isoformat(timespec="seconds")
    (dream_dir / "current.json").write_text(
        json.dumps(current_payload), encoding="utf-8"
    )


def test_second_dream_tick_while_running_is_skipped(isolated_dirs):
    scheduler_root, _ = isolated_dirs
    _seed_running_tick(scheduler_root)
    res = api.dream_tick("manual")
    assert res.kind == "skipped"
    assert res.reason == "another_run_in_progress"


# ---------------------------------------------------------------------------
# dream_list_runs
# ---------------------------------------------------------------------------

def test_dream_list_runs_returns_empty_when_no_dir(isolated_dirs):
    assert api.dream_list_runs() == []


def test_dream_list_runs_includes_running_tick(isolated_dirs):
    scheduler_root, _ = isolated_dirs
    _seed_running_tick(scheduler_root, run_id="stuck-1")
    runs = api.dream_list_runs()
    assert len(runs) == 1
    assert runs[0].run_id == "stuck-1"
    assert runs[0].status == "running"
    assert runs[0].trigger_reason == "manual"


def test_dream_list_runs_records_done_tick(isolated_dirs):
    """A full tick yields twice (architect → HR) then drives to done;
    list_runs should pick up the done state."""
    first = api.dream_tick("manual")
    assert first.kind == "yield"
    second = api.dream_tick_resume(
        first.run_id,
        json.dumps({"arch_governance_report": {"safe_actions_applied": [], "advice_pending": []}}),
    )
    assert second.kind == "yield"
    third = api.dream_tick_resume(
        second.run_id,
        json.dumps({"hr_governance_report": {"safe_actions_applied": [], "advice_pending": []}}),
    )
    assert third.kind == "done", third.to_dict()
    runs = api.dream_list_runs()
    assert len(runs) == 1
    assert runs[0].status == "done"


# ---------------------------------------------------------------------------
# dream_abort
# ---------------------------------------------------------------------------

def test_dream_abort_marks_abandoned_and_clears_current(isolated_dirs):
    scheduler_root, _ = isolated_dirs
    _seed_running_tick(scheduler_root, run_id="stuck-abort")
    abort = api.dream_abort("stuck-abort", "user_preempted")
    assert abort.aborted is True
    # abandoned.json exists
    assert (scheduler_root / "dream" / "stuck-abort" / "abandoned.json").exists()
    # current.json cleared → another tick can now start
    res2 = api.dream_tick("manual")
    assert res2.kind in ("done", "yield")
    # The aborted tick must NOT advance last_success.json by itself; a
    # subsequent successful tick may, so we only assert the abort half here.
    runs = {r.run_id: r.status for r in api.dream_list_runs()}
    assert runs["stuck-abort"] == "abandoned"


def test_dream_abort_on_unknown_run_is_noop(isolated_dirs):
    abort = api.dream_abort("does-not-exist", "manual_abort")
    assert abort.aborted is False


# ---------------------------------------------------------------------------
# Heartbeat self-heal — engine reclaims a dead RUNNING slot on next call
# ---------------------------------------------------------------------------

def test_stale_heartbeat_running_tick_self_heals(isolated_dirs):
    """Killed tick with a heartbeat > 30 min old must not wedge the single-
    flight gate. `_current_running_run_id()` self-heals by calling
    dream_abort under the hood and returns None so a fresh tick can start."""
    scheduler_root, _ = isolated_dirs
    stale_hb = (
        datetime.now(timezone.utc) - timedelta(hours=2)
    ).isoformat(timespec="seconds")
    _seed_running_tick(scheduler_root, run_id="killed-run", heartbeat=stale_hb)

    # Self-heal: gate returns None even though current.json still says running.
    assert api._current_running_run_id() is None

    # Abandoned artifact recorded on disk.
    assert (scheduler_root / "dream" / "killed-run" / "abandoned.json").exists()

    # Slot is free — a fresh dream_tick proceeds past the single-flight gate.
    res = api.dream_tick("manual")
    assert res.kind in ("yield", "done"), res.to_dict()


def test_missing_heartbeat_running_tick_self_heals(isolated_dirs):
    """Legacy `current.json` without a `last_heartbeat` field (or a partial
    write caught mid-flight) must also be treated as expired — otherwise
    old-format files could wedge single-flight indefinitely."""
    scheduler_root, _ = isolated_dirs
    _seed_running_tick(
        scheduler_root, run_id="no-hb-run", include_heartbeat=False
    )

    assert api._current_running_run_id() is None
    assert (scheduler_root / "dream" / "no-hb-run" / "abandoned.json").exists()


def test_fresh_heartbeat_running_tick_still_blocks(isolated_dirs):
    """Negative control: a tick with a fresh heartbeat is NOT self-healed;
    single-flight must still block a second dream_tick."""
    scheduler_root, _ = isolated_dirs
    _seed_running_tick(scheduler_root, run_id="alive-run")  # default = now

    assert api._current_running_run_id() == "alive-run"
    res = api.dream_tick("manual")
    assert res.kind == "skipped"
    assert res.reason == "another_run_in_progress"
    # Should NOT have written abandoned.json for the alive tick.
    assert not (scheduler_root / "dream" / "alive-run" / "abandoned.json").exists()


def test_dream_abort_is_idempotent_under_concurrent_self_heal(isolated_dirs):
    """Two concurrent processes observing the same stale heartbeat both call
    dream_abort; the second must be a benign no-op (aborted=False) rather
    than an exception. Guards against races between MCP callers."""
    scheduler_root, _ = isolated_dirs
    stale_hb = (
        datetime.now(timezone.utc) - timedelta(hours=2)
    ).isoformat(timespec="seconds")
    _seed_running_tick(scheduler_root, run_id="race-run", heartbeat=stale_hb)

    first = api.dream_abort("race-run", reason="stale_heartbeat")
    second = api.dream_abort("race-run", reason="stale_heartbeat")

    assert first.aborted is True
    assert second.aborted is False  # already abandoned; benign no-op
