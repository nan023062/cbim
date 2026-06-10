using CBIM.LlmClient;

namespace CBIM.Mind
{
    /// <summary>
    /// MotorCortex（运动皮层）—— 抽象基类。
    /// </summary>
    public class MotorCortex : Brain
    {
        public sealed override BrainKind Kind => BrainKind.MotorCortex;

        public MotorCortex(IBrainAgent agent, ChatClientFactory chatClientFactory, MotorCortexDescriptor descriptor)
            : base(agent, chatClientFactory, descriptor)
        {
        }
    }

    /// <summary>
    /// 擅长专业领域的工作执行、工具使用、问题解决等「干活」的运动皮层描述符。
    /// </summary>
    public class MotorCortexDescriptor : BrainDescriptor
    {
        public MotorCortexDescriptor(string brainId, string systemPrompt, string name = "", string identity = "")
            : base(brainId, systemPrompt, name, identity)
        {
        }
    }
}
