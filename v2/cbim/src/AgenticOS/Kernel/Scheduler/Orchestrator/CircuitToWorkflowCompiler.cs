#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using CBIM.Workspace;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace CBIM.Kernel
{
    /// <summary>
    /// 将 CBIM <see cref="NeuralCircuit"/> IR 翻译为 Microsoft Agents Framework
    /// <see cref="Workflow"/> 的内部静态翻译器——本子模块只做「装配」，不做「执行」。
    /// </summary>
    internal static class CircuitToWorkflowCompiler
    {
        public static Microsoft.Agents.AI.Workflows.Workflow Compile(
            NeuralCircuit circuit,
            IBrainLookup brainLookup,
            IPrefrontalCallback callback,
            IReadOnlyDictionary<string, AIFunction> toolRegistry,
            WorkspaceSystem? workspace = null)
        {
            if (circuit == null)
                throw new ArgumentNullException(nameof(circuit));
            if (brainLookup == null)
                throw new ArgumentNullException(nameof(brainLookup));
            if (callback == null)
                throw new ArgumentNullException(nameof(callback));
            if (toolRegistry == null)
                throw new ArgumentNullException(nameof(toolRegistry));

            var startNode = circuit.Nodes.FirstOrDefault(n => n.NodeId == circuit.StartNodeId);
            if (startNode == null)
            {
                throw new CircuitExecutionException(
                    circuit.StartNodeId,
                    $"StartNodeId='{circuit.StartNodeId}' 不在 NeuralCircuit.Nodes 中。");
            }

            var startExecutor = BuildExecutor(startNode, brainLookup, callback, toolRegistry, workspace);
            var builder = new WorkflowBuilder(startExecutor);

            var executorMap = new Dictionary<string, Executor>(StringComparer.Ordinal)
            {
                [circuit.StartNodeId] = startExecutor,
            };

            foreach (var node in circuit.Nodes)
            {
                if (node.NodeId == circuit.StartNodeId)
                    continue;

                var executor = BuildExecutor(node, brainLookup, callback, toolRegistry, workspace);
                builder.BindExecutor(executor);
                executorMap[node.NodeId] = executor;
            }

            foreach (var edge in circuit.Edges)
            {
                if (!executorMap.TryGetValue(edge.FromNodeId, out var fromExecutor))
                {
                    throw new CircuitExecutionException(
                        edge.FromNodeId,
                        $"CircuitEdge.FromNodeId='{edge.FromNodeId}' 不在节点表中。");
                }
                if (!executorMap.TryGetValue(edge.ToNodeId, out var toExecutor))
                {
                    throw new CircuitExecutionException(
                        edge.ToNodeId,
                        $"CircuitEdge.ToNodeId='{edge.ToNodeId}' 不在节点表中。");
                }

                if (edge.BranchLabel == null)
                {
                    builder.AddEdge<CircuitMessage>(
                        fromExecutor,
                        toExecutor,
                        condition: null,
                        label: null,
                        idempotent: false);
                }
                else
                {
                    var expectedLabel = edge.BranchLabel;
                    builder.AddEdge<CircuitMessage>(
                        fromExecutor,
                        toExecutor,
                        condition: msg => msg != null && msg.BranchLabel == expectedLabel,
                        label: null,
                        idempotent: false);
                }
            }

            foreach (var node in circuit.Nodes)
            {
                if (node is ReturnNode)
                {
                    builder.WithOutputFrom(executorMap[node.NodeId]);
                }
            }

            return builder.Build(validateOrphans: true);
        }

        private static Executor BuildExecutor(
            CircuitNode node,
            IBrainLookup brainLookup,
            IPrefrontalCallback callback,
            IReadOnlyDictionary<string, AIFunction> toolRegistry,
            WorkspaceSystem? workspace)
        {
            switch (node)
            {
                case CallBrainNode callBrain:
                {
                    var invocable = brainLookup.FindBrain(callBrain.TargetBrainId)
                        ?? throw new CircuitExecutionException(
                            callBrain.NodeId,
                            $"CallBrainNode.TargetBrainId='{callBrain.TargetBrainId}' 在 Agent 中找不到对应脑区。");
                    return new BrainCallExecutor(callBrain.NodeId, callBrain, invocable, callback, workspace);
                }

                case BranchNode branch:
                    return new BranchExecutor(branch.NodeId, branch);

                case ReturnNode ret:
                    return new ReturnExecutor(ret.NodeId, ret);

                case CallToolNode toolNode:
                    return new CallToolExecutor(toolNode.NodeId, toolNode, toolRegistry);

                default:
                    throw new NotSupportedException(
                        $"未知 CircuitNode 派生类型 '{node.GetType().Name}' (NodeId='{node.NodeId}')——C5 扩展开闭原则要求新增节点类型同时给 CircuitToWorkflowCompiler.BuildExecutor switch 加一支。");
            }
        }
    }
}
