#nullable enable
using System;
using System.Collections.Generic;
using CBIM.Mind;

namespace CBIM.Agent;

/// <summary>
/// Agent 描述（AgentDescription）——CBIM 能力维度的核心对象。
///
/// <para>职责：声明 Agent 的身份（Id / Name / Soul / Identity）、三个内置脑区的模型绑定
/// （<see cref="PrefrontalModelId"/> / <see cref="ParietalLobeModelId"/> / <see cref="HippocampusModelId"/>）
/// 以及可选的用户工作脑列表（<see cref="WorkBrains"/>）。</para>
///
/// <para>内置脑（PrefrontalCortex / ParietalLobe / Hippocampus）由 <see cref="Session"/> 构造器
/// 自动装配，调用方无须手动创建其描述符。</para>
///
/// <para>能力声明（Skills / Workflows / Tools / Mcp / ModelId）已下移至
/// <see cref="BrainDescriptor"/>——由各脑区自行声明所需能力，AgentDescription
/// 只负责 Agent 级别的身份与脑区编排。</para>
///
/// <para>记忆后端由 <see cref="AgenticOS"/> 统一持有（<c>AgenticOSOptions.Memory</c>）；
/// Hippocampus 通过 <c>agent.Os.Memory</c> 访问，不在 AgentDescription 层注入。</para>
/// </summary>
[Serializable]
public sealed class AgentDescription
{
    /// <summary>Agent 唯一 ID。kebab-case。例："unity-programmer" / "backend-programmer" / "blender-artist"。</summary>
    public string Id { get; }

    /// <summary>Agent 名（人类可读）。例："Unity 程序员"。</summary>
    public string Name { get; }

    /// <summary>
    /// 灵魂（Soul）——agent 的人格 / 行为准则 / 系统提示词。
    /// </summary>
    public string Soul { get; }

    /// <summary>
    /// 身份（Identity）——agent 的角色定位简介。
    /// </summary>
    public string Identity { get; }

    /// <summary>
    /// 主脑（PrefrontalCortex）绑定的 ModelDescriptor.Id。
    /// null 表示使用默认模型。
    /// </summary>
    public string? PrefrontalModelId { get; }

    /// <summary>
    /// 架构脑（ParietalLobe）绑定的 ModelDescriptor.Id。
    /// null 表示使用默认模型。
    /// </summary>
    public string? ParietalLobeModelId { get; }

    /// <summary>
    /// 记忆脑（Hippocampus）绑定的 ModelDescriptor.Id。
    /// null 表示使用默认模型。
    /// </summary>
    public string? HippocampusModelId { get; }

    /// <summary>
    /// 用户工作脑列表（可选，可为空列表）。
    /// 内置三脑区（PrefrontalCortex / ParietalLobe / Hippocampus）由框架自动装配，
    /// 此处仅声明额外的用户自定义工作脑。
    /// </summary>
    public IReadOnlyList<BrainDescriptor> WorkBrains { get; }

    public AgentDescription(
        string id,
        string name,
        string soul,
        string identity,
        string? prefrontalModelId = null,
        string? parietalLobeModelId = null,
        string? hippocampusModelId = null,
        IReadOnlyList<BrainDescriptor>? workBrains = null)
    {
        if (string.IsNullOrWhiteSpace(id))
            throw new ArgumentException("AgentDescription.Id 不能为空", nameof(id));
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("AgentDescription.Name 不能为空", nameof(name));
        if (string.IsNullOrWhiteSpace(soul))
            throw new ArgumentException("AgentDescription.Soul 不能为空——agent 必须有人设", nameof(soul));
        if (string.IsNullOrWhiteSpace(identity))
            throw new ArgumentException("AgentDescription.Identity 不能为空", nameof(identity));

        Id = id;
        Name = name;
        Soul = soul;
        Identity = identity;
        PrefrontalModelId = prefrontalModelId;
        ParietalLobeModelId = parietalLobeModelId;
        HippocampusModelId = hippocampusModelId;
        WorkBrains = workBrains ?? Array.Empty<BrainDescriptor>();
    }

    public override string ToString() =>
        $"AgentDescription({Id}, workBrains={WorkBrains.Count})";
}
