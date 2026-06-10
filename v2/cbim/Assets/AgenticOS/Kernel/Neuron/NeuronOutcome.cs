using System;
using System.Collections.Generic;

namespace CBIM.Kernel
{
    /// <summary>
    /// 主脑（PrefrontalCortex）向子脑区下发的一次调用请求。
    /// 由 <c>__brain_call_*</c> AIFunction 的 handler 构造，传给目标脑区的
    /// <see cref="Brain.InvokeAsync"/>。
    /// </summary>
    /// <param name="CorrelationId">关联主脑 AIFunction call id（追踪用 · 通常是 Guid）。</param>
    /// <param name="Intent">自然语言意图——目标脑区据此推理具体动作。</param>
    /// <param name="StructuredInput">可选结构化输入（任意可序列化对象）。</param>
    /// <param name="Context">主脑当前对话上下文切片（key-value · 不为 null）。</param>
    public sealed class NeuronInput
    {
        public string CorrelationId { get; }
        public string Intent { get; }
        public object? StructuredInput { get; }
        public IReadOnlyDictionary<string, object> Context { get; }

        public NeuronInput(
            string CorrelationId,
            string Intent,
            object? StructuredInput,
            IReadOnlyDictionary<string, object> Context)
        {
            this.CorrelationId = CorrelationId;
            this.Intent = Intent;
            this.StructuredInput = StructuredInput;
            this.Context = Context;
        }
    }
    
    /// <summary>
    /// 子脑区返回给主脑的执行结果。
    /// <see cref="Summary"/> 作为 ToolMessage 回填到主脑下一轮 LLM 上下文；
    /// <see cref="StructuredOutput"/> 供有需要的主脑路径解析（如 FissionProposal）；
    /// <see cref="SideEffects"/> 是 MotorCortex 家族脑区必填的副作用清单。
    /// </summary>
    public sealed class NeuronOutcome
    {
        public string Summary { get; }
        public object? StructuredOutput { get; }
        public IReadOnlyList<SideEffect> SideEffects { get; }
        public bool IsError { get; }
        public string? ErrorMessage { get; }

        public NeuronOutcome(
            string Summary,
            object? StructuredOutput,
            IReadOnlyList<SideEffect> SideEffects,
            bool IsError,
            string? ErrorMessage)
        {
            this.Summary = Summary;
            this.StructuredOutput = StructuredOutput;
            this.SideEffects = SideEffects;
            this.IsError = IsError;
            this.ErrorMessage = ErrorMessage;
        }
    }
    
    /// <summary>
    /// 副作用审计记录——MotorCortex 家族脑区在 <see cref="NeuronOutcome.SideEffects"/> 中
    /// 必填的结构化记账条目。其他脑区的 SideEffects 列表通常为空。
    ///
    /// 设计意图：把「世界状态变化」从自然语言摘要中剥离出来，给上游主脑 / 治理审计
    /// 一份可结构化扫描的清单。
    /// </summary>
    /// <param name="Kind">副作用种类。常见值：<c>file-write</c> / <c>mcp-call</c> / <c>http</c> / <c>process-spawn</c> / <c>memory-write</c>。</param>
    /// <param name="Target">受影响目标的标识——文件路径 / MCP server id / URL 等。</param>
    /// <param name="Detail">可选补充信息（diff 摘要 / HTTP 状态码等）。</param>
    /// <param name="At">副作用发生时间。用 <see cref="DateTimeOffset"/> 避开时区歧义。</param>
    public sealed class SideEffect
    {
        public string Kind { get; }
        public string Target { get; }
        public string? Detail { get; }
        public DateTimeOffset At { get; }

        public SideEffect(
            string Kind,
            string Target,
            string? Detail,
            DateTimeOffset At)
        {
            this.Kind = Kind;
            this.Target = Target;
            this.Detail = Detail;
            this.At = At;
        }
    }
}
