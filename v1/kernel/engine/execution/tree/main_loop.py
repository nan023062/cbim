"""tree/main_loop.py — Global ROOT for the CBIM main loop (v3.5).

Static topology — auditable in one read. Stacking order locked per
WORKFLOW-EXECUTION §5: Trace > Timeout > {Retry | Catch}.

Tree shape (see module.md §"5 分支模式拓扑"):
  Root (Trace > Timeout > RootSeq)
    InitTick
    CatchContextRetrieval(ContextRetrieval)  # v3.8 — 4-source pull,
                                              # writes bb.retrieved_context
    ModeClassify
    ModeSwitch (SwitchBranch on bb.mode)
      conversation → DirectReply
      architect    → ArchitectBranch (Sequence)
          DispatchCoreAgent#architect
          CoreReplyGate#architect (SwitchBranch on receipt status)
            ok               → Respond#architect
            needs_user_input → Respond#architect_need_user
            default          → Respond#architect
      hr           → HrBranch (Sequence)
          DispatchCoreAgent#hr
          CoreReplyGate#hr (SwitchBranch on receipt status)
            ok               → Respond#hr
            needs_user_input → Respond#hr_need_user
            default          → Respond#hr
      audit        → AuditBranch (Sequence)
          DispatchCoreAgent#auditor
          CoreReplyGate#auditor (SwitchBranch on receipt status)
            ok               → Respond#audit
            needs_user_input → Respond#audit_need_user
            default          → Respond#audit
      execution    → ExecutionSeq (Sequence)
          WorkLoop (LoopSeq, max_iters=3)
            ArchExecYield        (PR-D: single yield to the architect
                                  agent; replaces the in-process
                                  nine-leaf arch_exec subtree)
            DispatchWork
            ArchCheckGate        (v3.9: programmatic, deterministic
                                  read-only audit on touched_modules;
                                  writes bb.arch_check_report; tick
                                  always SUCCESS, pass/fail flows via
                                  verdict on the blackboard)
            ConvergeJudge        (PR-C: aggregates bb.work_results +
                                  bb.arch_check_report → bb.convergence
                                  ∈ {done | arch_redo | user_input |
                                  exhausted}; verdict.pass=False has
                                  priority over any work-side signal)
          EscalationGate (SwitchBranch on bb.convergence)
            "done"       → Respond
            "user_input" → Respond#need_user
            "exhausted"  → Respond#exhausted
          CatchFlush(FlushMemory)
      default      → ExecutionSeq (mirror — defensive fallback)

The three core-agent branches each produce exactly one yield with a
distinct ``agent_type`` (``architect`` / ``hr`` / ``auditor``); the main
agent dispatches to the fixed ``.claude/agents/*.md`` paths held by
``actions/core_agents.CORE_AGENT_FILES``.

PR-D: the kernel no longer holds any LLM client. ModeClassify is rule-
only (rule miss → "execution"); DirectReply is a deterministic
passthrough; ArchExecYield dispatches the architect agent and parses
its receipt trailer. All LLM-driven decisions live in
``.claude/agents/*.md`` personas, reached only via Task-tool dispatch.
"""

from __future__ import annotations

from ..actions.arch_check_gate import ArchCheckGate
from ..actions.arch_exec_yield import ArchExecYield
from ..actions.context_retrieval import ContextRetrieval
from ..actions.converge_judge import DEFAULT_MAX_ITERS, ConvergeJudge
from ..actions.direct_reply import DirectReply
from ..actions.dispatch_core_agent import DispatchCoreAgent
from ..actions.dispatch_work import DispatchWork
from ..actions.flush_memory import FlushMemory
from ..actions.init_tick import InitTick
from ..actions.mode_classify import ModeClassify
from ..actions.respond import Respond
from engine.core.composite import LoopSeq, Sequence, SwitchBranch
from engine.core.decorator import Catch, Timeout, Trace


def _mode_key(bb) -> str:
    return bb.mode or "execution"


def _converge_key(bb) -> str:
    val = getattr(bb, "convergence", None) or "done"
    # arch_redo should not reach EscalationGate (LoopSeq re-enters on it),
    # but be defensive — treat it as done so we render whatever we have.
    if val in ("done", "user_input", "exhausted"):
        return val
    return "done"


def _core_agent_key(agent_type: str):
    """Build a SwitchBranch key_fn that reads
    bb.work_results['core:<agent_type>'].status.

    Defaults to 'ok' when the entry or status is missing so the gate
    falls through to the default Respond branch instead of FAILURE-ing
    (defensive — DispatchCoreAgent always populates the entry, but the
    gate must not crash on an empty blackboard during dry-run or test).
    """
    key = f"core:{agent_type}"

    def _fn(bb) -> str:
        entry = (bb.work_results or {}).get(key)
        if not isinstance(entry, dict):
            return "ok"
        return entry.get("status") or "ok"

    return _fn


def build_root(*, global_timeout_s: int = 1800):
    init = InitTick(name="InitTick")
    # v3.8 — ContextRetrieval pulls four retrieval sources and writes the
    # three-bucket bb.retrieved_context. Wrapped in Catch(swallow) so a
    # retrieval blowup (missing index files, embedding provider crash …)
    # never aborts the tick: ContextRetrieval itself already absorbs
    # per-source errors, this is the outer belt for any unexpected
    # blowup (e.g. import failure on a fresh checkout).
    context_retrieval = Catch(
        ContextRetrieval(name="ContextRetrieval"),
        fallback="swallow",
        name="CatchContextRetrieval",
    )
    classify = ModeClassify(name="ModeClassify")

    # Conversation branch.
    direct = DirectReply(name="DirectReply")

    # Three core-agent branches — peer to Work Agent (see module.md
    # §"三大核心 agent 平级直派"). Each branch is
    # Sequence(DispatchCoreAgent → SwitchBranch(status)) so the core
    # agent's reply surfaces as bb.final_response (mirrors what
    # ExecutionSeq does for the work pipeline). The SwitchBranch routes
    # on the receipt status field captured by DispatchCoreAgent under
    # bb.work_results['core:<agent_type>']:
    #   - 'ok'                → Respond (default rendering)
    #   - 'needs_user_input'  → Respond(mode='need_user') — clarifying
    #                           question reaches the user instead of being
    #                           swallowed by a Sequence short-circuit
    #   - default             → Respond (defensive)
    # 'failed' never reaches the switch — DispatchCoreAgent returns
    # FAILURE on 'failed', short-circuiting the outer Sequence.
    def _core_branch(agent_type: str, branch_name: str, respond_suffix: str):
        respond_ok       = Respond(name=f"Respond#{respond_suffix}")
        respond_need_usr = Respond(name=f"Respond#{respond_suffix}_need_user",
                                   mode="need_user")
        gate = SwitchBranch(
            key_fn=_core_agent_key(agent_type),
            cases={
                "ok":               respond_ok,
                "needs_user_input": respond_need_usr,
            },
            default=respond_ok,
            name=f"CoreReplyGate#{agent_type}",
        )
        return Sequence(
            [
                DispatchCoreAgent(agent_type=agent_type,
                                  name=f"DispatchCoreAgent#{agent_type}"),
                gate,
            ],
            name=branch_name,
        )

    architect_branch = _core_branch("architect", "ArchitectBranch", "architect")
    hr_branch        = _core_branch("hr",        "HrBranch",        "hr")
    audit_branch     = _core_branch("auditor",   "AuditBranch",     "audit")

    # Execution branch — the Architect → Work pipeline with bounded
    # loop-back (PR-C). ArchExecYield sits as the first child of
    # WorkLoop so each retry re-runs the architect dispatch too;
    # ConvergeJudge is the last child and writes bb.convergence, which
    # EscalationGate then routes on. ArchExecYield is a single-yield
    # leaf — the architect agent does all the decomposition work
    # outside the kernel and returns arch_plan in its receipt trailer.
    arch_exec_yield = ArchExecYield(name="ArchExecYield")
    dispatch_work = DispatchWork(name="DispatchWork")
    arch_check_gate = ArchCheckGate(name="ArchCheckGate")
    converge_judge = ConvergeJudge(max_iters=DEFAULT_MAX_ITERS,
                                   name="ConvergeJudge")
    work_loop = LoopSeq(
        [arch_exec_yield, dispatch_work, arch_check_gate, converge_judge],
        max_iters=DEFAULT_MAX_ITERS,
        name="WorkLoop",
    )

    respond = Respond(name="Respond")
    respond_need_user = Respond(name="Respond#need_user", mode="need_user")
    respond_exhausted = Respond(name="Respond#exhausted", mode="exhausted")

    escalation_gate = SwitchBranch(
        key_fn=_converge_key,
        cases={
            "done":       respond,
            "user_input": respond_need_user,
            "exhausted":  respond_exhausted,
        },
        default=respond,
        name="EscalationGate",
    )

    flush = Catch(FlushMemory(name="FlushMemory"),
                  fallback="swallow", name="CatchFlush")

    execution_seq = Sequence(
        [work_loop, escalation_gate, flush],
        name="ExecutionSeq",
    )

    mode_switch = SwitchBranch(
        key_fn=_mode_key,
        cases={
            "conversation": direct,
            "architect":    architect_branch,
            "hr":           hr_branch,
            "audit":        audit_branch,
            "execution":    execution_seq,
        },
        default=execution_seq,
        name="ModeSwitch",
    )

    body = Sequence(
        [init, context_retrieval, classify, mode_switch],
        name="RootSeq",
    )

    return Trace(Timeout(body, seconds=global_timeout_s, name="GlobalTimeout"),
                 name="Root")


ROOT = build_root()
