---
name: dashboard
owner: architect
description: "Local web dashboard: HTTP server + static UI for inspecting project state"
keywords:
  - dashboard
  - http-server
  - stdlib
  - web-ui
  - inspection
  - json-api
status: implemented
body_edited_at: 2026-07-09T07:59:03Z
dependencies: []
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

- **`esc()` is not sufficient for JS-in-HTML-attribute contexts.** Per WHATWG, event-handler content attributes (`onclick="..."` etc.) are HTML-entity-decoded *before* the value is compiled as JS source; therefore `&#39;` in the source HTML becomes a literal `'` visible to the JS parser and cannot terminate a would-be attacker payload that closes an inline JS string. `esc()` is retained as defense-in-depth for text-node rendering paths but is **not** the boundary that keeps `onclick="fn('${esc(x)}')"` safe. The current safety of these inlined-JS-string call sites depends on an upstream invariant: **every id source that flows into these attributes — memory slug (`_sanitize_slug`), agent name validation, module path validation — rejects the JS/HTML metacharacters `'` `"` `` ` `` `<` `>` `&`**. As of this decision only `_sanitize_slug` enforces the full set; agent-name and module-path validators must be audited before their outputs are trusted in inline-JS-string attributes. **Trigger for revisit:** any upstream id-source relaxes its character set (e.g. permitting apostrophes in agent names), OR a new id source appears that is not covered by an equivalent blacklist. **Follow-up task (deferred, independent scope):** migrate all `onclick="fn('${esc(x)}')"`-style call sites in `dashboard/app.js` to `data-*` attributes + `addEventListener` reading `dataset`, eliminating the user-controlled-string-as-JS-source context entirely. Deferred because (a) it is a renderer-layer refactor, orthogonal to slug hardening; (b) dashboard is 127.0.0.1-only local-read tool — realistic threat model already requires local write access to `.cbim/`, at which point dashboard XSS is not the actual security boundary; (c) doing it opportunistically under a hotfix would smuggle scope. Not to be bundled with slug/validation fixes; requires its own architectural task.
