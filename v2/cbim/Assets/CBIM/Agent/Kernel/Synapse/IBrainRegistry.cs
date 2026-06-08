using System.Collections.Generic;
using CBIM.AgentSystem.Brain;

namespace CBIM.AgentSystem.Kernel.Synapse
{
    /// <summary>
    /// Agent 内部脑区动态注册点——Dream 裂变出新 <c>MotorCortex</c> 后通过本接口接入。
    /// <para>线程语义由具体实现决定（<see cref="InMemoryBrainRegistry"/> 取锁保证并发安全）。</para>
    /// </summary>
    public interface IBrainRegistry
    {
        /// <summary>
        /// 注册一个新脑区。<c>BrainBase.BrainId</c> 重复时抛
        /// <see cref="System.InvalidOperationException"/>——「BrainId 唯一」铁律的物理护栏。
        /// </summary>
        void RegisterBrain(Brain.Brain brain);

        /// <summary>
        /// 按 brainId 撤销注册。返回是否找到并撤销。
        /// </summary>
        bool UnregisterBrain(string brainId);

        /// <summary>
        /// 按 brainId 查找脑区；未注册时返回 null。
        /// </summary>
        Brain.Brain? Find(string brainId);

        /// <summary>
        /// 当前已注册的全部脑区快照（返回快照副本，调用方修改不影响内部状态）。
        /// </summary>
        IReadOnlyList<Brain.Brain> All();
    }
}
