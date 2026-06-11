#nullable enable
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using CBIM.Workspace;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace CBIM.Kernel
{
    /// <summary>
    /// FlowGraph 执行引擎门面——主脑（PrefrontalCortex）拿到 <see cref="NeuralCircuit"/> 编译产物后，
    /// 通过本类驱动 MAF Workflow 执行，最终拿回一个 <see cref="NeuronOutput"/>。
    /// </summary>
    public sealed class Orchestrator : ICircuitExecutor
    {
        private const string OrchestratorEntryNodeId = "@orchestrator-start";
        private const string OrchestratorReporterId = "@orchestrator";

        public async Task<NeuronOutcome> RunAsync(
            NeuralCircuit circuit,
            IBrainLookup brainLookup,
            IPrefrontalCallback callback,
            CancellationToken ct = default,
            IReadOnlyDictionary<string, AIFunction>? toolRegistry = null,
            WorkspaceSystem? workspace = null)
        {
            if (circuit == null)
                throw new ArgumentNullException(nameof(circuit));
            if (brainLookup == null)
                throw new ArgumentNullException(nameof(brainLookup));
            if (callback == null)
                throw new ArgumentNullException(nameof(callback));
            if (circuit.Nodes.Count == 0)
            {
                throw new ArgumentException(
                    "NeuralCircuit.Nodes 为空——图无可执行节点。",
                    nameof(circuit));
            }

            var resolvedToolRegistry = toolRegistry
                ?? new Dictionary<string, AIFunction>(StringComparer.Ordinal);

            var workflow = CircuitToWorkflowCompiler.Compile(circuit, brainLookup, callback, resolvedToolRegistry, workspace);

            var startMessage = new CircuitMessage(
                circuitId: circuit.CircuitId,
                fromNodeId: OrchestratorEntryNodeId,
                branchLabel: null,
                lastSummary: circuit.SourceRequest,
                history: new Dictionary<string, NeuronOutcome>(StringComparer.Ordinal));

            await using StreamingRun run = await InProcessExecution
                .RunStreamingAsync(workflow, startMessage, cancellationToken: ct)
                .ConfigureAwait(false);

            string? finalSummary = null;
            List<string>? errors = null;

            await foreach (WorkflowEvent ev in run.WatchStreamAsync(ct).ConfigureAwait(false))
            {
                switch (ev)
                {
                    case ExecutorFailedEvent failed:
                    {
                        string message = failed.Data?.Message ?? "executor failed without exception";
                        (errors ??= new List<string>()).Add(
                            $"node '{failed.ExecutorId}': {message}");
                        break;
                    }

                    case WorkflowErrorEvent error:
                    {
                        string message = error.Exception?.Message ?? "unknown workflow error";
                        (errors ??= new List<string>()).Add(message);
                        break;
                    }

                    case WorkflowOutputEvent output:
                    {
                        if (output.Data is string text)
                        {
                            finalSummary = text;
                        }
                        break;
                    }

                    case ExecutorInvokedEvent invoked:
                    {
                        callback.ReportProgress(
                            OrchestratorReporterId,
                            $"running node {invoked.ExecutorId}");
                        break;
                    }

                    case ExecutorCompletedEvent completed:
                    {
                        callback.ReportProgress(
                            OrchestratorReporterId,
                            $"node {completed.ExecutorId} done");
                        break;
                    }
                }
            }

            if (errors != null && errors.Count > 0)
            {
                return new NeuronOutcome(
                    Summary: string.Empty,
                    StructuredOutput: null,
                    SideEffects: Array.Empty<SideEffect>(),
                    IsError: true,
                    ErrorMessage: string.Join("; ", errors));
            }

            if (finalSummary == null)
            {
                return new NeuronOutcome(
                    Summary: string.Empty,
                    StructuredOutput: null,
                    SideEffects: Array.Empty<SideEffect>(),
                    IsError: true,
                    ErrorMessage: "circuit halted without return: no ReturnNode 触发 WorkflowOutputEvent。");
            }

            return new NeuronOutcome(
                Summary: finalSummary,
                StructuredOutput: null,
                SideEffects: Array.Empty<SideEffect>(),
                IsError: false,
                ErrorMessage: null);
        }
    }
}
