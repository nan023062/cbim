using System.Collections.Generic;

#nullable enable

namespace CBIMTeam
{
    /// <summary>
    /// Project 配置描述符——声明 Project 的基本信息、多 Workspace 根路径及关联 Team。
    /// </summary>
    public sealed class ProjectDescription
    {
        public string Id { get; }
        public string Name { get; }

        /// <summary>多 Workspace 根目录列表。</summary>
        public IReadOnlyList<string> WorkspacePaths { get; }

        /// <summary>关联 Team 的 Id（可选）。</summary>
        public string? TeamId { get; }

        public ProjectDescription(string id, string name, IReadOnlyList<string> workspacePaths, string? teamId = null)
        {
            Id             = id;
            Name           = name;
            WorkspacePaths = workspacePaths;
            TeamId         = teamId;
        }
    }
}
