using System;
using System.Collections.Generic;
using CBIM.Memory;
using CBIM.Mind;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace CBIM.Kernel
{
    /// <summary>
    /// 神经元工厂——按 <see cref="BrainDescriptor"/> 子类分派构造 <see cref="INeuron"/> 实例。
    /// </summary>
    public static class NeuronFactory
    {
        public static INeuron Create(Brain brain, string soul, string identity, BrainDescriptor descriptor, IChatClient chatClient, IReadOnlyList<AITool> tools, IReadOnlyList<AIContextProvider>? contextProviders = null)
        {
            if (descriptor == null)
                throw new ArgumentNullException(nameof(descriptor));
            if (tools == null)
                throw new ArgumentNullException(nameof(tools));

            switch (descriptor)
            {
                // ExternalMotorCortexDescriptor 必须先匹配更派生的类型。
                case ExternalMotorCortexDescriptor ext:
                {
                    return new ExternalNeuron(brain, soul, identity, tools,  contextProviders);
                }

                default:
                {
                    if (chatClient == null)
                        throw new InvalidOperationException(
                            $"BrainDescriptor 装配需要 chatClient 非 null（脑区 '{descriptor.BrainId}'）。");

                    return new Neuron(brain, soul, identity, chatClient, tools, contextProviders);
                }
            }
        }

        public static void Destroy(INeuron neuron)
        {
            if (neuron == null)
                throw new ArgumentNullException(nameof(neuron));

            neuron.Dispose();
        }
    }
}
