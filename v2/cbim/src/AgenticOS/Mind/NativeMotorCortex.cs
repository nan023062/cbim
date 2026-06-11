using System;
using CBIM.LlmClient;

namespace CBIM.Mind;

/// <summary>
/// NativeMotorCortex —— 运动皮层的默认实现（原生 LLM 工具循环路径）。
/// <para>双路径逻辑继承自 <see cref="Brain.InvokeAsync"/>——
/// 不需要额外重写，CompilerTools 通过基类 <c>_activeBuilder</c> 闭包驱动回路构建。</para>
/// </summary>
public sealed class NativeMotorCortex : MotorCortex
{
    /// <summary>本脑区的固定 BrainId 前缀常量。</summary>
    public const string DefaultBrainId = "motor-cortex.native";

    public NativeMotorCortex(IBrainAgent agent, ChatClientFactory chatClientFactory, NativeMotorCortexDescriptor descriptor)
        : base(agent, chatClientFactory, descriptor)
    {
    }
}

/// <summary>
/// NativeMotorCortex 描述符——原生 LLM 工具循环路径的运动皮层配置。
/// </summary>
public sealed class NativeMotorCortexDescriptor : MotorCortexDescriptor
{
    public NativeMotorCortexDescriptor(string systemPrompt, string name, string identity)
        : base(NativeMotorCortex.DefaultBrainId, systemPrompt, name, identity)
    {
    }

    /// <summary>
    /// 允许调用方指定自定义 brainId（必须以 "motor-cortex." 开头）。
    /// </summary>
    public NativeMotorCortexDescriptor(string brainId, string systemPrompt, string name, string identity)
        : base(brainId, systemPrompt, name, identity)
    {
        if (!brainId.StartsWith("motor-cortex.", StringComparison.Ordinal))
            throw new InvalidOperationException(
                $"NativeMotorCortexDescriptor.BrainId 必须以 'motor-cortex.' 开头（实际: '{brainId}'）");
    }
}
