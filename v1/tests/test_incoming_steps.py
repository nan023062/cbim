"""Unit tests for the Phase-5 incoming-queue triage leaves.

Covers IncomingScan / DispatchIncomingTriage / CollectIncomingTriage
in isolation (no Runner, no MCP).
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest

from engine.core.node import Status
from engine.dream.actions.collect_incoming_triage import CollectIncomingTriage
from engine.dream.actions.dispatch_incoming_triage import DispatchIncomingTriage
from engine.dream.actions.incoming_steps import IncomingScan
from engine.dream.core.blackboard import DreamBlackboard


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def bb() -> DreamBlackboard:
    b = DreamBlackboard()
    b.run_id = "test-run"
    return b


def _seed_jsonl(parent: Path, name: str, lines: list[dict]) -> Path:
    parent.mkdir(parents=True, exist_ok=True)
    p = parent / name
    body = "\n".join(json.dumps(d, ensure_ascii=False) for d in lines) + "\n"
    p.write_text(body, encoding="utf-8")
    return p


def _frozen_now(stamp: str):
    """Return a callable mimicking datetime.now → datetime parsed from stamp."""
    return lambda: datetime.strptime(stamp, "%Y-%m-%d")


# ---------------------------------------------------------------------------
# IncomingScan
# ---------------------------------------------------------------------------


def test_scan_no_dir_skips(bb, tmp_path):
    node = IncomingScan(store_dir=tmp_path, now_func=_frozen_now("2026-06-15"))
    assert node.tick(bb) is Status.SUCCESS
    assert bb.incoming_paths == []
    assert bb.incoming_triage_dispatched is False
    assert bb.incoming_triage_result == {
        "skipped": True,
        "reason": "no_incoming_dir",
    }


def test_scan_excludes_today_file(bb, tmp_path):
    incoming = tmp_path / "medium" / "incoming"
    today = _seed_jsonl(incoming, "2026-06-15.jsonl", [{"category": "decision"}])
    older = _seed_jsonl(incoming, "2026-06-13.jsonl", [{"category": "rule"}])

    node = IncomingScan(store_dir=tmp_path, now_func=_frozen_now("2026-06-15"))
    assert node.tick(bb) is Status.SUCCESS
    assert bb.incoming_paths == [str(older)]
    assert str(today) not in bb.incoming_paths
    assert bb.incoming_triage_dispatched is True
    assert bb.incoming_triage_result is None


def test_scan_only_today_file_present_skips(bb, tmp_path):
    incoming = tmp_path / "medium" / "incoming"
    _seed_jsonl(incoming, "2026-06-15.jsonl", [{"x": 1}])

    node = IncomingScan(store_dir=tmp_path, now_func=_frozen_now("2026-06-15"))
    assert node.tick(bb) is Status.SUCCESS
    assert bb.incoming_paths == []
    assert bb.incoming_triage_dispatched is False
    assert bb.incoming_triage_result == {
        "skipped": True,
        "reason": "no_mature_incoming",
    }


def test_scan_returns_paths_sorted_by_date(bb, tmp_path):
    incoming = tmp_path / "medium" / "incoming"
    p_b = _seed_jsonl(incoming, "2026-06-13.jsonl", [{"a": 1}])
    p_a = _seed_jsonl(incoming, "2026-06-12.jsonl", [{"b": 2}])
    p_c = _seed_jsonl(incoming, "2026-06-14.jsonl", [{"c": 3}])

    node = IncomingScan(store_dir=tmp_path, now_func=_frozen_now("2026-06-15"))
    assert node.tick(bb) is Status.SUCCESS
    assert bb.incoming_paths == [str(p_a), str(p_b), str(p_c)]


def test_scan_ignores_processed_subdir(bb, tmp_path):
    incoming = tmp_path / "medium" / "incoming"
    processed = incoming / "processed"
    _seed_jsonl(processed, "2026-06-10.jsonl", [{"old": True}])
    p_live = _seed_jsonl(incoming, "2026-06-13.jsonl", [{"live": True}])

    node = IncomingScan(store_dir=tmp_path, now_func=_frozen_now("2026-06-15"))
    assert node.tick(bb) is Status.SUCCESS
    assert bb.incoming_paths == [str(p_live)]


# ---------------------------------------------------------------------------
# DispatchIncomingTriage
# ---------------------------------------------------------------------------


def test_dispatch_short_circuits_when_scan_skipped(bb, tmp_path):
    bb.incoming_triage_dispatched = False
    bb.incoming_triage_result = {"skipped": True, "reason": "no_mature_incoming"}
    node = DispatchIncomingTriage(store_dir=tmp_path)
    assert node.tick(bb) is Status.SUCCESS
    assert bb.pending_dispatch is None


def test_dispatch_yields_when_paths_present(bb, tmp_path):
    incoming = tmp_path / "medium" / "incoming"
    _seed_jsonl(incoming, "2026-06-13.jsonl", [{"x": 1}])
    bb.incoming_paths = [str(incoming / "2026-06-13.jsonl")]
    bb.incoming_triage_dispatched = True
    bb.incoming_triage_result = None

    node = DispatchIncomingTriage(store_dir=tmp_path)
    assert node.tick(bb) is Status.RUNNING
    pd = bb.pending_dispatch
    assert pd is not None
    assert pd.agent_type == "main"
    assert pd.subtask_id == "governance_incoming_triage"
    assert pd.agent_file is None
    assert pd.prompt.lstrip().startswith("## 治理模式")
    # Path must show up in the prompt (json-encoded form).
    assert json.dumps(str(incoming / "2026-06-13.jsonl"), ensure_ascii=False) in pd.prompt


def test_dispatch_idempotent_when_result_present(bb, tmp_path):
    bb.incoming_triage_dispatched = True
    bb.incoming_triage_result = {"processed_paths": []}
    node = DispatchIncomingTriage(store_dir=tmp_path)
    assert node.tick(bb) is Status.SUCCESS
    assert bb.pending_dispatch is None


def test_dispatch_inline_overflow_falls_back_to_path_only(bb, tmp_path):
    incoming = tmp_path / "medium" / "incoming"
    incoming.mkdir(parents=True)
    big = incoming / "2026-06-13.jsonl"
    big.write_text("x" * (60 * 1024), encoding="utf-8")
    bb.incoming_paths = [str(big)]
    bb.incoming_triage_dispatched = True

    node = DispatchIncomingTriage(store_dir=tmp_path)
    assert node.tick(bb) is Status.RUNNING
    pd = bb.pending_dispatch
    assert "按需 Read" in pd.prompt or "按需读" in pd.prompt
    # Inline content should NOT have been embedded — the budget switch fired.
    assert "x" * 60 not in pd.prompt


# ---------------------------------------------------------------------------
# CollectIncomingTriage
# ---------------------------------------------------------------------------


def test_collect_no_payload_returns_failure_with_sentinel(bb, tmp_path):
    bb.incoming_triage_dispatched = True
    bb.incoming_triage_result = None

    node = CollectIncomingTriage(store_dir=tmp_path)
    assert node.tick(bb) is Status.FAILURE
    assert bb.incoming_triage_result == {
        "error": "no_payload_received",
        "skipped": False,
    }


def test_collect_already_collected_returns_success(bb, tmp_path):
    bb.incoming_triage_dispatched = True
    bb.incoming_triage_result = {"skipped": False, "processed_paths": []}
    node = CollectIncomingTriage(store_dir=tmp_path)
    assert node.tick(bb) is Status.SUCCESS


def test_collect_scan_skipped_branch(bb, tmp_path):
    bb.incoming_triage_dispatched = False
    bb.incoming_triage_result = None  # safety branch: scan should have written, but check default
    node = CollectIncomingTriage(store_dir=tmp_path)
    assert node.tick(bb) is Status.SUCCESS
    assert bb.incoming_triage_result == {
        "skipped": True,
        "reason": "scan_skipped",
    }


def test_collect_on_resume_success_moves_processed_files(bb, tmp_path):
    """Successful triage moves processed JSONLs to incoming/processed/."""
    incoming = tmp_path / "medium" / "incoming"
    p1 = _seed_jsonl(incoming, "2026-06-13.jsonl", [{"x": 1}])
    p2 = _seed_jsonl(incoming, "2026-06-14.jsonl", [{"y": 2}])

    bb.incoming_triage_dispatched = True
    bb.incoming_paths = [str(p1), str(p2)]

    payload = json.dumps({
        "processed_paths": [str(p1), str(p2)],
        "medium_entries_written": [str(tmp_path / "medium" / "incoming-2026-06-13-1.md")],
        "skipped_records": [],
        "errors": [],
    })

    node = CollectIncomingTriage(store_dir=tmp_path)
    node.on_resume(bb, payload)

    assert not p1.exists()
    assert not p2.exists()
    assert (incoming / "processed" / "2026-06-13.jsonl").exists()
    assert (incoming / "processed" / "2026-06-14.jsonl").exists()
    assert bb.incoming_triage_result["skipped"] is False
    archived = bb.incoming_triage_result["archived_paths"]
    assert len(archived) == 2


def test_collect_on_resume_business_errors_keep_files_in_place(bb, tmp_path):
    """Files reported in `errors` stay in incoming/ for next-tick retry."""
    incoming = tmp_path / "medium" / "incoming"
    p_ok = _seed_jsonl(incoming, "2026-06-13.jsonl", [{"x": 1}])
    p_bad = _seed_jsonl(incoming, "2026-06-14.jsonl", [{"y": 2}])

    bb.incoming_triage_dispatched = True
    bb.incoming_paths = [str(p_ok), str(p_bad)]

    # Agent reports p_bad as both processed and erroring — collector must
    # treat it as failed (don't archive). p_ok archives normally.
    payload = json.dumps({
        "processed_paths": [str(p_ok), str(p_bad)],
        "medium_entries_written": [],
        "skipped_records": [],
        "errors": [
            {"path": str(p_bad), "error": "memory_create returned 500"},
        ],
    })

    node = CollectIncomingTriage(store_dir=tmp_path)
    node.on_resume(bb, payload)

    # p_ok archived; p_bad still in place.
    assert not p_ok.exists()
    assert p_bad.exists()
    assert (incoming / "processed" / "2026-06-13.jsonl").exists()
    # Error path tickled in result; tick path must return SUCCESS for the
    # already-populated result branch (failure-safe semantic).
    assert bb.incoming_triage_result.get("errors")
    assert node.tick(bb) is Status.SUCCESS


def test_collect_on_resume_parse_failure_is_failure_safe(bb, tmp_path):
    """Garbled payload writes a sentinel but does NOT block downstream nodes."""
    bb.incoming_triage_dispatched = True
    node = CollectIncomingTriage(store_dir=tmp_path)
    node.on_resume(bb, "this is not json {{{")
    assert bb.incoming_triage_result is not None
    assert "error" in bb.incoming_triage_result
    assert bb.incoming_triage_result["skipped"] is False
    # Subsequent tick: result populated → SUCCESS, not FAILURE.
    assert node.tick(bb) is Status.SUCCESS


def test_collect_on_resume_non_dict_report(bb, tmp_path):
    """Wrapped report-key carrying non-dict surfaces the parser's error
    sentinel (parse_response writes the message, collect lifts it).
    Either branch (parse-time string or report_not_a_dict) writes a
    failure-safe sentinel; downstream tick returns SUCCESS regardless.
    """
    bb.incoming_triage_dispatched = True
    node = CollectIncomingTriage(store_dir=tmp_path)
    node.on_resume(bb, json.dumps({"incoming_triage_report": "not-a-dict"}))
    err = bb.incoming_triage_result.get("error") or ""
    assert err  # any truthy error sentinel is fine
    assert "dict" in err
    assert bb.incoming_triage_result["skipped"] is False
    assert node.tick(bb) is Status.SUCCESS


def test_collect_idempotent_after_files_already_moved(bb, tmp_path):
    """Re-resume on already-archived files must not blow up."""
    incoming = tmp_path / "medium" / "incoming"
    incoming.mkdir(parents=True)
    archived = incoming / "processed" / "2026-06-13.jsonl"
    archived.parent.mkdir(parents=True, exist_ok=True)
    archived.write_text('{"old": true}\n', encoding="utf-8")

    # Phantom incoming path: file is already gone.
    phantom = incoming / "2026-06-13.jsonl"

    bb.incoming_triage_dispatched = True
    payload = json.dumps({
        "processed_paths": [str(phantom)],
        "medium_entries_written": [],
        "skipped_records": [],
        "errors": [],
    })
    node = CollectIncomingTriage(store_dir=tmp_path)
    node.on_resume(bb, payload)

    assert bb.incoming_triage_result["skipped"] is False
    assert bb.incoming_triage_result["move_failures"] == []
