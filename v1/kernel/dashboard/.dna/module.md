---
name: dashboard
owner: architect
description: Local web dashboard: HTTP server + static UI for inspecting project state
keywords:
  - dashboard
  - http-server
  - stdlib
  - web-ui
  - inspection
  - json-api
dependencies: []
status: implemented
---

## Positioning

Local web dashboard for inspecting CBIM project state. Stdlib-only HTTP server (`server.py`) serving static UI assets (`index.html`, `app.js`, `style.css`, vendored `marked`/`purify`) and a thin JSON API backed by `services/`.

## Class Diagram

```mermaid
classDiagram
    class server {
        +run(port, auto_open)
        +handle_api(request)
    }
    class dashboard {
        +main entry: `cbim dashboard`
    }
    class UI {
        index.html + app.js + style.css
    }
    dashboard --> server
    server --> SVC[services.*]
    UI -.-> server : fetch JSON API
```

## Key Decisions

- **Stdlib HTTP only — no Flask/FastAPI.** The dashboard ships inside every kernel version; adding a web framework would balloon the install footprint for a tool most users rarely open.
- **Vendored frontend deps** (`marked`, `purify`, `mermaid`). Avoids per-project npm install for offline use. Bundles live under `dashboard/vendor/`, loaded by `index.html` via local `<script>` tags — no CDN, no runtime fetch.
- **Mermaid bundle size (3.2MB) is a deliberate accepted tradeoff.** The official UMD `mermaid@10.9.3/dist/mermaid.min.js` is 3.2MB — above the 2MB heuristic used for runtime-served assets. Accepted here because (a) dashboard is a local offline tool, so the bundle never traverses a user network; (b) the only cost is git-clone size inside the submodule; (c) the alternative (custom-built subset bundle, ~1.3-1.6MB) would prematurely lock the CBIM-wide diagram-type whitelist, which is an independent architectural decision not yet ripe. Revisit only if a) CBIM formally scopes its supported diagram DSL, or b) a slim UMD becomes officially available upstream.
- **Size threshold scope.** The 2MB size-budget heuristic applies to **runtime-served** assets (things the user's browser fetches over the network). Local vendored dev/inspection assets (dashboard, offline tooling) are governed by clone-time impact only and are not bound by the 2MB number. Any single vendored bundle >5MB still requires architect sign-off.

