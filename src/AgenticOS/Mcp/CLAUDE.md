# Mcp：外部工具客户端

## 职责边界

- 本模块定义 MCP 服务描述、配置存储、客户端启动接口、真实协议接入和共享/隔离实例生命周期。
- 它是连接外部工具的客户端侧，不负责业务任务决策或任意服务端能力实现。
- 运行时装配见 [运行时 DNA](../CLAUDE.md)；对外暴露本地记忆的服务端桥位于 [Memory](../Memory/CLAUDE.md)。

## 关键对象与对外契约

- `McpDescriptor` 承载 Id、描述和 Shared 等公共配置，具体传输由派生类型表达。
- `StdioMcpDescriptor` 提供 Command、Args、Env；`HttpMcpDescriptor` 提供 Endpoint、Headers、AuthToken。
- `FileMcpStore` 通过 FileBackend 保存描述配置，默认子目录 mcps；描述文件不是已运行客户端。
- [IStartedMcpClient.cs](IStartedMcpClient.cs) 同时定义 `IMcpClientStarter` 和 `IStartedMcpClient`。
- `IMcpClientStarter.Start` 同步返回握手及工具发现完成的启动产物；启动失败抛异常，不返回 null。
- `IStartedMcpClient.AiFunctions` 类型是 IReadOnlyList<object>；真实产物装箱 AIFunction，由 Brain 筛选 AITool。
- 启动产物必须可 Dispose，连接或子进程资源归持有该产物的管理器释放。

## 共享与释放语义

- `McpManager.GetOrCreate` 在锁内查询或启动，防止同一管理器内并发重复创建缓存实例。
- Shared=true 时以 mcpId 缓存一个客户端，用 brainId 集合记录引用。
- Shared=false 时以 `(mcpId, brainId)` 缓存独立客户端，不是每次调用都创建新连接。
- 共享引用是集合，不是调用次数累加；相同 brainId 重复获取不会增加独立计数。
- `Release` 移除共享引用，归零释放；隔离模式直接移除并释放对应键，未知键幂等无操作。
- Dispose 在锁外执行；管理器整体 Dispose 尽力释放全部实例，并阻止后续 GetOrCreate。
- 缓存键不含 SessionId；跨会话若复用 brainId，不应推断客户端天然按会话隔离。
- 修改同 Id 的描述文件不会自动重建已缓存实例；配置更新与连接生命周期需要调用方协调。

## 真实启动器与宿主接线

- [Impl/McpClientStarter.cs](Impl/McpClientStarter.cs) 使用 ModelContextProtocol SDK，不是空壳接口实现。
- Stdio 描述创建 StdioClientTransport；HTTP 描述创建 HttpClientTransport，并复制配置集合。
- HTTP token 作为 Bearer Authorization 补充，但不覆盖同名显式 Header。
- Start 同步等待 CreateAsync 和 ListToolsAsync；工具发现失败时先清理已连接 client 再上抛。
- Starter 不处理共享策略，也不自行缓存或重试；Shared 的解释只在 McpManager。
- `Cbim.Create` 未收到 `CbimOptions.McpStarter` 时使用 `NullMcpClientStarter`，Start 会明确抛错。
- [CLI Program](../../AgenticCLI/Program.cs) 显式传入 `new McpClientStarter()`，这才是命令行宿主真实接入路径。
- 默认空 starter 与 CLI 真实 starter 必须分别描述，不能声称核心默认已启用全部外部连接。

## Brain 协作与现状约束

- `Brain.BuildMcpTools` 按 Descriptor.McpIds 从 McpStore 取配置，再向 McpManager 获取客户端。
- 缺失描述符会跳过；获取成功后记录 mcpId，Dispose 时按相同 BrainId Release。
- Brain 当前仅捕获 InvalidOperationException 进行降级；不能把所有连接或握手异常都描述为安全忽略。
- MCP 工具调用不自动经过 StandardTools.PathGuard；外部服务权限不能套用内置文件工具白名单。
- 当前源码注释仍含 Unity/asmdef“休眠”说明，但现行 AgenticOS.csproj 已引用 MCP 包并包含 Impl 源码。
- 现状应以项目引用、实现和 CLI 接线为准，不把旧注释当作 .NET 构建开关。

## 源码与验证入口

- 生命周期入口看 [McpManager.cs](McpManager.cs)，协议适配看 [McpClientStarter.cs](Impl/McpClientStarter.cs)。
- 资源释放看 [StartedMcpClient.cs](Impl/StartedMcpClient.cs)，配置读写看 [FileMcpStore.cs](FileMcpStore.cs)。
- 当前没有产品测试项目提供 MCP 专项覆盖；可用 fake `IMcpClientStarter` 隔离网络验证共享、失败和释放语义。
- 真实传输还需分别验证握手、工具发现、异常清理和宿主配置，不能仅凭模拟启动器判定端到端可用。
- 公共验证入口见 [源码 DNA](../../CLAUDE.md)；同步 Start 可能阻塞，宿主应避免假定它是非阻塞 API。
