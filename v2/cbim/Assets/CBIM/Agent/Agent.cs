#nullable enable
using System;
using System.Collections.Generic;

namespace CBIM.AgentSystem
{
    /// <summary>
    /// Agent 实例——一份 AgentDescription装配后的运行态对象。
    /// </summary>
    public sealed class Agent : IDisposable, IBrainAgent
    {
        public Guid id { get; }
        
        readonly object _lock = new object();
        
        private AgentManager _manager;

        public AgentManager Manager => _manager;
        
        /// <summary>
        /// 静态描述符。运行时不变。
        /// </summary>
        public readonly AgentDescription Description;
        
        /// <summary>
        /// 主脑句柄——类型固定为 <see cref="PrefrontalCortex"/>。
        /// </summary>
        public readonly PrefrontalCortex Prefrontal;

        /// <summary>
        ///   
        /// </summary>
        public readonly ParietalLobe ParietalLobe;

        /// <summary>
        /// 记忆脑区句柄——类型固定为 <see cref="Hippocampus"/>。
        /// </summary>
        public readonly Hippocampus Hippocampus;
        
        /// <summary>激活时间戳。</summary>
        public DateTimeOffset CreatedAt { get; }
        

        public Agent(AgentManager manager, AgentDescription description)
        {
            id = Guid.NewGuid();
            
            _manager = manager;
            
            Description = description;
            
            Prefrontal = (PrefrontalCortex)RegisterBrain(PrefrontalDescriptor.Default);
            
            ParietalLobe = (ParietalLobe)RegisterBrain(ParietalLobeDescriptor.Default);
            
            Hippocampus = (Hippocampus)RegisterBrain(HippocampusDescriptor.Default);
            
            CreatedAt = DateTimeOffset.UtcNow;
        }

        /// <summary>
        /// 释放本实例占用的所有资源
        /// </summary>
        public void Dispose()
        {
            if (_manager == null) return;
            
            AgentManager manager = _manager;
            
            _manager = null;
            
            foreach (var brain in _brainList)
            {
                BrainFactory.Destroy(brain);
            }
            _brainList.Clear();
        }

        public override string ToString()
        {
            return $"Agent({Description.Name}.., desc={Description.Identity})";
        }

        #region Bain Manager
        
        private List<Brain> _brainList = new ();
        
        public Brain RegisterBrain(BrainDescriptor descriptor)
        {
            if (descriptor == null)
            {
                throw new ArgumentNullException(nameof(descriptor));
            }
            
            lock (_lock)
            {
                Brain brain = BrainFactory.Create(this, descriptor);
                
                _brainList.Add(brain);
                
                return brain;
            }
        }
        
        public bool UnregisterBrain(Brain brain)
        {
            lock (_lock)
            {
                if (_brainList.Remove(brain))
                {
                    BrainFactory.Destroy(brain);
                    
                    return true;
                }
                return false;
            }
        }
        
        public IReadOnlyList<Brain> AllBrains()
        {
            lock (_lock)
            {
                // 返回快照副本——调用方拿到的列表不会随后续 Register / Unregister 改变，
                // 避免外部迭代时被并发修改抛 InvalidOperationException。
                return _brainList;
            }
        }

        #endregion
    }
}
