using System;
using Microsoft.Extensions.AI;

namespace CBIM.LlmClient
{
    /// <summary>
    /// 已知但尚未支持的 Provider 占位构建器。
    /// </summary>
    public sealed class StubProviderBuilder : IProviderClientBuilder
    {
        private readonly KnownProvider _providerName;

        public StubProviderBuilder(KnownProvider providerName)
        {
            _providerName = providerName;
        }

        public IChatClient Build(ModelDescriptor descriptor) =>
            throw new NotSupportedException(
                $"Provider '{_providerName}' requires a custom adapter. " +
                $"Implement IProviderClientBuilder and register via ProviderRegistry.Register(\"{_providerName}\", yourBuilder).");
    }
}
