using System;
using System.Collections.Generic;

namespace CBIM.Mind;

/// <summary>
/// 上下文压缩策略——控制 <see cref="BrainDescriptor.CompactionStrategy"/> 行为。
/// </summary>
public enum ContextCompactionStrategy
{
    /// <summary>不压缩（默认）。</summary>
    None,

    /// <summary>截断旧消息——使用 MAF <c>TruncationCompactionStrategy</c>。</summary>
    Truncate,

    /// <summary>滑动窗口——使用 MAF <c>SlidingWindowCompactionStrategy</c>，按 turn 数限制历史。</summary>
    Sliding,

    /// <summary>摘要化——使用 MAF <c>SummarizationCompactionStrategy</c>（需要 LLM）。</summary>
    Summarize,
}

/// <summary>
/// 脑区描述符公共基类——声明「这是什么脑区」的静态信息（不含运行态资源）。
///
/// <para>承载脑区级别的能力声明：ModelId / SkillIds / WorkflowIds / ToolIds / McpIds。
/// 这些字段从 <see cref="CBIM.Agent.AgentDescription"/> 下移至此，使每个脑区可独立声明
/// 自己所需的模型与能力，AgentDescription 只负责 Agent 级别的身份与脑区编排。</para>
/// </summary>
public abstract class BrainDescriptor
{
    /// <summary>脑区在 AgentInstance 内的唯一标识。如 "prefrontal-cortex" / "motor-cortex.claude-code"。</summary>
    public string BrainId { get; }

    /// <summary>脑区的系统提示词（装入 ChatOptions.Instructions）。</summary>
    public string SystemPrompt { get; }

    /// <summary>脑区的人类可读名称（对应 ChatClientAgentOptions.Name）。</summary>
    public string Name { get; }

    /// <summary>脑区的角色定位简介（对应 ChatClientAgentOptions.Description）。</summary>
    public string Identity { get; }

    /// <summary>
    /// 引用 <c>ModelDescriptor.Id</c>——此脑区期望绑定的模型注册条目。
    /// 空字符串表示未指定，使用默认模型。
    /// </summary>
    public string ModelId { get; }

    /// <summary>
    /// 技能 Id 列表——引用 <c>SkillDescriptor.Id</c>。
    /// 脑区声明它具备哪些技能；空列表表示无附加技能。
    /// </summary>
    public IReadOnlyList<string> SkillIds { get; }

    /// <summary>
    /// Workflow Id 列表——引用 <c>WorkflowDescriptor.Id</c>。
    /// 脑区声明它可触发哪些 Workflow；空列表表示无附加 Workflow。
    /// </summary>
    public IReadOnlyList<string> WorkflowIds { get; }

    /// <summary>
    /// 工具家族 Id 列表——引用 <c>ToolDescriptor.FamilyName</c>（或未来统一 Id）。
    /// 脑区声明它需要哪些内置工具家族；空列表表示无附加工具。
    /// </summary>
    public IReadOnlyList<string> ToolIds { get; }

    /// <summary>
    /// MCP 服务 Id 列表——引用 <c>McpDescriptor.Id</c>。
    /// 脑区声明它需要哪些 MCP 服务；空列表表示无附加 MCP。
    /// </summary>
    public IReadOnlyList<string> McpIds { get; }

    /// <summary>
    /// 上下文窗口大小（token 数）。
    /// <para>非 null 时，MsAINeuron 会为本脑区启用 <see cref="Microsoft.Agents.AI.InMemoryChatHistoryProvider"/>
    /// 并按 <see cref="CompactionStrategy"/> 配置压缩策略，将历史 token 数限制在此值以内。</para>
    /// <para>null 表示不限制上下文历史大小（默认行为：不启用 ChatHistoryProvider）。</para>
    /// </summary>
    public int? ContextWindowTokens { get; }

    /// <summary>
    /// 历史压缩策略（当 <see cref="ContextWindowTokens"/> 非 null 时生效）。
    /// 默认为 <see cref="ContextCompactionStrategy.None"/>（不压缩，仅保留历史，不触发任何 Reducer）。
    /// </summary>
    public ContextCompactionStrategy CompactionStrategy { get; }

    protected BrainDescriptor(
        string brainId,
        string systemPrompt = "",
        string name = "",
        string identity = "",
        string modelId = "",
        IReadOnlyList<string> skillIds = null,
        IReadOnlyList<string> workflowIds = null,
        IReadOnlyList<string> toolIds = null,
        IReadOnlyList<string> mcpIds = null,
        int? contextWindowTokens = null,
        ContextCompactionStrategy compactionStrategy = ContextCompactionStrategy.None)
    {
        if (string.IsNullOrWhiteSpace(brainId))
            throw new ArgumentException("BrainDescriptor.BrainId 不能为空", nameof(brainId));

        BrainId = brainId;
        SystemPrompt = systemPrompt ?? string.Empty;
        Name = name ?? string.Empty;
        Identity = identity ?? string.Empty;
        ModelId = modelId ?? string.Empty;
        SkillIds = skillIds ?? Array.Empty<string>();
        WorkflowIds = workflowIds ?? Array.Empty<string>();
        ToolIds = toolIds ?? Array.Empty<string>();
        McpIds = mcpIds ?? Array.Empty<string>();
        ContextWindowTokens = contextWindowTokens;
        CompactionStrategy = compactionStrategy;
    }
}
