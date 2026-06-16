"""E2E for the Phase-5 incoming-queue triage step inside the dream loop.

Exercises the trajectory:
  1. dream_tick → IncomingScan finds prior-day JSONL → DispatchIncomingTriage
     yields to the main agent (agent_type="main",
     subtask_id="governance_incoming_triage").
  2. resume with a successful triage report → CollectIncomingTriage moves
     processed JSONLs to incoming/processed/ → ArchitectGovernanceStep yields.
  3. resume the architect report → HRGovernanceStep yields.
  4. resume the HR report → done.

Plus regression cases:
  - empty incoming queue is a clean skip (no main-agent yield).
  - parse-failure on the triage payload is FAILURE-SAFE: dream tick still
    converges past MemCompact (proves the @Catch on MemoryStepCatch + the
    SUCCESS re-entry path in CollectIncomingTriage.tick).
  - re-running with the file already archived: IncomingScan sees nothing.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path

import pytest

from engine.dream.api import dream_tick as api
from engine.dream.actions import incoming_steps as incoming_mod


def _seed_jsonl(parent: Path, name: str, lines: list[dict]) -> Path:
    parent.mkdir(parents=True, exist_ok=True)
    p = parent / name
    body = "\n".join(json.dumps(d, ensure_ascii=False) for d in lines) + "\n"
    p.write_text(body, encoding="utf-8")
    return p


@pytest.fixture
def isolated_dirs(tmp_path: Path, monkeypatch):
    scheduler_root = tmp_path / "scheduler"
    memory_root = tmp_path / "memory"
    transcripts_root = tmp_path / "transcripts"
    (memory_root / "medium").mkdir(parents=True)
    scheduler_root.mkdir(parents=True)
    transcripts_root.mkdir(parents=True)
    monkeypatch.setattr(api, "_scheduler_root", lambda: scheduler_root)
    monkeypatch.setattr(api, "_memory_store_dir", lambda: memory_root)
    monkeypatch.setattr(api, "_transcripts_dir", lambda: transcripts_root)
    # Pin "today" so the scan's exclusion is deterministic regardless of
    # when the test runs.
    monkeypatch.setattr(
        incoming_mod, "datetime",
        type("D", (), {
            "now": staticmethod(lambda: datetime(2099, 1, 1)),
            "strptime": datetime.strptime,
        }),
    )
    return scheduler_root, memory_root


def _arch_payload() -> str:
    return json.dumps({
        "arch_governance_report": {
            "safe_actions_applied": [],
            "advice_pending": [],
        }
    })


def _hr_payload() -> str:
    return json.dumps({
        "hr_governance_report": {
            "safe_actions_applied": [],
            "advice_pending": [],
        }
    })


def test_mature_incoming_triggers_main_yield_then_arch_then_hr(isolated_dirs):
    scheduler_root, memory_root = isolated_dirs
    incoming = memory_root / "medium" / "incoming"
    p1 = _seed_jsonl(incoming, "2026-06-13.jsonl", [
        {"category": "decision", "snippet": "promote 走人工门"},
    ])
    p2 = _seed_jsonl(incoming, "2026-06-14.jsonl", [
        {"category": "rule", "snippet": "incoming 失败不归档"},
    ])

    res = api.dream_tick("manual")
    assert res.kind == "yield", res.to_dict()
    dr = res.dispatch_request
    assert dr.agent_type == "main"
    assert dr.subtask_id == "governance_incoming_triage"
    assert dr.agent_file is None
    assert dr.prompt.lstrip().startswith("## 治理模式")
    for p in (p1, p2):
        assert json.dumps(str(p), ensure_ascii=False) in dr.prompt

    # Skill claims both JSONLs fully consumed; one new medium entry.
    medium_path = memory_root / "medium" / "incoming-2026-06-13-1.md"
    medium_path.write_text(
        "---\nslug: incoming-2026-06-13-1\ntier: medium\ntags: [decision]\n---\nbody\n",
        encoding="utf-8",
    )
    triage_report = json.dumps({
        "processed_paths": [str(p1), str(p2)],
        "medium_entries_written": [str(medium_path)],
        "skipped_records": [{"path": str(p1), "reason": "low-signal"}],
        "errors": [],
    })
    res2 = api.dream_tick_resume(res.run_id, triage_report)
    assert res2.kind == "yield", res2.to_dict()
    assert res2.dispatch_request.agent_type == "architect"

    # Files moved to processed/.
    archive = incoming / "processed"
    assert (archive / "2026-06-13.jsonl").exists()
    assert (archive / "2026-06-14.jsonl").exists()
    assert not p1.exists()
    assert not p2.exists()

    res3 = api.dream_tick_resume(res2.run_id, _arch_payload())
    assert res3.kind == "yield"
    assert res3.dispatch_request.agent_type == "hr"

    res4 = api.dream_tick_resume(res3.run_id, _hr_payload())
    assert res4.kind == "done", res4.to_dict()


def test_empty_queue_no_yield_for_incoming(isolated_dirs):
    """No prior-day files → IncomingScan skips → DispatchIncomingTriage no-op.
    First yield should still be the architect (memory step quiet)."""
    res = api.dream_tick("manual")
    assert res.kind == "yield"
    assert res.dispatch_request.agent_type == "architect"


def test_idempotent_after_processed(isolated_dirs):
    """After a successful triage moves files to processed/, re-running
    finds nothing to triage."""
    _, memory_root = isolated_dirs
    incoming = memory_root / "medium" / "incoming"
    p1 = _seed_jsonl(incoming, "2026-06-13.jsonl", [{"x": 1}])

    res = api.dream_tick("manual")
    assert res.kind == "yield"
    assert res.dispatch_request.subtask_id == "governance_incoming_triage"

    triage_report = json.dumps({
        "processed_paths": [str(p1)],
        "medium_entries_written": [],
        "skipped_records": [],
        "errors": [],
    })
    res2 = api.dream_tick_resume(res.run_id, triage_report)
    assert res2.kind == "yield"
    assert res2.dispatch_request.agent_type == "architect"
    assert not p1.exists()
    assert (incoming / "processed" / "2026-06-13.jsonl").exists()

    # Second tick: incoming/ has only processed/ subdir + nothing else.
    res3 = api.dream_tick_resume(res2.run_id, _arch_payload())
    res4 = api.dream_tick_resume(res3.run_id, _hr_payload())
    assert res4.kind == "done"

    # New tick → no incoming yield.
    res5 = api.dream_tick("manual")
    assert res5.kind == "yield"
    assert res5.dispatch_request.agent_type == "architect", \
        f"expected architect first, got {res5.dispatch_request.agent_type}"


def test_business_failure_does_not_block_downstream_compact(isolated_dirs):
    """Triage parse failure / business errors must NOT abort the memory
    governance sequence — MemCompact still runs and the dream loop still
    converges to the architect yield."""
    _, memory_root = isolated_dirs
    incoming = memory_root / "medium" / "incoming"
    _seed_jsonl(incoming, "2026-06-13.jsonl", [{"x": 1}])

    res = api.dream_tick("manual")
    assert res.kind == "yield"
    assert res.dispatch_request.subtask_id == "governance_incoming_triage"

    # Garbled payload — parse_response returns an error sentinel.
    res2 = api.dream_tick_resume(res.run_id, "totally not json {{{")
    # Expectation: SUCCESS-fall-through to architect dispatch (failure-safe).
    # If the @Catch swallowed an unexpected FAILURE we'd still see a yield;
    # what we MUST NOT see is an "error" kind.
    assert res2.kind == "yield", res2.to_dict()
    assert res2.dispatch_request.agent_type == "architect", \
        "MemCompact / arch dispatch should still run after triage failure"
