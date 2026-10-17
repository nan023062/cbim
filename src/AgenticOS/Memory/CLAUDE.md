# Memory：运行时记忆

## 职责边界

- 本模块提供运行时记忆条目的持久化、检索、结构化扫描，以及模型工具和外部 MCP 桥接。
- `IMemoryService` 是替换后端的边界；脑区何时读写、如何组织任务仍由上层决定。
- 此处记忆不是开发会话交接：开发状态与接手信息见 [会话交接](../../../.claude/memory/handoff.md)。
- 不把 `.claude/memory/` 文件当作 LocalMemoryService 的数据目录，也不把模块文档当运行日志。
- 上层服务归属见 [运行时 DNA](../CLAUDE.md)，外部客户端管理见 [Mcp DNA](../Mcp/CLAUDE.md)。

## 核心契约

- [IMemoryService.cs](IMemoryService.cs) 定义 Store、Query、Get、List、Delete、Clear、Scan、Stats 及部分异步包装。
- `MemoryEntry` 保存 Id、Source、CreatedAt、Text、Tags；同 Id 写入覆盖旧条目。
- `Query(text, topK)` 返回相关条目列表；空查询或非正 topK 在本地实现中返回空列表。
- `Get` 对未知或空白 Id 返回 null，`Delete` 对不存在的 Id 静默返回。
- `List` 按 CreatedAt 倒序；`MemoryScanFilter` 指定 SourceEquals、TagsAny、Since。
- `MemoryStats` 提供总数及最早/最新时间；空库的时间值为 null。
- `NullMemoryService.Instance` 是显式空后端，不代表远端存储已连接。

## 本地存储与检索

- `LocalMemoryService` 使用 `FileBackend`，把 JSON 条目加载到内存字典，以锁保护存取。
- 默认条目路径为注入根下 `.cbim/memory/medium/<id>.json`，索引为 `.cbim/memory/index.json`。
- `Cbim.Create` 默认传入 `Path.Combine(options.RootPath, "memory")`；因此最终路径还包含这个外层 memory 目录。
- 自定义 subDir 相对 `.cbim/`，index.json 放在该子目录的父目录；不要凭默认值推断所有宿主路径。
- 启动先读索引；索引缺失或损坏时扫描条目目录重建，损坏的条目 JSON 会被跳过。
- 条目和索引分别通过 WriteAtomic 写入；这不是覆盖两份文件的数据库事务。
- **当前是关键词 JSON 后端，不是向量库，也没有 embedding 计算。**
- Query 对查询分词去重，匹配正文子串和完整标签，忽略大小写，按命中分数降序。
- 分数相同时按 CreatedAt 倒序；这是同分排序，不是 LocalMemoryService 的连续时间衰减权重。
- Scan 各字段取 AND；TagsAny 内部取任一标签命中，Source 精确匹配，结果按时间倒序。
- 异步方法先检查取消，再调用同步实现；不要假设这些接口提供异步磁盘吞吐。

## 工具与实际协作

- `MemoryToolProvider.GetReadOnlyTools` 提供 query/get/list/stats/scan 五个 `memory_*` 工具。
- `GetReadWriteTools` 在只读集合上增加 memory_write 和 memory_delete。
- `Brain.BuildMemoryAndDnaTools` 仅给 Hippocampus 写工具，其他内置脑区使用只读集合。
- `Mind.MemoryContextProvider` 消费 IMemoryService 检索上下文；服务本身不决定脑区权限或提示词。
- `CbimOptions.Memory` 可注入替代后端；`Cbim.SwitchMemory` 替换服务引用，不应推断已捕获旧引用的工具自动重绑。

## 外部桥接边界

- `MemoryBridgeMcpServer` 是服务端协议包装，与 Mcp 模块连接外部工具的客户端方向相反。
- 它提供 memory_write/query/get/scan/stats 五个工具，不等同于进程内完整读写工具集合。
- `RunAsync` 支持 Console 或显式 TextReader/TextWriter；按行读取 JSON-RPC，EOF/取消结束循环。
- 桥接实现 initialize、tools/list、tools/call 等必要子集，不实现 resources/prompts/采样回调。
- 桥接层不做权限、配额或记忆业务策略；开放写入口前必须由宿主控制访问边界。
- 释放桥接循环不释放注入的 IMemoryService；该服务生命周期不属于桥接器。

## 源码与验证入口

- 核心数据语义看 [LocalMemoryService.cs](LocalMemoryService.cs)、[MemoryEntry.cs](MemoryEntry.cs)、[MemoryScanFilter.cs](MemoryScanFilter.cs)。
- 工具序列化和桥接看 [MemoryToolProvider.cs](MemoryToolProvider.cs)、[MemoryBridgeMcpServer.cs](Bridge/MemoryBridgeMcpServer.cs)。
- 当前 CLI 测试目录没有 Memory 专项测试；现有回路和 shell 用例不能证明记忆持久化或 MCP 桥接正确。
- 后续验证重点是重启加载、损坏索引回退、同分排序、过滤组合、工具权限和 JSON-RPC 错误响应。
- 公共验证入口见 [源码 DNA](../../CLAUDE.md)；更换后端须保持 IMemoryService 的空值与排序语义。
