#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CBIM.Memory;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace CBIM.Mind
{
    /// <summary>
    /// 在每次 LLM 调用前从 <see cref="IMemoryService"/> 检索相关记忆，
    /// 并将结果注入到 <see cref="AIContext.Instructions"/>，为 Brain ReAct 链路提供记忆上下文。
    ///
    /// <para>检索策略：取 <see cref="InvokingContext.AIContext.Messages"/> 中
    /// 最后一条 <see cref="ChatRole.User"/> 消息的文本作为查询词，命中 topK 条记忆后
    /// 以「- {Text}」列表格式追加到 Instructions。</para>
    ///
    /// <para>无匹配或查询词为空时返回空 <see cref="AIContext"/>，不报错。</para>
    ///
    /// <para>集成方式：由 <c>Brain</c> 构造器在 <c>memory != null</c> 时自动创建并注入
    /// <c>ChatClientAgentOptions.AIContextProviders</c>。</para>
    /// </summary>
    public sealed class MemoryContextProvider : AIContextProvider
    {
        private readonly IMemoryService _memory;
        private readonly int _topK;

        /// <summary>
        /// 构造 MemoryContextProvider。
        /// </summary>
        /// <param name="memory">Agent 级记忆服务，不为 null。</param>
        /// <param name="topK">每次检索返回的记忆条数上限，默认 5。</param>
        public MemoryContextProvider(IMemoryService memory, int topK = 5)
        {
            _memory = memory ?? throw new ArgumentNullException(nameof(memory));
            _topK   = topK > 0 ? topK : 5;
        }

        /// <inheritdoc/>
        protected override ValueTask<AIContext> ProvideAIContextAsync(
            InvokingContext context, CancellationToken cancellationToken = default)
        {
            // 从上下文取最后一条 User 消息作为检索查询词
            var query = string.Empty;
            var messages = context.AIContext.Messages;
            if (messages != null)
            {
                ChatMessage? lastUser = null;
                foreach (var m in messages)
                {
                    if (m != null && m.Role == ChatRole.User)
                        lastUser = m;
                }
                if (lastUser != null)
                    query = lastUser.Text ?? string.Empty;
            }

            if (string.IsNullOrWhiteSpace(query))
                return new ValueTask<AIContext>(new AIContext());

            // IMemoryService.Query 是同步接口
            IReadOnlyList<MemoryEntry> memories = _memory.Query(query, _topK);
            if (memories == null || memories.Count == 0)
                return new ValueTask<AIContext>(new AIContext());

            var sb = new StringBuilder();
            sb.AppendLine("Relevant memories:");
            foreach (var entry in memories)
            {
                if (entry == null) continue;
                sb.Append("- ").AppendLine(entry.Text);
            }

            return new ValueTask<AIContext>(new AIContext
            {
                Instructions = sb.ToString(),
            });
        }
    }
}
