using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Agents.AI.Workflows;

namespace CBIM.Kernel
{
    /// <summary>
    /// <c>BranchNode</c> 的 MAF Executor 包装——节点执行体里调
    /// <see cref="ConditionEvaluator.Evaluate"/> 求值，把分支标签写入
    /// <see cref="CircuitMessage.BranchLabel"/>，再 SendMessage 给下游。
    /// </summary>
    internal sealed class BranchExecutor : Executor<CircuitMessage>
    {
        private readonly string _nodeId;
        private readonly BranchNode _node;

        public BranchExecutor(string nodeId, BranchNode node)
            : base(nodeId)
        {
            if (string.IsNullOrWhiteSpace(nodeId))
                throw new ArgumentException("BranchExecutor.nodeId 不能为空。", nameof(nodeId));
            if (node == null)
                throw new ArgumentNullException(nameof(node));

            _nodeId = nodeId;
            _node = node;
        }

        public override async ValueTask HandleAsync(
            CircuitMessage message,
            IWorkflowContext context,
            CancellationToken cancellationToken = default)
        {
            if (message == null)
                throw new ArgumentNullException(nameof(message));

            string matchedLabel;
            try
            {
                matchedLabel = ConditionEvaluator.Evaluate(_node.ConditionExpression, message);
            }
            catch (Exception ex)
            {
                var failure = new CircuitExecutionException(
                    _nodeId,
                    $"ConditionExpression 评估失败: {ex.Message}",
                    ex);
                await context.AddEventAsync(new ExecutorFailedEvent(_nodeId, failure), cancellationToken).ConfigureAwait(false);
                await context.RequestHaltAsync().ConfigureAwait(false);
                return;
            }

            var next = message.WithNext(
                newFromNodeId: _nodeId,
                newLastSummary: message.LastSummary,
                appendOutcome: null,
                newBranchLabel: matchedLabel);

            await context.SendMessageAsync(next, targetId: null, cancellationToken).ConfigureAwait(false);
        }
    }
}
