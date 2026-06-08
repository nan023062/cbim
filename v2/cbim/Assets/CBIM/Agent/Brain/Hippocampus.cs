using System.Threading;
using System.Threading.Tasks;

namespace CBIM.AgentSystem
{
    /// <summary>
    /// Hippocampus（海马体）——记忆学习脑。
    /// </summary>
    public sealed class Hippocampus : Brain
    {
        public override BrainKind Kind => BrainKind.Hippocampus;
        
        public Hippocampus(IBrainAgent agent, HippocampusDescriptor descriptor)
            : base(agent, descriptor) 
        {
        }
        
        public override async Task<NeuronOutput> InvokeAsync(NeuronInput invocation, CancellationToken ct)
        {
            return default;
        }
    }
            
    /// <summary>
    /// 记忆、学习、冥想（反思）
    /// </summary>
    public sealed class HippocampusDescriptor : BrainDescriptor
    {
        public static readonly HippocampusDescriptor Default = new HippocampusDescriptor();
        
        static readonly string Id = "__hippocampus_cortex";
        static readonly string Prompt = "专注于记忆、学习、冥想的海马体, 你是智能体的大脑，负责管理和调度记忆系统，处理与记忆相关的任务，包括信息存储、回忆、遗忘和反思。你协助其他脑区进行知识积累和经验总结，支持智能体的持续学习和适应能力。";
        
        HippocampusDescriptor() : base(Id, Prompt)
        {
        }
    }
}