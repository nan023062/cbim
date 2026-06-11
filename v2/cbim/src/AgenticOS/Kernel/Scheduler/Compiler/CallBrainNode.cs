using System;

namespace CBIM.Kernel;

/// <summary>
/// CallBrain 节点——投递 Intent 到某个脑区（最常见节点；等同于上轮的 <c>__brain_call_*</c>）。
///
/// <para>本切片只做字符串非空校验。<see cref="TargetBrainId"/> 是否对应一个真实存在的
/// 可调脑区（palette 是否覆盖），由 <c>BrainCallExecutor</c>（T11）在装配期校验——
/// Compiler 不持 BrainRegistry 引用（K6 铁律：Compiler ⊥ Orchestrator 命名空间 + 不感知执行细节）。</para>
/// </summary>
public sealed class CallBrainNode : CircuitNode
{
    /// <summary>目标脑区 Id——如 <c>motor-cortex.native</c> / <c>parietal-lobe</c>。</summary>
    public string TargetBrainId { get; }

    /// <summary>自然语言意图——透传给 <c>BrainInvocation.Intent</c>。</summary>
    public string Intent { get; }

    /// <summary>可选 JSON 载荷——透传给 <c>BrainInvocation.StructuredInput</c>；不需要时为 null。</summary>
    public string? StructuredInputJson { get; }

    /// <summary>
    /// 本次派发的 Module Id JSON 字符串数组（例 <c>"[\"src/combat\",\"src/ui\"]"</c>）。
    ///
    /// <para>语义对齐 synapse 工具的 <c>moduleIdsJson</c> 参数：工作脑用其重建文件沙箱白名单；
    /// 非工作脑忽略；null / 空数组 → 工作脑无文件操作权限（Q8 fail-hard）。
    /// 编译期由 LLM 通过 <c>__circuit_add_call_brain</c> 透传，执行期由
    /// <c>BrainCallExecutor</c> + <see cref="CBIM.Workspace.ModuleResolver"/> 解析为活动 Module。</para>
    /// </summary>
    public string? ModuleIdsJson { get; }

    public CallBrainNode(
        string nodeId,
        string label,
        string targetBrainId,
        string intent,
        string? structuredInputJson,
        string? moduleIdsJson = null)
        : base(nodeId, label)
    {
        if (string.IsNullOrWhiteSpace(targetBrainId))
            throw new ArgumentException("CallBrainNode.TargetBrainId 不能为空。", nameof(targetBrainId));
        if (string.IsNullOrWhiteSpace(intent))
            throw new ArgumentException("CallBrainNode.Intent 不能为空。", nameof(intent));

        TargetBrainId = targetBrainId;
        Intent = intent;
        StructuredInputJson = structuredInputJson;
        ModuleIdsJson = moduleIdsJson;
    }
}
