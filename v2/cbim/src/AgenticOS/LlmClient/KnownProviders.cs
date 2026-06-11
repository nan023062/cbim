using System.Collections.Generic;

namespace CBIM.LlmClient
{
    /// <summary>
    /// 已知的 LLM 服务提供商枚举。仅供代码内使用，实际运行时以 <see cref="KnownProvider"/> 中的字符串常量为准。
    /// </summary>
    public enum KnownProvider
    {
        OpenAI, 
        Anthropic, 
        Azure, 
        Ollama, 
        
        DeepSeek, 
        Qwen, 
        Moonshot, 
        Doubao, 
        MiniMax,
        Glm,
        Baichuan,
        
        Ernie,
        Hunyuan,
        Spark,
    }

    internal static class KnownProvidersExtensions
    {
        static readonly IReadOnlyDictionary<KnownProvider, string> ProviderNames =
            new Dictionary<KnownProvider, string>
            {
                [KnownProvider.OpenAI]    = "OpenAI",
                [KnownProvider.Anthropic] = "Anthropic",
                [KnownProvider.Azure]     = "Azure OpenAI",
                [KnownProvider.Ollama]    = "Ollama",
                
                [KnownProvider.DeepSeek]  = "DeepSeek",
                [KnownProvider.Qwen]      = "Qwen",
                [KnownProvider.Moonshot]  = "Moonshot",
                [KnownProvider.Doubao]    = "Doubao",
                [KnownProvider.MiniMax]   = "MiniMax",
                [KnownProvider.Glm]       = "GLM",
                [KnownProvider.Baichuan]  = "Baichuan",
                
                [KnownProvider.Ernie]     = "Ernie Bot",
                [KnownProvider.Hunyuan]   = "Hunyuan Aide",
                [KnownProvider.Spark]     = "Spark NLP Cloud",
            };
        
        /// <summary>
        /// Provider 默认 API 端点。OpenAI 不在此表中——由 OpenAI SDK 内置默认端点处理。
        /// </summary>
        static readonly IReadOnlyDictionary<KnownProvider, string> DefaultEndpoints =
            new Dictionary<KnownProvider, string>
            {
                [KnownProvider.DeepSeek]  = "https://api.deepseek.com/v1",
                [KnownProvider.Qwen]      = "https://dashscope.aliyuncs.com/compatible-mode/v1",
                [KnownProvider.Moonshot]  = "https://api.moonshot.cn/v1",
                [KnownProvider.Doubao]    = "https://ark.cn-beijing.volces.com/api/v3",
                [KnownProvider.MiniMax]   = "https://api.minimax.chat/v1",
                [KnownProvider.Glm]       = "https://open.bigmodel.cn/api/paas/v4",
                [KnownProvider.Baichuan]  = "https://api.baichuan-ai.com/v1",
            };

        /// <summary>
        /// Provider 对应的环境变量名（用于 ApiKey 回退）。
        /// </summary>
        static readonly IReadOnlyDictionary<KnownProvider, string> EnvVarNames =
            new Dictionary<KnownProvider, string>
            {
                [KnownProvider.OpenAI]    = "OPENAI_API_KEY",
                [KnownProvider.Anthropic] = "ANTHROPIC_API_KEY",
                [KnownProvider.Azure]     = "AZURE_OPENAI_API_KEY",
                [KnownProvider.DeepSeek]  = "DEEPSEEK_API_KEY",
                [KnownProvider.Qwen]      = "DASHSCOPE_API_KEY",
                [KnownProvider.Moonshot]  = "MOONSHOT_API_KEY",
                [KnownProvider.Doubao]    = "ARK_API_KEY",
                [KnownProvider.MiniMax]   = "MINIMAX_API_KEY",
                [KnownProvider.Glm]       = "ZHIPUAI_API_KEY",
                [KnownProvider.Baichuan]  = "BAICHUAN_API_KEY",
            };
        
        public static string GetEnvVarName(this KnownProvider provider)
        {
            EnvVarNames.TryGetValue(provider, out var envVarName);
            return envVarName ?? string.Empty;
        }

        public static string GetEndpoint(this KnownProvider provider)
        {
            DefaultEndpoints.TryGetValue(provider, out var endpoint);
            return endpoint ?? string.Empty;
        }
    }
}
