# Contributing to CBIM

Thanks for your interest in CBIM. This document covers the C#/.NET development workflow, tests, and pull requests.

## Branch model

- The default branch is `master`. Contributions land on `master` through a pull request.
- Create a focused branch from the current default branch and open a pull request against `nan023062/cbim:master`.
- Keep one logical change per pull request.

Suggested branch names:

```
feat/<short-slug>
fix/<short-slug>
docs/<short-slug>
refactor/<short-slug>
test/<short-slug>
ci/<short-slug>
```

## Local development setup

Requirements:

- .NET 8 SDK
- `git`
- Windows, macOS, or Linux

Clone the repository and restore the solution:

```bash
git clone https://github.com/<your-fork>/cbim.git
cd cbim
dotnet restore src/cbim.sln
```

The SDK version is declared in `src/global.json`. Shared build and package settings live in `src/Directory.Build.props` and `src/Directory.Packages.props`.

## Build and test

Run the same checks used by CI:

```bash
dotnet build src/cbim.sln --no-restore
dotnet test src/cbim.sln --no-build
```

For a clean verification, run `dotnet restore src/cbim.sln` first. Keep generated `bin/` and `obj/` output untracked.

## Pull request flow

1. Create a focused branch from `master`.
2. Make the change and add or update automated tests where appropriate.
3. Run restore, build, and test locally.
4. Review `git diff --check` and the staged file list.
5. Push the branch and open a pull request against `nan023062/cbim:master`.
6. Address review feedback with focused commits.

## Commit messages

Use a short imperative summary, optionally prefixed with a type:

```
<type>: <short summary>

<optional body>
```

Recommended types are `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, and `ci`.

## Code style

- Follow the existing C# and .NET style in the surrounding project.
- Keep public APIs and contracts explicit and strongly typed.
- Prefer small, focused classes and methods.
- Do not leave debug output or generated artifacts in committed code.
- Do not add a dependency without documenting why it is needed.

## Repository boundaries

The supported implementation is the .NET solution under `src/`. Architecture documents live under `design/`. Do not reintroduce retired runtime trees, generated output, or alternate implementation entry points.

## Questions

If something is unclear or out of date, open an issue or submit a documentation pull request.
