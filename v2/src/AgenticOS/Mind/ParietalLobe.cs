#nullable enable
using System;
using System.Collections.Generic;
using CBIM.LlmClient;

namespace CBIM.Mind;

/// <summary>
/// ParietalLobe（顶叶）——架构脑。
/// 装配期获得「整工作区只读」沙箱：白名单 = WorkspaceSystem.RootPath，
/// ToolIds 由 <see cref="ParietalLobeDescriptor"/> 写死为只读文件家族（readfile/listdir/grep/glob）。
/// 不下放 writefile/editfile/deletefile/bash——这是按 BrainKind 写死的硬上限。
/// </summary>
public sealed class ParietalLobe : Brain
{
    public override BrainKind Kind => BrainKind.ParietalLobe;

    internal ParietalLobe(IBrainAgent agent, ParietalLobeDescriptor descriptor)
        : base(agent, descriptor)
    {
    }

    /// <summary>
    /// 架构脑沙箱白名单 = 工作区根路径——允许 read-all。
    /// 没拿到 RootPath 时退化为空（保持与默认行为一致）。
    /// </summary>
    protected override IReadOnlyList<string> ResolveStaticAllowedPathPrefixes()
    {
        var root = agent?.Os?.Workspace?.RootPath;
        if (string.IsNullOrWhiteSpace(root))
            return Array.Empty<string>();
        return new[] { root };
    }
}

/// <summary>
/// 逻辑 + 架构（全局观），负责规划和设计决策。
/// 内部描述符——仅供框架装配层使用；不对外暴露。
/// </summary>
internal sealed class ParietalLobeDescriptor : BrainDescriptor
{
    static readonly string Id = "__parietalLobe_cortex";
    static readonly string Prompt = "你是架构脑，负责结构性思维。你的核心职责是将外部工作区和环境建模为结构化知识，维护知识体系的完整性和一致性。\n你是唯一有权读写结构化知识库（.dna/）的脑区，其他脑区只能读取。\n你确保工作脑在清晰的结构边界内工作，识别知识缺口，主动补全和治理知识结构。";
    static readonly string DefaultName = "ParietalLobe";
    static readonly string DefaultIdentity = "架构脑 · 模块设计 / 架构合规";

    /// <summary>
    /// 架构脑只读文件家族——按 BrainKind 写死，不暴露给 AgentDescription 配置。
    /// readfile / listdir / grep / glob：四件套已能完整覆盖架构脑需要的工作区只读浏览能力。
    /// 不含 writefile / editfile / deletefile / bash——这些在权限模型里属于工作脑独占。
    /// </summary>
    private static readonly string[] ReadOnlyFileToolIds =
    {
        "readfile", "listdir", "grep", "glob",
    };

    /// <summary>
    /// 创建架构脑描述符。
    /// </summary>
    /// <param name="modelId">绑定的 ModelDescriptor.Id（null 或空字符串表示使用默认模型）。</param>
    internal ParietalLobeDescriptor(string? modelId = null)
        : base(Id, Prompt, DefaultName, DefaultIdentity, modelId ?? string.Empty,
               toolIds: ReadOnlyFileToolIds)
    {
    }
}
