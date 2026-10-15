using System;

namespace CBIM.Kernel;

/// <summary>
/// 回路执行期失败异常——由 Orchestrator 子模块内部 Executor 在执行图节点时抛出。
/// </summary>
public sealed class CircuitExecutionException : Exception
{
    /// <summary>失败节点 Id——与 <c>CircuitNode.NodeId</c> 一致。</summary>
    public string NodeId { get; }

    public CircuitExecutionException(string nodeId, string reason)
        : base($"节点 {nodeId} 执行失败: {reason}")
    {
        NodeId = nodeId;
    }

    public CircuitExecutionException(string nodeId, string reason, Exception innerException)
        : base($"节点 {nodeId} 执行失败: {reason}", innerException)
    {
        NodeId = nodeId;
    }
}
