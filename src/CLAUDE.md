# 源码整体 DNA

## 身份与边界

CBIM（Capability–Business Independence + Memory）是独立的 C#/.NET 8 智能体运行时：能力由脑区组织，业务知识由 Workspace 模块承载，通过调度和记忆在运行时组合。单 Agent 内部的脑区拆分与多个 Agent 的团队组合是两层结构。

此目录及其子目录的 CLAUDE.md 是供 Claude Code 阅读的模块 DNA，记录稳定职责、契约与边界；不是运行时 DNA 格式迁移。运行时仍识别 `.dna/module.md`。根目录规则保持通用，阶段进度与交接保存在 `.claude/memory/`。

## 直接子模块与关系

| 模块 | 职责 | DNA |
|---|---|---|
| AgenticOS | 单 Agent 的运行时、会话、脑区及基础设施 | [运行时](AgenticOS/CLAUDE.md) |
| AgenticTeam | 多个运行时实例的成员关系与项目组合 | [团队](AgenticTeam/CLAUDE.md) |
| AgenticCLI | 一次性命令行宿主及测试导航 | [命令行](AgenticCLI/CLAUDE.md) |

[cbim.sln](cbim.sln) 包含三个产品项目和 AgenticCLI.Test。测试物理上嵌套在 AgenticCLI/Test，逻辑上是独立项目，不是 CLI 运行时的一部分。

项目引用方向是 AgenticCLI → AgenticTeam → AgenticOS，CLI 也直接引用 AgenticOS。这描述程序集引用，不代表 AgenticOS 内部类型关系或运行时调用都单向无环。

## 协作主链与契约归属

- 宿主建立 AgentDescription 和 CbimOptions，通过 Cbim.Create 装配运行时，再注册模型配置并开启 Session。
- Session 装配脑区，将用户输入交给主脑；Brain 组合工具和上下文，Neuron 执行模型/工具调用，或由 Orchestrator 执行已提交的回路。
- Workspace 提供模块描述及调用所需的活动 Module；Memory 提供持久上下文；LLM/MCP 适配外部服务。
- 输出经 SessionOutcome 返回宿主；会话和外部客户端的生命周期由所属组合层管理，细节见各模块 DNA。

## 共享构建与验证入口

以下命令从本目录 `src/` 执行，使 SDK 查找使用 [global.json](global.json)（8.0.415，latestFeature 前滚）。

```sh
dotnet restore cbim.sln
dotnet build cbim.sln --no-restore
dotnet test cbim.sln --no-build
```

CI 使用 Release：build/test 均添加 `--configuration Release`。使用 `--no-build` 前须已按同配置构建；修改后需重建或省略该参数。

格式规则由 [.editorconfig](.editorconfig) 定义，可运行 `dotnet format cbim.sln --verify-no-changes --no-restore`；该命令不是现有 CI 步骤。具体聊天和单测命令见命令行模块 DNA。这些是验证入口，不代表已经运行或通过。

## 修改约束与现状边界

- [Directory.Build.props](Directory.Build.props) 统一 net8.0、nullable、最新语言版本和显式 using；包版本在 [Directory.Packages.props](Directory.Packages.props) 集中管理。
- EditorConfig 规定 file-scoped namespace、namespace 外 using、System 优先、C# 四空格及 LF；JSON/YAML/项目配置为两空格。
- 源码是现状依据；[设计原则](../design/cbim-观点.md) 用于理解能力/业务独立性。design/architecture-summary.md 中的旧程序集清单不能代替当前 solution。
- 不因枚举、接口或提示词存在就认定功能已交付。Provider、外部工作脑、团队协作的限制由所属模块说明。
- 模块 DNA 只描述本层与直接子层，不批量导入所有兄弟文件，不将任务日志写入稳定契约。
