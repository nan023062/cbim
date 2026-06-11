#nullable enable
using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Agents.AI;

namespace CBIM.Kernel;

/// <summary>
/// 神经元引擎种别——供 Brain 层做能力体征判断（如「External 不可作为主脑」）。
/// 用枚举而非运行期类型判别，让未来追加新 NeuronKind 不破坏现有校验代码。
/// </summary>
public enum NeuronKind
{
    /// <summary>Microsoft.Agents.AI（msai）装配的标准神经元——走 ChatClientAgent + FunctionInvokingChatClient。</summary>
    Msai,

    /// <summary>外部引擎桥接神经元——走 IExternalEngineAdapter（如 Claude Code）。</summary>
    External,
}

/// <summary>
/// 神经元——LLM 思维链单元抽象。
/// </summary>
public interface INeuron : IDisposable
{
    /// <summary>引擎种别——供 Brain 层做能力体征判断。</summary>
    NeuronKind Kind { get; }

    /// <summary>
    /// 核心执行——投递 <see cref="NeuronInput"/>，返回 <see cref="NeuronOutcome"/>。
    /// 不感知调用者是哪个脑区（脑区职责 = Brain 层；神经元只负责跑 LLM）。
    /// </summary>
    Task<NeuronOutcome> InvokeAsync(NeuronInput invocation, CancellationToken ct);

    /// <summary>
    /// 暴露底层 <see cref="AIAgent"/> 引用（仅供 Channel 持引用打 SendAsync 用）。
    /// <see cref="Neuron"/> 返回真实 ChatClientAgent；<see cref="ExternalNeuron"/>
    /// 返回 <c>null</c>（外部引擎自带 LLM，无 AIAgent 句柄）。
    /// </summary>
    AIAgent? UnderlyingAgent { get; }
}
