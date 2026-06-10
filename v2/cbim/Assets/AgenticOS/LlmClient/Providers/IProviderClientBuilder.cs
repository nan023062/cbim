using Microsoft.Extensions.AI;

namespace CBIM.LlmClient
{
    /// <summary>
    /// Provider 客户端构建器接口。
    /// 每个 Provider 实现一个，由 <see cref="ProviderRegistry"/> 管理注册。
    /// </summary>
    public interface IProviderClientBuilder
    {
        /// <summary>
        /// 按模型描述符构建对应的 <see cref="IChatClient"/>。
        /// </summary>
        /// <param name="descriptor">模型描述符，包含 Provider / ModelName / ApiKey / Endpoint 等字段。</param>
        /// <returns>构建好的 <see cref="IChatClient"/> 实例。</returns>
        IChatClient Build(ModelDescriptor descriptor);
    }
}
