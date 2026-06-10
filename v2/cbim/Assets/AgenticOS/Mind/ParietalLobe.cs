#nullable enable
using CBIM.LlmClient;

namespace CBIM.Mind
{
    /// <summary>
    /// ParietalLobe（顶叶）——架构脑。
    /// </summary>
    public sealed class ParietalLobe : Brain
    {
        public override BrainKind Kind => BrainKind.ParietalLobe;

        protected override bool CanWriteDna => true;

        internal ParietalLobe(IBrainAgent agent, ChatClientFactory chatClientFactory, ParietalLobeDescriptor descriptor)
            : base(agent, chatClientFactory, descriptor)
        {
        }
    }

    /// <summary>
    /// 逻辑 + 架构（全局观），负责规划和设计决策。
    /// 内部描述符——仅供框架装配层使用；不对外暴露。
    /// </summary>
    internal sealed class ParietalLobeDescriptor : BrainDescriptor
    {
        static readonly string Id = "__parietalLobe_cortex";
        static readonly string Prompt = "你是架构脑，负责结构性思维。你的核心职责是将外部工作区和环境建模为结构化知识，维护知识体系的完整性和一致性。\n你是唯一有权读写结构化知识库（.dna/）的脑区，其他脑区只能读取。\n你确保工作脑在清晰的结构边界内工作，识别知识缺口，主动补全和治理知识结构。";
        static readonly string DefaultName = "ParietalLobe";
        static readonly string DefaultIdentity = "架构脑 · 模块设计 / 架构合规";

        /// <summary>
        /// 创建架构脑描述符。
        /// </summary>
        /// <param name="modelId">绑定的 ModelDescriptor.Id（null 或空字符串表示使用默认模型）。</param>
        internal ParietalLobeDescriptor(string? modelId = null)
            : base(Id, Prompt, DefaultName, DefaultIdentity, modelId ?? string.Empty)
        {
        }
    }
}
