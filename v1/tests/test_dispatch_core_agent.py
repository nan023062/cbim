"""MF-4 (t5) regression — DispatchCoreAgent on_resume trailer parsing.

DispatchCoreAgent is the single-yield leaf shared by all three core-agent
branches (architect / hr / auditor). Its on_resume must:

  - parse the receipt trailer through parse_trailer
  - write the result under bb.work_results["core:<agent_type>"]
  - propagate failure_kind on status=failed
  - propagate question on status=needs_user_input
  - clear bb.pending_dispatch on resume

These tests cover the trailer field plumbing only; the dispatch yield
shape and re-tick short-circuit are exercised by test_bt_l2_tree.py.
"""
from __future__ import annotations

from types import SimpleNamespace

from engine.core.node import Status
from engine.execution.actions.core_agents import CORE_AGENT_FILES
from engine.execution.actions.dispatch_core_agent import DispatchCoreAgent


def _bb(**overrides) -> SimpleNamespace:
    bb = SimpleNamespace(
        tick_id="t",
        user_request="please audit the dispatcher",
        mode="audit",
        work_results={},
        pending_dispatch=None,
        trace=[],
    )
    for k, v in overrides.items():
        setattr(bb, k, v)
    return bb


def _receipt(*, status: str, agent: str = "architect",
             task_id: str = "core:architect",
             summary: str = "stub",
             question: str | None = None,
             failure_kind: str | None = None,
             extra_lines: tuple[str, ...] = ()) -> str:
    lines = [
        "<!-- BEGIN CBIM-RECEIPT v1",
        f"status: {status}",
        f"task_id: {task_id}",
        f"agent: {agent}",
        f"summary: {summary}",
    ]
    if question is not None:
        lines.append(f"question: {question}")
    if failure_kind is not None:
        lines.append(f"failure_kind: {failure_kind}")
    lines.extend(extra_lines)
    lines.append("END CBIM-RECEIPT -->")
    return "Body prose.\n" + "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# First-tick yield — sanity that the architect path produces the canonical
# DispatchRequest. Reuse the architect agent_type for all subsequent cases.
# ---------------------------------------------------------------------------

def test_tick_first_call_yields_core_dispatch():
    bb = _bb()
    leaf = DispatchCoreAgent(agent_type="architect")
    assert leaf.tick(bb) is Status.RUNNING
    dr = bb.pending_dispatch
    assert dr is not None
    assert dr.agent_type == "architect"
    assert dr.agent_file == CORE_AGENT_FILES["architect"]
    assert dr.subtask_id == "core:architect"


# ---------------------------------------------------------------------------
# on_resume — happy path
# ---------------------------------------------------------------------------

def test_on_resume_ok_writes_work_results_under_namespaced_key():
    bb = _bb()
    leaf = DispatchCoreAgent(agent_type="architect")
    leaf.tick(bb)
    leaf.on_resume(bb, _receipt(status="ok", summary="reviewed"))
    entry = bb.work_results["core:architect"]
    assert entry["status"] == "ok"
    assert entry["summary"] == "reviewed"
    assert entry["agent"] == "architect"
    assert bb.pending_dispatch is None


def test_on_resume_short_circuits_on_re_tick_when_ok():
    bb = _bb()
    leaf = DispatchCoreAgent(agent_type="architect")
    leaf.tick(bb)
    leaf.on_resume(bb, _receipt(status="ok"))
    # Next tick must see the result and resolve SUCCESS without re-yielding.
    assert leaf.tick(bb) is Status.SUCCESS
    assert bb.pending_dispatch is None


# ---------------------------------------------------------------------------
# MF-4 (t5) — failed status must propagate failure_kind
# ---------------------------------------------------------------------------

def test_on_resume_failed_propagates_failure_kind():
    bb = _bb()
    leaf = DispatchCoreAgent(agent_type="architect")
    leaf.tick(bb)
    leaf.on_resume(
        bb,
        _receipt(
            status="failed",
            summary="gave up",
            failure_kind="tool_error",
        ),
    )
    entry = bb.work_results["core:architect"]
    assert entry["status"] == "failed"
    assert entry["failure_kind"] == "tool_error"
    assert entry["summary"] == "gave up"
    # A failed core-agent result must short-circuit to FAILURE on next tick.
    assert leaf.tick(bb) is Status.FAILURE


def test_on_resume_failed_with_other_failure_kind():
    bb = _bb()
    leaf = DispatchCoreAgent(agent_type="hr")
    leaf.tick(bb)
    leaf.on_resume(
        bb,
        _receipt(
            status="failed",
            agent="hr",
            task_id="core:hr",
            summary="hr ran out of candidates",
            failure_kind="other",
        ),
    )
    entry = bb.work_results["core:hr"]
    assert entry["status"] == "failed"
    assert entry["failure_kind"] == "other"


# ---------------------------------------------------------------------------
# MF-4 (t5) — needs_user_input must propagate question
# ---------------------------------------------------------------------------

def test_on_resume_needs_user_input_propagates_question():
    bb = _bb()
    leaf = DispatchCoreAgent(agent_type="architect")
    leaf.tick(bb)
    leaf.on_resume(
        bb,
        _receipt(
            status="needs_user_input",
            summary="need clarification",
            question="which auth provider should I design for?",
        ),
    )
    entry = bb.work_results["core:architect"]
    assert entry["status"] == "needs_user_input"
    assert entry["question"] == "which auth provider should I design for?"
    # needs_user_input is the core agent's "I finished my turn, please
    # answer this clarifying question" signal — NOT a failure. The leaf
    # must return SUCCESS so the parent Sequence advances to the
    # downstream SwitchBranch (CoreReplyGate#<type>), which routes to
    # Respond(mode='need_user') to render the question. A FAILURE here
    # would short-circuit the Sequence and the question would be lost.
    assert leaf.tick(bb) is Status.SUCCESS


def test_on_resume_payload_can_be_dict_with_output_key():
    bb = _bb()
    leaf = DispatchCoreAgent(agent_type="auditor")
    leaf.tick(bb)
    leaf.on_resume(
        bb,
        {"output": _receipt(
            status="ok",
            agent="auditor",
            task_id="core:auditor",
            summary="audit complete",
        )},
    )
    entry = bb.work_results["core:auditor"]
    assert entry["status"] == "ok"
    assert entry["agent"] == "auditor"


def test_on_resume_preserves_extras():
    bb = _bb()
    leaf = DispatchCoreAgent(agent_type="architect")
    leaf.tick(bb)
    leaf.on_resume(
        bb,
        _receipt(
            status="ok",
            extra_lines=("custom_field: custom_value",),
        ),
    )
    entry = bb.work_results["core:architect"]
    assert entry["extras"].get("custom_field") == "custom_value"
