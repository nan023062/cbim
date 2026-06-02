"""PR-C — Blackboard `_extras` persistence round-trip tests.

Covers spec §10.3 cases 23-25.
"""
from __future__ import annotations

from engine.core.blackboard import SCHEMA_VERSION, Blackboard


# ---------------------------------------------------------------------------
# Case 23: round-trip with work_loop_iter + arch_redo_context
# ---------------------------------------------------------------------------

def test_extras_round_trip_preserves_pr_c_scratch_fields():
    bb = Blackboard()
    bb.tick_id = "rt-1"
    bb.user_request = "hi"
    bb.mode = "execution"
    bb.arch_plan = [{"id": "t1"}]
    # PR-C scratch fields ride on bb.__dict__
    bb.work_loop_iter = 2
    bb._loopseq_WorkLoop_iter = 2
    bb.arch_redo_context = {
        "iter": 2,
        "unresolved": [{
            "task_id": "t1",
            "blocking_module": "v1/x",
            "question": "what now?",
            "agent": "programmer",
            "summary": "stuck",
        }],
        "previous_plan": [{"id": "t1"}],
    }
    bb.convergence = "arch_redo"

    raw = bb.to_dict()
    # Extras key is present and inside fields.
    assert "_extras" in raw["fields"], f"missing _extras: {raw['fields']}"
    extras = raw["fields"]["_extras"]
    assert extras["work_loop_iter"] == 2
    assert extras["_loopseq_WorkLoop_iter"] == 2
    assert extras["convergence"] == "arch_redo"
    assert extras["arch_redo_context"]["iter"] == 2

    bb2 = Blackboard.from_dict(raw)
    assert bb2.work_loop_iter == 2
    assert getattr(bb2, "_loopseq_WorkLoop_iter") == 2
    assert bb2.convergence == "arch_redo"
    assert bb2.arch_redo_context == bb.arch_redo_context


# ---------------------------------------------------------------------------
# Case 24: from_dict on an old snapshot lacking _extras is a no-op
# ---------------------------------------------------------------------------

def test_from_dict_without_extras_is_noop():
    old_snapshot = {
        "schema_version": SCHEMA_VERSION,
        "tick_id": "old-1",
        "created_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
        "bb_status": "running",
        "fields": {
            "tick_id": "old-1",
            "user_request": "hello",
            "mode": "conversation",
        },
    }
    bb = Blackboard.from_dict(old_snapshot)
    assert bb.tick_id == "old-1"
    assert bb.user_request == "hello"
    assert bb.mode == "conversation"
    # No extras → these are unset (None).
    assert getattr(bb, "work_loop_iter", None) is None
    assert getattr(bb, "convergence", None) is None
    assert getattr(bb, "arch_redo_context", None) is None


# ---------------------------------------------------------------------------
# Case 25: schema_version is unchanged (additive extras stay backward-readable)
# ---------------------------------------------------------------------------

def test_schema_version_unchanged_by_extras():
    bb = Blackboard()
    bb.tick_id = "sv"
    bb.convergence = "done"
    bb.work_loop_iter = 1
    raw = bb.to_dict()
    assert raw["schema_version"] == SCHEMA_VERSION == 4


def test_extras_not_emitted_when_no_scratch_set():
    bb = Blackboard()
    bb.tick_id = "no-extras"
    raw = bb.to_dict()
    # Pure canonical fields only — _extras must not appear.
    assert "_extras" not in raw["fields"]


# NOTE: the former `test_extras_round_trip_preserves_arch_subtree_state`
# test was removed alongside schema v4 — it asserted round-trip
# persistence of `arch_plan_draft / arch_state / arch_scan_summary`,
# which were dropped from `_PERSISTED_EXTRAS` when the in-process
# architect subtree was retired in v3.6. The remaining extras
# (convergence / arch_redo_context / work_loop_iter / retrieved_context)
# are exercised by the round-trip tests above.


# ---------------------------------------------------------------------------
# RI-7 (t?) regression — schema_version=3 backwards compatibility.
#
# Old snapshots persisted scratch fields that were dropped from
# _PERSISTED_EXTRAS in v3.6 (arch_plan_draft / arch_state /
# arch_scan_summary / hr_agent_inventory / …). from_dict must:
#   (a) not raise on the old schema_version=3 envelope
#   (b) instantiate a Blackboard
#   (c) on the next to_dict, emit schema_version=4 and drop the
#       deprecated extras entirely — they must not leak back into
#       persistence and re-pollute the snapshot.
# ---------------------------------------------------------------------------

def test_from_dict_loads_schema_v3_with_dropped_extras_without_raising():
    old_snapshot = {
        "schema_version": 3,
        "tick_id": "legacy-1",
        "created_at": "2025-11-01T00:00:00",
        "updated_at": "2025-11-01T00:00:00",
        "bb_status": "running",
        "fields": {
            "tick_id": "legacy-1",
            "user_request": "implement login",
            "mode": "execution",
            "arch_plan": [{"id": "t1"}],
            "_extras": {
                # Live extras that ARE still on the allowlist.
                "convergence": "arch_redo",
                "work_loop_iter": 2,
                # Dead extras dropped from _PERSISTED_EXTRAS in v3.6.
                "arch_plan_draft": [{"id": "stale"}],
                "arch_state": "scanning",
                "arch_scan_summary": "old summary",
                "hr_agent_inventory": [{"name": "old-agent"}],
            },
        },
    }
    bb = Blackboard.from_dict(old_snapshot)
    # (a) + (b) — load succeeds and yields a Blackboard.
    assert isinstance(bb, Blackboard)
    assert bb.tick_id == "legacy-1"
    assert bb.user_request == "implement login"
    assert bb.mode == "execution"
    # Live extras survive the round-trip.
    assert bb.convergence == "arch_redo"
    assert bb.work_loop_iter == 2


def test_to_dict_after_v3_load_writes_v4_and_drops_deprecated_extras():
    old_snapshot = {
        "schema_version": 3,
        "tick_id": "legacy-2",
        "created_at": "2025-11-01T00:00:00",
        "updated_at": "2025-11-01T00:00:00",
        "bb_status": "running",
        "fields": {
            "tick_id": "legacy-2",
            "user_request": "x",
            "mode": "execution",
            "_extras": {
                "convergence": "done",
                "arch_plan_draft": [{"id": "stale"}],
                "hr_agent_inventory": [{"name": "ghost"}],
                "arch_state": "scanning",
                "arch_scan_summary": "old",
            },
        },
    }
    bb = Blackboard.from_dict(old_snapshot)
    raw = bb.to_dict()

    # (c1) — schema bumped to current version on rewrite.
    assert raw["schema_version"] == SCHEMA_VERSION == 4

    # (c2) — deprecated extras must not appear in the rewritten snapshot.
    extras = raw["fields"].get("_extras", {})
    for dead_key in (
        "arch_plan_draft",
        "arch_state",
        "arch_scan_summary",
        "hr_agent_inventory",
    ):
        assert dead_key not in extras, \
            f"deprecated extra {dead_key!r} leaked back into persistence: {extras}"

    # Live extras still ride along (sanity).
    assert extras.get("convergence") == "done"


def test_from_dict_loads_v3_snapshot_without_extras_key():
    # An even older variant where the snapshot has no _extras at all.
    old_snapshot = {
        "schema_version": 3,
        "tick_id": "legacy-3",
        "created_at": "2025-01-01T00:00:00",
        "updated_at": "2025-01-01T00:00:00",
        "bb_status": "running",
        "fields": {
            "tick_id": "legacy-3",
            "user_request": "hi",
            "mode": "conversation",
        },
    }
    bb = Blackboard.from_dict(old_snapshot)
    assert bb.mode == "conversation"
    assert getattr(bb, "convergence", None) is None
    raw = bb.to_dict()
    assert raw["schema_version"] == 4
    # No scratch fields were set, so _extras must not appear.
    assert "_extras" not in raw["fields"]
