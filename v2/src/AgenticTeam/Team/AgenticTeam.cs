using System;
using System.Collections.Generic;
using CBIM;

#nullable enable

namespace CBIMTeam;

/// <summary>
/// AgenticTeam — 管理多个 Cbim 实例，维护组织成员关系。
///
/// <para>使用方式：
/// <code>
/// var team = AgenticTeam.Create(description);
/// var member = team.GetMember("architect");
/// team.Dispose();
/// </code>
/// </para>
/// </summary>
public sealed class AgenticTeam : IDisposable
{
    private readonly Dictionary<string, TeamMember> _members;
    private readonly object _lock = new object();

    public TeamDescription Description { get; }
    public IReadOnlyList<TeamMember> Members
    {
        get
        {
            lock (_lock)
            {
                return new List<TeamMember>(_members.Values);
            }
        }
    }

    private AgenticTeam(TeamDescription description, Dictionary<string, TeamMember> members)
    {
        Description = description;
        _members = members;
    }

    /// <summary>
    /// 按 <paramref name="description"/> 创建 AgenticTeam，并为每个
    /// <see cref="TeamMemberDescription"/> 初始化对应的 Cbim 实例。
    /// </summary>
    public static AgenticTeam Create(TeamDescription description)
    {
        if (description == null)
            throw new ArgumentNullException(nameof(description));

        var members = new Dictionary<string, TeamMember>();
        foreach (var memberDesc in description.MemberDescriptions)
        {
            var os = Cbim.Create(memberDesc.OsOptions);
            var member = new TeamMember(memberDesc.Id, memberDesc.Role, os);
            members[memberDesc.Id] = member;
        }

        return new AgenticTeam(description, members);
    }

    #region 成员管理

    /// <summary>向 Team 动态添加一个成员（初始化其 Cbim 实例）。</summary>
    public TeamMember AddMember(TeamMemberDescription description)
    {
        if (description == null)
            throw new ArgumentNullException(nameof(description));

        var os = Cbim.Create(description.OsOptions);
        var member = new TeamMember(description.Id, description.Role, os);

        lock (_lock)
        {
            _members[description.Id] = member;
        }

        return member;
    }

    /// <summary>移除并释放指定 Id 的成员。Id 不存在时静默忽略。</summary>
    public void RemoveMember(string memberId)
    {
        if (string.IsNullOrWhiteSpace(memberId))
            return;

        TeamMember? member = null;
        lock (_lock)
        {
            if (_members.TryGetValue(memberId, out member))
                _members.Remove(memberId);
        }

        member?.Dispose();
    }

    /// <summary>按 Id 查找成员。找不到返回 null。</summary>
    public TeamMember? GetMember(string memberId)
    {
        if (string.IsNullOrWhiteSpace(memberId))
            return null;
        lock (_lock)
        {
            return _members.TryGetValue(memberId, out var m) ? m : null;
        }
    }

    #endregion

    #region 生命周期

    /// <summary>释放所有成员持有的 Cbim 实例。</summary>
    public void Dispose()
    {
        List<TeamMember> snapshot;
        lock (_lock)
        {
            snapshot = new List<TeamMember>(_members.Values);
            _members.Clear();
        }

        foreach (var member in snapshot)
        {
            member.Dispose();
        }
    }

    #endregion
}
