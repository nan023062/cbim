using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
namespace CBIM.Kernel
{
    /// <summary>
    /// 节点间消息 envelope——MAF Executor 之间通过 <see cref="CircuitMessage"/> 串接，
    /// 沿 <c>NeuralCircuit</c> 中的边逐节点流动。
    /// </summary>
    public sealed class CircuitMessage
    {
        /// <summary>所属回路 Id——便于交叉调试时识别 envelope 出处。</summary>
        public string CircuitId { get; }

        /// <summary>上一个执行节点 Id——下游节点用以引用 History。</summary>
        public string FromNodeId { get; }

        /// <summary>BranchNode 评估出的分支标签——用于 MAF AddEdge 的 condition lambda 匹配；
        /// 非 BranchNode 产生的消息恒为 <c>null</c>。</summary>
        public string? BranchLabel { get; }

        /// <summary>上一节点 outcome.Summary——回填进下一节点 BrainInvocation.Context["previous"]。</summary>
        public string LastSummary { get; }

        /// <summary>路径现场：nodeId → 该节点 BrainOutcome；只读视图（构造期一次性包装）。</summary>
        public IReadOnlyDictionary<string, NeuronOutcome> History { get; }

        public CircuitMessage(
            string circuitId,
            string fromNodeId,
            string? branchLabel,
            string lastSummary,
            IReadOnlyDictionary<string, NeuronOutcome> history)
        {
            if (string.IsNullOrWhiteSpace(circuitId))
                throw new ArgumentException("CircuitMessage.CircuitId 不能为空。", nameof(circuitId));
            if (string.IsNullOrWhiteSpace(fromNodeId))
                throw new ArgumentException("CircuitMessage.FromNodeId 不能为空。", nameof(fromNodeId));
            if (lastSummary == null)
                throw new ArgumentNullException(nameof(lastSummary));
            if (history == null)
                throw new ArgumentNullException(nameof(history));

            CircuitId = circuitId;
            FromNodeId = fromNodeId;
            BranchLabel = branchLabel;
            LastSummary = lastSummary;
            var historyCopy = new Dictionary<string, NeuronOutcome>(history.Count);
            foreach (var kv in history)
                historyCopy[kv.Key] = kv.Value;
            History = new ReadOnlyDictionary<string, NeuronOutcome>(historyCopy);
        }

        /// <summary>派生下一节点的 envelope——不可变更新。</summary>
        public CircuitMessage WithNext(
            string newFromNodeId,
            string newLastSummary,
            NeuronOutcome? appendOutcome,
            string? newBranchLabel)
        {
            if (string.IsNullOrWhiteSpace(newFromNodeId))
                throw new ArgumentException("CircuitMessage.WithNext.newFromNodeId 不能为空。", nameof(newFromNodeId));
            if (newLastSummary == null)
                throw new ArgumentNullException(nameof(newLastSummary));

            var nextHistory = new Dictionary<string, NeuronOutcome>(History.Count + 1);
            foreach (var kv in History)
                nextHistory[kv.Key] = kv.Value;
            if (appendOutcome != null)
            {
                nextHistory[newFromNodeId] = appendOutcome;
            }

            return new CircuitMessage(
                CircuitId,
                newFromNodeId,
                newBranchLabel,
                newLastSummary,
                nextHistory);
        }
    }
}
