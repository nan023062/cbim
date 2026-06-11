using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace CBIM.Kernel;

/// <summary>
/// <c>CallToolNode</c> 的 MAF Executor 包装——节点执行体里按 <see cref="CallToolNode.ToolName"/>
/// 在工具注册表中查找目标 <see cref="AIFunction"/>，调用它，并将结果写入
/// <see cref="CircuitMessage"/>，沿回路传给下游。
/// </summary>
[SendsMessage(typeof(CircuitMessage))]
internal sealed class CallToolExecutor : Executor<CircuitMessage>
{
    private readonly string _nodeId;
    private readonly CallToolNode _node;
    private readonly IReadOnlyDictionary<string, AIFunction> _toolRegistry;

    public CallToolExecutor(
        string nodeId,
        CallToolNode node,
        IReadOnlyDictionary<string, AIFunction> toolRegistry)
        : base(nodeId)
    {
        if (string.IsNullOrWhiteSpace(nodeId))
            throw new ArgumentException("CallToolExecutor.nodeId 不能为空。", nameof(nodeId));
        if (node == null)
            throw new ArgumentNullException(nameof(node));
        if (toolRegistry == null)
            throw new ArgumentNullException(nameof(toolRegistry));

        _nodeId = nodeId;
        _node = node;
        _toolRegistry = toolRegistry;
    }

    public override async ValueTask HandleAsync(
        CircuitMessage message,
        IWorkflowContext context,
        CancellationToken cancellationToken = default)
    {
        if (message == null)
            throw new ArgumentNullException(nameof(message));

        if (!_toolRegistry.TryGetValue(_node.ToolName, out var tool))
        {
            var failure = new CircuitExecutionException(
                _nodeId,
                $"CallToolNode.ToolName='{_node.ToolName}' 不在 toolRegistry 中——工具未注册。");
            await context.AddEventAsync(new ExecutorFailedEvent(_nodeId, failure), cancellationToken).ConfigureAwait(false);
            await context.RequestHaltAsync().ConfigureAwait(false);
            return;
        }

        // 将 ArgsJson 反序列化为 AIFunctionArguments 兼容的字典形式，透传给工具。
        AIFunctionArguments? args = null;
        if (!string.IsNullOrWhiteSpace(_node.ArgsJson) &&
            !string.Equals(_node.ArgsJson.Trim(), "{}", StringComparison.Ordinal))
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(_node.ArgsJson);
                if (parsed != null && parsed.Count > 0)
                {
                    var dict = new Dictionary<string, object>(parsed.Count, StringComparer.OrdinalIgnoreCase);
                    foreach (var kv in parsed)
                        dict[kv.Key] = kv.Value;
                    args = new AIFunctionArguments(dict);
                }
            }
            catch (JsonException ex)
            {
                var failure = new CircuitExecutionException(
                    _nodeId,
                    $"CallToolNode.ArgsJson 反序列化失败: {ex.Message}",
                    ex);
                await context.AddEventAsync(new ExecutorFailedEvent(_nodeId, failure), cancellationToken).ConfigureAwait(false);
                await context.RequestHaltAsync().ConfigureAwait(false);
                return;
            }
        }

        object? result;
        try
        {
            result = await tool.InvokeAsync(args, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            var failure = new CircuitExecutionException(_nodeId, ex.Message, ex);
            await context.AddEventAsync(new ExecutorFailedEvent(_nodeId, failure), cancellationToken).ConfigureAwait(false);
            await context.RequestHaltAsync().ConfigureAwait(false);
            return;
        }

        // 将工具返回值序列化为字符串 summary，写入 CircuitMessage。
        string summary = result == null
            ? string.Empty
            : (result is string s ? s : JsonSerializer.Serialize(result));

        // 工具调用不产生 NeuronOutput，appendOutcome 传 null；BranchLabel 保持 null。
        var next = message.WithNext(
            newFromNodeId: _nodeId,
            newLastSummary: summary,
            appendOutcome: null,
            newBranchLabel: null);

        await context.SendMessageAsync(next, targetId: null, cancellationToken).ConfigureAwait(false);
    }
}
