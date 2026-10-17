# Workspace：业务模块与知识

## 职责边界

- `WorkspaceSystem` 管理工作区根、模块描述注册表、活动 Module 以及 DNA 读写工具。
- 业务知识由模块描述承载；模型执行和脑区权限装配仍归 Brain/Kernel，不由 Workspace 调度任务。
- 本文件是供 Claude Code 阅读的模块 DNA；**运行时仍发现 `.dna/` 并指向 `.dna/module.md`，不读取 CLAUDE.md 替代它**。
- 上层组合见 [运行时 DNA](../CLAUDE.md)，派发机制见 [Kernel DNA](../Kernel/CLAUDE.md)。

## 关键对象

- [Workspace.cs](Workspace.cs) 中的主类型名是 `WorkspaceSystem`，文件名不等于类型名。
- `ModuleDescription` 是静态声明：Id、Name、Metadata，以及可选 Workflows、Tools、McpList。
- `ModuleMetadata` 有本地和远端描述形式；自动发现创建指向 module.md 的 `LocalModuleMetadata`。
- `Module` 是激活记录：InstanceId、Description、WorkspaceRoot、ActivatedAt、ActivatedByTaskId。
- Module 不持有模型客户端或外部进程，没有 Dispose；关闭实例只是移出活动表。
- `ModuleResolver` 是 internal 解析入口，供直接派发和编译派发共享。

## 发现与生命周期契约

- `WorkspaceSystem(rootPath)` 自动发现模块；传入 descriptions 可覆盖自动发现，适合嵌入或验证。
- `DiscoverModules` 以 `.dna` 的父目录为模块根；即使 module.md 缺失也会生成描述符。
- Id 来自模块根相对工作区的路径，使用正斜杠；根模块 Id 为 `.`，不是 frontmatter 的 name。
- `ListDescriptions`、`GetDescription`、`ContainsDescription` 查询静态表；未知 Id 查询返回 null/false。
- `OpenInstance` 要求已注册描述符和非空根路径，为每次激活生成新 InstanceId 并登记活动表。
- `CloseInstance` 移除指定激活记录；`ListActiveInstances`/`GetActiveInstance` 查询运行态。
- 调用方应传已解析的绝对路径；OpenInstance 本身不是全套路径授权或目录存在性校验器。

## 派发协作与能力边界

- `ModuleResolver.Resolve` 解析 JSON 字符串数组，只激活注册表中命中的 Id。
- 空值、非法 JSON、空数组或缺失 Workspace 返回空列表；空白和未知 Id 被跳过。
- 每个有效 Id 调用 OpenInstance，路径为工作区根加 Id；`.` 直接使用根，任务标识目前传 null。
- `SynapseToolFactory` 和 `BrainCallExecutor` 都把解析结果放入 `NeuronInput.Modules`。
- Brain 的工作脑按这些 Module.WorkspaceRoot 重建标准工具；空 Modules 不获得标准文件工具。
- ModuleDescription 的 Tools/McpList/Workflows 是声明，不能据字段存在就认定当前 Brain 已自动合并全部业务能力。
- 当前自动发现主要填 Id、Name、Metadata；标准工具和 MCP 装配仍需核对 Brain 的 ToolIds/McpIds 路径。

## DNA 工具与稳定约束

- `WorkspaceToolProvider.GetReadOnlyTools` 提供 `module_list`；缺失 Workspace 时返回空工具集。
- `DnaToolProvider` 的只读入口是 `dna_list`、`dna_show`，读写集合增加 init/edit/split/deprecate/reindex。
- 脑区权限分配在 `Brain.BuildMemoryAndDnaTools`：架构脑读写，记忆脑不配 DNA，其他脑区只读。
- `DnaInit`、`DnaEdit`、`DnaSplit`、`DnaDeprecate`、`DnaReindex` 是 WorkspaceSystem 的实际修改入口。
- 写路径先经 `ResolveAndGuard` 限定工作区；文本采用 UTF-8 无 BOM，通过临时文件替换写入。
- 结构变更后重新发现模块；不要只改磁盘结构而假定已有描述注册表自动刷新。
- `DnaSplit` 返回反向依赖引用提示，但不会自动修改其他模块的 dependencies。
- `DnaDeprecate` 归档为 `.dna.archived`，不删除业务代码；已有归档时拒绝覆盖。
- `DnaReindex` 仅在根存在 `.dna` 时写工作区根 index.md，不写到 `.cbim/index.md`。

## 源码与验证入口

- 发现与 CRUD 看 [Workspace.cs](Workspace.cs)，激活参数看 [Module.cs](Module.cs) 和 [ModuleResolver.cs](ModuleResolver.cs)。
- 工具协议看 [DnaToolProvider.cs](DnaToolProvider.cs)、[DnaWriteTypes.cs](DnaWriteTypes.cs)、[WorkspaceToolProvider.cs](WorkspaceToolProvider.cs)。
- [CircuitModulesTest](../../AgenticCLI/Test/CircuitModulesTest.cs) 验证注册描述符经编译派发成为活动 Module。
- 该测试不是自动发现、DNA CRUD 或路径边界的完整覆盖；改动这些部分需独立核对相应分支。
- 公共验证入口见 [源码 DNA](../../CLAUDE.md)，修改 Id/路径规则时同时检查两条派发调用者。
