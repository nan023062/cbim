"""Unit tests for ArchExecYield (PR-D).

The leaf replaces the in-process nine-leaf arch_exec subtree with a
single yield to the architect agent. Coverage:

  1. First tick: yields a DispatchRequest targeting the architect agent
     with subtask_id="arch:<iter>".
  2. on_resume with a valid receipt trailer carrying arch_plan populates
     bb.arch_plan; the next tick is SUCCESS.
  3. on_resume with malformed JSON / missing fields → bb.arch_plan=[],
     no convergence override, next tick is SUCCESS (empty plan, treated
     by DispatchWork as a no-op).
  4. on_resume with status="needs_user_input" seeds bb.convergence so
     EscalationGate routes to Respond#need_user.
  5. Cap violation (>8 tasks) is a hard fail → bb.arch_plan=[].
"""
from __future__ import annotations

from types import SimpleNamespace

from engine.execution.actions.arch_exec_yield import (
    ARCHITECT_AGENT_FILE,
    ArchExecYield,
)
from engine.core.node import Status


def _bb(**overrides) -> SimpleNamespace:
    bb = SimpleNamespace(
        tick_id="t",
        user_request="implement login",
        mode="execution",
        arch_plan=None,
        work_results={},
        pending_dispatch=None,
        trace=[],
        convergence=None,
        arch_redo_context=None,
        work_loop_iter=None,
        retrieved_context=None,
    )
    for k, v in overrides.items():
        setattr(bb, k, v)
    return bb


def _receipt(arch_plan_json: str, *, status: str = "ok",
             question: str | None = None,
             task_id: str = "arch:1") -> str:
    lines = [
        "<!-- BEGIN CBIM-RECEIPT v1",
        f"status: {status}",
        f"task_id: {task_id}",
        "agent: architect",
        "summary: stub",
    ]
    if question:
        lines.append(f"question: {question}")
    if arch_plan_json is not None:
        lines.append(f"arch_plan: {arch_plan_json}")
    lines.append("END CBIM-RECEIPT -->")
    return "Body prose.\n" + "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Tick — first call yields
# ---------------------------------------------------------------------------

def test_tick_first_call_yields_architect_dispatch():
    bb = _bb()
    leaf = ArchExecYield()
    assert leaf.tick(bb) is Status.RUNNING
    dr = bb.pending_dispatch
    assert dr is not None
    assert dr.agent_type == "architect"
    assert dr.agent_file == ARCHITECT_AGENT_FILE
    assert dr.subtask_id == "arch:1"
    assert dr.prompt.startswith("## 执行模式 · ArchExec")


def test_tick_subtask_id_uses_work_loop_iter():
    bb = _bb(work_loop_iter=2)
    leaf = ArchExecYield()
    leaf.tick(bb)
    assert bb.pending_dispatch.subtask_id == "arch:2"


def test_tick_short_circuits_when_plan_present():
    bb = _bb(arch_plan=[{"id": "a1"}])
    leaf = ArchExecYield()
    assert leaf.tick(bb) is Status.SUCCESS
    assert bb.pending_dispatch is None


def test_tick_failure_when_plan_is_not_a_list():
    bb = _bb(arch_plan="not a list")
    leaf = ArchExecYield()
    assert leaf.tick(bb) is Status.FAILURE


# ---------------------------------------------------------------------------
# on_resume — happy path
# ---------------------------------------------------------------------------

def test_on_resume_with_valid_trailer_populates_arch_plan():
    bb = _bb()
    leaf = ArchExecYield()
    leaf.tick(bb)  # primes pending_dispatch
    plan_json = (
        '[{"id":"t1","description":"do thing",'
        '"required_capability":"programmer","params":{},'
        '"arch_context":"ctx-1"}]'
    )
    leaf.on_resume(bb, _receipt(plan_json))
    assert bb.pending_dispatch is None
    assert isinstance(bb.arch_plan, list)
    assert len(bb.arch_plan) == 1
    task = bb.arch_plan[0]
    assert task["id"] == "t1"
    assert task["required_capability"] == "programmer"
    assert task["arch_context"] == "ctx-1"
    # Second tick → SUCCESS, plan stays.
    assert leaf.tick(bb) is Status.SUCCESS


def test_on_resume_unknown_capability_collapses_to_generalist():
    bb = _bb()
    leaf = ArchExecYield()
    leaf.tick(bb)
    plan_json = (
        '[{"id":"t1","description":"x",'
        '"required_capability":"sorcerer","params":{},'
        '"arch_context":"c"}]'
    )
    leaf.on_resume(bb, _receipt(plan_json))
    assert bb.arch_plan[0]["required_capability"] == "generalist"


def test_on_resume_payload_can_be_dict_with_output_key():
    bb = _bb()
    leaf = ArchExecYield()
    leaf.tick(bb)
    plan_json = (
        '[{"id":"t1","description":"x",'
        '"required_capability":"programmer","params":{},'
        '"arch_context":"c"}]'
    )
    leaf.on_resume(bb, {"output": _receipt(plan_json)})
    assert bb.arch_plan and bb.arch_plan[0]["id"] == "t1"


# ---------------------------------------------------------------------------
# on_resume — failure paths
# ---------------------------------------------------------------------------

def test_on_resume_with_malformed_json_yields_empty_plan():
    bb = _bb()
    leaf = ArchExecYield()
    leaf.tick(bb)
    leaf.on_resume(bb, _receipt("[not valid json"))
    assert bb.arch_plan == []
    # Malformed plan must surface as user_input so EscalationGate routes
    # to Respond#need_user instead of letting WorkLoop fall through to a
    # fake 'done'.
    assert bb.convergence == "user_input"
    assert bb.work_results["arch:1"]["status"] == "needs_user_input"


def test_on_resume_with_missing_arch_context_fails_validation():
    bb = _bb()
    leaf = ArchExecYield()
    leaf.tick(bb)
    plan_json = (
        '[{"id":"t1","description":"x",'
        '"required_capability":"programmer","params":{},'
        '"arch_context":""}]'
    )
    leaf.on_resume(bb, _receipt(plan_json))
    assert bb.arch_plan == []
    assert bb.convergence == "user_input"
    assert bb.work_results["arch:1"]["status"] == "needs_user_input"


def test_on_resume_with_too_many_tasks_fails_validation():
    bb = _bb()
    leaf = ArchExecYield()
    leaf.tick(bb)
    items = ",".join(
        f'{{"id":"t{i}","description":"x",'
        f'"required_capability":"programmer","params":{{}},'
        f'"arch_context":"c"}}'
        for i in range(9)
    )
    leaf.on_resume(bb, _receipt(f"[{items}]"))
    assert bb.arch_plan == []
    assert bb.convergence == "user_input"
    assert bb.work_results["arch:1"]["status"] == "needs_user_input"


def test_on_resume_with_failed_status_yields_empty_plan():
    bb = _bb()
    leaf = ArchExecYield()
    leaf.tick(bb)
    leaf.on_resume(
        bb,
        "<!-- BEGIN CBIM-RECEIPT v1\n"
        "status: failed\n"
        "task_id: arch:1\n"
        "agent: architect\n"
        "summary: gave up\n"
        "failure_kind: other\n"
        "END CBIM-RECEIPT -->\n",
    )
    assert bb.arch_plan == []


# ---------------------------------------------------------------------------
# on_resume — needs_user_input fast-path
# ---------------------------------------------------------------------------

def test_on_resume_with_needs_user_input_sets_convergence():
    bb = _bb()
    leaf = ArchExecYield()
    leaf.tick(bb)
    leaf.on_resume(
        bb,
        _receipt(
            None,
            status="needs_user_input",
            question="which auth provider?",
        ),
    )
    assert bb.arch_plan == []
    assert bb.convergence == "user_input"
    entry = bb.work_results["arch:1"]
    assert entry["status"] == "needs_user_input"
    assert entry["question"] == "which auth provider?"


# ---------------------------------------------------------------------------
# arch_redo re-entry — regression for the WorkLoop dead-loop bug
#
# Prior to the fix, ConvergeJudge would decide arch_redo (returning
# FAILURE) and LoopSeq would bump work_loop_iter, but ArchExecYield's
# "plan is not None → SUCCESS" short-circuit swallowed the re-entry
# because nothing cleared the stale bb.arch_plan. WorkLoop then spun to
# max_iters never re-yielding to the architect, and the whole
# "architecture non-compliant → let the architect redo" mechanism was
# a no-op. These tests pin the fix: (a) ArchExecYield.tick detects the
# stale plan via arch_redo_context.iter < work_loop_iter and clears it
# before falling through to the yield block; (b) on_resume consumes
# arch_redo_context so the detection does NOT re-fire on the
# post-resume re-tick and wipe the fresh plan.
# ---------------------------------------------------------------------------

def test_tick_clears_stale_plan_on_redo_reentry_and_yields():
    """LoopSeq re-entry after arch_redo: stale plan must be cleared and
    the architect re-dispatched, not swallowed by the short-circuit."""
    bb = _bb(arch_plan=[{"id": "prev-t1"}])
    bb.arch_redo_context = {
        "iter": 1,
        "unresolved": [],
        "previous_plan": [{"id": "prev-t1"}],
    }
    bb.work_loop_iter = 2
    leaf = ArchExecYield()
    assert leaf.tick(bb) is Status.RUNNING
    assert bb.arch_plan is None  # stale plan wiped
    assert bb.pending_dispatch is not None
    assert bb.pending_dispatch.agent_type == "architect"
    assert bb.pending_dispatch.subtask_id == "arch:2"


def test_tick_does_not_clear_when_ctx_iter_equals_current():
    """Defensive: only iter STRICTLY less than current counts as stale.
    An equal iter (which shouldn't occur in production but is worth
    guarding against — race hypothesis, replay tests, etc.) leaves the
    plan alone."""
    bb = _bb(arch_plan=[{"id": "t1"}])
    bb.arch_redo_context = {"iter": 2, "unresolved": [], "previous_plan": []}
    bb.work_loop_iter = 2
    leaf = ArchExecYield()
    assert leaf.tick(bb) is Status.SUCCESS
    assert bb.arch_plan == [{"id": "t1"}]


def test_tick_ignores_malformed_arch_redo_context():
    """A non-dict / missing-iter context does NOT trip stale-plan
    clearing — the short-circuit fires normally."""
    bb = _bb(arch_plan=[{"id": "t1"}])
    bb.arch_redo_context = "not a dict"
    bb.work_loop_iter = 2
    leaf = ArchExecYield()
    assert leaf.tick(bb) is Status.SUCCESS
    assert bb.arch_plan == [{"id": "t1"}]

    bb2 = _bb(arch_plan=[{"id": "t1"}])
    bb2.arch_redo_context = {"unresolved": []}  # no iter key
    bb2.work_loop_iter = 2
    assert ArchExecYield().tick(bb2) is Status.SUCCESS
    assert bb2.arch_plan == [{"id": "t1"}]


def test_on_resume_clears_arch_redo_context_so_retick_short_circuits():
    """After on_resume writes a fresh plan, the very next tick must NOT
    re-clear it — the redo signal is consumed here."""
    bb = _bb(arch_plan=[{"id": "prev-t1"}])
    bb.arch_redo_context = {"iter": 1, "unresolved": [], "previous_plan": []}
    bb.work_loop_iter = 2
    leaf = ArchExecYield()

    # Tick 1: clears the stale plan and yields.
    assert leaf.tick(bb) is Status.RUNNING
    assert bb.arch_plan is None

    # Architect (simulated) replies with a valid iter-2 plan.
    plan_json = (
        '[{"id":"t1","description":"redo work",'
        '"required_capability":"programmer","params":{},'
        '"arch_context":"redo-ctx"}]'
    )
    leaf.on_resume(bb, _receipt(plan_json, task_id="arch:2"))

    # arch_redo_context consumed; fresh plan populated.
    assert bb.arch_redo_context is None
    assert isinstance(bb.arch_plan, list) and len(bb.arch_plan) == 1
    assert bb.arch_plan[0]["id"] == "t1"

    # Tick 2: plan is fresh, context cleared → short-circuit SUCCESS,
    # NO second wipe.
    assert leaf.tick(bb) is Status.SUCCESS
    assert bb.arch_plan and bb.arch_plan[0]["id"] == "t1"


def test_on_resume_clears_redo_context_on_all_reply_paths():
    """The context-consume applies regardless of reply status, so a
    'failed' / 'needs_user_input' / malformed reply on the redo round
    also releases the marker (otherwise the next tick would loop back
    into the redo detection with an empty plan)."""
    # failed status
    bb = _bb()
    bb.arch_redo_context = {"iter": 1, "unresolved": [], "previous_plan": []}
    ArchExecYield().on_resume(
        bb,
        "<!-- BEGIN CBIM-RECEIPT v1\n"
        "status: failed\n"
        "task_id: arch:1\n"
        "agent: architect\n"
        "summary: gave up\n"
        "failure_kind: other\n"
        "END CBIM-RECEIPT -->\n",
    )
    assert bb.arch_redo_context is None

    # needs_user_input status
    bb = _bb()
    bb.arch_redo_context = {"iter": 1, "unresolved": [], "previous_plan": []}
    ArchExecYield().on_resume(
        bb,
        _receipt(None, status="needs_user_input", question="which framework?"),
    )
    assert bb.arch_redo_context is None

    # malformed-plan status=ok path
    bb = _bb()
    bb.arch_redo_context = {"iter": 1, "unresolved": [], "previous_plan": []}
    ArchExecYield().on_resume(bb, _receipt("[not valid json"))
    assert bb.arch_redo_context is None


# ---------------------------------------------------------------------------
# Cross-tick state hygiene
# ---------------------------------------------------------------------------

def test_no_cross_tick_state_on_self():
    leaf = ArchExecYield()
    bb1 = _bb()
    leaf.tick(bb1)
    bb2 = _bb()
    leaf.tick(bb2)
    # Both yields use the fresh bb only; nothing leaks via self.
    assert bb1.pending_dispatch.subtask_id == "arch:1"
    assert bb2.pending_dispatch.subtask_id == "arch:1"
    public_attrs = {
        k for k in vars(leaf).keys()
        if not k.startswith("_") and k != "name"
    }
    assert public_attrs == set()


# ---------------------------------------------------------------------------
# RI-1 + RI-2 regression — _compose_prompt must render the
# module_knowledge bucket from bb.retrieved_context when present, and
# fall back to a placeholder line when absent. The architect prompt is
# the only place the retrieval pipeline surfaces in execution mode.
# ---------------------------------------------------------------------------

def test_compose_prompt_renders_module_knowledge_hits():
    bb = _bb(retrieved_context={
        "module_knowledge": [
            {"doc_id": "dna/foo", "score": 0.9, "snippet": "hello"},
        ],
    })
    prompt = ArchExecYield._compose_prompt(bb, "arch:1")
    # Either the doc id or the snippet body must reach the prompt.
    assert "dna/foo" in prompt
    assert "hello" in prompt
    # Section header is still present.
    assert "### 知识快照" in prompt


def test_compose_prompt_renders_multiple_module_knowledge_hits():
    bb = _bb(retrieved_context={
        "module_knowledge": [
            {"doc_id": "dna/foo", "score": 0.9, "snippet": "hello"},
            {"doc_id": "dna/bar", "score": 0.7, "content": "world"},
        ],
    })
    prompt = ArchExecYield._compose_prompt(bb, "arch:1")
    assert "dna/foo" in prompt
    assert "hello" in prompt
    assert "dna/bar" in prompt
    assert "world" in prompt


def test_compose_prompt_falls_back_to_placeholder_without_retrieved_context():
    bb = _bb(retrieved_context=None)
    prompt = ArchExecYield._compose_prompt(bb, "arch:1")
    assert "### 知识快照" in prompt
    # Fallback placeholder is shipped verbatim — exact phrasing is part
    # of the architect prompt contract.
    assert "无快照" in prompt
    assert "dna_list" in prompt


def test_compose_prompt_falls_back_when_bucket_empty():
    bb = _bb(retrieved_context={"module_knowledge": []})
    prompt = ArchExecYield._compose_prompt(bb, "arch:1")
    assert "无快照" in prompt


def test_compose_prompt_falls_back_when_bucket_missing():
    # retrieved_context exists but has no module_knowledge key.
    bb = _bb(retrieved_context={"other_bucket": [{"x": 1}]})
    prompt = ArchExecYield._compose_prompt(bb, "arch:1")
    assert "无快照" in prompt
