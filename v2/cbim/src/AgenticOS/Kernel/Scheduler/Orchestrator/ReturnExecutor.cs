using System;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Agents.AI.Workflows;

namespace CBIM.Kernel
{
    /// <summary>
    /// <c>ReturnNode</c> 的 MAF Executor 包装——终止节点。
    /// </summary>
    [YieldsOutput(typeof(string))]
    internal sealed class ReturnExecutor : Executor<CircuitMessage, string>
    {
        private static readonly Regex PlaceholderRegex = new Regex(
            @"\{previous\.summary\}|\{node_(?<id>[A-Za-z0-9_\-]+)\.summary\}",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        private readonly string _nodeId;
        private readonly ReturnNode _node;

        public ReturnExecutor(string nodeId, ReturnNode node)
            : base(nodeId)
        {
            if (string.IsNullOrWhiteSpace(nodeId))
                throw new ArgumentException("ReturnExecutor.nodeId 不能为空。", nameof(nodeId));
            if (node == null)
                throw new ArgumentNullException(nameof(node));

            _nodeId = nodeId;
            _node = node;
        }

        public override async ValueTask<string> HandleAsync(
            CircuitMessage message,
            IWorkflowContext context,
            CancellationToken cancellationToken = default)
        {
            if (message == null)
                throw new ArgumentNullException(nameof(message));

            string rendered = RenderTemplate(_node.SummaryTemplate, message);

            await context.YieldOutputAsync(rendered, cancellationToken).ConfigureAwait(false);
            await context.RequestHaltAsync().ConfigureAwait(false);

            return rendered;
        }

        private static string RenderTemplate(string template, CircuitMessage message)
        {
            return PlaceholderRegex.Replace(template, match =>
            {
                if (match.Value == "{previous.summary}")
                {
                    return message.LastSummary ?? string.Empty;
                }

                string nodeId = match.Groups["id"].Value;
                if (message.History.TryGetValue(nodeId, out var outcome))
                {
                    return outcome.Summary ?? string.Empty;
                }
                return string.Empty;
            });
        }
    }
}
