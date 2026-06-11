#nullable enable
using System.Collections.Generic;
using CBIM.Kernel;
using CBIM.LlmClient;
using CBIM.Workspace;
using Microsoft.Extensions.AI;

namespace CBIM.Mind;

/// <summary>
/// PrefrontalCortex（前额叶皮层）—— 主脑 / 调度中枢。
/// 每个 Agent 有且仅有 1 个；Channel.SendAsync 的实际投递目标。
///
/// <para>双路径逻辑已上移至 <see cref="Brain.InvokeAsync"/> 基类实现：
/// <list type="bullet">
/// <item>路径 1（编译期）：透传给 Neuron.InvokeAsync，LLM 工具循环由 CompilerTools + SynapseTools 驱动；</item>
/// <item>路径 2（执行期）：<c>_activeBuilder.Compiled != null</c>——取出已冻结的
/// <see cref="NeuralCircuit"/> 交 <see cref="Orchestrator"/> 执行。</item>
/// </list>
/// 本类保留 <see cref="IPrefrontalCallback"/> 的具体实现，并覆写 BuildExtraTools 追加 SynapseTools。
/// </para>
/// </summary>
public sealed class PrefrontalCortex : Brain, IPrefrontalCallback
{
    public override BrainKind Kind => BrainKind.PrefrontalCortex;

    /// <summary>
    /// 构造器——由 BrainFactory 或 Agent 装配期调用。
    /// Orchestrator、CompilerTools、SynapseTools、Neuron 均由基类自管理。
    /// </summary>
    /// <param name="agent">所属 Agent 实例。同时充当脑区查找表，供 Orchestrator 定位子脑区。</param>
    /// <param name="chatClientFactory">LLM 客户端工厂。</param>
    /// <param name="descriptor">脑区描述符。</param>
    internal PrefrontalCortex(
        IBrainAgent agent,
        ChatClientFactory chatClientFactory,
        PrefrontalDescriptor descriptor)
        : base(agent, chatClientFactory, descriptor)
    {
    }

    /// <summary>
    /// 追加 SynapseTools + BrainInspectTools + WorkspaceTools——让主脑 Neuron 能：
    /// (1) 直接调用各子脑区（SynapseTools）；
    /// (2) 派发前只读地枚举 / 检查可调子脑区的描述符与运行态（BrainInspectTools）；
    /// (3) 派发前枚举工作区已注册的 ModuleDescription（WorkspaceTools.module_list），
    ///     从而在 __brain_call_* 的 moduleIdsJson 入参里报上正确的 module id。
    /// </summary>
    protected override IReadOnlyList<AITool> BuildExtraTools(IBrainAgent agent, BrainDescriptor descriptor)
    {
        var synapse = SynapseToolFactory.Build(agent.CallableBrains, agent);
        var inspect = BrainInspectToolProvider.GetReadOnlyTools(agent);
        var workspaceTools = WorkspaceToolProvider.GetReadOnlyTools(agent.Os?.Workspace);

        int total = synapse.Count + inspect.Count + workspaceTools.Count;
        if (total == synapse.Count)
            return synapse;
        var merged = new List<AITool>(total);
        foreach (var t in synapse)
            merged.Add(t);
        foreach (var t in inspect)
            merged.Add(t);
        foreach (var t in workspaceTools)
            merged.Add(t);
        return merged;
    }

    #region IPrefrontalCallback

    /// <inheritdoc/>
    void IPrefrontalCallback.ReportProgress(string brainId, string message)
    {
        // 默认实现：静默丢弃进度通知。
        // 如需透传至 Channel.OnOutput，装配方可替换本逻辑。
    }

    /// <inheritdoc/>
    void IPrefrontalCallback.ReportOutcome(string brainId, NeuronOutcome outcome)
    {
        // 默认实现：静默丢弃终态通知。
        // Orchestrator 通过 WorkflowOutputEvent 直接返回最终摘要，
        // 本回调供扩展用（如流式进度透传）。
    }

    #endregion
}

/// <summary>
/// 协调分析、任务分发、结果汇总。
/// 内部描述符——仅供框架装配层使用；不对外暴露。
/// </summary>
internal sealed class PrefrontalDescriptor : BrainDescriptor
{
    static readonly string DefaultId = "__prefrontal_cortex";
    static readonly string DefaultPrompt = "你是主脑，负责接收外部输入、分析拆解任务、调度工作脑并行执行、汇聚所有结果后给出最终回应。\n你可以同时向多个工作脑下达任务，充分利用并发能力，不需要串行等待。\n你不直接执行具体工作，只负责理解意图、制定策略、分配任务、整合输出。";
    static readonly string DefaultName = "PrefrontalCortex";
    static readonly string DefaultIdentity = "主脑 · 调度中枢";

    /// <summary>
    /// 创建主脑描述符。
    /// </summary>
    /// <param name="modelId">绑定的 ModelDescriptor.Id（null 或空字符串表示使用默认模型）。</param>
    internal PrefrontalDescriptor(string? modelId = null)
        : base(DefaultId, DefaultPrompt, DefaultName, DefaultIdentity, modelId ?? string.Empty)
    {
    }
}
