using System;
using System.Collections.Generic;
using CBIM.Workspace;

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

        /// <summary>
        /// 本次调用动态指派给目标脑区的 Module 实例列表（per-invocation）。
        ///
        /// <para>语义：MotorCortex（工作脑）按这份清单逐次重建文件沙箱白名单——
        /// <c>AllowedPathPrefixes = Modules.Select(m =&gt; m.WorkspaceRoot)</c>。
        /// 空列表 → 工作脑无任何文件读写权限（Q8 fail-hard，不退化到全工作区）。
        /// 非工作脑忽略本字段（其沙箱在装配期一次成型）。</para>
        /// </summary>
        public IReadOnlyList<Module> Modules { get; }

        public NeuronInput(
            string CorrelationId,
            string Intent,
            object? StructuredInput,
            IReadOnlyDictionary<string, object> Context,
            IReadOnlyList<Module>? Modules = null)
        {
            this.CorrelationId = CorrelationId;
            this.Intent = Intent;
            this.StructuredInput = StructuredInput;
            this.Context = Context;
            this.Modules = Modules ?? Array.Empty<Module>();
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

        /// <summary>
        /// 复制本结果但用 <paramref name="sideEffects"/> 覆盖 <see cref="SideEffects"/>——
        /// MotorCortex（工作脑）在 Brain 层调用结束时调用，将 ToolSandbox 队列里收集的副作用记录归入。
        /// 其余字段透传，避免重复罗列全参 ctor。
        /// </summary>
        public NeuronOutcome WithSideEffects(IReadOnlyList<SideEffect> sideEffects)
        {
            return new NeuronOutcome(
                Summary: Summary,
                StructuredOutput: StructuredOutput,
                SideEffects: sideEffects ?? Array.Empty<SideEffect>(),
                IsError: IsError,
                ErrorMessage: ErrorMessage);
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
