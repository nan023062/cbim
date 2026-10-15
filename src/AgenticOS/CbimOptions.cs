using CBIM.Agent;
using CBIM.Mcp;
using CBIM.Memory;

namespace CBIM;

/// <summary>
/// CbimOptions — Cbim 工厂方法入参，汇聚所有顶层可配置项。
/// </summary>
public sealed class CbimOptions
{
    /// <summary>
    /// 数据根目录，存放所有 JSON 配置文件（models / skills / workflows / mcps / …）。
    /// 不能为 null 或空白。
    /// </summary>
    public required string RootPath { get; set; }

    /// <summary>
    /// 单一 Agent 的描述符。必填——<see cref="Cbim.Create"/> 将据此装配唯一的 Agent 实例。
    /// </summary>
    public required AgentDescription Agent { get; set; }

    /// <summary>
    /// MCP SDK 桥接实现（可选）。
    /// 不提供时默认使用 <see cref="NullMcpClientStarter"/>，
    /// 任何 MCP 实例化尝试都将抛出 <see cref="System.InvalidOperationException"/>。
    /// </summary>
    public IMcpClientStarter? McpStarter { get; set; }

    /// <summary>
    /// 外部注入的记忆服务实现（可选）。
    /// 提供时直接使用；为 null 时用 <see cref="LocalMemoryService"/> + <c>RootPath/memory</c> 创建默认实现。
    /// </summary>
    public IMemoryService? Memory { get; set; }
}
