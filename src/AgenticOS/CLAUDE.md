# 单 Agent 运行时 DNA

## 职责与边界

AgenticOS 提供单个 Agent 的运行时组合、会话与脑区装配，以及工具、模型、工作区和记忆基础设施。它不负责命令行参数解析，也不是跨机器团队调度器。

[Cbim.cs](Cbim.cs) 的 `Cbim.Create` 是基础设施组合根；[Agent/Session.cs](Agent/Session.cs) 管理一次会话的脑区；[Mind/Brain.cs](Mind/Brain.cs) 装配脑区工具、上下文及执行路径。脑区是一个 Agent 内部的能力划分，不是团队成员。

## 对外契约与生命周期

- `Cbim.Create(CbimOptions)` 要求有效 RootPath 和 AgentDescription，建立 FileBackend、配置 stores、ChatClientFactory、McpManager、Memory 和 Workspace。
- `OpenSessionAsync` 创建独立 Session 并登记；`CloseSessionAsync` 移除并释放会话；`GetSession` 对未知 ID 返回 null。
- Session 先创建架构脑、记忆脑和用户 WorkBrains，再创建主脑，保证主脑构造时可以查询可派发脑区快照。
- `Session.SendAsync` 将用户消息转为调用输入并交给主脑，返回 SessionOutcome；各脑区结果使用 Kernel 契约。
- Cbim 释放其持有的会话与 MCP 资源，Dispose 有幂等保护和 ProcessExit 尽力兜底。正常宿主应显式结束生命周期，不依赖退出回调。
- 多个 Session 使用同一 Cbim 的共享服务；独立会话不意味着所有数据后端均逐会话隔离。

## 脑区权限与协作约束

- 主脑 PrefrontalCortex 是外部任务的协调入口，具备跨脑区派发及模块检查能力。
- 架构脑 ParietalLobe 负责业务结构和 DNA 读写；记忆脑 Hippocampus 独占 Memory 写工具且没有 DNA 工具；其他脑区只读 Memory/DNA。
- 工作脑工具按每次调用的 Modules 重新装配。未分配模块时没有标准文件工具，不能在派发过程中丢失模块上下文。
- 工作脑的标准工具副作用会汇入 NeuronOutcome.SideEffects；不能将模型回复文本当作实际动作记录。
- 权限工具和上下文装配入口在 `Brain.BuildMemoryAndDnaTools`、`BuildContextProviders`、`RebuildMotorStandardToolsForInvocation`。

## 直接子模块

| 模块 | 契约与协作职责 |
|---|---|
| [Kernel](Kernel/CLAUDE.md) | 输入输出契约、Neuron 模型执行、直接派发及 Circuit 调度 |
| [Workspace](Workspace/CLAUDE.md) | 业务模块描述、活动模块解析、DNA 工具与工作区知识 |
| [Memory](Memory/CLAUDE.md) | 运行时记忆存取与检索 |
| [Tools](Tools/CLAUDE.md) | 内置动作、路径约束及副作用记录 |
| [Mcp](Mcp/CLAUDE.md) | 外部工具客户端及实例生命周期 |
| [LlmClient](LlmClient/CLAUDE.md) | 模型描述和 IChatClient 构造 |

Agent 与 Mind 首轮由本文覆盖；Skills/Workflow 的描述符 stores 提供能力资产。[Storage/Storage.cs](Storage/Storage.cs) 的 FileBackend 提供路径解析及文件存储原语，WriteAtomic 使用临时文件再 Replace/Move；它不是 Workspace 的模块注册表或工具路径权限检查器。这些支撑目录暂不单独扩展 DNA 层级。

## 依赖与现状边界

- Cbim 是服务组合点，Brain 消费这些服务；不是每个脑区独立创建所有存储。
- Mind 与 Kernel 存在双向类型联系：Brain 使用 Kernel 契约，Neuron 和 SynapseToolFactory 也引用 Brain。不要把设计的无环目标描述成当前类型图已无环。
- 默认 RootPath 同时用于存储和 Workspace；Memory 默认从其 memory 子目录初始化。路径细节由 Memory DNA 说明。
- 未注入 McpStarter 时使用空实现；CLI 的真实启动器是宿主显式提供的，不是 Cbim.Create 自动启动任意 MCP。
- [Mind/BrainFactory.cs](Mind/BrainFactory.cs) 对外部工作脑仍存在未实现分支。Dream/裂变不能仅凭记忆脑提示词描述视为自动运行机制。
- 本目录 Team 下的空壳类型不等于实际团队实现；多实例组合在独立 AgenticTeam 项目。

## 定位与验证

改动会话装配从 Session 构造函数追踪到 BrainFactory 和 Brain；改动服务生命周期从 Cbim.Create/Dispose 追踪。当前没有产品测试覆盖；回路模块传递、动作副作用、完整会话生命周期和端到端模型调用仍需验证。公共验证入口及限制见 [源码 DNA](../CLAUDE.md)。
