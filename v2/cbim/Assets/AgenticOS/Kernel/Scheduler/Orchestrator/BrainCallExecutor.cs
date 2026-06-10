using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Agents.AI.Workflows;

namespace CBIM.Kernel
{
    /// <summary>
    /// <c>CallBrainNode</c> 的 MAF Executor 包装——节点执行体里调
    /// </summary>
    internal sealed class BrainCallExecutor : Executor<CircuitMessage>
    {
        private readonly string _nodeId;
        private readonly CallBrainNode _node;
        private readonly IInvocable _brain;
        private readonly IPrefrontalCallback _callback;

        public BrainCallExecutor(
            string nodeId,
            CallBrainNode node,
            IInvocable brain,
            IPrefrontalCallback callback)
            : base(nodeId)
        {
            if (string.IsNullOrWhiteSpace(nodeId))
                throw new ArgumentException("BrainCallExecutor.nodeId 不能为空。", nameof(nodeId));
            if (node == null)
                throw new ArgumentNullException(nameof(node));
            if (brain == null)
                throw new ArgumentNullException(nameof(brain));
            if (callback == null)
                throw new ArgumentNullException(nameof(callback));

            _nodeId = nodeId;
            _node = node;
            _brain = brain;
            _callback = callback;
        }

        public override async ValueTask HandleAsync(
            CircuitMessage message,
            IWorkflowContext context,
            CancellationToken cancellationToken = default)
        {
            if (message == null)
                throw new ArgumentNullException(nameof(message));

            _callback.ReportProgress("@orchestrator", $"running node {_nodeId} (brain={_node.TargetBrainId})");

            var invocationContext = new Dictionary<string, object>
            {
                ["previous"] = message.LastSummary,
            };

            var invocation = new NeuronInput(
                CorrelationId: Guid.NewGuid().ToString(),
                Intent: _node.Intent,
                StructuredInput: _node.StructuredInputJson,
                Context: invocationContext);

            NeuronOutcome outcome;
            try
            {
                outcome = await _brain.InvokeAsync(invocation, cancellationToken).ConfigureAwait(false);
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

            if (outcome.IsError)
            {
                var failure = new CircuitExecutionException(_nodeId, outcome.ErrorMessage ?? "unknown error");
                await context.AddEventAsync(new ExecutorFailedEvent(_nodeId, failure), cancellationToken).ConfigureAwait(false);
                await context.RequestHaltAsync().ConfigureAwait(false);
                return;
            }

            _callback.ReportProgress("@orchestrator", $"node {_nodeId} done");

            var next = message.WithNext(
                newFromNodeId: _nodeId,
                newLastSummary: outcome.Summary,
                appendOutcome: outcome,
                newBranchLabel: null);

            await context.SendMessageAsync(next, targetId: null, cancellationToken).ConfigureAwait(false);
        }
    }
}
