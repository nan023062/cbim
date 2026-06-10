using System;
using System.Collections.Generic;

namespace CBIM.LlmClient
{
    /// <summary>
    /// Provider 构建器注册表。
    /// </summary>
    public sealed class ProviderRegistry
    {
        private readonly Dictionary<KnownProvider, IProviderClientBuilder> _builders =
            new Dictionary<KnownProvider, IProviderClientBuilder>();

#region 公共方法

        /// <summary>
        /// 注册或替换指定 Provider 的构建器（大小写不敏感）。
        /// </summary>
        public void Register(KnownProvider provider, IProviderClientBuilder builder)
        {
            if (builder == null)
                throw new ArgumentNullException(nameof(builder));

            _builders[provider] = builder;
        }

        /// <summary>
        /// 按 provider 名称解析构建器（大小写不敏感）。
        /// 找不到时抛 <see cref="NotSupportedException"/>。
        /// </summary>
        public IProviderClientBuilder Resolve(KnownProvider provider)
        {
            if (_builders.TryGetValue(provider, out var builder))
                return builder;

            throw new NotSupportedException(
                $"No IProviderClientBuilder registered for provider '{provider}'. " +
                $"Call ProviderRegistry.Register(\"{provider}\", yourBuilder) to add support.");
        }

        /// <summary>
        /// 创建并返回预注册所有内置 Provider 的默认注册表实例。
        /// </summary>
        public static ProviderRegistry CreateDefault()
        {
            var registry = new ProviderRegistry();

            // OpenAI 兼容 Provider：共享同一 OpenAICompatibleBuilder 实例
            var openAiCompatibleBuilder = new OpenAICompatibleBuilder();
            foreach (KnownProvider provider in Enum.GetValues(typeof(KnownProvider)))
            {
                registry.Register(provider, openAiCompatibleBuilder);
            }

            // Anthropic
            registry.Register(KnownProvider.Anthropic, new AnthropicBuilder());

            // Azure OpenAI（占位，待 Azure.AI.OpenAI.dll 加入 asmdef）
            registry.Register(KnownProvider.Azure, new AzureOpenAIBuilder());

            // Ollama（占位，待 OllamaSharp.dll 加入 asmdef）
            registry.Register(KnownProvider.Ollama, new OllamaBuilder());

            // 非兼容 Provider 占位（需要自定义适配器）
            registry.Register(KnownProvider.Ernie,   new StubProviderBuilder(KnownProvider.Ernie));
            registry.Register(KnownProvider.Hunyuan, new StubProviderBuilder(KnownProvider.Hunyuan));
            registry.Register(KnownProvider.Spark,   new StubProviderBuilder(KnownProvider.Spark));

            return registry;
        }

#endregion
    }
}
