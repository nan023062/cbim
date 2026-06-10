#nullable enable
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using CBIM.Mind;

namespace CBIM.Agent
{
#region AgentEventKind

    /// <summary>
    /// Agent 层统一事件类型枚举。
    /// </summary>
    public enum AgentEventKind
    {
        /// <summary>单个 token 片段（流式输出）。</summary>
        Token,

        /// <summary>一次 LLM 调用结束后的 token 统计。</summary>
        Usage,

        /// <summary>某个 Brain 开始推理（InvokeAsync 入口）。</summary>
        BrainStart,

        /// <summary>某个 Brain 推理结束（InvokeAsync 返回）。</summary>
        BrainEnd,

        /// <summary>Workflow 节点开始（预留）。</summary>
        WorkflowNodeStart,

        /// <summary>Workflow 节点结束（预留）。</summary>
        WorkflowNodeEnd,
    }

#endregion

#region AgentEvent

    /// <summary>
    /// Agent 层统一事件——所有 Brain 事件经 <see cref="Agent.OnEvent"/> 聚合后以本类型对外分发。
    /// </summary>
    public sealed class AgentEvent
    {
        /// <summary>事件产生时间（UTC）。</summary>
        public DateTimeOffset Timestamp { get; }

        /// <summary>所属会话 ID（来自 <see cref="Agent.SessionId"/>）。</summary>
        public string SessionId { get; }

        /// <summary>产生事件的脑区 ID。</summary>
        public string BrainId { get; }

        /// <summary>事件类型。</summary>
        public AgentEventKind Kind { get; }

        /// <summary>
        /// 事件载荷：
        /// <list type="bullet">
        ///   <item><see cref="AgentEventKind.Token"/> → <see cref="BrainTokenEvent"/></item>
        ///   <item><see cref="AgentEventKind.Usage"/> → <see cref="BrainUsageEvent"/></item>
        ///   <item><see cref="AgentEventKind.BrainStart"/> / <see cref="AgentEventKind.BrainEnd"/> → null</item>
        /// </list>
        /// </summary>
        public object? Data { get; }

        public AgentEvent(
            DateTimeOffset timestamp,
            string sessionId,
            string brainId,
            AgentEventKind kind,
            object? data)
        {
            Timestamp = timestamp;
            SessionId = sessionId;
            BrainId   = brainId;
            Kind      = kind;
            Data      = data;
        }
    }

#endregion

#region AgentUsageSummary

    /// <summary>
    /// Session 级别的 token 用量汇总——跨所有 Brain 的累计统计。
    /// 线程安全：所有字段通过 <see langword="lock"/> 或 Interlocked 更新。
    /// </summary>
    public sealed class AgentUsageSummary
    {
        private long _inputTokens;
        private long _outputTokens;
        private long _totalTokens;

        private readonly ConcurrentDictionary<string, BrainUsage> _byBrain
            = new ConcurrentDictionary<string, BrainUsage>(StringComparer.Ordinal);

        /// <summary>Session 累计输入 token 数。</summary>
        public long InputTokens => _inputTokens;

        /// <summary>Session 累计输出 token 数。</summary>
        public long OutputTokens => _outputTokens;

        /// <summary>Session 累计合计 token 数。</summary>
        public long TotalTokens => _totalTokens;

        /// <summary>按 BrainId 分类的累计用量。</summary>
        public IReadOnlyDictionary<string, BrainUsage> ByBrain => _byBrain;

        /// <summary>
        /// 将一次 <see cref="BrainUsageEvent"/> 累加到汇总中。
        /// 由 <see cref="Agent"/> 的事件订阅回调调用；线程安全。
        /// </summary>
        internal void Accumulate(string brainId, BrainUsageEvent e)
        {
            System.Threading.Interlocked.Add(ref _inputTokens,  e.InputTokens);
            System.Threading.Interlocked.Add(ref _outputTokens, e.OutputTokens);
            System.Threading.Interlocked.Add(ref _totalTokens,  e.TotalTokens);

            var entry = _byBrain.GetOrAdd(brainId, _ => new BrainUsage());
            lock (entry)
            {
                entry.InputTokens  += e.InputTokens;
                entry.OutputTokens += e.OutputTokens;
                entry.TotalTokens  += e.TotalTokens;
            }
        }
    }

#endregion
}
