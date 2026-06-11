namespace CBIM.Mind
{
    /// <summary>
    /// 流式 token 事件——每次 LLM 输出一个 token 片段时由 Brain 触发。
    /// </summary>
    public sealed class BrainTokenEvent
    {
        /// <summary>产生本事件的脑区 ID。</summary>
        public string BrainId { get; }

        /// <summary>单个 token 文本片段。IsEnd = true 时为空串。</summary>
        public string Token { get; }

        /// <summary>是否为本次调用的最后一个 token（流结束信号）。</summary>
        public bool IsEnd { get; }

        public BrainTokenEvent(string brainId, string token, bool isEnd)
        {
            BrainId = brainId;
            Token   = token;
            IsEnd   = isEnd;
        }
    }

    /// <summary>
    /// Token 用量事件——每次 LLM 调用结束后，Brain 上报本次输入/输出 token 数。
    /// </summary>
    public sealed class BrainUsageEvent
    {
        /// <summary>产生本事件的脑区 ID。</summary>
        public string BrainId { get; }

        /// <summary>本次调用消耗的输入 token 数。</summary>
        public int InputTokens { get; }

        /// <summary>本次调用消耗的输出 token 数。</summary>
        public int OutputTokens { get; }

        /// <summary>本次调用消耗的合计 token 数（InputTokens + OutputTokens）。</summary>
        public int TotalTokens { get; }

        public BrainUsageEvent(string brainId, int inputTokens, int outputTokens, int totalTokens)
        {
            BrainId      = brainId;
            InputTokens  = inputTokens;
            OutputTokens = outputTokens;
            TotalTokens  = totalTokens;
        }
    }

    /// <summary>
    /// 脑区累计 token 用量——跨多次 InvokeAsync 调用的汇总统计。
    /// </summary>
    public sealed class BrainUsage
    {
        /// <summary>累计输入 token 数。</summary>
        public int InputTokens { get; internal set; }

        /// <summary>累计输出 token 数。</summary>
        public int OutputTokens { get; internal set; }

        /// <summary>累计合计 token 数。</summary>
        public int TotalTokens { get; internal set; }
    }
}
