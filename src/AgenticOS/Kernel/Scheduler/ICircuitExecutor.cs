#nullable enable
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using CBIM.Workspace;
using Microsoft.Extensions.AI;

namespace CBIM.Kernel;

/// <summary>
/// NeuralCircuit 执行引擎的抽象——Brain 层只依赖此接口，不依赖 Orchestrator 具体类。
/// </summary>
public interface ICircuitExecutor
{
    Task<NeuronOutcome> RunAsync(
        NeuralCircuit circuit,
        IBrainLookup brainLookup,
        IPrefrontalCallback callback,
        CancellationToken ct = default,
        IReadOnlyDictionary<string, AIFunction>? toolRegistry = null,
        WorkspaceSystem? workspace = null);
}
