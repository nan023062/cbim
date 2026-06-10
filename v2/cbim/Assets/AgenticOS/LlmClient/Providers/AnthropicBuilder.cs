using System;
using Anthropic;
using Anthropic.Core;
using Microsoft.Extensions.AI;

namespace CBIM.LlmClient
{
    /// <summary>
    /// 构建 Anthropic <see cref="IChatClient"/>。
    ///
    /// <para>SDK 用法依据：
    ///   <c>new AnthropicClient(new ClientOptions { ApiKey = apiKey }).AsIChatClient(model)</c>
    ///   （参照 MAF agent-framework/dotnet/src/Microsoft.Agents.AI.Anthropic/AnthropicClientExtensions.cs
    ///    和 agent-framework/dotnet/samples/03-workflows/_StartHere/04_MultiModelService/Program.cs）
    /// </para>
    ///
    /// <para>注意：<see cref="ModelDescriptor.Endpoint"/> 对 Anthropic 公有 API 不适用；
    /// 若需 Foundry/Bedrock 等变体，请自行实现 <see cref="IProviderClientBuilder"/> 并注册。</para>
    ///
    /// <para>AsIChatClient 只接受 model 参数；max_tokens 由调用侧通过 ChatOptions.MaxOutputTokens
    /// 或全局 AnthropicClientExtensions.DefaultMaxTokens（4096）控制。
    /// 若描述符中 <see cref="ModelDescriptor.MaxTokens"/> 不为 null，
    /// 请在上层（如 CBIM.NewAgent）将其写入 ChatOptions.MaxOutputTokens。</para>
    /// </summary>
    public sealed class AnthropicBuilder : IProviderClientBuilder
    {
        // Anthropic SDK 类：Anthropic.AnthropicClient
        // 构造：new AnthropicClient(new Anthropic.Core.ClientOptions { ApiKey = apiKey })
        // IChatClient 桥接：AnthropicClient.AsIChatClient(model)
        //   — 扩展方法来自 Microsoft.Agents.AI.Anthropic.dll，命名空间 Anthropic
        //   — 签名：AsIChatClient(this IAnthropicClient client, string model)，无 maxTokens 参数

        public IChatClient Build(ModelDescriptor descriptor)
        {
            if (descriptor == null) throw new ArgumentNullException(nameof(descriptor));

            string apiKey = ApiKeyResolver.Resolve(descriptor);

            var client = new AnthropicClient(new ClientOptions { ApiKey = apiKey });

            // AsIChatClient(model) — 不接受 maxTokens 参数；max_tokens 由 ChatOptions 或全局默认值控制
            return client.AsIChatClient(descriptor.ModelName);
        }
    }
}
