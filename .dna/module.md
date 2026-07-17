---
name: cbim-kernel
owner: architect
description: "Cbim-CC kernel monorepo: single kernel module installed per-project via install.sh"
keywords: []
status: implemented
body_edited_at: 2026-07-17T06:13:54Z
dependencies: []
---

## Positioning

Cbim-CC kernel monorepo. Develops and packages the CC kernel; `install.sh` clones the repo and copies `v1/kernel/` into each project's `.cbim/kernel/`. Dogfoods CBIM on itself: this repo's own architecture knowledge lives under `.dna/`.

## Origin Context

The kernel must run inside each project's `.cbim/` and serve only that project. Earlier drafts considered a globally-installed kernel with version pinning per project (launcher on PATH + version registry + cross-version migrator), but the operational cost of maintaining cross-version compatibility outweighed the benefit at this scale. The current shape — `install.sh` copies `v1/kernel/` into `<project>/.cbim/kernel/`, kernel runs only against its own project — is a deliberate collapse of that earlier multi-module design into a single kernel module.

## Key Decisions

- **v1 layout collapsed to a single kernel module.** The earlier three-module design (`bin` launcher + `installer`/`updater` + `kernel`) was abandoned. On disk, only `v1/kernel/` exists; there is no launcher binary on PATH, no install-root version registry, no cross-version migrator. Install is a flat copy of `v1/kernel/` into `<project>/.cbim/kernel/` via `install.sh`.

- **Repo layout is `v1/kernel/` + `v1/tests/` + `v1/docs/`.** The `v1/` prefix exists because `v2/` (a separate native-agent experiment) lives in this repo but is out of scope for this `.dna/` tree.

- **Per-project install, no global state.** Each project owns its own `.cbim/kernel/`. Kernel code only ever executes against the project it currently serves. No cross-project, cross-version, or cross-install coordination.

- **Dogfooded `.dna/`.** This repo carries its own `.dna/` tree; architecture changes here are governed by the same kernel CLI that ships to users.

## Class Diagram

```mermaid
classDiagram
    class kernel { <<module>> }
    class tests { <<module>> }
```

`kernel` is the production artifact: `install.sh` copies `v1/kernel/` into each project's `.cbim/kernel/`. `tests` is a sibling harness that exercises the kernel end-to-end through a real `claude -p` subprocess; it is **not** packaged or shipped — it stays in the monorepo for CI and local validation. The `tests → kernel` relationship is a **runtime subprocess invocation** (not a static import), so it is documented in prose here rather than as a `..>` dependency arrow in the class diagram — the R2 direct-child rule reserves diagram arrows for static-dependency edges at the direct-child level, and both `kernel` and `tests` live two path segments below this parent (under the unadopted `v1/` intermediate directory). The earlier three-module design (`bin` launcher + `installer`/`updater` + `kernel`) targeted a globally-installed multi-version layout; that design was abandoned in favour of the current per-project flat-copy install (`install.sh` → `<project>/.cbim/kernel/`). No launcher binary, no version registry, no cross-version migrator exists on disk.

