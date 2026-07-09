"""PR-C — integration shape tests for the WorkLoop + EscalationGate region.

Covers spec §10.2 cases 18-22. Topology assertions run against the real
ROOT; behavioural tests build a minimal sub-tree (WorkLoop +
EscalationGate) so they can pre-seed bb.work_results without re-running
the architect-execution chain.
"""
from __future__ import annotations

from types import SimpleNamespace

from engine.core.composite import LoopSeq, Sequence, SwitchBranch
from engine.core.node import Node, Status
from engine.execution.actions.arch_exec_yield import ArchExecYield
from engine.execution.actions.converge_judge import (
    DEFAULT_MAX_ITERS,
    ConvergeJudge,
)
from engine.execution.actions.dispatch_work import DispatchWork
from engine.execution.actions.respond import Respond
from engine.execution.tree.main_loop import ROOT, _converge_key


def _walk(n, acc=None):
    acc = acc if acc is not None else []
    acc.append(n)
    for ch in n.children():
        _walk(ch, acc)
    return acc


def _find(name: str) -> Node:
    for n in _walk(ROOT):
        if n.name == name:
            return n
    raise AssertionError(f"node not found in ROOT: {name}")


# ---------------------------------------------------------------------------
# Case 18: WorkLoop has [ArchExecYield, DispatchWork, ArchCheckGate,
# ConvergeJudge] (v3.9: ArchCheckGate inserted between DispatchWork and
# ConvergeJudge so the architectural compliance check happens before
# convergence judgement).
# ---------------------------------------------------------------------------

def test_workloop_children_in_order():
    wl = _find("WorkLoop")
    assert isinstance(wl, LoopSeq)
    assert [c.name for c in wl.children()] == [
        "ArchExecYield", "DispatchWork", "ArchCheckGate", "ConvergeJudge",
    ]
    # max_iters lines up with the module constant.
    assert wl._max_iters == DEFAULT_MAX_ITERS  # noqa: SLF001 — structural


# ---------------------------------------------------------------------------
# Case 19: EscalationGate has exactly three cases + default
# ---------------------------------------------------------------------------

def test_escalation_gate_cases():
    gate = _find("EscalationGate")
    assert isinstance(gate, SwitchBranch)
    cases = gate._cases  # noqa: SLF001
    assert set(cases.keys()) == {"done", "user_input", "exhausted"}
    assert cases["done"].name == "Respond"
    assert cases["user_input"].name == "Respond#need_user"
    assert cases["exhausted"].name == "Respond#exhausted"
    # default points to the same Respond instance used by "done".
    assert gate._default is cases["done"]  # noqa: SLF001


# ---------------------------------------------------------------------------
# Behavioural — minimal sub-tree
# ---------------------------------------------------------------------------

def _mini_tree():
    """Build [WorkLoop[NoOpArch, DispatchWork, ConvergeJudge], EscalationGate].

    Uses a no-op arch stand-in (always SUCCESS) so the architect subtree
    is out of the equation; pre-seeding bb.work_results means DispatchWork
    short-circuits each leaf via the "result already present" path.
    """
    class _NoOp(Node):
        name = "NoOpArch"

        def tick(self, _bb) -> Status:
            return Status.SUCCESS

    respond = Respond(name="Respond")
    respond_need_user = Respond(name="Respond#need_user", mode="need_user")
    respond_exhausted = Respond(name="Respond#exhausted", mode="exhausted")

    judge = ConvergeJudge(max_iters=DEFAULT_MAX_ITERS, name="ConvergeJudge")
    work_loop = LoopSeq(
        [_NoOp(), DispatchWork(name="DispatchWork"), judge],
        max_iters=DEFAULT_MAX_ITERS,
        name="WorkLoop",
    )
    gate = SwitchBranch(
        key_fn=_converge_key,
        cases={
            "done":       respond,
            "user_input": respond_need_user,
            "exhausted":  respond_exhausted,
        },
        default=respond,
        name="EscalationGate",
    )
    return Sequence([work_loop, gate], name="MiniExec")


def _mini_bb(arch_plan, work_results) -> SimpleNamespace:
    bb = SimpleNamespace()
    bb.tick_id = "mini"
    bb.user_request = ""
    bb.mode = "execution"
    bb.arch_plan = arch_plan
    bb.work_results = work_results
    bb.final_response = None
    bb.interrupt_reason = None
    bb.trace = []
    bb.runner_resume_path = None
    bb.work_loop_iter = None
    bb.convergence = None
    bb.arch_redo_context = None
    bb.pending_dispatch = None
    bb.bb_status = None
    return bb


# ---------------------------------------------------------------------------
# Case 20: all-ok work_results → done branch consolidates work output
# ---------------------------------------------------------------------------

def test_done_branch_renders_consolidated_work_output():
    tree = _mini_tree()
    bb = _mini_bb(
        arch_plan=[{"id": "t1"}, {"id": "t2"}],
        work_results={
            "t1": {"status": "ok", "output": "first answer", "agent": "p"},
            "t2": {"status": "ok", "output": "second answer", "agent": "p"},
        },
    )
    assert tree.tick(bb) is Status.SUCCESS
    assert bb.convergence == "done"
    assert bb.final_response == "first answer\n\n---\n\nsecond answer"


# ---------------------------------------------------------------------------
# Case 21: needs_user_input → Respond#need_user banner
# ---------------------------------------------------------------------------

def test_user_input_branch_renders_pause_banner():
    tree = _mini_tree()
    bb = _mini_bb(
        arch_plan=[{"id": "t1"}],
        work_results={
            "t1": {
                "status": "needs_user_input",
                "output": "ignored prose",
                "agent": "programmer",
                "summary": "need clarification on field X",
                "question": "Should X be int or str?",
            },
        },
    )
    assert tree.tick(bb) is Status.SUCCESS
    assert bb.convergence == "user_input"
    assert bb.final_response is not None
    assert bb.final_response.startswith("我需要你的确认才能继续")
    assert "Should X be int or str?" in bb.final_response
    assert "【任务 t1 - programmer】" in bb.final_response


# ---------------------------------------------------------------------------
# Case 22: needs_arch_decision pre-seeded to final iter → exhausted branch
# ---------------------------------------------------------------------------

def test_exhausted_branch_renders_handoff_banner():
    tree = _mini_tree()
    bb = _mini_bb(
        arch_plan=[{"id": "t1"}],
        work_results={
            "t1": {
                "status": "needs_arch_decision",
                "output": "raw output",
                "agent": "programmer",
                "summary": "spec missing",
                "question": "What schema for field Z?",
                "blocking_module": "v1/kernel/engine/exec",
            },
        },
    )
    # Force the loop to enter at its last allowed iter so ConvergeJudge
    # yields "exhausted" instead of "arch_redo".
    bb.work_loop_iter = DEFAULT_MAX_ITERS
    bb._loopseq_WorkLoop_iter = DEFAULT_MAX_ITERS

    assert tree.tick(bb) is Status.SUCCESS
    assert bb.convergence == "exhausted"
    assert bb.final_response is not None
    assert bb.final_response.startswith(f"我尝试了 {DEFAULT_MAX_ITERS} 轮架构师")
    assert "What schema for field Z?" in bb.final_response
    assert "v1/kernel/engine/exec" in bb.final_response
    assert "(a) 给架构师补充关键信息后重试" in bb.final_response


# ---------------------------------------------------------------------------
# Regression canaries — exercise the real ArchExecYield leaf inside the
# WorkLoop + EscalationGate sub-tree so the three fixes (malformed-reply
# routes to user_input, multi-line arch_plan parses, architect persona
# carries execution mode) cannot silently regress.
#
# Why integration-level: the prior leaf-only test
# `test_on_resume_with_malformed_json_yields_empty_plan` enshrined the
# old silent-empty-plan behavior. Only ticking the whole sub-tree proves
# the loop actually surfaces user_input via EscalationGate instead of
# falling through to a fake "done" with "(empty response)".
# ---------------------------------------------------------------------------

def _mini_tree_with_arch_yield():
    """Same shape as _mini_tree but with a real ArchExecYield first child."""
    respond = Respond(name="Respond")
    respond_need_user = Respond(name="Respond#need_user", mode="need_user")
    respond_exhausted = Respond(name="Respond#exhausted", mode="exhausted")

    arch = ArchExecYield(name="ArchExecYield")
    judge = ConvergeJudge(max_iters=DEFAULT_MAX_ITERS, name="ConvergeJudge")
    work_loop = LoopSeq(
        [arch, DispatchWork(name="DispatchWork"), judge],
        max_iters=DEFAULT_MAX_ITERS,
        name="WorkLoop",
    )
    gate = SwitchBranch(
        key_fn=_converge_key,
        cases={
            "done":       respond,
            "user_input": respond_need_user,
            "exhausted":  respond_exhausted,
        },
        default=respond,
        name="EscalationGate",
    )
    return arch, Sequence([work_loop, gate], name="MiniExec")


# Malformed reply: status=ok, all required base fields present, but NO
# arch_plan line at all. Pre-fix this collapsed to bb.arch_plan=[],
# convergence unset → "done" branch → Respond renders "(empty response)".
# Post-fix: ArchExecYield seeds convergence="user_input" + a synthetic
# needs_user_input work_results entry so EscalationGate routes to
# Respond#need_user.
_MALFORMED_REPLY = (
    "Body prose.\n"
    "<!-- BEGIN CBIM-RECEIPT v1\n"
    "status: ok\n"
    "task_id: arch:1\n"
    "agent: architect\n"
    "summary: stub\n"
    "END CBIM-RECEIPT -->\n"
)


def test_malformed_arch_reply_routes_to_user_input_not_done():
    arch, tree = _mini_tree_with_arch_yield()
    bb = _mini_bb(arch_plan=None, work_results={})
    bb.user_request = "implement login form"
    bb.retrieved_context = None

    # First tick drives ArchExecYield → RUNNING with pending_dispatch set.
    assert tree.tick(bb) is Status.RUNNING
    assert bb.pending_dispatch is not None
    assert bb.pending_dispatch.agent_type == "architect"

    # Architect (simulated) returns a malformed receipt — status=ok but
    # no arch_plan trailer field.
    arch.on_resume(bb, _MALFORMED_REPLY)

    # Re-tick. WorkLoop re-enters at child 0: ArchExecYield sees
    # bb.arch_plan == [] (a list) → SUCCESS. DispatchWork sees empty
    # plan → SUCCESS. ConvergeJudge sees needs_user_input in
    # work_results → leaves convergence="user_input". EscalationGate
    # routes to Respond#need_user.
    assert tree.tick(bb) is Status.SUCCESS

    # (a) Convergence is user_input, not the silent "done".
    assert bb.convergence == "user_input"
    # (b) Banner is the Respond#need_user header.
    assert bb.final_response is not None
    assert bb.final_response.startswith("我需要你的确认才能继续")
    # (c) Definitely NOT the empty-response fallback that the old bug
    # produced.
    assert bb.final_response != "(empty response)"


# Multi-line arch_plan: the JSON value opens with [ on the trailer key
# line, then one task object pretty-printed across 5 lines, then a
# closing ]. Pre-fix the parser treated each new key: line as a fresh
# trailer field, so the value collapsed to "[" and json.loads failed.
# Post-fix _looks_like_new_field gates on identifier-shaped prefixes only,
# so JSON-internal "key": lines and the bare [/] brackets are correctly
# appended as continuation.
_MULTILINE_REPLY = (
    "<!-- BEGIN CBIM-RECEIPT v1\n"
    "status: ok\n"
    "task_id: arch:1\n"
    "agent: architect\n"
    "summary: stub\n"
    "arch_plan: [\n"
    "  {\n"
    '    "id": "t1", "description": "implement login form",\n'
    '    "required_capability": "programmer",\n'
    '    "params": {}, "arch_context": "ctx-login"\n'
    "  }\n"
    "]\n"
    "END CBIM-RECEIPT -->\n"
)


# ---------------------------------------------------------------------------
# arch_redo dead-loop regression — end-to-end through the mini sub-tree.
#
# Prior to the ArchExecYield stale-plan fix, this exact scenario would
# silently spin WorkLoop to max_iters: iter 1 arch dispatch OK, work
# agent returns needs_arch_decision → ConvergeJudge decides arch_redo →
# LoopSeq bumps to iter 2 → ArchExecYield sees bb.arch_plan (stale from
# iter 1) is not None → short-circuits SUCCESS without ever re-yielding
# to the architect. Post-fix: iter 2 re-enters ArchExecYield, detects
# the stale plan via arch_redo_context.iter < work_loop_iter, clears it,
# and yields a fresh architect dispatch (subtask_id="arch:2").
# ---------------------------------------------------------------------------

def _arch_receipt(plan_json: str, task_id: str = "arch:1") -> str:
    return (
        "<!-- BEGIN CBIM-RECEIPT v1\n"
        "status: ok\n"
        f"task_id: {task_id}\n"
        "agent: architect\n"
        "summary: stub\n"
        f"arch_plan: {plan_json}\n"
        "END CBIM-RECEIPT -->\n"
    )


def _work_receipt_needs_arch(task_id: str) -> str:
    return (
        "<!-- BEGIN CBIM-RECEIPT v1\n"
        f"task_id: {task_id}\n"
        "agent: programmer\n"
        "status: needs_arch_decision\n"
        "summary: schema missing\n"
        "question: which schema for field Z?\n"
        "blocking_module: v1/foo\n"
        "END CBIM-RECEIPT -->\n"
    )


def test_arch_redo_reyields_to_architect_not_dead_loops():
    """WorkLoop must re-yield the architect on arch_redo — the whole
    point of the redo mechanism. Regression pin for the stale-plan
    short-circuit dead loop."""
    from engine.execution.actions.dispatch_work import WorkAgentLeaf

    arch, tree = _mini_tree_with_arch_yield()
    bb = _mini_bb(arch_plan=None, work_results={})
    bb.user_request = "implement x"
    bb.retrieved_context = None

    # Tick 1 — ArchExecYield yields architect (subtask arch:1).
    assert tree.tick(bb) is Status.RUNNING
    assert bb.pending_dispatch is not None
    assert bb.pending_dispatch.agent_type == "architect"
    assert bb.pending_dispatch.subtask_id == "arch:1"

    # Feed architect's iter-1 plan.
    iter1_plan_json = (
        '[{"id":"t1","description":"impl x",'
        '"required_capability":"programmer","params":{},'
        '"arch_context":"iter1-ctx"}]'
    )
    arch.on_resume(bb, _arch_receipt(iter1_plan_json, task_id="arch:1"))
    assert bb.arch_plan == [{
        "id": "t1", "description": "impl x",
        "required_capability": "programmer",
        "params": {"touched_modules": []},
        "arch_context": "iter1-ctx",
    }]

    # Tick 2 — DispatchWork yields work agent for t1.
    assert tree.tick(bb) is Status.RUNNING
    assert bb.pending_dispatch is not None
    assert bb.pending_dispatch.agent_type == "work"
    assert bb.pending_dispatch.subtask_id == "t1"

    # Work agent replies with needs_arch_decision — will trigger arch_redo
    # in ConvergeJudge (iter 1 < max_iters).
    WorkAgentLeaf(task_id="t1").on_resume(bb, _work_receipt_needs_arch("t1"))
    assert bb.work_results["t1"]["status"] == "needs_arch_decision"

    # Tick 3 — the critical one. Sequence:
    #   ArchExecYield.tick  → plan present (iter-1), ctx=None → SUCCESS.
    #   DispatchWork.tick   → work_results[t1] present → SUCCESS.
    #   ConvergeJudge.tick  → needs_arch_decision @ iter 1, stashes
    #                          arch_redo_context.iter=1, purges, returns
    #                          FAILURE.
    #   LoopSeq             → bumps work_loop_iter to 2, re-enters.
    #   ArchExecYield.tick  → plan still set BUT stale (ctx.iter=1 <
    #                          work_loop_iter=2). Post-fix: clears plan
    #                          and yields architect subtask arch:2.
    status = tree.tick(bb)
    assert status is Status.RUNNING, (
        "arch_redo did NOT re-yield to architect — WorkLoop is dead-looping. "
        f"convergence={bb.convergence!r} work_loop_iter={bb.work_loop_iter} "
        f"arch_plan={bb.arch_plan!r}"
    )
    assert bb.pending_dispatch is not None
    assert bb.pending_dispatch.agent_type == "architect"
    assert bb.pending_dispatch.subtask_id == "arch:2", (
        "expected iter-2 architect subtask; got "
        f"{bb.pending_dispatch.subtask_id!r}"
    )
    assert bb.arch_plan is None, (
        "stale iter-1 plan should have been cleared before the yield"
    )
    # And the redo context must still be present at this point — it's
    # about to be rendered into the architect's redo prompt.
    assert bb.arch_redo_context is not None
    assert bb.arch_redo_context["iter"] == 1

    # Feed architect's iter-2 plan.
    iter2_plan_json = (
        '[{"id":"t1b","description":"revised task",'
        '"required_capability":"programmer","params":{},'
        '"arch_context":"iter2-ctx"}]'
    )
    arch.on_resume(bb, _arch_receipt(iter2_plan_json, task_id="arch:2"))

    # on_resume must have consumed arch_redo_context — otherwise the next
    # tick would wipe the fresh plan we just wrote.
    assert bb.arch_redo_context is None
    assert bb.arch_plan and bb.arch_plan[0]["id"] == "t1b"


def test_multiline_arch_plan_parses_through_sub_tree():
    arch, tree = _mini_tree_with_arch_yield()
    bb = _mini_bb(arch_plan=None, work_results={})
    bb.user_request = "implement login form"
    bb.retrieved_context = None

    # First tick → architect dispatch yields RUNNING.
    assert tree.tick(bb) is Status.RUNNING

    # Architect (simulated) returns a well-formed but pretty-printed
    # multi-line arch_plan value.
    arch.on_resume(bb, _MULTILINE_REPLY)

    # The leaf-level assertion: parser handled the continuation lines.
    assert isinstance(bb.arch_plan, list)
    assert len(bb.arch_plan) == 1
    task = bb.arch_plan[0]
    assert task["id"] == "t1"
    assert task["description"] == "implement login form"
    assert task["required_capability"] == "programmer"
    assert task["arch_context"] == "ctx-login"

    # And the integration-level corroboration: re-ticking advances past
    # ArchExecYield into DispatchWork, which now has a real task to fan
    # out — so it yields a work-agent dispatch (RUNNING). This proves
    # the parsed plan flows downstream, not just that the JSON decoded.
    assert tree.tick(bb) is Status.RUNNING
    assert bb.pending_dispatch is not None
    assert bb.pending_dispatch.agent_type == "work"
    assert bb.pending_dispatch.subtask_id == "t1"
