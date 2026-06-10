#nullable enable
using CBIM.LlmClient;
using CBIM.Memory;

namespace CBIM.Mind
{
    /// <summary>
    /// Hippocampus（海马体）——记忆学习脑。
    /// 记忆后端由 <see cref="AgenticOS"/> 统一持有；Hippocampus 通过 <c>agent.Os.Memory</c> 访问，
    /// 不再在描述符或脑区内自持记忆后端——直接从 <c>agent.Os.Memory</c> 取。
    /// </summary>
    public sealed class Hippocampus : Brain
    {
        public override BrainKind Kind => BrainKind.Hippocampus;

        internal Hippocampus(IBrainAgent agent, ChatClientFactory chatClientFactory, HippocampusDescriptor descriptor)
            : base(agent, chatClientFactory, descriptor)
        {
        }
    }

    /// <summary>
    /// 记忆、学习、冥想（反思）。
    /// 内部描述符——仅供框架装配层使用；不对外暴露。
    /// </summary>
    internal sealed class HippocampusDescriptor : BrainDescriptor
    {
        static readonly string Id = "__hippocampus_cortex";
        static readonly string Prompt = "你是记忆脑，负责存储、学习和知识提炼。你是唯一有权读写记忆的脑区，其他脑区只能读取。\n你总结工作脑的执行经验，从中提炼可复用的模式和能力（裂变），并将业务经验写回结构化知识。\n你持续积累、整理、蒸馏记忆，让整个 Agent 随使用而成长。";
        static readonly string DefaultName = "Hippocampus";
        static readonly string DefaultIdentity = "海马体 · 记忆学习 / Dream 裂变";

        /// <summary>
        /// 创建记忆脑描述符。
        /// </summary>
        /// <param name="modelId">绑定的 ModelDescriptor.Id（null 或空字符串表示使用默认模型）。</param>
        internal HippocampusDescriptor(string? modelId = null)
            : base(Id, Prompt, DefaultName, DefaultIdentity, modelId ?? string.Empty)
        {
        }
    }
}
