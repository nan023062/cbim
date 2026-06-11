using System;
using System.Collections.Generic;

namespace CBIM.Kernel
{
    /// <summary>
    /// 神经回路构建器——per-invocation 可变状态收集器，由
    /// <c>PrefrontalCortex.InvokeAsync</c>（T14）在「编译期」实例化一次、
    /// <c>CompilerToolFactory</c>（T10）封装的 <c>__circuit_add_*</c> AITool handler
    /// 闭包持本实例引用、LLM 通过工具调用反复调 <c>Add*</c> 累积节点 / 边、
    /// 最终主脑调 <see cref="Commit"/> 冻结成 <see cref="NeuralCircuit"/>。
    /// </summary>
    public sealed class NeuralCircuitBuilder
    {
        private readonly string _sourceRequest;
        private readonly List<CircuitNode> _nodes = new List<CircuitNode>();
        private readonly List<CircuitEdge> _edges = new List<CircuitEdge>();
        private readonly Dictionary<string, CircuitNode> _nodeIndex = new Dictionary<string, CircuitNode>(StringComparer.Ordinal);
        private int _nextId = 1;

        /// <summary>回路 Id——构造期由调用方传入（通常 <c>Guid.NewGuid().ToString()</c>）；
        /// Commit 后透传给 <see cref="NeuralCircuit.CircuitId"/>。</summary>
        public string CircuitId { get; }

        /// <summary>Commit 产物——Commit 成功后写入，未 commit / commit 失败保持 <c>null</c>。</summary>
        public NeuralCircuit? Compiled { get; private set; }

        public NeuralCircuitBuilder(string circuitId, string sourceRequest)
        {
            if (string.IsNullOrWhiteSpace(circuitId))
                throw new ArgumentException("NeuralCircuitBuilder.CircuitId 不能为空。", nameof(circuitId));
            if (string.IsNullOrWhiteSpace(sourceRequest))
                throw new ArgumentException("NeuralCircuitBuilder.SourceRequest 不能为空。", nameof(sourceRequest));

            CircuitId = circuitId;
            _sourceRequest = sourceRequest;
        }

        /// <summary>添加 CallBrain 节点——返回新节点 Id（首次调用即 StartNodeId）。</summary>
        public string AddCallBrain(string label, string targetBrainId, string intent, string? structuredInputJson, string? moduleIdsJson = null)
        {
            EnsureMutable();
            var nodeId = AllocateNodeId();
            var node = new CallBrainNode(nodeId, label, targetBrainId, intent, structuredInputJson, moduleIdsJson);
            _nodes.Add(node);
            _nodeIndex.Add(nodeId, node);
            return nodeId;
        }

        /// <summary>添加 Branch 节点——返回新节点 Id。</summary>
        public string AddBranch(string label, string conditionExpression)
        {
            EnsureMutable();
            var nodeId = AllocateNodeId();
            var node = new BranchNode(nodeId, label, conditionExpression);
            _nodes.Add(node);
            _nodeIndex.Add(nodeId, node);
            return nodeId;
        }

        /// <summary>添加 Return 节点——返回新节点 Id。</summary>
        public string AddReturn(string label, string summaryTemplate)
        {
            EnsureMutable();
            var nodeId = AllocateNodeId();
            var node = new ReturnNode(nodeId, label, summaryTemplate);
            _nodes.Add(node);
            _nodeIndex.Add(nodeId, node);
            return nodeId;
        }

        /// <summary>添加边——即时校验：两端节点均已声明；BranchLabel 与源节点类型对齐。</summary>
        public void AddEdge(string fromNodeId, string toNodeId, string? branchLabel)
        {
            EnsureMutable();
            if (string.IsNullOrWhiteSpace(fromNodeId))
                throw new ArgumentException("AddEdge.FromNodeId 不能为空。", nameof(fromNodeId));
            if (string.IsNullOrWhiteSpace(toNodeId))
                throw new ArgumentException("AddEdge.ToNodeId 不能为空。", nameof(toNodeId));

            if (!_nodeIndex.TryGetValue(fromNodeId, out var fromNode))
                throw new InvalidOperationException($"AddEdge 源节点 '{fromNodeId}' 尚未声明，先调用对应 Add* 创建节点。");
            if (!_nodeIndex.ContainsKey(toNodeId))
                throw new InvalidOperationException($"AddEdge 目标节点 '{toNodeId}' 尚未声明，先调用对应 Add* 创建节点。");

            var fromIsBranch = fromNode is BranchNode;
            if (fromIsBranch && string.IsNullOrWhiteSpace(branchLabel))
                throw new InvalidOperationException(
                    $"AddEdge 源节点 '{fromNodeId}' 是 BranchNode，BranchLabel 必填。");
            if (!fromIsBranch && branchLabel != null)
                throw new InvalidOperationException(
                    $"AddEdge 源节点 '{fromNodeId}' 非 BranchNode，BranchLabel 必须为 null。");

            _edges.Add(new CircuitEdge(fromNodeId, toNodeId, branchLabel));
        }

        /// <summary>冻结成 <see cref="NeuralCircuit"/>——执行整体校验后返回。</summary>
        public NeuralCircuit Commit()
        {
            EnsureMutable();
            if (_nodes.Count == 0)
                throw new CircuitCompilationException("图未声明任何节点");

            // 1) ≥1 ReturnNode
            var returnNodes = new List<ReturnNode>();
            foreach (var node in _nodes)
            {
                if (node is ReturnNode rn) returnNodes.Add(rn);
            }
            if (returnNodes.Count == 0)
                throw new CircuitCompilationException("图未声明终止节点 ReturnNode");

            var startNodeId = _nodes[0].NodeId;
            var adjacency = BuildAdjacency();

            // 2) 连通性 BFS
            var reachable = BfsReachable(startNodeId, adjacency);
            foreach (var rn in returnNodes)
            {
                if (!reachable.Contains(rn.NodeId))
                    throw new CircuitCompilationException(
                        $"ReturnNode '{rn.NodeId}' 从 StartNode '{startNodeId}' 不可达");
            }

            // 3) 无环 DFS
            DetectCycle(startNodeId, adjacency);

            // 4) BranchNode 出度 ≥2
            foreach (var node in _nodes)
            {
                if (node is BranchNode bn)
                {
                    if (!adjacency.TryGetValue(bn.NodeId, out var outs) || outs.Count < 2)
                        throw new CircuitCompilationException(
                            $"BranchNode '{bn.NodeId}' 至少需要 2 条出边");
                }
            }
            foreach (var edge in _edges)
            {
                if (_nodeIndex[edge.FromNodeId] is BranchNode && string.IsNullOrWhiteSpace(edge.BranchLabel))
                {
                    throw new CircuitCompilationException(
                        $"BranchNode '{edge.FromNodeId}' 的出边必须填 BranchLabel");
                }
            }

            var compiled = new NeuralCircuit(
                CircuitId,
                _sourceRequest,
                startNodeId,
                _nodes,
                _edges,
                DateTimeOffset.UtcNow);
            Compiled = compiled;
            return compiled;
        }

        private void EnsureMutable()
        {
            if (Compiled != null)
                throw new InvalidOperationException("Builder 已 commit，不可再修改。");
        }

        private string AllocateNodeId() => $"n{_nextId++:D2}";

        private Dictionary<string, List<string>> BuildAdjacency()
        {
            var adj = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (var node in _nodes)
                adj[node.NodeId] = new List<string>();
            foreach (var edge in _edges)
                adj[edge.FromNodeId].Add(edge.ToNodeId);
            return adj;
        }

        private static HashSet<string> BfsReachable(string startNodeId, Dictionary<string, List<string>> adjacency)
        {
            var visited = new HashSet<string>(StringComparer.Ordinal) { startNodeId };
            var queue = new Queue<string>();
            queue.Enqueue(startNodeId);
            while (queue.Count > 0)
            {
                var cur = queue.Dequeue();
                if (!adjacency.TryGetValue(cur, out var outs)) continue;
                foreach (var next in outs)
                {
                    if (visited.Add(next)) queue.Enqueue(next);
                }
            }
            return visited;
        }

        private static void DetectCycle(string startNodeId, Dictionary<string, List<string>> adjacency)
        {
            var color = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var nodeId in adjacency.Keys)
                color[nodeId] = 0;

            foreach (var nodeId in adjacency.Keys)
            {
                if (color[nodeId] == 0)
                    DfsVisit(nodeId, adjacency, color);
            }
        }

        private static void DfsVisit(string nodeId, Dictionary<string, List<string>> adjacency, Dictionary<string, int> color)
        {
            color[nodeId] = 1;
            if (adjacency.TryGetValue(nodeId, out var outs))
            {
                foreach (var next in outs)
                {
                    if (color[next] == 1)
                        throw new CircuitCompilationException(
                            $"图存在环路，节点 '{next}' 形成回边（来自 '{nodeId}'）");
                    if (color[next] == 0)
                        DfsVisit(next, adjacency, color);
                }
            }
            color[nodeId] = 2;
        }
    }
}
