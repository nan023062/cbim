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
dependencies: []
status: implemented
---

## Positioning

MCP (Model Context Protocol) server exposing kernel ops as MCP tools over stdio for LLM tool calls. Tools defined under `tools/` — split by governance domain:

- **agent** — `agent_list`, `agent_show`, `agent_scaffold`, `agent_update`, `agent_add_skill`, `agent_archive`
- **dna** — `dna_list`, `dna_show`, `dna_reindex`, `dna_init`, `dna_edit`, `dna_split`, `dna_write_doc` (deprecated), `dna_write_section` (deprecated)
- **memory** — `memory_query`, `memory_get`, `memory_list`, `memory_create`, `memory_delete`, `memory_reindex`, `memory_cleanup`
- **skill** — `skill_list`, `skill_show` (read-only)
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
```

## Key Decisions

- **All read AND write tools talk to `services/`, not to `cbi/_primitives` or `memory/` internals directly.** Preserves the facade boundary as a one-way wall: `mcp_server.tools.* → services.*`. Any tool reaching past services into a private primitive is a regression — the audit `index_consistency` check (and only it) is the permanent white-box exception, see below.
- **Banned-api lock targets `cbi._primitives` (NOT `cbi.resources`).** The forbidden import surface is the underscore-prefixed internal package; the rich resource model under `cbi.resources` is legitimate public API and stays available to tool layers that need object-shaped access (CLI handlers in particular consume `cbi.resources` directly). The white-box client allowlist for `cbi._primitives` is exactly four call sites: `services` (the only general-purpose facade), `cbi.resources` (the wrapper layer that owns the public object model), `engine.audit.checks.index_consistency` (the permanent governance white-box check that compares index state against primitives — see `engine/audit/.dna/`), and `project.hooks_src` (install-time snapshot bootstrap). Any other client triggers an audit failure.
- **Reindex is not a tool-layer responsibility.** The retrieval index is updated as the synchronous side-effect of every governance write inside `services/` (via `services/_reindex.py`). MCP tools therefore do not post-process service results to upsert / delete index entries, and they do not need a per-tool reindex hook. The legacy `dna_reindex` tool still exists for explicit user-driven full rebuilds (and as the path that bootstraps an empty registry on a clean repo), but the steady state is the per-write inline call in services. New tool authors MUST NOT re-introduce per-tool reindex logic.
- **MCP server is the LLM write path only.** Hook subprocesses (Claude Code lifecycle callbacks) bypass MCP entirely and import kernel modules in-process; `mcp` SDK is therefore a soft dependency, required only when the LLM wants to call governance tools.
- **Slash commands talk to MCP tools, never to a Bash CLI.** Project-side `.claude/commands/cbim_*.md` invoke `mcp__cbim__*` tools (e.g. `dashboard_ensure_running`, `debug_set`, `log_show`). Shelling out to `cbim ...` from a slash command is a regression — it bypasses MCP logging, ignores `.cbim/` read-permission denials, and routes through whatever `cbim` binary the user's PATH happens to find (often a stale global pin-launcher, not the project kernel).

- **MCP deprecated 工具（`dna_write_doc` / `dna_write_section`）计划下一个 minor release（1.1.0）移除；Batch 4 仅加 stderr 警告，未删。** `mcp_server/tools/dna.py` 中两个工具函数体首行 `print("[DEPRECATED] ... will be removed in the next minor release (1.1.0); use dna_edit(target='body' or 'contract') / dna_edit(target='section' or 'contract-section') instead.", file=sys.stderr)`，工具本身还读、返回值还走原服务层路径（`KnowledgeService`）以保证调用者不崩。`dna_edit(target="body"|"section"|"contract"|"contract-section")` 是完整的后继趋面。下一个 minor release 一起删两个工具函数 + `register_dna_tools()` 中的注册调用 + 对应单测。迁移路径与 CLI 一致：`dna edit --target {body|section|contract|contract-section}`。

## Non-Goals

- **No hook transport.** Hook subprocesses do not connect to this server (no UDS listener, no hook-facing MCP tools). Hook reliability is decoupled from server liveness.
