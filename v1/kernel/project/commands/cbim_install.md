---
description: Install or refresh the CBIM V1 kernel and native project Skills
---
# /cbim_install

Install or refresh CBIM V1 in the current project. The operation is explicit and
project-local: it does not install MCP, lifecycle hooks, schedulers, dashboards,
or background services.

## What it does

1. Confirms the current project root.
2. Installs `v1/kernel/` into `<project>/.cbim/kernel/` and creates the local launcher.
3. Initializes project configuration, the module registry, and `memory/medium/`.
4. Installs reusable agents and native main-session Skills under `.claude/`.
5. Preserves existing user-authored agents, Skills, commands, settings, CLAUDE.md,
   `.dna/`, memory, indexes, and other runtime data.
6. Removes only precisely recognized legacy CBIM registrations when explicitly
   synchronizing; third-party hooks, MCP entries, permissions, and metadata stay intact.

## Source development

For source development, use a temporary project and isolated home/configuration
paths. The root `install.sh` is a bootstrap convenience for a published checkout;
it does not represent a background runtime and must not be used to upgrade the
containing Nan-Li project implicitly.

## After install

Use `.cbim/run --help` (Windows: `.cbim/run.cmd --help`) for the available explicit
CLI operations. Claude Code may automatically match a native Skill when its
specific description fits a request; users may also invoke a Skill explicitly.
Unmatched requests use normal Claude Code behavior. Memory is read or written only
when the user explicitly asks.

## Uninstall and legacy data

There is no automatic data purge. Back up data first, then remove only verified CBIM
source assets and registrations. Do not recursively delete `.cbim/`; existing logs,
indexes, memory, and legacy scheduler data are preserved unless the user separately
requests their cleanup.
