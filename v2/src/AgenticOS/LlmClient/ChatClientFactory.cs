using System;
using CBIM.Mind;
using Microsoft.Extensions.AI;

namespace CBIM.LlmClient;

/// <summary>
/// LLM 客户端工厂——按脑区描述符选择合适的 IChatClient。
/// </summary>
public class ChatClientFactory
{
    private readonly ProviderRegistry _registry;

    /// <summary>
    /// 使用默认 <see cref="ProviderRegistry"/>（含所有内置 Provider）构造工厂。
    /// </summary>
    public ChatClientFactory()
    {
        _registry = ProviderRegistry.CreateDefault();
    }

    /// <summary>
    /// 使用指定 <see cref="ProviderRegistry"/> 构造工厂（便于测试或自定义 Provider 注册）。
    /// </summary>
    public ChatClientFactory(ProviderRegistry registry)
    {
        _registry = registry ?? throw new ArgumentNullException(nameof(registry));
    }

    /// <summary>
    /// 按模型描述符返回对应的 LLM 客户端。
    /// </summary>
    public IChatClient Create(ModelDescriptor? model)
    {
        if (model == null)
            throw new InvalidOperationException(
                "ModelDescriptor is required. Pass a ModelDescriptor to ChatClientFactory.Create().");

        var builder = _registry.Resolve(model.Provider);
        return builder.Build(model);
    }
}
