#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using CBIM.Kernel;
using CBIM.Workspace;
using FluentAssertions;
using Xunit;

namespace CBIM.Test;

/// <summary>
/// 验证编译期把 moduleIdsJson 注入 CallBrainNode 后,运行时
/// BrainCallExecutor 能透过共享的 ModuleResolver 解析出非空 Modules,
/// 通过 IInvocable.InvokeAsync 抵达目标脑区。
/// </summary>
public sealed class CircuitModulesTest
{
    [Fact]
    public async Task Compiled_call_brain_with_moduleIdsJson_yields_NeuronInput_Modules_non_empty()
    {
        // -- arrange --
        string root = Path.Combine(Path.GetTempPath(), "cbim-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);

        const string ModuleId = "demo-module";
        string moduleMetaPath = Path.Combine(root, ModuleId, ".dna", "module.md");
        Directory.CreateDirectory(Path.GetDirectoryName(moduleMetaPath)!);
        File.WriteAllText(moduleMetaPath, "# Demo Module\n");

        var description = new ModuleDescription(
            id: ModuleId,
            name: "Demo Module",
            metadata: new LocalModuleMetadata(moduleMetaPath));
        var workspace = new WorkspaceSystem(root, new[] { description });

        var builder = new NeuralCircuitBuilder(
            circuitId: Guid.NewGuid().ToString(),
            sourceRequest: "test request");

        string callId = builder.AddCallBrain(
            label: "call-target",
            targetBrainId: "target-brain",
            intent: "do something",
            structuredInputJson: null,
            moduleIdsJson: $"[\"{ModuleId}\"]");
        string returnId = builder.AddReturn("done", "ok");
        builder.AddEdge(callId, returnId, branchLabel: null);

        NeuralCircuit circuit = builder.Commit();

        var spy = new ModulesCapturingBrain();
        var lookup = new SingleBrainLookup("target-brain", spy);
        var callback = new NoopCallback();

        // -- act --
        var orchestrator = new Orchestrator();
        NeuronOutcome outcome = await orchestrator.RunAsync(
            circuit,
            lookup,
            callback,
            CancellationToken.None,
            toolRegistry: null,
            workspace: workspace);

        // -- assert --
        outcome.IsError.Should().BeFalse(because: outcome.ErrorMessage ?? "");
        spy.Captured.Should().NotBeNull();
        spy.Captured!.Modules.Should().NotBeEmpty();
        spy.Captured.Modules[0].Description.Id.Should().Be(ModuleId);

        // -- cleanup --
        try
        { Directory.Delete(root, recursive: true); }
        catch { /* best-effort */ }
    }

    private sealed class ModulesCapturingBrain : IInvocable
    {
        public NeuronInput? Captured { get; private set; }

        public Task<NeuronOutcome> InvokeAsync(NeuronInput input, CancellationToken ct = default)
        {
            Captured = input;
            return Task.FromResult(new NeuronOutcome(
                Summary: "ok",
                StructuredOutput: null,
                SideEffects: Array.Empty<SideEffect>(),
                IsError: false,
                ErrorMessage: null));
        }
    }

    private sealed class SingleBrainLookup : IBrainLookup
    {
        private readonly string _id;
        private readonly IInvocable _brain;
        public SingleBrainLookup(string id, IInvocable brain) { _id = id; _brain = brain; }
        public IInvocable? FindBrain(string brainId) =>
            string.Equals(brainId, _id, StringComparison.Ordinal) ? _brain : null;
    }

    private sealed class NoopCallback : IPrefrontalCallback
    {
        public void ReportProgress(string brainId, string message) { }
        public void ReportOutcome(string brainId, NeuronOutcome outcome) { }
    }
}
