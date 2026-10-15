# CBIM

[English](README.md) | [中文](README.zh-CN.md)

> CBIM（Capability–Business Independence + Memory）是一个独立运行的 C#/.NET 8 智能体运行时，用确定性的调度方式编排智能体。它把可复用能力、项目业务上下文与记忆分离，再通过强类型工具、工作流、工作区和 Provider 抽象在运行时组合起来。

## 当前实现

仓库只保留一套正式实现：位于 [`src/`](src/) 下的 .NET 8 solution。

- `AgenticOS` —— 运行时、agent、workspace、记忆、MCP、LLM Provider、工具和工作流编排
- `AgenticTeam` —— 项目与团队组合
- `AgenticCLI` —— 命令行入口
- `AgenticCLI/Test` —— 自动化测试

架构与设计原则位于 [`design/`](design/)：

- [`_ARCHITECTURE.md`](design/_ARCHITECTURE.md) —— 概念模型与边界
- [`architecture-summary.md`](design/architecture-summary.md) —— 运行时约束与依赖方向
- [`cbim-观点.md`](design/cbim-观点.md) —— 能力/业务独立性、记忆、工作流与工作区

## 环境要求

- .NET 8 SDK（版本由 [`src/global.json`](src/global.json) 声明）
- Git

## 构建与测试

在仓库根目录执行：

```bash
dotnet restore src/cbim.sln
dotnet build src/cbim.sln --no-restore
dotnet test src/cbim.sln --no-build
```

Solution 使用 `src/Directory.Build.props` 与 `src/Directory.Packages.props` 中的共享构建和依赖配置。Provider 与运行时设置位于对应可执行项目中，包括 [`src/AgenticCLI/appsettings.json`](src/AgenticCLI/appsettings.json)。

## 运行时模型

CBIM 将可复用能力与项目专属的工作区知识分离。Agent 通过强类型运行时服务操作，而不是直接拥有不受限制的文件修改权。调度器把工作流编译为显式 circuit 节点；workspace 与 DNA 服务管理项目结构；memory 服务提供持久上下文；LLM 客户端通过 Provider registry 选择。

运行时支持本地及外部模型 Provider、MCP descriptor/client、workspace/DNA 操作、memory 工具、安全文件系统工具，以及 team/project 组合。具体行为以 `src/` 中的 C# 实现和 `design/` 中的架构文档为准。

## 参与贡献

.NET 开发流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。提交 Pull Request 时请补充相关测试，不要提交 `bin/` 或 `obj/` 下的生成文件。

## 许可

[MIT](LICENSE)
