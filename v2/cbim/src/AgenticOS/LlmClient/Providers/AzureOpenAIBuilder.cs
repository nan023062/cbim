using System;
using Microsoft.Extensions.AI;

namespace CBIM.LlmClient;

/// <summary>
/// 构建 Azure OpenAI <see cref="IChatClient"/>。
///
/// <para>依赖 <c>Azure.AI.OpenAI.dll</c>（提供 <c>AzureOpenAIClient</c>）及
/// <c>Azure.Core.dll</c>（提供 <c>AzureKeyCredential</c>）。
/// 当前 <c>CBIM.asmdef</c> 的 <c>precompiledReferences</c> 中<b>未包含</b>上述两个 DLL，
/// 因此实现为 <see cref="NotImplementedException"/> 占位。
/// </para>
///
/// <para>待 DLL 添加至 asmdef 后，取消注释下方实现并删除 throw。</para>
///
/// <para>预期 SDK 用法（依据 MAF DurableAgents 系列示例）：
/// <code>
/// using Azure.AI.OpenAI;
/// using Azure.Core;
///
/// new AzureOpenAIClient(new Uri(endpoint), new AzureKeyCredential(apiKey))
///     .GetChatClient(deploymentName)   // deploymentName == ModelDescriptor.ModelName
///     .AsIChatClient()
/// </code>
/// </para>
///
/// <para>字段映射：
///   • <see cref="ModelDescriptor.Endpoint"/> — Azure OpenAI 资源 URI（必填）
///   • <see cref="ModelDescriptor.ModelName"/> — 部署名（deployment name）
///   • ApiKey 来自 <see cref="ApiKeyResolver"/>（环境变量 <c>AZURE_OPENAI_API_KEY</c>）
/// </para>
/// </summary>
public sealed class AzureOpenAIBuilder : IProviderClientBuilder
{
    public IChatClient Build(ModelDescriptor descriptor)
    {
        if (descriptor == null)
            throw new ArgumentNullException(nameof(descriptor));

        // TODO: 将 Azure.AI.OpenAI.dll 和 Azure.Core.dll 添加至 CBIM.asmdef precompiledReferences，
        //       然后取消注释以下实现。
        //
        // string endpoint = descriptor.Endpoint
        //     ?? throw new InvalidOperationException(
        //         "AzureOpenAIBuilder requires ModelDescriptor.Endpoint (Azure resource URI).");
        // string apiKey  = ApiKeyResolver.Resolve(descriptor);
        //
        // return new Azure.AI.OpenAI.AzureOpenAIClient(
        //         new Uri(endpoint),
        //         new Azure.Core.AzureKeyCredential(apiKey))
        //     .GetChatClient(descriptor.ModelName)   // deployment name
        //     .AsIChatClient();                       // Microsoft.Extensions.AI.OpenAI 扩展

        throw new NotImplementedException(
            "AzureOpenAIBuilder requires Azure.AI.OpenAI.dll and Azure.Core.dll, " +
            "which are not yet included in CBIM.asmdef precompiledReferences. " +
            "Add those DLLs to the asmdef and uncomment the implementation in AzureOpenAIBuilder.cs.");
    }
}
