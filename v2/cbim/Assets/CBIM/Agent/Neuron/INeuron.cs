#nullable enable
using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Agents.AI;

namespace CBIM.AgentSystem
{
    /// <summary>
    /// 神经元——LLM 思维链单元抽象。
    /// </summary>
    public interface INeuron : IDisposable
    {
        /// <summary>引擎种别——供 Brain 层做能力体征判断。</summary>
        NeuronKind Kind { get; }

        /// <summary>
        /// 核心执行——投递 <see cref="NeuronInput"/>，返回 <see cref="NeuronOutput"/>。
        /// 不感知调用者是哪个脑区（脑区职责 = Brain 层；神经元只负责跑 LLM）。
        /// </summary>
        Task<NeuronOutput> InvokeAsync(NeuronInput invocation, CancellationToken ct);

        /// <summary>
        /// 暴露底层 <see cref="AIAgent"/> 引用（仅供 Channel 持引用打 SendAsync 用）。
        /// <see cref="MsAINeuron"/> 返回真实 ChatClientAgent；<see cref="ExternalEngineNeuron"/>
        /// 返回 <c>null</c>（外部引擎自带 LLM，无 AIAgent 句柄）。
        /// </summary>
        AIAgent? UnderlyingAgent { get; }
    }
}
