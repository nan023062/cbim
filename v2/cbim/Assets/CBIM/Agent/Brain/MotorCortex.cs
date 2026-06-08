using System.Threading;
using System.Threading.Tasks;

namespace CBIM.AgentSystem
{
    /// <summary>
    /// MotorCortex（运动皮层）—— 抽象基类。
    /// </summary>
    public class MotorCortex : Brain
    {
        public sealed override BrainKind Kind => BrainKind.MotorCortex;
        
        public MotorCortex(IBrainAgent agent, MotorCortexDescriptor descriptor)
            : base(agent, descriptor) 
        {
            
        }
        
        public override async Task<NeuronOutput> InvokeAsync(NeuronInput invocation, CancellationToken ct)
        {
            return default;
        }
    }
    
    /// <summary>
    /// 擅长专业领域的工作执行、工具使用、问题解决等「干活」的运动皮层描述符。
    /// </summary>
    public class MotorCortexDescriptor : BrainDescriptor
    {
        public MotorCortexDescriptor(string brainId, string systemPrompt) : base(brainId, systemPrompt)
        {
        }
    }
}
