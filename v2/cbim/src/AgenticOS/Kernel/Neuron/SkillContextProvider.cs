using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CBIM.Skills;
using Microsoft.Agents.AI;

namespace CBIM.Mind;

/// <summary>
/// 将当前 Brain 配置的 Skill 列表注入到 LLM 系统提示。
///
/// <para>在每次 LLM 调用前（<see cref="AIContextProvider.ProvideAIContextAsync"/>），
/// 从 <see cref="FileSkillStore"/> 按构造期传入的 <see cref="_skillIds"/> 查询
/// <see cref="SkillDescriptor"/>，并将 <c>Name + Content</c>（Content 为空时降级用
/// Description）拼成结构化指令追加到 <see cref="AIContext.Instructions"/>，
/// 使 LLM 知悉当前可用的 Skill 集合。</para>
///
/// <para>空 Skill 列表时返回空 <see cref="AIContext"/>（不写 Instructions），不报错。</para>
///
/// <para>集成方式：在 <c>ChatClientAgentOptions.AIContextProviders</c> 列表中添加此实例。</para>
/// </summary>
public sealed class SkillContextProvider : AIContextProvider
{
    private readonly FileSkillStore _skillStore;
    private readonly IReadOnlyList<string> _skillIds;

    /// <summary>
    /// 构造 SkillContextProvider。
    /// </summary>
    /// <param name="skillStore">技能仓储，用于按 Id 查询 SkillDescriptor。</param>
    /// <param name="skillIds">当前 Brain 配置的 Skill Id 列表。空列表合法（注入空 context）。</param>
    public SkillContextProvider(FileSkillStore skillStore, IReadOnlyList<string> skillIds)
    {
        _skillStore = skillStore ?? throw new ArgumentNullException(nameof(skillStore));
        _skillIds = skillIds ?? throw new ArgumentNullException(nameof(skillIds));
    }

    /// <inheritdoc/>
    protected override ValueTask<AIContext> ProvideAIContextAsync(
        InvokingContext context, CancellationToken cancellationToken = default)
    {
        if (_skillIds.Count == 0)
            return new ValueTask<AIContext>(new AIContext());

        var sb = new StringBuilder();
        sb.AppendLine("Available skills:");

        int written = 0;
        for (int i = 0; i < _skillIds.Count; i++)
        {
            var id = _skillIds[i];
            if (string.IsNullOrWhiteSpace(id))
                continue;

            SkillDescriptor skill = _skillStore.Get(id);
            if (skill == null)
                continue;

            sb.Append("- ").Append(skill.Name).Append(": ");

            // 优先用 Content（SKILL.md 正文）；为空时降级到 Description（一句话摘要）。
            string body = string.IsNullOrWhiteSpace(skill.Content)
                ? skill.Description
                : skill.Content;
            sb.AppendLine(body);

            written++;
        }

        if (written == 0)
            return new ValueTask<AIContext>(new AIContext());

        return new ValueTask<AIContext>(new AIContext
        {
            Instructions = sb.ToString(),
        });
    }
}
