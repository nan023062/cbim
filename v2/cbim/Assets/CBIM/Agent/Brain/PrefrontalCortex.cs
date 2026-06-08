using System.Threading;
using System.Threading.Tasks;

namespace CBIM.AgentSystem
{
    /// <summary>
    /// PrefrontalCortex（前额叶皮层）—— 主脑 / 调度中枢。
    /// 每个 Agent 有且仅有 1 个；Channel.SendAsync 的实际投递目标。
    /// </summary>
    public sealed class PrefrontalCortex : Brain
    {
        public override BrainKind Kind => BrainKind.PrefrontalCortex;
        
        public PrefrontalCortex(IBrainAgent agent, PrefrontalDescriptor descriptor)
            : base(agent, descriptor) 
        {
        }
        
        public override async Task<NeuronOutput> InvokeAsync(NeuronInput invocation, CancellationToken ct)
        {
            return default;
        }
    }
            
    /// <summary>
    /// 协调分析、任务分发、结果汇总 
    /// </summary>
    public sealed class PrefrontalDescriptor : BrainDescriptor
    {
        public static readonly PrefrontalDescriptor Default = new PrefrontalDescriptor();
        
        static readonly string Id = "__prefrontal_cortex";
        static readonly string Prompt = "专注于分析、决策、协调的主脑, 你是智能体的大脑，负责分析用户请求、设计解决方案、调度其他脑区执行并汇总结果。";
        
        PrefrontalDescriptor() : base(Id, Prompt)
        {
        }
    }
    
    


}
