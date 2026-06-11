#nullable enable
using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.AI;

namespace CBIM.Test.Fixtures
{
    /// <summary>
    /// <see cref="IChatClient"/> 的冒烟测试替身——永远返回 "hello from mock"。
    /// 由 Assets/Editor/_VerifyMsai/MockChatClient.cs 迁移而来,适配 net8.0 +
    /// Microsoft.Extensions.AI 10.6.0(nullable 注解收紧)。
    /// </summary>
    internal sealed class MockChatClient : IChatClient
    {
        public ChatClientMetadata Metadata { get; } =
            new ChatClientMetadata("mock", new Uri("mock://local"), "mock-model");

        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options = null,
            CancellationToken cancellationToken = default)
        {
            var reply = new ChatMessage(ChatRole.Assistant, "hello from mock");
            return Task.FromResult(new ChatResponse(reply));
        }

        public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            yield return new ChatResponseUpdate(ChatRole.Assistant, "hello from mock");
            await Task.CompletedTask;
        }

        public object? GetService(Type serviceType, object? serviceKey = null) => null;

        public void Dispose() { }
    }
}
