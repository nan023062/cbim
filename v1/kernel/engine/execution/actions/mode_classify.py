"""actions/mode_classify.py — classify user_request → bb.mode.

Five-mode policy (v3.8 — add core-agent explicit-naming tier, narrow audit/architect bare keywords):
  1. Rule path — keyword/pattern tables. Deterministic; no LLM call.
     - architect-preempt (split/merge/deprecate a module, update .dna) → architect
     - core-agent explicit naming (ask/let/找/让/请/叫/派给/交给 + architect/HR/auditor) → matching role
     - execution verbs (implement/add/fix/refactor/修一下/改一下/…)    → execution
     - architect meta-task patterns (design a module / draw architecture …) → architect
     - hr lifecycle patterns (recruit X agent / 招 X agent …)          → hr
     - audit verb-form patterns (do a code review / 独立审查 …)        → audit
     - questions / lookups / greetings                                 → conversation
     - everything else (default)                                       → execution
  2. PR-D: the LLM fallback branch is gone. The kernel performs no LLM
     classification; rule miss defaults to "execution" so the architect
     agent itself can reroute (via status="needs_user_input") if the
     request turns out to be conversational on closer inspection.

Empty / whitespace-only request → "conversation" so DirectReply ships a
friendly "please describe what you want" message instead of blowing up
the execution pipeline.

Precedence on rule conflict (v3.8):
  architect-preempt > core-agent explicit naming > execution-verb >
  architect-request (remaining) > hr-request (remaining) >
  audit-request (remaining) > conversation > default ("execution").

The v3.7 ordering placed execution-verb before all three core-agent
tables, which broke two cross-table cases:
  - "修一下审计日志的 bug" → audit (bare "审计" hit audit-b4; "修一下"
    was missing from the execution Chinese verb row)
  - "请审计员做架构评审"  → architect ("做+架构" in architect-b5 ran
    before the audit table, so the explicit "请审计员" naming lost)

v3.8 fixes both by (a) hoisting the explicit "ask/请 + role" patterns
into a dedicated tier ABOVE execution-verb so explicit dispatch always
wins, (b) extending the execution Chinese verb row with 修一下/改一下/
调一下/顺手修/顺便改/改个/修个, (c) narrowing audit-b4 to drop bare
"审计" (it is now only an audit signal when paired with a review verb
or appears in audit-b5/b6 verb-form patterns), and (d) narrowing the
architect-b5 deliverable list so bare "架构" no longer matches (only
"架构图" / "架构设计"; "架构评审/审查" is audit territory).

The architect-preempt layer still fires FIRST for "split/merge/deprecate
a module" and "update .dna" — these have no execution landing and are
unambiguously architect work.

Example precedence walk-through:
  - "修一下审计日志的 bug"  → execution-verb tier (修一下) wins
  - "请审计员做架构评审"    → core-agent naming tier (请+审计员) wins
  - "请架构师设计登录模块"  → core-agent naming tier (请+架构师) wins
  - "design a new login module" → architect-request tier (no explicit
    naming, no execution verb)

NEVER fails (returns SUCCESS always). The mode is a routing decision, not
an error condition.
"""

from __future__ import annotations

import re

from engine.core.node import Node, Status


# The 5 mode strings written to bb.mode by ModeClassify.tick.
MODES: tuple[str, ...] = ("conversation", "architect", "hr", "audit", "execution")
DEFAULT_MODE = "execution"


# ---------------------------------------------------------------------------
# Pre-emption layer — architect-only actions that semantically cannot be
# "code execution". Runs BEFORE the execution-verb table.
# ---------------------------------------------------------------------------

_ARCHITECT_PREEMPT_PATTERNS = [
    # Chinese: 拆分 / 合并 / 废弃 / 下架 模块
    re.compile(r"(拆分|拆|合并|废弃|下架)\s*[一个]?\s*\S*\s*模块"),
    # Chinese: 更新 / 修订 / 重写 / 调整 .dna
    re.compile(r"(更新|修订|重写|调整)\s*\.?dna"),
    re.compile(r"更新\s*(module|contract)\.md", re.IGNORECASE),
    # English: split/merge/deprecate (a) module
    re.compile(
        r"\b(split|merge|deprecate|retire|archive)\s+(an?\s+|the\s+)?\w*\s*module\b",
        re.IGNORECASE,
    ),
    # English: update/edit/touch .dna (and friends)
    re.compile(
        r"\b(update|edit|modify|touch|fix|amend|rewrite)\s+(the\s+)?"
        r"(\.dna|module\.md|contract\.md|dna\s+(doc|entry|record|module))\b",
        re.IGNORECASE,
    ),
]


# ---------------------------------------------------------------------------
# Core-agent explicit naming — "ask/let/.../dispatch + role" (English) and
# "让/请/找/问/叫/派给/交给 + 角色" (Chinese). Hoisted out of the per-role
# _ARCHITECT_PATTERNS / _HR_PATTERNS / _AUDIT_PATTERNS so explicit naming
# beats execution verbs and beats every other core-agent meta-task table.
#
# Order within this list is the tie-break for the (rare) case where a single
# request names two roles. The first match wins, so list order is
# significant — keep this stable.
# ---------------------------------------------------------------------------

_CORE_AGENT_NAMING_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # architect — English dispatch verb + architect
    (
        "architect",
        re.compile(
            r"\b(ask|let|have|tell|dispatch|send|consult|get|find|invoke)\s+"
            r"(the\s+)?architect\b",
            re.IGNORECASE,
        ),
    ),
    # architect — Chinese 让 / 请 / 找 / 问 / 叫 / 派给 / 交给 架构师
    (
        "architect",
        re.compile(r"(让|请|找|问|叫|派给|交给)\s*架构师"),
    ),
    # hr — English dispatch verb + HR
    (
        "hr",
        re.compile(
            r"\b(ask|let|have|tell|dispatch|send|consult|get|find|invoke)\s+"
            r"(the\s+)?hr\b",
            re.IGNORECASE,
        ),
    ),
    # hr — Chinese 让 / 请 / 找 / 问 / 叫 / 派给 / 交给 HR
    (
        "hr",
        re.compile(r"(让|请|找|问|叫|派给|交给)\s*HR", re.IGNORECASE),
    ),
    # audit — English dispatch verb + auditor
    (
        "audit",
        re.compile(
            r"\b(ask|let|have|tell|dispatch|send|consult|get|find|invoke)\s+"
            r"(the\s+)?auditor\b",
            re.IGNORECASE,
        ),
    ),
    # audit — Chinese 让 / 请 / 找 / 问 / 叫 / 派给 / 交给 审计员
    (
        "audit",
        re.compile(r"(让|请|找|问|叫|派给|交给)\s*审计员"),
    ),
]


# ---------------------------------------------------------------------------
# Execution verbs — broad action verbs that signal "code is going to move".
# ---------------------------------------------------------------------------

_EXECUTION_PATTERNS = [
    re.compile(
        r"\b(implement|add|fix|refactor|build|wire|create|split|merge|deprecate|"
        r"update|delete|remove)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"(实现|新增|修复|重构|加(一?个|入)|创建|拆分|合并|废弃|更新|删除|改写|重写"
        r"|修一下|改一下|调一下|顺手修|顺便改|改个|修个)"
    ),
]


# ---------------------------------------------------------------------------
# Architect request — explicit dispatch to the architect role. Requires
# either naming the architect + a dispatch verb, OR pairing an architect-
# specific meta-task verb with an architect-exclusive deliverable. Bare
# topic words (architecture / module.md / contract.md) DO NOT trigger.
# ---------------------------------------------------------------------------

_ARCHITECT_PATTERNS = [
    # NOTE: a1/a2 (English/Chinese explicit "ask/请 + architect") moved
    # to _CORE_AGENT_NAMING_PATTERNS so explicit naming wins over
    # execution verbs. This table now holds only the meta-task (b*)
    # patterns that fire AFTER the execution-verb table.
    # (b1) English: design + architect-exclusive deliverable
    # Allows up to 4 modifier words between "design [a/the/new]" and the
    # deliverable noun, so "design a new login module" still matches.
    re.compile(
        r"\bdesign\s+(an?\s+|the\s+)?(new\s+)?(\w+\s+){0,4}"
        r"(module|sub-?module|system|component|service|API|architecture|"
        r"blueprint|contract|interface|boundary|layer)\b",
        re.IGNORECASE,
    ),
    # (b2) English: draw / sketch / propose / outline / re-architect + architecture-like noun
    re.compile(
        r"\b(draw|sketch|propose|outline|re-?architect|redesign)\s+"
        r"(an?\s+|the\s+)?(architecture|blueprint|design|module\s+shape|"
        r"module\s+boundary|component\s+diagram)\b",
        re.IGNORECASE,
    ),
    # (b3) English: define a contract / module boundary
    re.compile(
        r"\bdefine\s+(an?\s+|the\s+)?(contract|interface|module\s+boundary|"
        r"sub-?module\s+boundaries)\b",
        re.IGNORECASE,
    ),
    # (b4) English: produce / write / prepare / build / generate a knowledge pack / context pack
    re.compile(
        r"\b(produce|write|prepare|build|generate)\s+(an?\s+|the\s+)?"
        r"(knowledge\s+pack|context\s*pack)\b",
        re.IGNORECASE,
    ),
    # (b5) Chinese: architect meta-task verbs + deliverable nouns.
    # v3.8: bare "架构" removed — "架构评审/架构审查" is audit territory.
    # Only "架构图" / "架构设计" remain as architect-exclusive deliverables.
    re.compile(
        r"(画|出|做|提供|写|准备|生成)\s*(一?份|一?张|一?套)?\s*"
        r"(设计|蓝图|架构图|架构设计|知识包|context\s*pack|模块划分|模块边界|契约设计)"
    ),
    # (b6) Chinese: 模块化 / 重构架构 / 拆分模块 / 合并模块 / 定义契约 / 架构设计
    re.compile(r"(模块化|重构架构|拆分模块|合并模块|定义契约|架构设计)"),
]


# ---------------------------------------------------------------------------
# HR request — explicit dispatch to HR. Either naming HR + a dispatch verb,
# OR pairing a lifecycle verb (recruit / hire / onboard / train / …) with
# an explicit "agent" object.
# ---------------------------------------------------------------------------

_HR_PATTERNS = [
    # NOTE: a1/a2 (English/Chinese explicit "ask/请 + HR") moved to
    # _CORE_AGENT_NAMING_PATTERNS. This table holds only the lifecycle
    # (b*) patterns that fire AFTER the execution-verb table.
    # (b1) English: recruit / hire / onboard / … + agent
    # Allows up to 4 modifier words between the verb and "agent" so
    # "recruit a python backend engineer agent" still matches.
    re.compile(
        r"\b(recruit|hire|onboard|train|coach|mentor|assess|evaluate|fire|"
        r"retire|promote)\s+(an?\s+|the\s+)?(\w+\s+){0,4}(work\s+)?agent\b",
        re.IGNORECASE,
    ),
    # (b2) Chinese: 招 / 聘 / 上岗 / 培训 / 带教 / 考核 / 裁撤 / 晋升 + agent
    # Allows up to 20 chars of any modifier text (incl. embedded Latin
    # words like "Rust") between the verb and "agent" so phrases like
    # "招一个会写 Rust 的工作 agent" still match. Non-greedy keeps the
    # window tight to the nearest "agent".
    re.compile(
        r"(招募|招聘|招(一?个)?|聘请|入职|上岗|培训|带教|考核|评估|"
        r"裁撤|晋升|下岗).{0,20}?(work\s*)?agent",
        re.IGNORECASE,
    ),
    # (b3) Chinese: 能力管理 / 人员管理 / 岗位调整 / 招聘 agent / 入职 agent
    re.compile(r"(能力管理|人员管理|岗位调整|招聘\s*agent|入职\s*agent)", re.IGNORECASE),
]


# ---------------------------------------------------------------------------
# Audit request — explicit dispatch to the auditor. Either naming the
# auditor + a dispatch verb, OR a verb-form audit/review request (audit
# X, do a code review, run a design review). Bare topic noun "audit" no
# longer triggers — "implement audit logging" must NOT route to audit.
# ---------------------------------------------------------------------------

_AUDIT_PATTERNS = [
    # NOTE: a1/a2 (English/Chinese explicit "ask/请 + auditor") moved
    # to _CORE_AGENT_NAMING_PATTERNS. This table holds only the
    # verb-form audit (b*) patterns that fire AFTER the execution-verb table.
    # (b1) English: independent review / second opinion / sanity / governance check
    re.compile(
        r"\b(independent\s+(review|audit|critique)|second\s+opinion|"
        r"sanity\s+check|governance\s+check|gov\s+check)\b",
        re.IGNORECASE,
    ),
    # (b2) English: audit as verb — line-initial or after a polite/request lead-in
    re.compile(
        r"(^|\b(please|kindly|could you|can you|let'?s|let us)\s+)"
        r"audit\s+(the\s+|this\s+|our\s+|my\s+)?\w+",
        re.IGNORECASE,
    ),
    # (b3) English: do / run / perform / conduct / kick off a code/design/architecture review or audit
    re.compile(
        r"\b(do|run|perform|conduct|kick\s*off)\s+(an?\s+|the\s+)?"
        r"(code\s*review|design\s*review|architecture\s*review|audit)\b",
        re.IGNORECASE,
    ),
    # (b4) Chinese: 独立审查 / 复盘 / 挑刺 / 质疑 / 提出反对意见
    # 独立(...)审查/审核/复核/评审 — allow up to 6 Chinese chars between
    # the "独立" prefix and the verb-noun, so phrases like
    # "独立对抗式审查" / "独立对项目的审查" still match.
    # v3.8: bare "审计" dropped — "审计日志" is a noun phrase about the
    # subject, not an audit request. Audit signal now requires either an
    # explicit review verb (审查/审核/复核/评审/复盘/挑刺/质疑) or one of
    # the verb-form patterns in b5/b6, or explicit "请+审计员" naming.
    re.compile(
        r"(独立.{0,6}?(审查|审核|复核|评审)|"
        r"复盘|挑刺|找问题|质疑|提出反对意见)"
    ),
    # (b5) Chinese: prefix-noun + verb-noun audit phrasing
    # e.g. 全盘审查 / 全面评审 / 整体复盘 / 架构评审 / 代码审查 / 设计审核
    re.compile(r"(全盘|全面|整体|架构|代码|设计)\s*(审查|审核|评审|复盘)"),
    # (b6) Chinese: 做 + (一次|一轮|一遍|个)? + 审查/审核/评审/code review
    # e.g. 做一次审查 / 做一轮评审 / 做个 code review / 做 code review
    re.compile(r"做\s*(一次|一轮|一遍|个)?\s*(审查|审核|评审|code\s*review)", re.IGNORECASE),
]


# ---------------------------------------------------------------------------
# Conversation — questions / lookups / greetings (unchanged from v3.5).
# ---------------------------------------------------------------------------

_CONVERSATION_PATTERNS = [
    # English question / lookup / greeting phrasing
    re.compile(r"^\s*(what|who|when|where|why|how|which|is|are|do|does|can|could|should|would)\b",
               re.IGNORECASE),
    re.compile(r"\b(explain|describe|tell me|show me|status|recall|history|hi|hello|hey|thanks)\b",
               re.IGNORECASE),
    # Chinese question / lookup / greeting phrasing
    re.compile(r"(什么|为什么|怎么|如何|哪|是不是|有没有|可不可以|能不能|是否|多少|多久)"),
    re.compile(r"(查询|查一下|查看|看一下|介绍一下|说明|解释|状态|你好|您好|谢谢)"),
]


class ModeClassify(Node):
    def __init__(self, *, name: str = "ModeClassify") -> None:
        self.name = name

    def tick(self, bb) -> Status:
        text = (bb.user_request or "").strip()
        if not text:
            bb.mode = "conversation"
            return Status.SUCCESS

        # v3.8 precedence:
        #   architect-preempt > core-agent explicit naming > execution-verb >
        #   architect-request (remaining b*) > hr-request (remaining b*) >
        #   audit-request (remaining b*) > conversation > default.

        # 1. Architect preempt — split/merge/deprecate a module, update .dna.
        for pat in _ARCHITECT_PREEMPT_PATTERNS:
            if pat.search(text):
                bb.mode = "architect"
                return Status.SUCCESS

        # 2. Core-agent explicit naming — "ask/let/请/找/让 + role".
        # Wins over execution verbs so "请审计员审一下" lands on audit
        # even when an execution verb appears in the same sentence.
        for mode, pat in _CORE_AGENT_NAMING_PATTERNS:
            if pat.search(text):
                bb.mode = mode
                return Status.SUCCESS

        # 3. Execution verbs — the broad default for "code is going to move".
        for pat in _EXECUTION_PATTERNS:
            if pat.search(text):
                bb.mode = "execution"
                return Status.SUCCESS

        # 4. Remaining architect meta-task patterns (b*).
        for pat in _ARCHITECT_PATTERNS:
            if pat.search(text):
                bb.mode = "architect"
                return Status.SUCCESS

        # 5. Remaining HR lifecycle patterns (b*).
        for pat in _HR_PATTERNS:
            if pat.search(text):
                bb.mode = "hr"
                return Status.SUCCESS

        # 6. Remaining audit verb-form patterns (b*).
        for pat in _AUDIT_PATTERNS:
            if pat.search(text):
                bb.mode = "audit"
                return Status.SUCCESS

        # 7. Conversation-shaped phrasing.
        for pat in _CONVERSATION_PATTERNS:
            if pat.search(text):
                bb.mode = "conversation"
                return Status.SUCCESS

        # 8. Rule miss — default to execution (the safe "send through
        # the Architect → Work pipeline" path). The kernel performs no
        # LLM classification; the architect itself reroutes (via
        # status="needs_user_input") if the request turns out to be
        # conversational on closer inspection.
        bb.mode = DEFAULT_MODE
        return Status.SUCCESS
