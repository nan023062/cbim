using System;

namespace CBIM.LlmClient;

/// <summary>
/// LLM 模型描述符——声明「这是哪个模型、来自哪个提供商、如何访问」的静态配置。
/// <see cref="ChatClientFactory"/> 根据此描述符路由到具体的 IChatClient 实现。</para>
///
/// 字段设计原则：
///   • <see cref="ApiKey"/> / <see cref="Endpoint"/> 可选——未设置时由工厂从环境变量回退。
///   • <see cref="Temperature"/> / <see cref="MaxTokens"/> 可选——null 表示使用提供商默认值。
/// </summary>
public sealed class ModelDescriptor
{
    /// <summary>唯一标识，供 BrainDescriptor.ModelHint 引用。kebab-case 推荐。</summary>
    public string Id { get; }

    /// <summary>显示名称（人类可读）。</summary>
    public string Name { get; }

    /// <summary>提供商（见 <see cref="KnownProvider"/>）。</summary>
    public KnownProvider Provider { get; }

    /// <summary>模型名，如 "gpt-4o" / "claude-opus-4-8" / "llama3"。</summary>
    public string ModelName { get; }

    /// <summary>API Key（可选）。null 时由工厂从环境变量读取。</summary>
    public string? ApiKey { get; }

    /// <summary>自定义端点 URL（可选）。null 时使用提供商默认端点。</summary>
    public string? Endpoint { get; }

    /// <summary>采样温度（可选）。null 时使用提供商默认值。</summary>
    public float? Temperature { get; }

    /// <summary>最大输出 Token 数（可选）。null 时使用提供商默认值。</summary>
    public int? MaxTokens { get; }

    public ModelDescriptor(
        string id,
        string name,
        KnownProvider provider,
        string modelName,
        string? apiKey = null,
        string? endpoint = null,
        float? temperature = null,
        int? maxTokens = null)
    {
        if (string.IsNullOrWhiteSpace(id))
            throw new ArgumentException("ModelDescriptor.Id 不能为空", nameof(id));
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("ModelDescriptor.Name 不能为空", nameof(name));
        if (string.IsNullOrWhiteSpace(modelName))
            throw new ArgumentException("ModelDescriptor.ModelName 不能为空", nameof(modelName));

        Id = id;
        Name = name;
        Provider = provider;
        ModelName = modelName;
        ApiKey = apiKey;
        Endpoint = endpoint;
        Temperature = temperature;
        MaxTokens = maxTokens;
    }

    public override string ToString() => $"ModelDescriptor({Id}, {Provider}/{ModelName})";
}
