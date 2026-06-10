using System;
using System.Collections.Generic;

namespace CBIM.Kernel
{
    /// <summary>
    /// 主脑（PrefrontalCortex）向子脑区下发的一次调用请求。
    /// </summary>
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
    /// </summary>
    public sealed class NeuronOutcome
    {
        public string Summary { get; }
        public object? StructuredOutput { get; }
        public IReadOnlyList<SideEffect> SideEffects { get; }
        public bool IsError { get; }
        public string? ErrorMessage { get; }

        public NeuronOutcome(string Summary, object? StructuredOutput, IReadOnlyList<SideEffect> SideEffects, bool IsError, string? ErrorMessage)
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
    /// </summary>
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
