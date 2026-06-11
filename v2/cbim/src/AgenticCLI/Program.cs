#nullable enable
using System;
using System.CommandLine;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using CBIM;
using CBIM.Agent;
using CBIM.LlmClient;
using Microsoft.Extensions.Configuration;

namespace CBIM.Cli;

/// <summary>
/// AgenticCLI — CBIM 的瘦命令行前端。
/// <para>
/// 替代 Unity Desktop 作为 AgenticOS 的展示层。所有业务逻辑均下沉至
/// AgenticOS（Cbim / Session / ModelStore / McpManager）；本 Program
/// 仅负责参数解析、配置加载、控制台 IO 和事件订阅。
/// </para>
/// <para>
/// 未来 AgenticDesktop（GUI 前端）将作为 sibling 复用 AgenticOS — 此处
/// 不引入任何 CLI 专属的编排 / 路由 / 装配逻辑。
/// </para>
/// </summary>
public static class Program
{
    public static Task<int> Main(string[] args)
    {
        var rootOption = new Option<string?>(
            aliases: new[] { "--root" },
            description: "数据根目录（CBIM 工作目录）。默认 %LocalAppData%/CBIM。");

        var configOption = new Option<string?>(
            aliases: new[] { "--config", "-c" },
            description: "appsettings.json 路径。默认与可执行文件同目录。");

        var providerOption = new Option<string?>(
            aliases: new[] { "--provider" },
            description: "LLM 提供商：openai / anthropic / azure / ollama。覆盖 appsettings。");

        var modelOption = new Option<string?>(
            aliases: new[] { "--model" },
            description: "提供商侧模型名,如 gpt-4o-mini。覆盖 appsettings。");

        var apiKeyOption = new Option<string?>(
            aliases: new[] { "--api-key" },
            description: "LLM API Key。留空则由工厂从环境变量读取（OPENAI_API_KEY 等）。");

        var soulOption = new Option<string?>(
            aliases: new[] { "--soul" },
            description: "Agent 人格 / 系统提示词。覆盖 appsettings。");

        var identityOption = new Option<string?>(
            aliases: new[] { "--identity" },
            description: "Agent 角色简介。覆盖 appsettings。");

        var messageOption = new Option<string>(
            aliases: new[] { "--message", "-m" },
            description: "发送给 Agent 的用户消息。")
        { IsRequired = true };

        var chatCommand = new Command("chat", "打开一次性 Session,发送一条消息,打印响应后关闭。")
        {
            rootOption,
            configOption,
            providerOption,
            modelOption,
            apiKeyOption,
            soulOption,
            identityOption,
            messageOption,
        };

        chatCommand.SetHandler(async (ctx) =>
        {
            var settings = new ChatSettings
            {
                Root = ctx.ParseResult.GetValueForOption(rootOption),
                Config = ctx.ParseResult.GetValueForOption(configOption),
                Provider = ctx.ParseResult.GetValueForOption(providerOption),
                Model = ctx.ParseResult.GetValueForOption(modelOption),
                ApiKey = ctx.ParseResult.GetValueForOption(apiKeyOption),
                Soul = ctx.ParseResult.GetValueForOption(soulOption),
                Identity = ctx.ParseResult.GetValueForOption(identityOption),
                Message = ctx.ParseResult.GetValueForOption(messageOption)!,
            };
            ctx.ExitCode = await RunChatAsync(settings, ctx.GetCancellationToken()).ConfigureAwait(false);
        });

        var root = new RootCommand("CBIM 命令行 — AgenticOS 的瘦前端,与未来的 AgenticDesktop GUI 共享同一核心。")
        {
            chatCommand,
        };

        return root.InvokeAsync(args);
    }

    private static async Task<int> RunChatAsync(ChatSettings settings, CancellationToken ct)
    {
        // ------------------------------------------------------------------
        // 配置层 — appsettings.json 是默认值，CLI 选项覆盖。
        // ------------------------------------------------------------------
        string configPath = ResolveConfigPath(settings.Config);
        var config = new ConfigurationBuilder()
            .AddJsonFile(configPath, optional: true, reloadOnChange: false)
            .Build();
        var fileSection = config.GetSection("Cbim");

        string provider = settings.Provider ?? fileSection["Provider"] ?? "OpenAI";
        string modelName = settings.Model ?? fileSection["ModelName"] ?? "gpt-4o-mini";
        string? apiKey = settings.ApiKey ?? fileSection["ApiKey"];
        string soul = settings.Soul ?? fileSection["AgentSoul"]
            ?? "你是一个友善、专业的 AI 助手，回答简洁准确。";
        string identity = settings.Identity ?? fileSection["AgentIdentity"]
            ?? "通用助手，用于 CBIM 集成验证。";
        string dataSubdir = fileSection["DataSubdir"] ?? "CBIM";

        string rootPath = !string.IsNullOrWhiteSpace(settings.Root)
            ? settings.Root!
            : Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                dataSubdir);

        if (!Enum.TryParse<KnownProvider>(provider, ignoreCase: true, out var providerEnum))
        {
            Console.Error.WriteLine($"[cbim] 未知 provider: {provider}。允许值: OpenAI / Anthropic / AzureOpenAI / Ollama。");
            return 2;
        }

        const string ModelId = "demo-model";
        const string AgentId = "demo-agent";

        // ------------------------------------------------------------------
        // Phase 1：配置基础设施（与 Assets/Desktop/CbimDemo.cs 1:1）。
        // ------------------------------------------------------------------
        Console.WriteLine("[cbim] Phase 1: 配置基础设施");

        var agentDesc = new AgentDescription(
            id: AgentId,
            name: "Demo Agent",
            soul: soul,
            identity: identity,
            prefrontalModelId: ModelId);

        using var cbim = Cbim.Create(new CbimOptions
        {
            RootPath = rootPath,
            Agent = agentDesc,
            // MCP starter 复活 — net8.0 + C#12 编译 ModelContextProtocol 的
            // C# 11 required 成员已无障碍（旧 Unity 魔改 Roslyn 限制不复存在）。
            McpStarter = new CBIM.Mcp.McpClientStarter(),
        });
        Console.WriteLine($"[cbim] OK Cbim 初始化 root={rootPath}");

        var modelDescriptor = new ModelDescriptor(
            id: ModelId,
            name: $"{providerEnum}/{modelName}",
            provider: providerEnum,
            modelName: modelName,
            apiKey: string.IsNullOrWhiteSpace(apiKey) ? null : apiKey);
        cbim.ModelStore.Put(modelDescriptor);
        Console.WriteLine($"[cbim] OK ModelStore 注册 {modelDescriptor}");

        // ------------------------------------------------------------------
        // Phase 2：开 Session 投递消息。
        // ------------------------------------------------------------------
        Console.WriteLine("[cbim] Phase 2: 打开 Session");
        var session = await cbim.OpenSessionAsync(ct).ConfigureAwait(false);
        Console.WriteLine($"[cbim] OK Session={session.SessionId}");

        session.OnOutput += evt =>
        {
            if (evt.Text.StartsWith("[PROGRESS]", StringComparison.Ordinal))
                Console.WriteLine($"[cbim] .. {evt.Text}");
        };

        Console.WriteLine("[cbim] -> 发送消息");
        SessionOutcome outcome;
        try
        {
            outcome = await session.SendAsync(settings.Message, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[cbim] !! 异常: {ex.Message}");
            Console.Error.WriteLine(ex);
            await cbim.CloseSessionAsync(session.SessionId, CancellationToken.None).ConfigureAwait(false);
            return 1;
        }

        int exitCode;
        if (outcome.IsError)
        {
            Console.Error.WriteLine($"[cbim] !! Session 错误: {outcome.ErrorMessage}");
            exitCode = 1;
        }
        else
        {
            Console.WriteLine($"[cbim] <- {outcome.ResultText}");
            exitCode = 0;
        }

        await cbim.CloseSessionAsync(session.SessionId, CancellationToken.None).ConfigureAwait(false);
        Console.WriteLine($"[cbim] OK Session 关闭 {session.SessionId}");
        return exitCode;
    }

    private static string ResolveConfigPath(string? overridePath)
    {
        if (!string.IsNullOrWhiteSpace(overridePath))
            return overridePath!;
        string baseDir = AppContext.BaseDirectory;
        return Path.Combine(baseDir, "appsettings.json");
    }

    /// <summary>
    /// chat 命令的解析后设置 — POCO,无逻辑。
    /// </summary>
    private sealed class ChatSettings
    {
        public string? Root { get; init; }
        public string? Config { get; init; }
        public string? Provider { get; init; }
        public string? Model { get; init; }
        public string? ApiKey { get; init; }
        public string? Soul { get; init; }
        public string? Identity { get; init; }
        public string Message { get; init; } = string.Empty;
    }
}
