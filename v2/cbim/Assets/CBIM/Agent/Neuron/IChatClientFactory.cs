using Microsoft.Extensions.AI;
using CBIM.AgentSystem.Brain;

namespace CBIM.AgentSystem
{
    /// <summary>
    /// LLM 客户端工厂——按脑区描述符选择合适的 IChatClient。
    ///
    /// <para>不同脑区可能需要不同的 LLM：
    ///   - 主脑/前额叶（Logic/Structural）：需要强推理能力，选大模型（如 gpt-4o）。
    ///   - 工作脑（Action）：执行简单指令，可用快速小模型（如 gpt-4o-mini）。
    ///   - 记忆脑（Memory）：摘要/检索，也可用小模型。
    /// </para>
    ///
    /// <para>最简实现：<see cref="SingleChatClientFactory"/>——所有脑区共用一个客户端（向下兼容）。</para>
    /// <para>按脑区切模型：实现本接口，在 <see cref="Create"/> 内按 <see cref="BrainDescriptor.MindMode"/>
    /// 或 <see cref="BrainDescriptor.ModelHint"/> 返回对应客户端。</para>
    /// </summary>
    public interface IChatClientFactory
    {
        /// <summary>
        /// 按脑区描述符返回对应的 LLM 客户端。
        /// 同一脑区在 Agent 生命周期内可能多次调用——实现应保证幂等（返回同一实例或等价实例）。
        /// </summary>
        IChatClient Create(BrainDescriptor descriptor);
    }

    /// <summary>
    /// 最简实现——所有脑区共用同一个 <see cref="IChatClient"/>。
    /// 向下兼容：现有代码传入一个 IChatClient 即可，无需改调用方。
    /// </summary>
    public sealed class SingleChatClientFactory : IChatClientFactory
    {
        private readonly IChatClient _client;

        public SingleChatClientFactory(IChatClient client)
        {
            if (client == null)
                throw new System.ArgumentNullException(nameof(client));
            _client = client;
        }

        /// <inheritdoc/>
        public IChatClient Create(BrainDescriptor descriptor) => _client;
    }
}

