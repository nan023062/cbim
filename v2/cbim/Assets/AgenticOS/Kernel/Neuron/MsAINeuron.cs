#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CBIM.Mind;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Compaction;
using Microsoft.Extensions.AI;

namespace CBIM.Kernel
{
    /// <summary>
    /// 标准 MsAI 神经元——装配 <see cref="ChatClientAgent"/> + <see cref="FunctionInvokingChatClient"/>
    /// + AITool 集（StandardAITools + SynapseAITools）。
    ///
    /// <para>InvokeAsync 路径：把 <see cref="NeuronInput.Intent"/> 包成 user
    /// <see cref="ChatMessage"/> 投给内部 ChatClientAgent.RunAsync，取 response.Text
    /// 作为 <see cref="NeuronOutcome.Summary"/>。</para>
    /// </summary>
    public sealed class MsAINeuron : INeuron
    {
        public NeuronKind Kind => NeuronKind.Msai;

        public AIAgent? UnderlyingAgent => _agent;

        private readonly ChatClientAgent _agent;

        private readonly IChatClient _invokingChatClient;

        private readonly ChatMessage _message;
        
        private readonly Brain _brain;

        /// <summary>
        /// 上下文历史提供器——当 <see cref="BrainDescriptor.ContextWindowTokens"/> 非 null 时由构造器创建；
        /// 否则为 null（不启用历史管理）。
        /// </summary>
        private readonly InMemoryChatHistoryProvider? _historyProvider;
        
        /// <summary>
        /// 上下文历史提供器——当 <see cref="BrainDescriptor.ContextWindowTokens"/> 非 null 时非 null。
        /// Brain 可通过此属性查询当前会话的历史消息数。
        /// </summary>
        public InMemoryChatHistoryProvider? HistoryProvider => _historyProvider;


        private int _disposed;

        /// <summary>
        /// 装配单元：
        /// </summary>
        public MsAINeuron(Brain brain,  string soul, string identity, BrainDescriptor descriptor, IChatClient chatClient, 
            IReadOnlyList<AITool> aiTools, IReadOnlyList<AIContextProvider>? contextProviders = null)
        {
            if (descriptor == null)
                throw new ArgumentNullException(nameof(descriptor));
            if (chatClient == null)
                throw new ArgumentNullException(nameof(chatClient));
            if (aiTools == null)
                throw new ArgumentNullException(nameof(aiTools));
            
            // 包 FunctionInvokingChatClient——让 LLM 返回 tool_call 时框架自动派发到 AIFunction 并回填结果。
            _invokingChatClient = new FunctionInvokingChatClient(chatClient);

            var options = new ChatClientAgentOptions
            {
                Name = descriptor.Name,
                Description = descriptor.Identity,
            };

            // 注入 ContextProviders（Skill / Workflow 等动态上下文注入器）
            if (contextProviders != null && contextProviders.Count > 0)
            {
                var providerList = new List<AIContextProvider>(contextProviders.Count);
                foreach (var p in contextProviders)
                {
                    if (p != null) providerList.Add(p);
                }
                if (providerList.Count > 0)
                    options.AIContextProviders = providerList;
            }

            // 上下文历史管理：当 descriptor.ContextWindowTokens 非 null 时启用 InMemoryChatHistoryProvider，
            // 并根据 descriptor.CompactionStrategy 配置对应的 IChatReducer。
            if (descriptor.ContextWindowTokens.HasValue)
            {
                var historyOptions = new InMemoryChatHistoryProviderOptions();

                int contextTokens = descriptor.ContextWindowTokens.Value;

                switch (descriptor.CompactionStrategy)
                {
                    case ContextCompactionStrategy.Truncate:
                    {
                        // TruncationCompactionStrategy：当 token 超出 contextWindowTokens 时，截断最旧的非系统消息组。
#pragma warning disable MAAI001
                        var truncateStrategy = new TruncationCompactionStrategy(
                            trigger: CompactionTriggers.TokensExceed(contextTokens));
#pragma warning restore MAAI001
                        historyOptions.ChatReducer = truncateStrategy.AsChatReducer();
                        break;
                    }

                    case ContextCompactionStrategy.Sliding:
                    {
                        // SlidingWindowCompactionStrategy：按 turn 数限制历史——
                        // 将 token 预算粗估为每 turn 约 500 token，至少保留 1 turn。
                        int maxTurns = Math.Max(1, contextTokens / 500);
#pragma warning disable MAAI001
                        var slidingStrategy = new SlidingWindowCompactionStrategy(
                            trigger: CompactionTriggers.TurnsExceed(maxTurns));
#pragma warning restore MAAI001
                        historyOptions.ChatReducer = slidingStrategy.AsChatReducer();
                        break;
                    }

                    case ContextCompactionStrategy.Summarize:
                    {
                        // TODO: SummarizationCompactionStrategy 需要注入 IChatClient（用于摘要 LLM 调用）。
                        // 当前暂不注入，留空——等待外部传入专用 summarizer IChatClient 后完善。
                        // historyOptions.ChatReducer = new SummarizationCompactionStrategy(chatClient, CompactionTriggers.TokensExceed(contextTokens)).AsChatReducer();
                        break;
                    }

                    case ContextCompactionStrategy.None:
                    default:
                        // None：仅启用历史存储，不配置 Reducer（自然增长，不压缩）。
                        break;
                }

                _historyProvider = new InMemoryChatHistoryProvider(historyOptions);
                options.ChatHistoryProvider = _historyProvider;
            }

            // Instructions 三段拼接：Soul（Agent 人格）+ Identity（角色定位）+ SystemPrompt（脑区专项指令）。
            // 任意段为空时自动跳过，不产生多余空行。
            var instructions = string.Join("\n\n",
                new[] { soul, identity, descriptor.SystemPrompt }
                    .Where(s => !string.IsNullOrWhiteSpace(s)));

            // Instructions 在 MAF v1 落在 ChatOptions（ChatClientAgent.Instructions getter = _agentOptions?.ChatOptions?.Instructions）。
            // 即使 aiTools 为空也要建 ChatOptions 以承载 Instructions。
            var chatOptions = new ChatOptions
            {
                Instructions = instructions,
            };
            if (aiTools.Count > 0)
            {
                var tools = new List<AITool>(aiTools.Count);
                foreach (var t in aiTools)
                {
                    if (t == null)
                        throw new ArgumentException("MsaiNeuron.aiTools 不允许 null 项。", nameof(aiTools));
                    tools.Add(t);
                }
                chatOptions.Tools = tools;
            }
            options.ChatOptions = chatOptions;

            _agent   = new ChatClientAgent(_invokingChatClient, options);
            _message = new ChatMessage(ChatRole.User, string.Empty);
            _brain   = brain;
        }

        /// <inheritdoc/>
        public async Task<NeuronOutcome> InvokeAsync(NeuronInput invocation, CancellationToken ct)
        {
            if (invocation == null)
                throw new ArgumentNullException(nameof(invocation));

            TextContent textContent = new TextContent(invocation.Intent ?? string.Empty);
            _message.Contents.Clear();
            _message.Contents.Add(textContent);

            var sb = new StringBuilder();

            // 流式执行：逐 token 回调 Brain，同时收集最终文本
            await foreach (var update in _agent.RunStreamingAsync(_message, cancellationToken: ct).ConfigureAwait(false))
            {
                // 提取文本 token
                var token = update.Text ?? string.Empty;
                if (!string.IsNullOrEmpty(token))
                {
                    sb.Append(token);
                    _brain?.RaiseToken(token, isEnd: false);
                }

                // 提取 token 用量（通常在流结束前最后一个 update 的 Contents 中以 UsageContent 形式出现）
                if (update.Contents != null)
                {
                    foreach (var content in update.Contents)
                    {
                        if (content is UsageContent usageContent && usageContent.Details != null)
                        {
                            var details = usageContent.Details;
                            var inputTokens  = (int)(details.InputTokenCount  ?? 0);
                            var outputTokens = (int)(details.OutputTokenCount ?? 0);
                            if (inputTokens > 0 || outputTokens > 0)
                                _brain?.RaiseUsage(inputTokens, outputTokens);
                        }
                    }
                }
            }

            // 流结束信号
            _brain?.RaiseToken(string.Empty, isEnd: true);

            return new NeuronOutcome(
                Summary: sb.ToString(),
                StructuredOutput: null,
                SideEffects: Array.Empty<SideEffect>(),
                IsError: false,
                ErrorMessage: null);
        }

        public async void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
                return;

            // FunctionInvokingChatClient 实现了 IDisposable / IAsyncDisposable——按声明顺序释放。
            if (_invokingChatClient is IAsyncDisposable ad)
                await ad.DisposeAsync().ConfigureAwait(false);
            else if (_invokingChatClient is IDisposable d)
                d.Dispose();
        }
    }
}
