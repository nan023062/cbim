#nullable enable
using System;
using CBIM.LlmClient;

namespace CBIM.Mind;

public static class BrainFactory
{
    /// <summary>
    /// 按描述符类型装配脑区实例。
    ///
    /// <para>Orchestrator、CompilerTools、SynapseTools、ChatClient、Neuron
    /// 均已下沉至 <see cref="Brain"/> 基类构造器自管理；
    /// 本工厂仅负责按描述符子类型分派到对应 Brain 子类。
    /// </para>
    ///
    /// <param name="agent">所属 Agent 实例（提供 ModelStore / CallableBrains 等上下文）。</param>
    /// <param name="chatClientFactory">LLM 客户端工厂——由 Agent 私有持有，经此注入脑区。</param>
    /// <param name="descriptor">脑区描述符——通过类型决定创建哪种 Brain。</param>
    /// </summary>
    public static Brain Create(
        IBrainAgent agent,
        ChatClientFactory chatClientFactory,
        BrainDescriptor descriptor)
    {
        if (agent == null)
            throw new ArgumentNullException(nameof(agent));
        if (chatClientFactory == null)
            throw new ArgumentNullException(nameof(chatClientFactory));
        if (descriptor == null)
            throw new ArgumentNullException(nameof(descriptor));

        // ExternalMotorCortex Brain 尚未实现——提前检查，避免进入构造器后泄漏资源。
        if (descriptor is ExternalMotorCortexDescriptor)
            throw new NotImplementedException("ExternalMotorCortex Brain not implemented");

        if (descriptor is PrefrontalDescriptor prefrontalDescriptor)
            return new PrefrontalCortex(agent, prefrontalDescriptor);

        if (descriptor is ParietalLobeDescriptor parietalLobeDescriptor)
            return new ParietalLobe(agent, parietalLobeDescriptor);

        if (descriptor is HippocampusDescriptor hippocampusDescriptor)
            return new Hippocampus(agent, hippocampusDescriptor);

        if (descriptor is NativeMotorCortexDescriptor nativeMotorCortexDescriptor)
            return new NativeMotorCortex(agent, nativeMotorCortexDescriptor);

        if (descriptor is MotorCortexDescriptor motorCortexDescriptor)
            return new MotorCortex(agent, motorCortexDescriptor);

        throw new NotImplementedException($"{descriptor.GetType()} not implemented");
    }

    public static void Destroy(Brain brain)
    {
        brain.Dispose();
    }
}
