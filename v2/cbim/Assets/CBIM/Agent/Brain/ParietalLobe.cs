using System.Threading;
using System.Threading.Tasks;

namespace CBIM.AgentSystem
{
    /// <summary>
    /// ParietalLobe（顶叶）——架构脑。
    /// </summary>
    public sealed class ParietalLobe : Brain
    {
        public override BrainKind Kind => BrainKind.ParietalLobe;
        
        public ParietalLobe(IBrainAgent agent, ParietalLobeDescriptor descriptor)
            : base(agent, descriptor) 
        {
        }
        
        public override async Task<NeuronOutput> InvokeAsync(NeuronInput invocation, CancellationToken ct)
        {
            return default;
        }
    }
    
    /// <summary>
    /// 逻辑 + 架构（全局观），负责规划和设计决策
    /// </summary>
    public sealed class ParietalLobeDescriptor : BrainDescriptor
    {
        public static readonly ParietalLobeDescriptor Default = new ParietalLobeDescriptor();
        
        static readonly string Id = "__parietalLobe_cortex";
        static readonly string Prompt = "专注于规划、设计、架构的顶叶, 你是智能体的大脑，负责从全局视角规划和设计解决方案，制定模块接口规范，校验整体架构合规性，并协助记忆脑落地裂变设计。";
        
        ParietalLobeDescriptor() : base(Id, Prompt)
        {
        }
    }
}
