#nullable enable
using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Agents.AI;

namespace CBIM.AgentSystem
{
    public enum BrainKind : byte
    {
        /// <summary>前额叶皮层（主脑 · 调度中枢）</summary>
        PrefrontalCortex,

        /// <summary>顶叶（架构脑 · 模块设计 / 架构合规）。</summary>
        ParietalLobe,

        /// <summary>海马体（记忆学习 · Dream 裂变）。</summary>
        Hippocampus,

        /// <summary>运动皮层</summary>
        MotorCortex
    }
    
    /// <summary>
    /// 脑区的归属Agent实例，通过Agent可以获取所有能力上下文和记忆信息
    /// </summary>
    public interface IBrainAgent
    {
        AgentManager Manager { get; }
    }
    
    /// <summary>
    /// 脑区契约公共基类。 其实就是封装的AI Agent
    /// </summary>
    public abstract class Brain : IDisposable
    {
        private bool __disposed;
        
        public abstract BrainKind Kind { get; }
        
        public string BrainId => Descriptor.BrainId;
        
        public BrainDescriptor Descriptor { get; }
        
        private INeuron _neuron;
        
        internal IBrainAgent Agent { get; private set; }

        /// <summary>
        /// 神经元——LLM 思维链单元。本字段是 Brain 层调用 LLM 的唯一出口（K2 铁律）。
        /// 由 AgentSystem 装配期通过 NeuronFactory 创建并注入；BrainBase 与子类不感知其具体实现
        /// （<see cref="MsAINeuron"/> 还是 <see cref="ExternalEngineNeuron"/>）。
        /// </summary>
        public INeuron Neuron
        {
            get
            {
                _neuron ??= NeuronFactory.Create(Descriptor);
                
                return _neuron;
            }
        }

        /// <summary>
        /// 透传 <see cref="Neuron"/> 的底层 <see cref="Microsoft.Agents.AI.AIAgent"/> 引用——保留旧字段名以兼容
        /// 已持引用打 <c>SendAsync</c> 的 Channel 等调用方。
        /// <see cref="ExternalEngineNeuron"/> 路径下恒为 <c>null</c>（外部引擎自带 LLM，无 AIAgent 句柄）。
        /// </summary>
        public AIAgent? AIAgent => Neuron.UnderlyingAgent;
        
        /// <summary>
        /// 构造期仅做字段写入与非空校验。
        /// LLM 装配（msai ChatClientAgent / external Adapter）已下沉到 NeuronFactory；
        /// 子类构造器只须做语义校验（Kind / BrainId 前缀等）并透传给本基类。
        /// </summary>
        protected Brain(IBrainAgent agent, BrainDescriptor descriptor)
        {
            if (agent == null)
                throw new ArgumentNullException(nameof(agent), "BrainBase.Agent 不允许 null。");
                    
            if (descriptor == null)
                throw new ArgumentException("BrainBase.BrainDescriptor 不能为空", nameof(descriptor));

            __disposed = false;
            Agent = agent;
            Descriptor = descriptor;
            _neuron = default;
        }

        /// <summary>
        /// 投递子任务到本脑区。
        ///
        /// 默认实现：直接透传给 <see cref="Neuron"/>.InvokeAsync——
        /// msai / external 的路径差异在 NeuronFactory 装配期已决定，本层无感。
        /// 如需特化（如主脑的聚合策略），子类可重写。
        /// </summary>
        public virtual Task<NeuronOutput> InvokeAsync(NeuronInput invocation, CancellationToken ct)
        {
            if (invocation == null)
                throw new ArgumentNullException(nameof(invocation));
            return Neuron.InvokeAsync(invocation, ct);
        }
        
        protected virtual void BeforeDestroy() { }

        /// <summary>
        /// 释放本脑区占用的资源。
        /// 默认实现释放 <see cref="Neuron"/>；子类如持有额外资源需重写并最后调用 base。
        /// AgentInstance 的释放顺序保证调用：MotorCortex → 其他脑区 → Prefrontal。
        /// 实现需做到多次调用幂等。
        /// </summary>
        public void Dispose()
        {
            if(__disposed) return;
            
            __disposed = true;
            
            try
            {
                BeforeDestroy();
                
                NeuronFactory.Destroy(_neuron);
            }
            finally
            {
                Agent = null;
                
                _neuron = null;
            }
        }
    }
}
