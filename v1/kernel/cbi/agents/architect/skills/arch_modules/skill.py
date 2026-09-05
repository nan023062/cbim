SKILL: str = r"""\
# Skill: Business Module CRUD

Use this skill when the user asks to create, inspect, update, split, or deprecate
`.dna/` business modules. It is an optional knowledge-management capability, not
an execution gate and not a dispatch protocol.

## Method

1. Read the relevant `.dna/module.md`, optional `contract.md`, notes, and workflows.
2. Identify the module's positioning, public boundary, dependencies, and current state.
3. Propose the smallest change that records the user's requested business knowledge.
4. Apply authorized edits through the `dna` service or CLI so validation, atomic writes,
   path safety, and index updates remain active.
5. Report changed files and verification results.

## Rules

- A module document describes its own responsibility and boundaries; child internals belong
  in the child module.
- Use `contract.md` only for a genuine external or protocol boundary.
- Workflows are durable procedural knowledge in `.dna/workflows/`; they are not executable
  runtime programs.
- Do not dispatch agents, require an architect approval stage, or modify code unless the
  user explicitly includes code in scope.
- Do not read or write memory unless the user explicitly asks for memory work.
- Do not alter unrelated user data, configuration, permissions, or historical records.

## CLI examples

```bash
cbim dna list
cbim dna show <module-dir>
cbim dna init <dir> --type {root,parent,leaf} --name <name> --owner <owner>
cbim dna edit <module-dir> --target body
cbim dna reindex
```
"""
