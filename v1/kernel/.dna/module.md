---
name: cbim-kernel-pkg
owner: architect
description: CBIM 内核 Python 包，承载引擎/记忆/CBI/服务/仪表盘/MCP，单 install 路径
keywords:
  - kernel
  - install
  - package
  - runtime
  - single-entry
  - project-local
status: implemented
body_edited_at: 2026-07-09T07:59:03Z
dependencies: []
---

## Positioning

This module IS the CBIM kernel Python package — the single code drop that powers every per-project CBIM operation: CLI commands, Claude Code hook handlers, memory engine, dashboard server, MCP server, agent/skill primitives, and project bootstrap.

The whole package is installed verbatim under `<project>/.cbim/kernel/` by the `/cbim_install` slash command. There is exactly one install path (download tree + run `python -m engine init`) and exactly one runtime entry — the shim `.cbim/run` (POSIX) or `.cbim/run.cmd` (Windows), which sets `PYTHONPATH=<project>/.cbim/kernel` and execs `python -m engine "$@"`. No `cbim` binary on `PATH`. No global venv. No multi-version staging. No version pin.

## Origin Context

A CBIM "install" is just a directory tree. The user runs `/cbim_install` inside a project; that downloads this whole kernel package into `<project>/.cbim/kernel/` and runs `python -m engine init` once. Init writes the shim `.cbim/run`, installs the 4 agents under `.claude/agents/`, installs the 6 slash commands under `.claude/commands/`, installs the 7 in-process hook bridges under `.claude/hooks/cbim_*.py` (snapshot copied from `project/hooks_src/`), merges hook + MCP config into `.claude/settings.json`, drops a `CLAUDE.md`, and appends `.cbim/` to `.gitignore` plus the `permissions.deny` entries that keep LLM tools out of `.cbim/`. From then on the user (and Claude Code) invoke the kernel only via the shim — and LLM-driven writes to `.dna/`, `.claude/agents/`, and `.cbim/memory/` go through the `cbim` MCP server, never through raw `Write`/`Edit`.

Sub-modules exist because each one corresponds to a distinct invocation trigger or audience:

- `engine/` — invoked once per CLI command (human-typed; LLM `Bash` is blocked from `.cbim/run *` by `permissions.deny`)
- `dashboard/`, `mcp_server/` — long-lived servers spawned on demand. `mcp_server` exposes governance tools to the LLM over stdio; the dashboard serves the local web UI.
- `cbi/` — read at design time by agents (resources: Agent / Skill / DNAModule / Memory)
- `memory/` — persistent store accessed by hooks (in-process) and by the engine on user request
- `project/` — touched only at install / init / `project sync`; no runtime role. Source of truth for the agents, commands, hook scripts (under `hooks_src/`), templates, and `permissions.deny` entries that get snapshotted into the user's project.
- `services/` — façade layer so `mcp_server` and `dashboard` never reach into `cbi`/`memory` internals directly
- `context.py` — shared infrastructure imported by everyone for path resolution

Hook subprocesses are install-time snapshots, not a kernel sub-module: they live at `project/hooks_src/cbim_*.py` (source of truth) and execute from `.claude/hooks/cbim_*.py` after init. They bootstrap `<project>/.cbim/kernel/` onto `sys.path` and call kernel functions in-process — there is no MCP transport, no UDS, no subprocess hop into the server. One trigger family per sub-module. A change in the MCP wire protocol stays inside `mcp_server`; a change in hook behaviour stays inside `hooks_src/`.

## Key Decisions

- **Single runtime entry: the shim `.cbim/run` → `python -m engine`.** No `cbim` binary on `PATH`, no global venv, no installer/updater. The kernel lives at exactly one location per project (`<project>/.cbim/kernel/`) and is invoked exactly one way. Uninstall = `rm -rf .cbim/ .claude/agents/{architect,auditor,hr,programmer}/ .claude/commands/cbim_*.md .claude/hooks/cbim_*.py`. Refresh = re-run `/cbim_install` (idempotent).
- **`context.py` is a leaf file with two public root-resolution faces.** `project_root()` is STRICT (raises when no `.cbim/` is found); `resolve_root_or_cwd()` is LENIENT (degrades to `cwd`). Runtime entry points use the strict face so misconfig fails loudly; CLI / tests / service internals use the lenient face so scratch directories and ad-hoc invocations keep working. Both share the same env-var override (`CBIM_PROJECT_ROOT`) and the same hard home-directory boundary — the home guard is never relaxed (it exists because earlier `~/.cbim/` walks silently clobbered user-global state). `services/_fm.py` no longer holds its own `find_project_root` copy; all walk-up logic is owned by `context.py`.
- **`atomic_io.py` is a leaf file at the kernel root, sibling to `context.py`.** stdlib-only, zero kernel dependencies, importable from every layer. Owns `atomic_write_bytes` / `atomic_write_text` (write to `*.tmp` → fsync → `os.replace` → fsync parent dir) and `fsync_dir` (POSIX-only effective; Windows silently no-ops). File-level fsync failures propagate; directory-level fsync failures are swallowed. Any failure path cleans up the leftover `.tmp`. The filename is **`atomic_io.py`** (not `_io.py`) because it is a public primitive every kernel layer consumes — not a private helper. `engine/persistence` and any other writer that needs whole-file atomic replace MUST go through it instead of hand-rolling tmp+replace.
- **`context.py` and `atomic_io.py` are leaves, not sub-packages.** Every sub-module imports `from context import project_root, resolve_root_or_cwd, cbim_dir, kernel_root` and `from atomic_io import atomic_write_bytes, atomic_write_text`. Promoting either to a package would invert the dependency graph (everyone would depend on a sub-module that itself depends on nothing). Keeping them as single files at the kernel root makes their "shared kernel primitive" status structurally obvious.
- **`services/` exists so `mcp_server/` and `dashboard/` never reach into `cbi/` or `memory/` directly.** Both servers are surface-area-heavy; without the facade layer they would pin kernel internals as their public API. `services/` is the read-write double-faced facade — every governance read AND every governance write flows through it; tool layers (MCP / CLI / dashboard) are thin shells.
- **`project/` is the only sub-module that mutates the user's filesystem outside `.cbim/`.** Init writes `.claude/agents/`, `.claude/commands/`, `.claude/hooks/cbim_*.py`, `.claude/settings.json` (hooks + mcpServers + permissions.deny), `CLAUDE.md`, `.gitignore`, `.claudeignore`. Every other sub-module reads or writes inside `.cbim/` only.
- **MCP is the LLM write path; hooks are in-process.** All LLM-initiated writes to `.dna/`, `.claude/agents/`, and `.cbim/memory/` flow through `mcp_server/` (`dna_*`, `agent_*`, `memory_*` tools), which delegate to `services/`. Hook subprocesses (Claude Code lifecycle callbacks) bypass MCP entirely: they bootstrap `<project>/.cbim/kernel/` onto `sys.path` and call `memory.*` / `cbi.*` / `engine.*` directly. Hooks are trusted by the Claude Code framework — `permissions.deny` does not apply to them, only to LLM-driven tool calls.
- **Hook subprocesses can write `.cbim/` data directories, but never `.cbim/kernel/`.** Permitted writes: `.cbim/memory/short/`, `.cbim/logs/`, `.cbim/scheduler/`, `.cbim/.cc-status`, `.cbim/.debug`. The kernel code drop at `.cbim/kernel/` is owned by `/cbim_install` and never mutated by hooks.
- **`.cbim/` is invisible to LLM tools.** `permissions.deny` blocks `Read(.cbim/**)` and `Bash(.cbim/run *)`; `.claudeignore` hides it from indexing. Hooks are exempt — they are framework-level lifecycle callbacks, not LLM tool calls.
- **Sub-package vs leaf file is a deliberate axis.** `context.py` and `atomic_io.py` are files because each has zero internal structure to encapsulate — dual root-resolution faces are still one cohesive responsibility, and atomic writes are three small functions over the same primitive. Every other sub-module is a package because it has at least two collaborators that benefit from a shared boundary.

## Non-Goals

- No installer, updater, upgrade flow, migrate command, version pin, `versions.json`, `.cbim/.pin`, or `cbim_kernel.context` legacy import path.
- No `bin/` directory, no `cbim` launcher script on PATH, no global venv at `~/.cbim/`.
- No multi-version kernel staging. Each project carries its own kernel copy at `<project>/.cbim/kernel/`. To "upgrade", re-run `/cbim_install`.

## Class Diagram

```mermaid
classDiagram
    class engine { <<module>> }
    class project { <<module>> }
    class cbi { <<module>> }
    class memory { <<module>> }
    class services { <<module>> }
    class dashboard { <<module>> }
    class mcp_server { <<module>> }

    engine ..> project : delegates init / sync
    engine ..> cbi : delegates dna / agent / skill / snapshot
    engine ..> memory : delegates memory ops
    engine ..> dashboard : delegates dashboard start
    engine ..> mcp_server : delegates mcp stdio
    engine ..> services : CLI handlers route through services
    services ..> cbi : reads via primitives
    services ..> memory : reads via memory facade
    services ..> engine : reads engine config + retrieval (inline reindex)
    mcp_server ..> services : tools call service facades (read AND write)
    mcp_server ..> memory : tools read memory
    mcp_server ..> engine : tools read engine state + drive bt_tick / dream_tick
    dashboard ..> services : panels read service facades
    project ..> cbi : reads templates at install time only
```

Dependency direction is strict and unidirectional. The stable bottom: `context.py` and `atomic_io.py` (two leaf files at the kernel root, not sub-modules), `cbi`, `memory`. Mid-tier: `services`, `project`. Top-tier (orchestrators): `engine`, `dashboard`, `mcp_server`. Nothing below imports anything above. `cbi` and `memory` import only from `context` / `atomic_io` and their own internals.

Hook subprocesses are not a sub-package of the kernel: they live as install-time snapshots under `project/hooks_src/cbim_*.py`, get copied into `.claude/hooks/` at init, and bootstrap `<project>/.cbim/kernel/` onto `sys.path` to import `memory.*` / `cbi.*` / `engine.*` directly. No subprocess-to-server transport.

Loose kernel-root artefacts: `__init__.py` (exposes `__version__` read from `VERSION`), `VERSION` (single-line semver string), `requirements.txt` (runtime dependencies), `context.py` (shared root-resolution primitives — see below), `atomic_io.py` (shared atomic file-write primitives — see below).

**`context.py` — dual-faced root resolver.** Two public functions, one strict and one lenient, sharing the same env-var override (`CBIM_PROJECT_ROOT`) and the same hard home-directory boundary:

- `project_root(cwd=None)` — STRICT. Walks up looking for `.cbim/config.json` (preferred) or a bare `.cbim/` directory; raises `RuntimeError` when the walk hits the filesystem root with no marker found, or when it reaches `Path.home()`. Used by runtime entry points (MCP server, dashboard, hooks) where a missing project is a misconfig that must fail loudly.
- `resolve_root_or_cwd(cwd=None)` — LENIENT. Same walk + same home guard, capped at 10 ancestors (preserving the legacy `services._fm.find_project_root` budget); returns `cwd.resolve()` unchanged when no marker is found. Used by CLI handlers, tests, and service internals where running outside a CBIM project is legitimate (scratch dirs, ad-hoc invocations).
- The home-directory boundary is **never relaxed** — treating `~/.cbim/` as a project root previously caused `cbim init` to silently overwrite user-global state, so both faces refuse to return `Path.home()` regardless of mode.
- `services/_fm.py` no longer holds a private `find_project_root`; all walk-up logic is consolidated here. Services and CLI consume `project_root` / `resolve_root_or_cwd` directly.
- `kernel_root()` (env var `CBIM_KERNEL_ROOT` or `Path(__file__).parent`) and `cbim_dir()` (`project_root() / ".cbim"`) round out the public surface.

**`atomic_io.py` — atomic file-write primitives.** Sibling of `context.py`: a leaf file with zero kernel dependencies (stdlib only), importable from any layer.

- `atomic_write_bytes(path, data, *, fsync=True)` and `atomic_write_text(path, text, *, encoding="utf-8", fsync=True)` write to `<path>.tmp`, fsync the file payload (when `fsync=True`), `os.replace` onto the target, then fsync the parent directory.
- `fsync_dir(path)` — best-effort directory fsync; on Windows `os.fsync` of a directory raises `OSError` and is silently swallowed (Windows offers no equivalent guarantee via this API).
- File-level fsync failures **propagate** (caller's data is genuinely not durable yet); directory-level fsync failures are silently swallowed.
- Any failure path attempts to remove the leftover `.tmp` so the workspace never accumulates partial files; cleanup exceptions are suppressed.
- Note: the file is named `atomic_io.py`, NOT `_io.py` — it is a public leaf consumed by every kernel layer (persistence, cbi, memory, services), not a private helper.
