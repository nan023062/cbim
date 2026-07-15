---
name: mcp-server
owner: architect
description: MCP stdio 工具服务器：暴露 dna/agent/skill/memory/audit 等内核治理工具给 LLM
keywords:
  - mcp
  - stdio
  - tools
  - llm-write
  - governance
  - services-shell
status: implemented
body_edited_at: 2026-07-14T10:21:58Z
dependencies: []
---

## Positioning

MCP (Model Context Protocol) server exposing kernel ops as MCP tools over stdio for LLM tool calls. Tools defined under `tools/` — split by governance domain:

- **agent** — `agent_list`, `agent_show`, `agent_scaffold`, `agent_update`, `agent_add_skill`, `agent_archive`
- **dna** — `dna_list`, `dna_show`, `dna_reindex`, `dna_init`, `dna_edit`, `dna_split`, `dna_write_doc` (deprecated), `dna_write_section` (deprecated)
- **memory** — `memory_query`, `memory_get`, `memory_list`, `memory_create`, `memory_delete`, `memory_reindex`, `memory_cleanup`
- **skill** — read: `skill_list`, `skill_show`; write: `skill_create`, `skill_update`, `skill_delete`, `skill_add_asset`, `skill_remove_asset`
- **snapshot** — `project_snapshot` (read-only)
- **scheduler** — task scheduler control surface (`scheduler_status`, `scheduler_trigger`)
- **runtime** — slash-command back-end: `dashboard_ensure_running`, `debug_get`, `debug_set`, `log_show`
- **audit** — read-only governance drift checks: `audit_run`, `audit_list_checks`

Background tasks under `tasks/` (heartbeat).

The server lifespan owns the embedded task scheduler. Hook subprocesses do NOT call this server — they run in-process and import kernel modules directly (see `project/hooks_src/`).

## Class Diagram

```mermaid
classDiagram
    class server {
        +main()
        +register_tools()
    }
    class scheduler {
        +run_task(name)
    }
    class dna_tool
    class agent_tool
    class skill_tool
    class snapshot_tool
    class scheduler_tool
    class heartbeat_task
    server --> dna_tool
    server --> agent_tool
    server --> skill_tool
    server --> snapshot_tool
    server --> scheduler_tool
    scheduler --> heartbeat_task
    dna_tool --> SVC[services.KnowledgeService]
    agent_tool --> SVC2[services.AgentService]
    skill_tool --> SVC3[services.SkillService]
```

## Key Decisions

- **All read AND write tools talk to `services/`, not to `cbi/_primitives` or `memory/` internals directly.** Preserves the facade boundary as a one-way wall: `mcp_server.tools.* → services.*`. Any tool reaching past services into a private primitive is a regression — the audit `index_consistency` check (and only it) is the permanent white-box exception, see below.
- **Banned-api lock targets `cbi._primitives` (NOT `cbi.resources`).** The forbidden import surface is the underscore-prefixed internal package; the rich resource model under `cbi.resources` is legitimate public API and stays available to tool layers that need object-shaped access (CLI handlers in particular consume `cbi.resources` directly). The white-box client allowlist for `cbi._primitives` is exactly four call sites: `services` (the only general-purpose facade), `cbi.resources` (the wrapper layer that owns the public object model), `engine.audit.checks.index_consistency` (the permanent governance white-box check that compares index state against primitives — see `engine/audit/.dna/`), and `project.hooks_src` (install-time snapshot bootstrap). Any other client triggers an audit failure.
- **Reindex is not a tool-layer responsibility.** The retrieval index is updated as the synchronous side-effect of every governance write inside `services/` (via `services/_reindex.py`). MCP tools therefore do not post-process service results to upsert / delete index entries, and they do not need a per-tool reindex hook. The legacy `dna_reindex` tool still exists for explicit user-driven full rebuilds (and as the path that bootstraps an empty registry on a clean repo), but the steady state is the per-write inline call in services. New tool authors MUST NOT re-introduce per-tool reindex logic.
- **MCP server is the LLM write path only.** Hook subprocesses (Claude Code lifecycle callbacks) bypass MCP entirely and import kernel modules in-process; `mcp` SDK is therefore a soft dependency, required only when the LLM wants to call governance tools.
- **Slash commands talk to MCP tools, never to a Bash CLI.** Project-side `.claude/commands/cbim_*.md` invoke `mcp__cbim__*` tools (e.g. `dashboard_ensure_running`, `debug_set`, `log_show`). Shelling out to `cbim ...` from a slash command is a regression — it bypasses MCP logging, ignores `.cbim/` read-permission denials, and routes through whatever `cbim` binary the user's PATH happens to find (often a stale global pin-launcher, not the project kernel).

- **MCP deprecated 工具（`dna_write_doc` / `dna_write_section`）计划下一个 minor release（1.1.0）移除；Batch 4 仅加 stderr 警告，未删。** `mcp_server/tools/dna.py` 中两个工具函数体首行 `print("[DEPRECATED] ... will be removed in the next minor release (1.1.0); use dna_edit(target='body' or 'contract') / dna_edit(target='section' or 'contract-section') instead.", file=sys.stderr)`，工具本身还读、返回值还走原服务层路径（`KnowledgeService`）以保证调用者不崩。`dna_edit(target="body"|"section"|"contract"|"contract-section")` 是完整的后继趋面。下一个 minor release 一起删两个工具函数 + `register_dna_tools()` 中的注册调用 + 对应单测。迁移路径与 CLI 一致：`dna edit --target {body|section|contract|contract-section}`。

- **D8 收官（2026-07-10）**：Task 2+3 完成——`dna_edit` 新增 `target="note"` 分支（`mode: create / update / delete`，payload 与 `target="workflow"` 对称）；`dna_show` 新增 `include_notes: bool` 参数支持 note 全文读取（默认 False，向后兼容）。全部路由 `services/` facade，MCP 层保持薄壳——与本模块“所有写工具需走 services/”铁律对齐。

- **`mcp_server/tools/skill.py` 从只读升级为读写双面，5 个写侧工具已落地（2026-07-14）**。工具体保持“服务层薄壳”铁律——仅参数验证 + 转调 `services.SkillService.*` + 错误文字化（异常 → `f"ERROR: {e}"` 字符串）。

  | 工具名 | 参数 | 返回 | 服务层目标 |
  |---|---|---|---|
  | `skill_create` | `agent_name: str`, `skill_name: str`, `body: str = ""`, `as_dir: bool = False` | 创建后的 skill 路径（字符串）或 `ERROR: ...` | `SkillService.create_agent_skill` |
  | `skill_update` | `agent_name: str`, `skill_name: str`, `target: str`, `payload: dict` | 保存后的 skill 路径或 `ERROR: ...` | `SkillService.update_agent_skill` |
  | `skill_delete` | `agent_name: str`, `skill_name: str` | 被删除的路径或 `ERROR: ...` | `SkillService.delete_agent_skill` |
  | `skill_add_asset` | `agent_name: str`, `skill_name: str`, `asset_rel_path: str`, `content: str`, `is_executable: bool = False` | 新建资产的路径或 `ERROR: ...` | `SkillService.add_skill_asset` |
  | `skill_remove_asset` | `agent_name: str`, `skill_name: str`, `asset_rel_path: str` | 被删除资产的路径或 `ERROR: ...` | `SkillService.remove_skill_asset` |

  **MCP 层铁律，不可下沉到服务层之内**：

  - **花名禁写 4 个内置名字**。工具层先判 `agent_name ∈ {"architect","auditor","hr","programmer"}` → 直接返 `ERROR: cannot manage core kernel agent via skill_*`，无需进服务层（服务层同样拒——两道防护）。
  - **path traversal 直接转发**。agent_name / skill_name 中包含 `/` `\` `..` `.` → 代服务层报 `ValueError` 包装为 `ERROR: invalid <kind> name: ...`。asset_rel_path traversal 报错同理 — 服务层 `PathOutsideRootError` → `ERROR: asset path escapes skill assets/`。
  - **is_executable 只在 `skill_add_asset` 出现**。默认 False。调用者需显式传 True 才能写可执行后缀（服务层拒写 → `ERROR: is_executable flag required for suffix ...`）。
  - **错误形状与现有 agent_* 工具一致**。字符串方式返回 `ERROR: <msg>` ——目前 MCP 层未使用异常 propagation，不引入新风格。
  - **服务层一致入口**。新工具不得 import `cbi._primitives.skills`，不得 import `cbi.resources.Skill`（遇到需要都说明同处服务层尚未提供，需回头扩服务层，而不是跨层）。已有 `skill_list` / `skill_show` 只读工具保持不变。
  - **register 方法集中注册**。`register(mcp)` 一个函数里声明 7 个工具（旧 2 + 新 5）；`mcp_server/server.py` 现有的 `register(mcp)` 机制自动发现，无需额外注册。

- **环境事实（当前源码领先于 vendored 部署）**。MCP server 运行时实际加载 `.cbim/kernel/` 的 vendored 副本——本轮新增的 5 个 MCP `skill_*` 工具与 `SkillService` 写侧方法需一次 `/cbim_install` 同步后才在当前项目内可用。该事实属于部署层商定，不影响本模块源码层的设计锚定。

## Non-Goals

- **No hook transport.** Hook subprocesses do not connect to this server (no UDS listener, no hook-facing MCP tools). Hook reliability is decoupled from server liveness.

