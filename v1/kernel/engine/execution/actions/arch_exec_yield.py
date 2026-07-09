"""actions/arch_exec_yield.py — single-yield leaf that dispatches the
architect agent and parses ``arch_plan`` out of the receipt trailer.

Replaces the nine-leaf in-process ``arch_exec`` subtree (PR-D). The
architect persona at ``.claude/agents/architect/architect.md`` carries
the procedural knowledge for execution-mode decomposition; this leaf is
the kernel's single touchpoint to that persona.

Cross-tick state rule: nothing on ``self`` survives a tick. The leaf
inspects ``bb.arch_plan`` on each tick to decide whether to yield again
or short-circuit. Receipt parsing happens in ``on_resume``; the very
next tick reads the result off bb.

Result-key scheme: ``subtask_id = f"arch:{iter}"`` where ``iter`` is
``bb.work_loop_iter`` (PR-C field). The Runner's two-level
``agent_subtask_to_leaf`` map (wired in api/bt_tick.py) routes
``("architect", "arch:<n>") → "ArchExecYield"`` so the resume path
resolves correctly even though both this leaf and
``DispatchCoreAgent#architect`` dispatch ``agent_type="architect"``.
"""

from __future__ import annotations

import json
from typing import Any

from engine.core.node import Node, Status

from .core_agents import CORE_AGENT_FILES
from .receipt import parse_trailer
from ..api.result import DispatchRequest


ARCHITECT_AGENT_FILE = CORE_AGENT_FILES["architect"]

# Cap mirrors arch_exec/assemble.py historical behavior.
_MAX_TASKS = 8

# Capabilities the architect may name on a task. Anything else is
# silently collapsed to "generalist" so HR's CoreAgentSelector can route.
_KNOWN_CAPABILITIES: frozenset[str] = frozenset(
    {"programmer", "doc_writer", "generalist"}
)


class ArchExecYield(Node):
    """First child of WorkLoop — yields once to the architect agent.

    First tick (no result on bb yet):
        Sets ``bb.pending_dispatch`` to a DispatchRequest targeting the
        architect; returns RUNNING.

    on_resume(payload):
        Parses ``payload`` through ``parse_trailer``; pulls
        ``arch_plan`` from ``trailer.extras``; validates and writes
        ``bb.arch_plan``. On ``status="needs_user_input"`` also seeds
        ``bb.convergence="user_input"`` so EscalationGate skips
        ConvergeJudge's verdict.

    Re-tick after resume:
        SUCCESS when ``bb.arch_plan`` is a (possibly empty) list.
        FAILURE when the receipt was malformed / missing the field.
        On ``status="failed"`` the leaf also returns FAILURE.
    """

    name: str = "ArchExecYield"

    def __init__(self, *, name: str = "ArchExecYield") -> None:
        self.name = name

    # ------------------------------------------------------------------
    # Tick / resume
    # ------------------------------------------------------------------

    def tick(self, bb) -> Status:
        # Post-arch_redo entry: ConvergeJudge stashed bb.arch_redo_context
        # (with iter = the iter that failed) then returned FAILURE, and
        # LoopSeq has since bumped bb.work_loop_iter. The bb.arch_plan
        # from the failed iter is still hanging around — a naive
        # short-circuit on "plan is not None" below would swallow the
        # redo silently and WorkLoop would spin to exhaustion never
        # re-yielding to the architect. Detect that state here (by iter
        # comparison against the stashed context) and clear the stale
        # plan so the yield block below fires. on_resume clears
        # arch_redo_context after writing the fresh plan, so this branch
        # does NOT re-fire on the post-resume re-tick (which would wipe
        # the plan we just received).
        plan = getattr(bb, "arch_plan", None)
        if plan is not None and self._is_stale_redo_plan(bb):
            bb.arch_plan = None
            plan = None

        # Short-circuit when a previous step in this same iter (either
        # bt_tick's fresh-plan init or on_resume just now) already
        # produced a plan.
        if plan is not None:
            # Defensive: invalid shape → FAILURE so the loop bubbles.
            if not isinstance(plan, list):
                return Status.FAILURE
            return Status.SUCCESS

        # First call (or redo re-entry with plan just cleared above) — yield.
        subtask_id = self._subtask_id(bb)
        bb.pending_dispatch = DispatchRequest(
            agent_type="architect",
            agent_file=ARCHITECT_AGENT_FILE,
            prompt=self._compose_prompt(bb, subtask_id),
            subtask_id=subtask_id,
            timeout_hint_s=None,
        )
        return Status.RUNNING

    def on_resume(self, bb, payload: Any) -> None:
        text = _payload_to_text(payload)
        subtask_id = self._subtask_id(bb)
        trailer = parse_trailer(text, dispatch_task_id=subtask_id)

        bb.pending_dispatch = None
        # Mark the arch_redo signal as consumed. The context was needed
        # during yield (rendered into the architect prompt by
        # _compose_prompt) and by tick() to detect the redo re-entry;
        # once we have a fresh receipt in hand the redo round is over.
        # Leaving arch_redo_context set would cause tick()'s stale-plan
        # check to fire on the next tick and wipe the plan we're about
        # to write below. Exhausted-path readers (Respond#exhausted) are
        # unaffected: ConvergeJudge re-stashes arch_redo_context at the
        # exhausted iter itself, after any on_resume call.
        if getattr(bb, "arch_redo_context", None) is not None:
            bb.arch_redo_context = None

        status = trailer.status
        if status == "failed":
            bb.arch_plan = []
            return

        if status == "needs_user_input":
            # Architect determined human input is required — skip the
            # ConvergeJudge verdict entirely and route straight to
            # EscalationGate's user_input branch. Empty plan signals
            # DispatchWork to no-op.
            bb.arch_plan = []
            bb.convergence = "user_input"
            # Surface the question so the need_user Respond can render it.
            new_results = dict(bb.work_results or {})
            new_results[subtask_id] = {
                "status": "needs_user_input",
                "summary": trailer.summary,
                "question": trailer.question or "",
                "agent": trailer.agent,
                "output": text,
            }
            bb.work_results = new_results
            return

        if status == "needs_arch_decision":
            # Not legal for the architect itself — coerce to failed.
            bb.arch_plan = []
            return

        # status == "ok" — pull arch_plan from extras.
        raw = trailer.extras.get("arch_plan")
        plan = _parse_plan(raw)
        if plan is None:
            # Malformed / missing / cap-violating / bad-capability plan.
            # Surface as user_input so EscalationGate routes to
            # Respond#need_user instead of letting WorkLoop fall through
            # to a fake 'done' with an empty plan. Re-dispatching the
            # same architect with the same prompt would almost certainly
            # produce the same malformed reply — only the user can break
            # the deadlock by rephrasing.
            bb.arch_plan = []
            bb.convergence = "user_input"
            new_results = dict(bb.work_results or {})
            new_results[subtask_id] = {
                "status": "needs_user_input",
                "summary": "architect reply did not contain a parseable arch_plan trailer field",
                "question": (
                    "The architect did not produce a valid arch_plan. "
                    "Please rephrase your request or restate it more "
                    "explicitly so the architect can decompose it into "
                    "work tasks."
                ),
                "agent": "architect",
                "output": text,
            }
            bb.work_results = new_results
            return

        bb.arch_plan = plan

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _subtask_id(bb) -> str:
        iter_no = int(getattr(bb, "work_loop_iter", 1) or 1)
        return f"arch:{iter_no}"

    @staticmethod
    def _is_stale_redo_plan(bb) -> bool:
        """Return True iff arch_redo_context was stashed at a prior iter.

        ConvergeJudge writes ``arch_redo_context["iter"] = work_loop_iter``
        BEFORE returning FAILURE; LoopSeq then bumps ``work_loop_iter``
        by one and re-ticks us. So a strictly-less-than comparison
        catches exactly the "just re-entered a redo iteration" state.
        The condition also gates on the context being a well-formed
        dict with an int iter — corrupt / partial contexts fall through
        as "not stale" (defensive: the loop still functions; a
        legitimate redo will fix the shape on the next round).

        Returns False when arch_redo_context is None (first entry, or
        after on_resume consumed it), when the context isn't a dict,
        when ``iter`` is missing / non-int, or when the stashed iter is
        NOT older than the current work_loop_iter.
        """
        ctx = getattr(bb, "arch_redo_context", None)
        if not isinstance(ctx, dict):
            return False
        stashed_iter = ctx.get("iter")
        if not isinstance(stashed_iter, int):
            return False
        current_iter = int(getattr(bb, "work_loop_iter", 1) or 1)
        return stashed_iter < current_iter

    @staticmethod
    def _compose_prompt(bb, subtask_id: str) -> str:
        user_request = (getattr(bb, "user_request", "") or "").strip()
        snapshot = _render_module_knowledge(bb)
        redo_context = getattr(bb, "arch_redo_context", None)
        if redo_context:
            redo_block = _render_redo_context(redo_context)
        else:
            redo_block = "(首次进入)"
        return (
            "## 执行模式 · ArchExec\n\n"
            "### 用户请求\n"
            f"{user_request}\n\n"
            "### 知识快照\n"
            f"{snapshot}\n\n"
            "### 重入上下文\n"
            f"{redo_block}\n\n"
            "### 任务\n"
            "扫描受影响模块、判断知识/代码同步状态、必要时通过 MCP 写入 .dna/，\n"
            "最终产出 arch_plan（list[dict]）作为给 Work Agent 的 ContextPack 来源。\n\n"
            "每条 task 字段：\n"
            "  id (str, 唯一)\n"
            "  description (str)\n"
            "  required_capability (str, ∈ {programmer, doc_writer, generalist})\n"
            "  params (dict)\n"
            "  arch_context (str, 非空)\n\n"
            "params 必填字段：\n"
            "  touched_modules (list[str], 必填，非空)\n"
            "    本 task 将触及（创建/修改/审查）的模块路径集合，路径形如\n"
            "    `v1/kernel/engine/audit`，与 `.dna/module.md` 路径一致。\n"
            "    用于 ArchCheckGate 按需对触及模块跑 dna_tree/dna_fission；\n"
            "    漏写 = 协议违规，下游网关会标 warning 并退化为全树扫描，\n"
            "    但不会因此 fail —— 是给架构师的提醒，不是给用户的阻塞。\n"
            "  depends_on (list[str], 可选)\n"
            "    本 task 依赖的其他 task id；不能成环。\n\n"
            "约束：\n"
            f"  - task 总数 ≤ {_MAX_TASKS}\n"
            "  - 不可执行 → arch_plan 留空 list，receipt status=needs_user_input + question\n\n"
            "### 回执格式\n"
            "按 PR-A 回执 trailer 规范输出，并在 trailer 中追加 arch_plan 行。\n"
            "完整模板（单行注释，与 receipt.py 解析器一致）：\n\n"
            "<!-- BEGIN CBIM-RECEIPT v1\n"
            f"task_id: {subtask_id}\n"
            "agent: architect\n"
            "status: ok\n"
            "summary: <一句话总结>\n"
            "notes: \n"
            "arch_plan: <JSON-encoded list[dict]，无任务时为 []>\n"
            "END CBIM-RECEIPT -->\n"
        )


# ---------------------------------------------------------------------------
# Module-private helpers
# ---------------------------------------------------------------------------

_SNAPSHOT_FALLBACK = "(无快照 — 自行调用 dna_list / dna_show 查询)"
_SNAPSHOT_SUMMARY_CHARS = 160


# Banner injected verbatim before any audit_finding entries in the redo
# context block. Wording is contract-grade — programmer / coder / doc
# agents downstream parse the architect's redo plan against the
# expectation that the architect MUST address every finding here. Do
# not rephrase casually; updates go through .dna review.
_AUDIT_FINDINGS_HEADER = (
    "以下是程序化检测门（ArchCheckGate）发现的硬性架构问题，"
    "必须按 suggestion 修复，不得绕过。"
)
_AUDIT_FINDINGS_PROHIBITION = (
    "不得提议关闭/降级该检查或将 finding 标记为 baseline 接受 —— "
    "这两类操作是人类显式动作，不属于本次 redo 的合法选项；"
    "必须真正修改 .dna 让下一轮 audit 通过。"
)


def _render_redo_context(redo_context: dict) -> str:
    """Render arch_redo_context with audit findings as a hard read-only block.

    Two-section layout:
      1. Audit findings (if any): the header + each finding's full text +
         the prohibition footer. This block is the only place where the
         architect is told "you MUST do exactly this".
      2. Everything else (work-side needs_arch_decision unresolved
         entries, previous_plan, iter, reason): serialised as pretty
         JSON so the architect sees the full payload.
    """
    unresolved = redo_context.get("unresolved") or []
    audit_entries: list[dict] = []
    other_entries: list[dict] = []
    for entry in unresolved:
        if isinstance(entry, dict) and entry.get("kind") == "audit_finding":
            audit_entries.append(entry)
        else:
            other_entries.append(entry)

    sections: list[str] = []

    if audit_entries:
        lines: list[str] = [_AUDIT_FINDINGS_HEADER, ""]
        for i, f in enumerate(audit_entries, 1):
            check = f.get("check") or "unknown"
            severity = f.get("severity") or "warn"
            target = f.get("target") or "(no target)"
            message = (f.get("message") or "").strip()
            suggestion = (f.get("suggestion") or "").strip()
            code = f.get("code")
            origin = f.get("origin") or "new"
            head = f"[{i}] check={check} severity={severity} origin={origin} target={target}"
            if code:
                head += f" code={code}"
            lines.append(head)
            if message:
                lines.append(f"    message: {message}")
            if suggestion:
                lines.append(f"    suggestion: {suggestion}")
            else:
                lines.append("    suggestion: (none — fix per message)")
        lines.append("")
        lines.append(_AUDIT_FINDINGS_PROHIBITION)
        sections.append("\n".join(lines))

    # Carry the remainder (non-audit unresolved + previous_plan + iter +
    # reason) as pretty JSON. We rebuild the dict to keep the audit
    # entries OUT of the JSON dump (they already appear above verbatim).
    remainder = {
        k: v for k, v in redo_context.items()
        if k != "unresolved"
    }
    if other_entries:
        remainder["unresolved"] = other_entries
    if remainder:
        sections.append(json.dumps(remainder, ensure_ascii=False, indent=2))

    if not sections:
        # Defensive: redo_context was empty-but-present. Render the
        # original (possibly empty) JSON so the architect at least sees
        # the shape.
        return json.dumps(redo_context, ensure_ascii=False, indent=2)

    return "\n\n".join(sections)


def _render_module_knowledge(bb) -> str:
    """Render ContextRetrieval's module_knowledge bucket as a snapshot.

    Reads ``bb.retrieved_context["module_knowledge"]`` (written by the
    ContextRetrieval leaf earlier in the tick) and formats each hit as
    a single human-readable line: ``- <doc_id> (score=<s>): <summary>``.
    Falls back to the static placeholder when the bucket is missing or
    empty so the prompt always carries a snapshot section.
    """
    rc = getattr(bb, "retrieved_context", None) or {}
    hits = rc.get("module_knowledge") or []
    if not hits:
        return _SNAPSHOT_FALLBACK
    lines: list[str] = []
    for h in hits:
        if not isinstance(h, dict):
            continue
        doc_id = h.get("doc_id") or "<unknown>"
        score = h.get("score")
        try:
            score_str = f"{float(score):.3f}" if score is not None else "?"
        except (TypeError, ValueError):
            score_str = "?"
        body = h.get("content") or h.get("snippet") or h.get("text") or ""
        if not isinstance(body, str):
            body = str(body)
        body = body.strip().replace("\n", " ")
        if len(body) > _SNAPSHOT_SUMMARY_CHARS:
            body = body[:_SNAPSHOT_SUMMARY_CHARS].rstrip() + "..."
        lines.append(f"- {doc_id} (score={score_str}): {body}")
    if not lines:
        return _SNAPSHOT_FALLBACK
    return "\n".join(lines)


def _payload_to_text(payload: Any) -> str:
    if isinstance(payload, str):
        return payload
    if isinstance(payload, dict):
        return payload.get("output", "") or ""
    if payload is None:
        return ""
    return str(payload)


def _parse_plan(raw: Any) -> list[dict] | None:
    """Parse and validate the architect's arch_plan trailer field.

    Returns the normalized list on success, None on any structural
    failure (including a missing ``arch_plan`` field — the architect
    is required to emit the line even when the plan is empty). An
    explicit empty list (``raw == "[]"`` or whitespace-only) is a
    valid result and is returned as ``[]``.
    """
    if raw is None:
        # Missing field — the architect did not honor the receipt
        # contract. Treat as malformed so the caller surfaces FAILURE
        # rather than silently producing an empty plan.
        return None
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return []
    try:
        loaded = json.loads(s)
    except (ValueError, TypeError):
        return None
    if not isinstance(loaded, list):
        return None
    if len(loaded) > _MAX_TASKS:
        # Cap-violation is a hard fail per spec — architect was told
        # ≤ 8 tasks; emitting more means it didn't follow the contract.
        return None

    out: list[dict] = []
    for item in loaded:
        if not isinstance(item, dict):
            return None
        task_id = item.get("id")
        description = item.get("description")
        arch_context = item.get("arch_context")
        if not isinstance(task_id, str) or not task_id:
            return None
        if not isinstance(description, str):
            return None
        if not isinstance(arch_context, str) or not arch_context:
            return None
        capability = item.get("required_capability") or "generalist"
        if not isinstance(capability, str):
            capability = "generalist"
        if capability not in _KNOWN_CAPABILITIES:
            capability = "generalist"
        params = item.get("params") or {}
        if not isinstance(params, dict):
            return None
        # Normalise params.touched_modules — required field per ArchCheckGate
        # contract, but architects sometimes forget. Missing / malformed
        # collapses to [] (empty list), which ArchCheckGate then treats as
        # "scan everything as a fallback and emit a warning". We do NOT
        # fail the plan over this — the gate's warning is the right
        # surface for the protocol nudge.
        params = dict(params)  # shallow copy so we don't mutate the input
        params["touched_modules"] = _coerce_touched_modules(
            params.get("touched_modules")
        )
        out.append({
            "id": task_id,
            "description": description,
            "required_capability": capability,
            "params": params,
            "arch_context": arch_context,
        })
    return out


def _coerce_touched_modules(raw: Any) -> list[str]:
    """Coerce a raw `touched_modules` field into a clean list[str].

    Returns an empty list on any malformed input — missing, wrong type,
    or list-of-non-strings. The ArchCheckGate fallback covers the empty
    case (full-tree scan + warning); we do not fail the plan over a
    missing field, because (a) the gate already surfaces the issue and
    (b) re-dispatching the architect for one missing list rarely helps.
    """
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        s = item.strip()
        if not s:
            continue
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


__all__ = ["ArchExecYield", "ARCHITECT_AGENT_FILE"]
