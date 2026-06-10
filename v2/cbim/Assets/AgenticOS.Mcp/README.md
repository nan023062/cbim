# AgenticOS.Mcp — 当前休眠（quarantined）

## 状态

本装配层（`AgenticOS.Mcp.asmdef`）通过 `defineConstraints: ["CBIM_MCP_CLIENT"]` **默认排除编译**。该 define 未设置 → Unity 跳过本 asmdef，整个 MCP-client 路径处于离线状态。

## 为什么休眠

`ModelContextProtocol` 1.3.0（以及该 SDK **所有已发布版本**）的 `StdioClientTransportOptions` / `HttpClientTransportOptions` 用 C# 11 `required` 修饰必填成员（`Command` / `Endpoint`）。`required` 自 `v0.1.0-preview.1` 起即引入，**没有可降级到无 `required` 的 SDK 版本**。

魔改 Unity（2020.3）的 Roslyn **不识别** `required` 关键字语义，但**会触发** CS0619：

> Constructors of types with required members are not supported in this version of your compiler.

任何 `new StdioClientTransportOptions { ... }` 都编译失败。SDK 也未提供 `[SetsRequiredMembers]` 标注的替代构造器或字段直传形式构造器，常规迂回不通。

实际"可用"的 Cbim 工作链不依赖此装配——`Brain.BuildMcpTools` 在 `agent.Os.Mcp == null`（即 `NullMcpClientStarter` 兜底时）会返回空工具集，StandardTools + Compiler + Memory/DNA 工具仍完整。

## 不会丢的资产

- **SPI 抽象** `Assets/AgenticOS/Mcp/{IMcpClientStarter, IStartedMcpClient, McpDescriptor, McpManager}` + 兜底 `NullMcpClientStarter` 全活——SDK-free，零删除。
- **ModelContextProtocol DLL `.meta`**：`Assets/AgenticOS/ThirdParty/MsExtensionsAI/ModelContextProtocol{.Core,}.dll.meta` 保留；DLL 二进制在 `.gitignore` 中排除但留在本地工作树，复活时无需重新写 PluginImporter。
- **本目录源码**：`McpClientStarter.cs` / `StartedMcpClient.cs` 维持直接 `new` 对象初始化器形式（**不要**改回反射——反射只是绕 CS0619 的下策；Option B 路径下直接 `new` 才是正轨）。

## 复活路径（Option B：Unity 之外预编译 DLL）

1. 在 Unity 目标 asmdef 中设置 scripting define `CBIM_MCP_CLIENT`（PlayerSettings → Scripting Define Symbols 或 asmdef `defineConstraints` 上层声明）；
2. 在 Unity **之外**用真正的 C# 11 编译器（dotnet SDK 7+ / Visual Studio 2022+）把本目录 + `Assets/AgenticOS` 引用编出 `AgenticOS.Mcp.dll`：

   ```pwsh
   dotnet build  # 产出 AgenticOS.Mcp.dll，需要先建一个 csproj 把 .cs 引进去
   ```

3. 把产出的 DLL（**不**带源码）投放到 `Assets/AgenticOS/ThirdParty/AgenticOS.Mcp/AgenticOS.Mcp.dll`；
4. 在 `Assets/Desktop/Desktop.asmdef.references` 重新加 `"AgenticOS.Mcp"`（届时 references 指向预编译 DLL 的 asmdef shim 或直接 `precompiledReferences`，按选择）；
5. 在 `Assets/Desktop/CbimDemo.cs` 复原 `McpStarter = new CBIM.Mcp.McpClientStarter()` 注入。

**不要**尝试在 Unity 内编译此装配——除非升级 Unity Mono / Roslyn 至支持 `required`。

## 详细背景

参见 `Assets/AgenticOS/ThirdParty/MsExtensionsAI/_MCP_EVAL_REPORT.md` §5（更正版结论）+ §9（状态变更）。
