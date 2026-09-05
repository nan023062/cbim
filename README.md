# CBIM

[English](README.md) | [中文](README.zh-CN.md)

CBIM (Capability–Business Independence + Memory) separates **portable capability** (Agents and Skills), **project business knowledge** (module-local `.dna/`), and **explicitly saved memory**.

[V1](v1/) runs on Claude Code using user-invoked main-session Skills and a local Python data layer. [V2](v2/) is a separate implementation; the V1 simplification does not change it.

## V1 working model

- **No Skill invoked: normal Claude Code behavior.** CBIM does not classify, route, dispatch or gate ordinary requests.
- **Matching Skill: work in the main conversation.** Claude Code may select a Skill when its description clearly matches the request; the user may also invoke it explicitly. If no Skill matches, use normal Claude Code behavior. Specialist Agents remain reusable capabilities, not mandatory stages.
- **Memory is explicit.** Save, query or organize it only at the user's request. No conversation capture, automatic recall, distillation or source deletion.
- No behavior tree, background governance, lifecycle hooks, MCP server or scheduled Claude process.
- Keep the useful foundations: resource management, schemas, path checks, atomic writes, module registry, retrieval, knowledge graph and manual audits.

This is an experiment in reducing workflow overhead while preserving useful knowledge boundaries, not a guarantee of bounded context or improved accuracy.

## User-invoked Skills

| Skill | Purpose |
|---|---|
| `/cbim-knowledge` | Read relevant modules, contracts, notes and business workflows |
| `/cbim-code` | Locate and explain source code for a requested scope |
| `/cbim-architecture` | Design or update business architecture for the requested change |
| `/cbim-development` | Implement and verify a scoped change without mandatory delegation |
| `/cbim-memory` | Explicitly save, query or organize selected memory |

Native Skills are installed at `.claude/skills/<name>/SKILL.md`, with `user-invocable: true` and no `disable-model-invocation` or `context: fork`. Claude Code may automatically match a clearly relevant Skill; an unmatched request uses default behavior. Agent-private Skills and Python built-in method texts remain separate mechanisms.

Example: `/cbim-knowledge explain the payment module's contract`. This does not implicitly read memory or start an architect Agent.

## Install and upgrade

Requires Python 3.10+, Git, Claude Code, and Bash for the shell installer (including Windows Git Bash). The project-local launchers support POSIX and Windows.

**Source checkout:** review and run this checkout's `install.sh` as described in [installation reference](v1/docs/INSTALL.zh-CN.md). The remote `master` installer installs the published branch, not uncommitted changes in your checkout. Do not use a remote download to verify this refactor before it is released.

The installer vendors `v1/kernel/` into the selected project's `.cbim/kernel/`, creates a project-local Python environment and launchers, and installs capability assets and explicit Skills. It does not install MCP, register lifecycle hooks, start a service, or alter global Claude settings. Existing user permissions remain in force.

Use `.cbim/run --help` from a human terminal (Windows: `.cbim/run.cmd --help`) for the current CLI. There is no global `cbim` command. A Skill does not grant shell access: if the host denies this entry point, stop and report the restriction rather than removing deny rules or using another path to the same data.

**Existing installations:** explicit synchronization can remove narrowly recognized legacy CBIM project registrations while preserving other tools and user settings. It does not unregister operating-system tasks or delete runtime data. Review existing system tasks and customized coordinator instructions separately. Source changes do not upgrade the containing project automatically.

**Uninstall:** first back up memory, business knowledge, capability assets and any historical records you need. Remove only verified CBIM executable assets and registrations. Do not recursively delete `.cbim/` as a routine uninstall: it contains user data as well as code. No automatic data purge is provided.

## Data layout

```text
project/
├── .claude/
│   ├── agents/                 # portable specialist definitions and private Skills
│   ├── skills/                 # explicit main-session entry points
│   └── commands/               # manual installation/help/diagnostic commands
├── src/<module>/.dna/
│   ├── module.md               # required module metadata and architecture
│   ├── contract.md             # optional contract
│   ├── notes/                  # optional business notes
│   └── workflows/              # optional business process descriptions
└── .cbim/
    ├── run / run.cmd           # local launchers
    ├── .venv/                  # managed Python environment
    ├── kernel/                 # installed V1 source
    ├── config.json
    ├── index.md                # module registry
    ├── index/                  # derived retrieval/graph data
    └── memory/medium/          # explicitly saved entries
```

A root `.dna/` is optional. Business workflows are knowledge files, not executable dispatch trees. Existing `short`, candidates, logs and old execution state are not automatically migrated or deleted.

## Retained manual capabilities

- Agent/Skill management, including assets and executable-asset declarations.
- Module/contract/note/workflow management, split, snapshot and reindex.
- Memory storage, lookup, health checks and explicit maintenance.
- BM25 text retrieval and knowledge graph queries. Optional backend structures remain; the Local/OpenAI retrieval embedding providers are currently unwired placeholders, separate from the optional Chroma memory backend.
- Read-only audits and optional baseline management.

A user-requested write may synchronize its indexes. This is operation consistency, not an autonomous workflow. Index failures must be visible; no background process will silently repair them later.

## Development

Tests live in `v1/tests/`; kernel imports are configured by the test fixtures. Run tests with temporary project/home directories and no access to an existing installation. Real Claude integration tests are opt-in and distinct from ordinary unit tests. Git hooks and CI remain development tooling, not CBIM runtime triggers.

- [V1 architecture](v1/docs/ARCHITECTURE.zh-CN.md)
- [Installation reference](v1/docs/INSTALL.zh-CN.md)
- [Module format](v1/docs/MODULE-MD-DESIGN.zh-CN.md)
- [Explicit memory](v1/docs/MEMORY-REDESIGN.zh-CN.md)
- [Exception handling](v1/docs/EXCEPTION-GOVERNANCE.zh-CN.md)

## License

[MIT](LICENSE)
