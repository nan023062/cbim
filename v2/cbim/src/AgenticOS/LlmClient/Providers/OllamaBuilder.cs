using System;
using Microsoft.Extensions.AI;

namespace CBIM.LlmClient
{
    /// <summary>
    /// 构建 Ollama <see cref="IChatClient"/>。
    ///
    /// <para>依赖 <c>OllamaSharp.dll</c>（提供 <c>OllamaApiClient</c>，实现 <c>IChatClient</c>）。
    /// 当前 <c>CBIM.asmdef</c> 的 <c>precompiledReferences</c> 中<b>未包含</b>该 DLL，
    /// 因此实现为 <see cref="NotImplementedException"/> 占位。
    /// </para>
    ///
    /// <para>待 DLL 添加至 asmdef 后，取消注释下方实现并删除 throw。</para>
    ///
    /// <para>预期 SDK 用法（依据 MAF AgentWebChat ChatClientExtensions.cs）：
    /// <code>
    /// using OllamaSharp;
    ///
    /// var httpClient = new System.Net.Http.HttpClient
    ///     { BaseAddress = new Uri(endpoint ?? "http://localhost:11434") };
    /// new OllamaApiClient(httpClient, modelName);   // OllamaApiClient : IChatClient
    /// </code>
    /// </para>
    ///
    /// <para>字段映射：
    ///   • <see cref="ModelDescriptor.Endpoint"/> — Ollama 服务地址，默认 <c>http://localhost:11434</c>
    ///   • <see cref="ModelDescriptor.ModelName"/> — 模型名，如 "llama3" / "mistral"
    ///   • ApiKey 对 Ollama 无意义，忽略
    /// </para>
    /// </summary>
    public sealed class OllamaBuilder : IProviderClientBuilder
    {
        private const string DefaultEndpoint = "http://localhost:11434";

        public IChatClient Build(ModelDescriptor descriptor)
        {
            if (descriptor == null) throw new ArgumentNullException(nameof(descriptor));

            // TODO: 将 OllamaSharp.dll 添加至 CBIM.asmdef precompiledReferences，
            //       然后取消注释以下实现。
            //
            // string endpoint = !string.IsNullOrWhiteSpace(descriptor.Endpoint)
            //     ? descriptor.Endpoint
            //     : DefaultEndpoint;
            //
            // var httpClient = new System.Net.Http.HttpClient
            //     { BaseAddress = new Uri(endpoint) };
            //
            // // OllamaApiClient 直接实现 IChatClient（OllamaSharp >= 5.x）
            // return new OllamaSharp.OllamaApiClient(httpClient, descriptor.ModelName);

            throw new NotImplementedException(
                "OllamaBuilder requires OllamaSharp.dll, " +
                "which is not yet included in CBIM.asmdef precompiledReferences. " +
                "Add OllamaSharp.dll to the asmdef and uncomment the implementation in OllamaBuilder.cs.");
        }
    }
}
