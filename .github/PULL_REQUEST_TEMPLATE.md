<!--
Thanks for contributing to CBIM. Please fill out the sections below.
Keep the description focused on what changed and why.
-->

## Summary

<!-- One or two sentences: what does this PR change? -->

## Related issue

<!-- e.g. "Fixes #123" / "Refs #456" / "N/A" -->

## Type of change

<!-- Check one or more -->

- [ ] feat — new feature
- [ ] fix — bug fix
- [ ] docs — documentation only
- [ ] refactor — internal refactor, no behavior change
- [ ] test — test additions / fixes
- [ ] chore — tooling / housekeeping
- [ ] ci — CI / build config

## How was this tested?

<!--
Describe the test approach. At minimum, the default suite must pass:

    pytest v1/tests/ -m "not workflow"

If you added new tests, mention them here. If a change is intentionally
untested (e.g. doc-only), say so.
-->

## Self-check

<!-- All boxes must be checked before requesting review. -->

- [ ] `pytest v1/tests/ -m "not workflow"` passes locally
- [ ] No new third-party dependency introduced (or justified in Summary)
- [ ] No `print`-style debugging left in committed code
- [ ] **No governance files committed** — `.cbim/`, `.claude/`, `CLAUDE.md`, `.mcp.json`, `.claudeignore` are NOT in this PR (see [CONTRIBUTING.md](../CONTRIBUTING.md) "Red line")
- [ ] Commit messages follow the convention in `CONTRIBUTING.md`
- [ ] Branch is up to date with `master`
