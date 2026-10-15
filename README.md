# CBIM

[English](README.md) | [中文](README.zh-CN.md)

> CBIM (Capability–Business Independence + Memory) is a standalone C#/.NET 8 runtime for deterministic agent orchestration. It separates reusable capability, project business context, and memory, then combines them through typed tools, workflows, workspaces, and provider abstractions.

## Current implementation

The repository contains one supported implementation: the .NET 8 solution under [`src/`](src/).

- `AgenticOS` — runtime, agents, workspaces, memory, MCP, LLM providers, tools, and workflow orchestration
- `AgenticTeam` — project and team composition
- `AgenticCLI` — command-line entry point
- `AgenticCLI/Test` — automated tests

Architecture and design principles are documented in [`design/`](design/):

- [`_ARCHITECTURE.md`](design/_ARCHITECTURE.md) — conceptual model and boundaries
- [`v2-architecture-summary.md`](design/v2-architecture-summary.md) — runtime constraints and dependency direction
- [`cbim-v2-观点.md`](design/cbim-v2-观点.md) — capability/business independence, memory, workflows, and workspaces

## Requirements

- .NET 8 SDK (the pinned SDK is declared in [`src/global.json`](src/global.json))
- Git

## Build and test

Run these commands from the repository root:

```bash
dotnet restore src/cbim.sln
dotnet build src/cbim.sln --no-restore
dotnet test src/cbim.sln --no-build
```

The solution uses the shared build and package configuration in `src/Directory.Build.props` and `src/Directory.Packages.props`. Provider and runtime settings are kept with the relevant executable project, including [`src/AgenticCLI/appsettings.json`](src/AgenticCLI/appsettings.json).

## Runtime model

CBIM keeps reusable capability separate from project-specific workspace knowledge. Agents operate through typed runtime services rather than unrestricted file mutation. The scheduler compiles workflows into explicit circuit nodes; workspace and DNA services manage project structure; memory services provide durable context; and LLM clients are selected through the provider registry.

The runtime supports local and external model providers, MCP descriptors and clients, workspace/DNA operations, memory tools, secure filesystem tooling, and team/project composition. Detailed behavior should be verified against the C# implementation in `src/` and the architecture documents in `design/`.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the .NET development workflow. Pull requests should include relevant tests and should not add generated output under `bin/` or `obj/`.

## License

[MIT](LICENSE)
