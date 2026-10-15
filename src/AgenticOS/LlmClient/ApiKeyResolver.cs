using System;

namespace CBIM.LlmClient;

/// <summary>
/// 解析 ModelDescriptor 的 ApiKey，按优先级：
/// 1. <see cref="ModelDescriptor.ApiKey"/>（描述符内联值）
/// 2. 环境变量（按 <see cref="KnownProvider.EnvVarNames"/> 查表）
/// 3. 抛 <see cref="InvalidOperationException"/>
/// </summary>
public static class ApiKeyResolver
{
    /// <summary>
    /// 解析 ApiKey。找不到时抛出 <see cref="InvalidOperationException"/>。
    /// </summary>
    /// <param name="descriptor">模型描述符。</param>
    /// <returns>解析到的 ApiKey 字符串。</returns>
    public static string Resolve(ModelDescriptor descriptor)
    {
        if (descriptor == null)
            throw new ArgumentNullException(nameof(descriptor));

        // 优先使用描述符内联值
        if (!string.IsNullOrWhiteSpace(descriptor.ApiKey))
            return descriptor.ApiKey;

        // 其次从环境变量读取
        string? envKey = null;
        string envVarName = descriptor.Provider.GetEnvVarName();
        if (!string.IsNullOrWhiteSpace(envVarName))
        {
            envKey = Environment.GetEnvironmentVariable(envVarName);
        }

        if (!string.IsNullOrWhiteSpace(envKey))
            return envKey!;

        // 失败
        string hint = envVarName != null
            ? $" (expected env var: {envVarName})"
            : " (no env var mapping found for this provider)";

        throw new InvalidOperationException(
            $"No API key found for provider '{descriptor.Provider}' / model '{descriptor.ModelName}'.{hint} " +
            $"Set ModelDescriptor.ApiKey or the corresponding environment variable.");
    }
}
