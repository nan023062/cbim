#nullable enable
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.Extensions.AI;

namespace CBIM.Kernel;

/// <summary>
/// 编译器工具工厂——为主脑 Neuron 产出 <c>__circuit_*</c> IR 构建 AITool 集（6 个）。
/// </summary>
public static class CompilerToolFactory
{
    /// <summary>
    /// 产出 6 个 <c>__circuit_*</c> AITool。
    /// </summary>
    public static IReadOnlyList<AITool> Build(
        ICircuitBuilderContext context,
        IReadOnlyList<Mind.Brain> callableBrains)
    {
        if (context == null)
            throw new ArgumentNullException(nameof(context));
        if (callableBrains == null)
            throw new ArgumentNullException(nameof(callableBrains));

        var callableBrainIds = new HashSet<string>(StringComparer.Ordinal);
        var callableBrainIdsOrdered = new List<string>(callableBrains.Count);
        foreach (var brain in callableBrains)
        {
            if (brain == null)
                throw new ArgumentException("callableBrains 不允许 null 项。", nameof(callableBrains));
            if (!callableBrainIds.Add(brain.BrainId))
                throw new InvalidOperationException(
                    $"callableBrains 中 BrainId 重复: '{brain.BrainId}'——「BrainId 唯一」铁律违反。");
            callableBrainIdsOrdered.Add(brain.BrainId);
        }

        var tools = new List<AITool>(6)
        {
            BuildStartTool(context),
            BuildAddCallBrainTool(context, callableBrainIds, callableBrainIdsOrdered),
            BuildAddBranchTool(context),
            BuildAddReturnTool(context),
            BuildAddEdgeTool(context),
            BuildCommitTool(context),
        };
        return tools;
    }

    private static NeuralCircuitBuilder ResolveBuilder(ICircuitBuilderContext context)
    {
        var builder = context.GetActiveBuilder();
        if (builder == null)
            throw new InvalidOperationException(
                "No active NeuralCircuitBuilder——__circuit_* 工具仅在 PrefrontalCortex.InvokeAsync 窗口内有效。");
        return builder;
    }

    private static AIFunction BuildStartTool(ICircuitBuilderContext context)
    {
        var trampoline = new StartTrampoline(context);
        var method = ResolveMethod(typeof(StartTrampoline), nameof(StartTrampoline.Invoke));
        return AIFunctionFactory.Create(
            method,
            target: trampoline,
            name: "__circuit_start",
            description:
                "Declare the beginning of neural-circuit compilation. " +
                "Call this once before any __circuit_add_* tool. " +
                "Idempotency: must NOT be called after __circuit_commit succeeded.");
    }

    private static AIFunction BuildAddCallBrainTool(
        ICircuitBuilderContext context,
        HashSet<string> callableBrainIds,
        IReadOnlyList<string> callableBrainIdsOrdered)
    {
        var trampoline = new AddCallBrainTrampoline(context, callableBrainIds, callableBrainIdsOrdered);
        var method = ResolveMethod(typeof(AddCallBrainTrampoline), nameof(AddCallBrainTrampoline.Invoke));
        return AIFunctionFactory.Create(
            method,
            target: trampoline,
            name: "__circuit_add_call_brain",
            description:
                "Declare a step that dispatches user intent to a specific brain. " +
                "Use after __circuit_start; can be chained. " +
                "Returns the new node id (e.g. 'n01') for later __circuit_add_edge wiring.");
    }

    private static AIFunction BuildAddBranchTool(ICircuitBuilderContext context)
    {
        var trampoline = new AddBranchTrampoline(context);
        var method = ResolveMethod(typeof(AddBranchTrampoline), nameof(AddBranchTrampoline.Invoke));
        return AIFunctionFactory.Create(
            method,
            target: trampoline,
            name: "__circuit_add_branch",
            description:
                "Declare a conditional branch node. " +
                "conditionExpression must match: '<token> contains \"<value>\"' OR '<token> equals \"<value>\"' " +
                "where <token> is 'previous.summary' or 'node_<id>.summary'. " +
                "Returns the new node id; wire >=2 outgoing edges via __circuit_add_edge with branchLabel " +
                "'true' or 'false'.");
    }

    private static AIFunction BuildAddReturnTool(ICircuitBuilderContext context)
    {
        var trampoline = new AddReturnTrampoline(context);
        var method = ResolveMethod(typeof(AddReturnTrampoline), nameof(AddReturnTrampoline.Invoke));
        return AIFunctionFactory.Create(
            method,
            target: trampoline,
            name: "__circuit_add_return",
            description:
                "Declare a terminal node that yields the final summary back to the main brain. " +
                "summaryTemplate may contain placeholders such as '{previous.summary}' or '{node_n03.summary}' " +
                "that Orchestrator resolves at execution time. " +
                "At least one Return node is required for __circuit_commit to succeed.");
    }

    private static AIFunction BuildAddEdgeTool(ICircuitBuilderContext context)
    {
        var trampoline = new AddEdgeTrampoline(context);
        var method = ResolveMethod(typeof(AddEdgeTrampoline), nameof(AddEdgeTrampoline.Invoke));
        return AIFunctionFactory.Create(
            method,
            target: trampoline,
            name: "__circuit_add_edge",
            description:
                "Connect two declared nodes. " +
                "branchLabel MUST be provided when fromNodeId is a Branch node (one edge per outcome), " +
                "and MUST be null otherwise. " +
                "Returns 'ok' on success.");
    }

    private static AIFunction BuildCommitTool(ICircuitBuilderContext context)
    {
        var trampoline = new CommitTrampoline(context);
        var method = ResolveMethod(typeof(CommitTrampoline), nameof(CommitTrampoline.Invoke));
        return AIFunctionFactory.Create(
            method,
            target: trampoline,
            name: "__circuit_commit",
            description:
                "Freeze the in-progress graph into an immutable NeuralCircuit. " +
                "Whole-graph validation runs: >=1 ReturnNode, reachability from start, no cycles, " +
                "Branch out-degree >=2 with non-empty branchLabel on each outgoing edge. " +
                "On failure the LLM must clarify with the user instead of forcing execution.");
    }

    private static MethodInfo ResolveMethod(Type trampolineType, string methodName)
    {
        var method = trampolineType.GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public);
        if (method == null)
            throw new InvalidOperationException(
                $"未找到 {trampolineType.Name}.{methodName}——内部不变量违反。");
        return method;
    }

    private sealed class StartTrampoline
    {
        private readonly ICircuitBuilderContext _context;

        public StartTrampoline(ICircuitBuilderContext context) { _context = context; }

        public string Invoke(
            [Description("The original user natural-language request that motivates this circuit. " +
                         "Echoed back for LLM bookkeeping; the value is already captured by the builder ctor.")]
            string _)
        {
            var builder = ResolveBuilder(_context);
            if (builder.Compiled != null)
                throw new InvalidOperationException(
                    "__circuit_start 不可在 __circuit_commit 成功后再次调用——Builder 已冻结。");
            return "started";
        }
    }

    private sealed class AddCallBrainTrampoline
    {
        private readonly ICircuitBuilderContext _context;
        private readonly HashSet<string> _callableBrainIds;
        private readonly IReadOnlyList<string> _callableBrainIdsOrdered;

        public AddCallBrainTrampoline(
            ICircuitBuilderContext context,
            HashSet<string> callableBrainIds,
            IReadOnlyList<string> callableBrainIdsOrdered)
        {
            _context = context;
            _callableBrainIds = callableBrainIds;
            _callableBrainIdsOrdered = callableBrainIdsOrdered;
        }

        public string Invoke(
            [Description("Short human-readable label for this step; surfaces in audit / visualization.")]
            string label,
            [Description("Target brain id; MUST be one of the callable brains exposed to the main brain.")]
            string targetBrainId,
            [Description("Natural-language task description for the target brain.")]
            string intent,
            [Description("Optional JSON-serialized structured payload; pass null when not needed.")]
            string? structuredInputJson,
            [Description("Module ids for this dispatch as a JSON string array (e.g. '[\"src/combat\",\"src/ui\"]'). " +
                         "Worker brains use these to scope their filesystem sandbox; non-worker brains ignore. " +
                         "Pass null or '[]' when no module scope is required (workers will get NO file access).")]
            string? moduleIdsJson)
        {
            var builder = ResolveBuilder(_context);
            if (!_callableBrainIds.Contains(targetBrainId ?? string.Empty))
            {
                var available = _callableBrainIdsOrdered.Count == 0
                    ? "<empty>"
                    : string.Join(", ", _callableBrainIdsOrdered);
                throw new InvalidOperationException(
                    $"targetBrainId '{targetBrainId}' 不在可调脑区集合; 可选: {available}");
            }
            try
            {
                return builder.AddCallBrain(label, targetBrainId, intent, structuredInputJson, moduleIdsJson);
            }
            catch (ArgumentException ex)
            {
                throw new InvalidOperationException(ex.Message);
            }
        }
    }

    private static readonly Regex SConditionRegex = new Regex(
        "^\\s*(previous\\.summary|node_n\\d{2}\\.summary)\\s+(contains|equals)\\s+\"[^\"]*\"\\s*$",
        RegexOptions.Compiled);

    private sealed class AddBranchTrampoline
    {
        private readonly ICircuitBuilderContext _context;

        public AddBranchTrampoline(ICircuitBuilderContext context) { _context = context; }

        public string Invoke(
            [Description("Short human-readable label for this branch node; surfaces in audit / visualization.")]
            string label,
            [Description("Condition expression. Must be: '<token> contains \"<value>\"' OR " +
                         "'<token> equals \"<value>\"' where <token> is 'previous.summary' or 'node_<id>.summary'.")]
            string conditionExpression)
        {
            var builder = ResolveBuilder(_context);
            if (string.IsNullOrWhiteSpace(conditionExpression) ||
                !SConditionRegex.IsMatch(conditionExpression))
            {
                throw new InvalidOperationException(
                    "conditionExpression 形式不合法; 仅支持 '<token> contains \"<value>\"' 或 " +
                    "'<token> equals \"<value>\"', 其中 <token> 为 'previous.summary' 或 'node_n<NN>.summary'。" +
                    $"实际收到: '{conditionExpression}'");
            }
            try
            {
                return builder.AddBranch(label, conditionExpression);
            }
            catch (ArgumentException ex)
            {
                throw new InvalidOperationException(ex.Message);
            }
        }
    }

    private sealed class AddReturnTrampoline
    {
        private readonly ICircuitBuilderContext _context;

        public AddReturnTrampoline(ICircuitBuilderContext context) { _context = context; }

        public string Invoke(
            [Description("Short human-readable label for this return node; surfaces in audit / visualization.")]
            string label,
            [Description("Final summary template; may include placeholders '{previous.summary}' " +
                         "or '{node_<id>.summary}' resolved by Orchestrator at execution time.")]
            string summaryTemplate)
        {
            var builder = ResolveBuilder(_context);
            try
            {
                return builder.AddReturn(label, summaryTemplate);
            }
            catch (ArgumentException ex)
            {
                throw new InvalidOperationException(ex.Message);
            }
        }
    }

    private sealed class AddEdgeTrampoline
    {
        private readonly ICircuitBuilderContext _context;

        public AddEdgeTrampoline(ICircuitBuilderContext context) { _context = context; }

        public string Invoke(
            [Description("Source node id (returned by a prior __circuit_add_* call).")]
            string fromNodeId,
            [Description("Target node id (returned by a prior __circuit_add_* call).")]
            string toNodeId,
            [Description("Branch label; MUST be supplied when fromNodeId is a Branch node " +
                         "(use 'true'/'false' to match Branch evaluation), MUST be null otherwise.")]
            string? branchLabel)
        {
            var builder = ResolveBuilder(_context);
            try
            {
                builder.AddEdge(fromNodeId, toNodeId, branchLabel);
                return "ok";
            }
            catch (ArgumentException ex)
            {
                throw new InvalidOperationException(ex.Message);
            }
        }
    }

    private sealed class CommitTrampoline
    {
        private readonly ICircuitBuilderContext _context;

        public CommitTrampoline(ICircuitBuilderContext context) { _context = context; }

        public string Invoke()
        {
            var builder = ResolveBuilder(_context);
            try
            {
                var circuit = builder.Commit();
                return
                    $"committed circuit {circuit.CircuitId} with " +
                    $"{circuit.Nodes.Count} nodes, {circuit.Edges.Count} edges";
            }
            catch (CircuitCompilationException ex)
            {
                throw new InvalidOperationException($"commit 失败: {ex.Reason}");
            }
        }
    }
}
