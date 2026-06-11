namespace CBIM.Kernel
{
    /// <summary>
    /// 供 Orchestrator 按 BrainId 查找脑区实例的最小接口。
    /// 由 Mind 层的 Agent 实现，Kernel 层只感知此接口，不依赖 IBrainAgent。
    /// </summary>
    public interface IBrainLookup
    {
        /// <summary>按 BrainId 查找脑区实例。找不到返回 <c>null</c>。</summary>
        IInvocable? FindBrain(string brainId);
    }
}
