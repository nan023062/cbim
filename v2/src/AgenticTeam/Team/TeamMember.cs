using System;
using CBIM;

#nullable enable

namespace CBIMTeam;

/// <summary>
/// Team 成员描述符——持有成员的角色标识和对应的 Cbim 实例。
/// </summary>
public sealed class TeamMember : IDisposable
{
    public string Id { get; }

    /// <summary>成员角色（如 "architect"、"developer"）。</summary>
    public string Role { get; }

    /// <summary>该成员的专属 Cbim 实例。</summary>
    public Cbim Os { get; }

    public TeamMember(string id, string role, Cbim os)
    {
        Id = id;
        Role = role;
        Os = os;
    }

    public void Dispose() => Os.Dispose();
}
