using System;
using Microsoft.Extensions.AI;
using OpenAI;

namespace CBIM.LlmClient;

/// <summary>
/// 构建兼容 OpenAI Chat Completion API 的 <see cref="IChatClient"/>。
///
/// 支持的 Provider：OpenAI, DeepSeek, Qwen, Moonshot, Doubao, MiniMax, Glm, Baichuan。
///
/// <para>Endpoint 解析优先级：
///   1. <see cref="ModelDescriptor.Endpoint"/>（描述符内联值）
///   2. <see cref="KnownProvider.DefaultEndpoints"/> 表（按 provider 名查）
///   3. 不传 endpoint，由 OpenAI SDK 使用内置默认（仅 openai 有效）
/// </para>
///
/// <para>SDK 用法依据：
///   <c>new OpenAIClient(apiKey).GetChatClient(model).AsIChatClient()</c>
///   （参照 MAF agent-framework/dotnet/samples/02-agents/AgentProviders/Agent_With_OpenAIChatCompletion）
/// </para>
/// </summary>
public sealed class OpenAICompatibleBuilder : IProviderClientBuilder
{
    // OpenAI SDK: OpenAIClient(string apiKey) — 使用 OpenAI 默认端点
    // OpenAI SDK: OpenAIClient(Uri endpoint, ApiKeyCredential credential) — 使用自定义端点
    // OpenAI.Chat.ChatClient.AsIChatClient() — 来自 Microsoft.Extensions.AI.OpenAI

    public IChatClient Build(ModelDescriptor descriptor)
    {
        if (descriptor == null)
            throw new ArgumentNullException(nameof(descriptor));

        string apiKey = ApiKeyResolver.Resolve(descriptor);
        KnownProvider provider = descriptor.Provider;

        // 解析端点：描述符内联 > 默认端点表 > 无（使用 SDK 内置默认）
        string? endpoint = descriptor.Endpoint;
        if (string.IsNullOrWhiteSpace(endpoint))
        {
            endpoint = provider.GetEndpoint();
        }

        OpenAIClient client;
        if (!string.IsNullOrWhiteSpace(endpoint))
        {
            // 自定义端点：使用 OpenAIClient(ApiKeyCredential, OpenAIClientOptions) 重载
            // API: OpenAIClient(ApiKeyCredential credential, OpenAIClientOptions options)
            client = new OpenAIClient(
                new System.ClientModel.ApiKeyCredential(apiKey),
                new OpenAIClientOptions { Endpoint = new Uri(endpoint) });
        }
        else
        {
            // 无自定义端点，使用 OpenAI 官方端点
            // API: OpenAIClient(string apiKey)
            client = new OpenAIClient(apiKey);
        }

        // GetChatClient(modelId) 返回 OpenAI.Chat.ChatClient
        // ChatClient.AsIChatClient() 来自 Microsoft.Extensions.AI.OpenAI
        return client.GetChatClient(descriptor.ModelName).AsIChatClient();
    }
}
