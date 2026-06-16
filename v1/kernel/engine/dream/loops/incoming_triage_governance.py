"""loops/incoming_triage_governance.py — Phase-5 incoming-queue triage descriptor.

Mirrors ``loops.memory_distill_governance``. The dispatcher renders the
prompt via :func:`compose_prompt` (embedding the JSONL paths IncomingScan
collected on ``bb.incoming_paths`` — and, if total payload fits within
the inline budget, the file contents themselves so the main agent doesn't
have to round-trip Read calls). The collector parses the reply via
:func:`parse_response`.

Reply schema (all keys required, arrays may be empty)::

    {
      "processed_paths":         ["<incoming JSONL absolute path>", ...],
      "medium_entries_written":  ["<absolute path>", ...],
      "skipped_records":         [{"reason": "low-signal|noise|duplicate", ...}, ...],
      "errors":                  [{"path": "<incoming JSONL>", "error": "..."}, ...]
    }

Semantics (LLM-driven high-signal filter):
  - The main agent reads each JSONL record and decides per-record whether
    it carries enough signal to fix as a medium memory entry. **Only
    high-signal records are promoted** (repeated decisions / long-term
    rules / explicit memory requests / failure lessons). Day-to-day Q&A,
    tool-noise, debug chatter is dropped silently into ``skipped_records``.
  - Compression follows the four-quadrant model (MUST / WANT / HOW / IS).
  - ``processed_paths`` contains JSONL files where every meaningful
    record has been triaged (entries either persisted or skipped); the
    collector then moves them into ``incoming/processed/``.
  - ``errors`` keeps a file in place for next-tick retry — DO NOT include
    the same path in both ``processed_paths`` and ``errors``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


# Inline-content budget. Beyond this we shift to "list paths only +
# instruct the agent to Read on demand" — keeps the prompt under the
# coordinator's context budget for runs with a large backlog.
_INLINE_PAYLOAD_LIMIT = 50 * 1024  # 50 KiB


def compose_prompt(bb, store_dir: str) -> str:
    """Render the incoming-triage governance prompt.

    Header marker ``## 治理模式`` matches the dream-loop dispatch
    convention. The coordinator is the executor — it reads each
    incoming JSONL, applies the high-signal filter, lands surviving
    records as medium entries via ``memory_create``, and reports back
    which JSONLs are fully consumed.
    """
    paths: list[str] = list(bb.incoming_paths or [])

    # Try to inline file contents up to the budget so the agent doesn't
    # need to Read each file. If we exceed the budget, fall back to
    # path-only mode and instruct the agent to Read on demand.
    inline_blocks: list[str] = []
    inline_total = 0
    inline_overflow = False
    for p in paths:
        try:
            text = Path(p).read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            inline_blocks.append(
                f"#### `{p}`\n```\n[read error: {type(e).__name__}: {e}]\n```\n"
            )
            continue
        chunk = f"#### `{p}`\n```jsonl\n{text}\n```\n"
        if inline_total + len(chunk) > _INLINE_PAYLOAD_LIMIT:
            inline_overflow = True
            break
        inline_blocks.append(chunk)
        inline_total += len(chunk)

    paths_json = json.dumps(paths, ensure_ascii=False, indent=2)

    lines: list[str] = [
        "## 治理模式（主 agent 增量记忆蒸馏子循环 — 阶段 5）",
        "",
        "你（主 agent）接到治理子任务。**唯一任务**：对下方 incoming 队列",
        "里的每条 JSONL 记录做语义价值二筛，把入选项压缩进 `.cbim/memory/medium/`。",
        "**不要做能力册扫描** / **不要做 transcript 蒸馏**（那些是别的子任务）。",
        "**不要调** `dna_*` / `agent_*` 工具；只动 `.cbim/memory/`，全程走 `memory_*` MCP 工具。",
        "",
        "### 入选标准（高信号·LLM 二筛）",
        "**入选**（写 medium）：",
        "- 反复出现的设计决策 / 拍板（同一议题第二次以上）",
        "- 长期规则 / 硬约束（'必须' / '绝不' / '原则是'）",
        "- 用户显式记忆请求（'记住' / '记一下' / '备忘'）",
        "- 失败教训（错过一次的具体复盘）",
        "",
        "**丢弃**（进 `skipped_records`）：",
        "- 日常问答、状态查询、工具回执、grep/read 的工具痕迹",
        "- 偶发性疑问 / 已即时解决的小话题",
        "- 与既有 medium 重复（先 `memory_query` 验证）",
        "",
        "### 操作步骤（按序）",
        "1. 逐条 JSONL 记录读判：依入选标准做语义价值判断。",
        "2. 入选项按 MUST / WANT / HOW / IS 四象限压缩成最短可恢复语义。",
        "3. 调 `memory_create(tier=\"medium\", slug=\"incoming-<date>-<n>\")` 落盘",
        "   medium 条目（已存在则更新）。`<date>` 用 JSONL 文件名前缀,",
        "   `<n>` 是该 JSONL 内的序号,起始 1。",
        "4. **不要删 incoming JSONL、不要清空、不要改名**——",
        "   归档是治理循环 `CollectIncomingTriage` 节点的职责，",
        "   它依赖你回报的 `processed_paths`。",
        "5. 装配下方 schema 回执，调 `dream_tick_resume(run_id, dispatch_result=<json>)` 回交。",
        "",
        "### 记忆库根目录（绝对路径）",
        f"`{store_dir}`",
        "",
        f"### 本轮 incoming JSONL 列表（共 {len(paths)} 个，按日期升序）",
        "```json",
        paths_json,
        "```",
        "",
    ]

    if inline_overflow or inline_total == 0:
        lines += [
            "### 文件内容",
            "（队列总量超过 50 KiB 内联预算，**改为按需 Read**：",
            "请用 `Read` 工具按上述路径列表逐文件读取，再做二筛。）",
            "",
        ]
    else:
        lines += ["### 文件内容（已内联，可直接读)"]
        lines.extend(inline_blocks)
        lines.append("")

    lines += [
        "### 回执 schema（严格 JSON,键名钉死）",
        "```json",
        "{",
        '  "processed_paths":         ["<本轮已处理完的 incoming JSONL 绝对路径>", ...],',
        '  "medium_entries_written":  ["<本轮写入或更新的 medium 文件绝对路径>", ...],',
        '  "skipped_records":         [{"path": "<incoming JSONL>", "reason": "low-signal|noise|duplicate", "snippet": "..."}],',
        '  "errors":                  [{"path": "<incoming JSONL>", "error": "<人类可读错误>"}]',
        "}",
        "```",
        "",
        "数组允许为空，但所有 4 个键必须存在。",
        "`processed_paths` 必须只包含**确实已经全员二筛完毕**的 JSONL——",
        "`CollectIncomingTriage` 会无条件把它们移到 `incoming/processed/`。",
        "**含有报错记录的 JSONL 不要放进 `processed_paths`**；",
        "把它放进 `errors` 让下一轮重试（同一文件可同时出现在 `medium_entries_written`",
        "里——表示部分入选写盘了，但因为还有未处理的错误记录，整文件不算消费完）。",
        "",
        "### 铁律（必读）",
        "- 只动 `.cbim/memory/`，不调 `dna_*` / `agent_*`；",
        "- 不删 incoming（删 / 归档交给 CollectIncomingTriage）；",
        "- 不发明内容；medium 条目必须来自 incoming 真实记录。",
        "- 高信号过滤优先，宁可丢也不要污染 medium。",
    ]
    return "\n".join(lines)


def parse_response(payload: str | dict | None) -> dict:
    """Normalize the triage response into ``{"incoming_triage_report": ...}``.

    Tolerance:
      - dict with the four canonical keys → wrapped
      - dict with the explicit ``incoming_triage_report`` wrapper → unwrapped
      - dict carrying ``error`` (no report) → returned as error sentinel
      - str → JSON-parsed; non-JSON treated as raw text error
    """
    if payload is None or (isinstance(payload, str) and not payload.strip()):
        return {"incoming_triage_report": None, "error": "empty response"}

    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (ValueError, TypeError):
            return {
                "incoming_triage_report": None,
                "error": f"non-json response: {payload[:200]!r}",
            }

    if isinstance(payload, dict):
        if "incoming_triage_report" in payload:
            inner = payload["incoming_triage_report"]
            if isinstance(inner, dict):
                return {"incoming_triage_report": _coerce_report(inner)}
            return {
                "incoming_triage_report": None,
                "error": "incoming_triage_report must be a dict",
            }
        if "error" in payload and not any(
            k in payload for k in (
                "processed_paths", "medium_entries_written",
                "skipped_records", "errors",
            )
        ):
            return {
                "incoming_triage_report": None,
                "error": str(payload["error"]),
            }
        return {"incoming_triage_report": _coerce_report(payload)}

    if isinstance(payload, list):
        return {
            "incoming_triage_report": None,
            "error": "response was a list, expected JSON object",
        }

    return {
        "incoming_triage_report": None,
        "error": f"unsupported response type {type(payload).__name__}",
    }


def _coerce_report(d: dict) -> dict:
    return {
        "processed_paths": _as_str_list(d.get("processed_paths")),
        "medium_entries_written": _as_str_list(d.get("medium_entries_written")),
        "skipped_records": _as_list_of_dicts(d.get("skipped_records")),
        "errors": _as_list_of_dicts(d.get("errors")),
    }


def _as_str_list(v: Any) -> list[str]:
    if not isinstance(v, list):
        return []
    return [str(x) for x in v if isinstance(x, (str, int, float))]


def _as_list_of_dicts(v: Any) -> list[dict]:
    if not isinstance(v, list):
        return []
    return [dict(x) for x in v if isinstance(x, dict)]


__all__ = [
    "compose_prompt",
    "parse_response",
]
