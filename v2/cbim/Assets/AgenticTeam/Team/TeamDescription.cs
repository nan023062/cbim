using System.Collections.Generic;
using CBIM;

#nullable enable

namespace CBIMTeam
{
    /// <summary>
    /// Team 配置描述符——声明 Team 的基本信息和成员列表。
    /// </summary>
    public sealed class TeamDescription
    {
        public string Id { get; }
        public string Name { get; }
        public IReadOnlyList<TeamMemberDescription> MemberDescriptions { get; }

        public TeamDescription(string id, string name, IReadOnlyList<TeamMemberDescription> memberDescriptions)
        {
            Id                 = id;
            Name               = name;
            MemberDescriptions = memberDescriptions;
        }
    }

    /// <summary>
    /// 单个成员的配置描述符——包含成员 Id、角色和其专属的 AgenticOS 配置。
    /// </summary>
    public sealed class TeamMemberDescription
    {
        public string Id { get; }
        public string Role { get; }

        /// <summary>每个成员持有独立的 AgenticOS 配置（独立根路径 / MCP 配置等）。</summary>
        public CbimOptions OsOptions { get; }

        public TeamMemberDescription(string id, string role, CbimOptions osOptions)
        {
            Id        = id;
            Role      = role;
            OsOptions = osOptions;
        }
    }
}
