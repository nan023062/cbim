using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CBIM.Workflow;
using Microsoft.Agents.AI;

namespace CBIM.Mind
{
    /// <summary>
    /// 将当前 Brain 配置的 Workflow 列表注入到 LLM 系统提示。
    ///
    /// <para>在每次 LLM 调用前（<see cref="AIContextProvider.ProvideAIContextAsync"/>），
    /// 从 <see cref="FileWorkflowStore"/> 按构造期传入的 <see cref="_workflowIds"/> 查询
    /// <see cref="WorkflowDescriptor"/>，并将 <c>Name + Description</c> 拼成结构化指令
    /// 追加到 <see cref="AIContext.Instructions"/>，提示 LLM 当前可调用的 Workflow 集合
    /// 以及调用约定（<c>__circuit_*</c> 工具族）。</para>
    ///
    /// <para>空 Workflow 列表时返回空 <see cref="AIContext"/>（不写 Instructions），不报错。</para>
    ///
    /// <para>集成方式：在 <c>ChatClientAgentOptions.AIContextProviders</c> 列表中添加此实例。</para>
    /// </summary>
    public sealed class WorkflowContextProvider : AIContextProvider
    {
        private readonly FileWorkflowStore _workflowStore;
        private readonly IReadOnlyList<string> _workflowIds;

        /// <summary>
        /// 构造 WorkflowContextProvider。
        /// </summary>
        /// <param name="workflowStore">Workflow 仓储，用于按 Id 异步查询 WorkflowDescriptor。</param>
        /// <param name="workflowIds">当前 Brain 配置的 Workflow Id 列表。空列表合法（注入空 context）。</param>
        public WorkflowContextProvider(FileWorkflowStore workflowStore, IReadOnlyList<string> workflowIds)
        {
            _workflowStore = workflowStore ?? throw new ArgumentNullException(nameof(workflowStore));
            _workflowIds   = workflowIds   ?? throw new ArgumentNullException(nameof(workflowIds));
        }

        /// <inheritdoc/>
        protected override async ValueTask<AIContext> ProvideAIContextAsync(
            InvokingContext context, CancellationToken cancellationToken = default)
        {
            if (_workflowIds.Count == 0)
                return new AIContext();

            var sb = new StringBuilder();
            sb.AppendLine("Available workflows:");

            int written = 0;
            for (int i = 0; i < _workflowIds.Count; i++)
            {
                var id = _workflowIds[i];
                if (string.IsNullOrWhiteSpace(id)) continue;

                WorkflowDescriptor workflow =
                    await _workflowStore.GetAsync(id, cancellationToken).ConfigureAwait(false);
                if (workflow == null) continue;

                sb.Append("- ").Append(workflow.Name).Append(": ").AppendLine(workflow.Description);

                written++;
            }

            if (written == 0)
                return new AIContext();

            sb.AppendLine("Use __circuit_* tools to invoke a workflow.");

            return new AIContext
            {
                Instructions = sb.ToString(),
            };
        }
    }
}
