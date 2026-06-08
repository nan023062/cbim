# Contributing to CBIM

Thanks for your interest in CBIM. This document covers how to set up a local
development environment, run the test suite, and submit a pull request.

> A Chinese version may be added later as `CONTRIBUTING.zh-CN.md`. Until then,
> this English document is authoritative.

---

## Branch model

- The default branch is `master`. All contributions land on `master` via pull
  request.
- Fork the repository, create a feature branch from `master`, push to your
  fork, then open a PR back to `nan023062/cbim:master`.
- Keep one logical change per PR. Split unrelated work into separate PRs so
  each can be reviewed and reverted independently.

Suggested branch naming:

```
feat/<short-slug>       # new feature
fix/<short-slug>        # bug fix
docs/<short-slug>       # documentation only
refactor/<short-slug>   # internal refactor, no behavior change
test/<short-slug>       # test additions / fixes
ci/<short-slug>         # CI / tooling
```

---

## Local development setup

Requirements:

- Python >= 3.10
- `git`
- Linux / macOS / WSL (the `install.sh` bootstrap installer is not supported
  on native Windows, but the test suite itself runs fine on any platform
  with Python 3.10+)

Clone and install dev + runtime dependencies into a virtualenv:

```bash
git clone https://github.com/<your-fork>/cbim.git
cd cbim
python -m venv .venv
source .venv/bin/activate      # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements-dev.txt
pip install -r v1/kernel/requirements.txt
```

`requirements-dev.txt` pulls in `pytest`. `v1/kernel/requirements.txt` pulls
in `mcp` (the runtime dependency the kernel and tests import).

No editable install is needed: `v1/tests/conftest.py` adds `v1/kernel/` to
`sys.path` automatically so `import engine`, `import cbi`, etc. resolve.

To enable the client-side leak guard locally, run: `git config core.hooksPath .githooks`

---

## Running tests

Default suite (what CI runs on every PR):

```bash
pytest v1/tests/ -m "not workflow"
```

This excludes the `workflow` marker — end-to-end loop tests that need
`ANTHROPIC_API_KEY` and the `claude` CLI on `PATH`. They are opt-in and
auto-skip when the environment is not configured.

To run a single file or a single test:

```bash
pytest v1/tests/test_retrieval_tokenize.py
pytest v1/tests/test_memory_facade.py::test_some_specific_case
```

To run the opt-in workflow loop tests locally (costs real API spend, slow):

```bash
export ANTHROPIC_API_KEY=...
pytest v1/tests/workflow/ -m workflow
```

---

## Pull request flow

1. Sync your fork's `master` with upstream.
2. Branch off `master`.
3. Make your change. Add or update tests where the change is testable.
4. Run the local test suite (`pytest v1/tests/ -m "not workflow"`) — it must
   pass before you push.
5. Run the **pre-push self-check** (see below).
6. Push your branch and open a PR against `nan023062/cbim:master`.
7. CI will run on the PR:
   - **Governance Leak Guard** — fails if any governance file is tracked
     (see "Red line" below).
   - **Tests** — runs `pytest -m "not workflow"` on Python 3.10 / 3.11 / 3.12.
8. Address review feedback. Force-push to the same branch is fine; the PR
   updates automatically.

### PR description

Explain **what** changed and **why**. A short bullet list is usually enough.
Link any related issue (`Fixes #123` / `Refs #123`).

### Commit message convention

Short imperative summary, optionally prefixed with a type and scope:

```
<type>: <short summary>

<optional body explaining why, wrapped at ~72 cols>
```

Recommended types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.

Examples:

```
fix: handle empty blackboard in dream tick init
docs: clarify install.sh requirements on Windows / WSL
test: cover retry decorator backoff edge case
```

Keep commits focused. If you need to fix up an earlier commit in your branch,
amend or interactive-rebase before pushing for review (after review starts,
prefer new commits so reviewers can see what changed).

---

## Code style

- Follow PEP 8 for Python. Prefer the formatting already used in the
  surrounding file over imposing a new convention.
- Type hints are encouraged in new / changed code. `from __future__ import
  annotations` is fine and is the style most existing modules use.
- Keep functions short and focused. If you find yourself writing a long
  docstring to explain *what* a function does, the function probably wants
  to be split.
- No `print` debugging left in committed code. Use the kernel's logging
  surfaces or `pytest -s` instead.
- Don't introduce a new third-party dependency without explaining why in the
  PR description. The runtime dep list (`v1/kernel/requirements.txt`) is
  intentionally tiny.

---

## Red line: never commit governance files

CBIM is used as a framework by downstream projects that run their own
governance layer on top. Those projects own and version their own
`.cbim/`, `.claude/`, `CLAUDE.md`, `.mcp.json`, and `.claudeignore` files.
Those files **must never** be committed to this public framework repository.

The forbidden paths are:

```
.cbim/
.claude/
CLAUDE.md
.mcp.json
.claudeignore
```

All five are listed in `.gitignore`, so a normal `git add <file>` won't pick
them up. **However**, `git add -A` / `git add .` after a CBIM-using session
can still pull them in if they exist outside the ignore patterns somehow, or
if you've force-added one of them in the past.

The **Governance Leak Guard** CI job scans every PR and every push and
fails the build if any of those paths show up as tracked files. This is the
last line of defense — if it fires, fix it before merging, do not bypass.

### Pre-push self-check

Before pushing, run:

```bash
git status
git diff --stat origin/master...HEAD
```

Skim the list. If you see any unexpected paths — especially anything starting
with `.cbim/`, `.claude/`, or any of `CLAUDE.md` / `.mcp.json` /
`.claudeignore` — stop and remove them before pushing.

Prefer staging files explicitly:

```bash
git add path/to/file1 path/to/file2
```

rather than `git add -A` / `git add .`, which can silently include files you
didn't mean to commit.

---

## Questions

If something in this document is unclear or out of date, please open an issue
or send a PR fixing it. Documentation contributions are welcome.
