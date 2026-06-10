#nullable enable
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using CBIM.Mind;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace CBIM.Kernel
{
    /// <summary>
    /// 外部引擎神经元
    /// </summary>
    public sealed class ExternalNeuron : INeuron
    {
        public NeuronKind Kind => NeuronKind.External;
        
        public AIAgent? UnderlyingAgent => null;

        private readonly IExternalEngineAdapter _adapter;
        private int _disposed;
        
        public ExternalNeuron(Brain brain,  string soul, string identity,
            IReadOnlyList<AITool> aiTools, IReadOnlyList<AIContextProvider>? contextProviders = null)
        {
            ExternalMotorCortexDescriptor descriptor = (ExternalMotorCortexDescriptor)brain.Descriptor;
            
            // init by ExternalMotorCortexDescriptor info
            _adapter = null;
        }

        /// <inheritdoc/>
        public async Task<NeuronOutcome> InvokeAsync(NeuronInput invocation, CancellationToken ct)
        {
            if (invocation == null)
                throw new ArgumentNullException(nameof(invocation));

            var jobId = await _adapter.SubmitAsync(invocation, ct).ConfigureAwait(false);
            var outcome = await _adapter.AwaitResultAsync(jobId, ct).ConfigureAwait(false);
            return outcome;
        }

        public async void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
                return;

            await _adapter.DisposeAsync().ConfigureAwait(false);
        }
    }
    
    /// <summary>
    /// 把对外部 agent 引擎（Claude Code / Cursor / Cline 等）的调用收敛到一处。
    /// <see cref="ExternalMotorCortex"/> 在 InvokeAsync 路径上仅与本接口对话——
    /// 具体 Adapter（如 ClaudeCodeEngineAdapter）由后续切片实装。
    ///
    /// <para>提交 / 等待二阶段拆分的原因：外部引擎多为 subprocess 或异步作业，
    /// 同步 await 会长时间持有 CancellationToken；二阶段可让上游灵活控制超时 /
    /// 取消 / 进度上报。</para>
    ///
    /// <para>实现期约定：</para>
    /// <list type="bullet">
    ///   <item>SubmitAsync 必须返回一个对实现内部唯一的 jobId（用于 AwaitResultAsync 配对）。</item>
    ///   <item>AwaitResultAsync 失败时返回 <c>IsError=true</c> 的 <see cref="NeuronOutcome"/>，<b>不</b>抛出。</item>
    ///   <item>DisposeAsync 必须强制收尾——杀掉所有未退出的外部进程、关闭桥接 server。</item>
    /// </list>
    /// </summary>
    public interface IExternalEngineAdapter : IAsyncDisposable
    {
        /// <summary>
        /// 提交一次外部引擎调用。返回引擎内部唯一的 jobId。
        /// </summary>
        Task<string> SubmitAsync(NeuronInput invocation, CancellationToken ct);

        /// <summary>
        /// 等待指定 jobId 的最终结果。
        /// 失败时返回 <c>IsError=true</c> 的 <see cref="NeuronOutcome"/>，不抛。
        /// </summary>
        Task<NeuronOutcome> AwaitResultAsync(string jobId, CancellationToken ct);
    }
}
