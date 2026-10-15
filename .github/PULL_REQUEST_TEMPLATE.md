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
Describe the test approach. At minimum, the solution should build and the
automated tests should pass:

    dotnet build src/cbim.sln --no-restore
    dotnet test src/cbim.sln --no-build

If you added new tests, mention them here. If a change is intentionally
untested (e.g. doc-only), say so.
-->

## Self-check

<!-- All boxes must be checked before requesting review. -->

- [ ] `dotnet build src/cbim.sln --no-restore` passes locally
- [ ] `dotnet test src/cbim.sln --no-build` passes locally
- [ ] No new third-party dependency introduced (or justified in Summary)
- [ ] No debug output or generated files left in committed code
- [ ] Commit messages follow the convention in `CONTRIBUTING.md`
- [ ] Branch is up to date with `master`
