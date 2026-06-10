using System;
using System.Collections.Generic;
using CBIMTeam;

#nullable enable

namespace CBIMTeam
{
    /// <summary>
    /// AgenticProject — 多 Workspace 数据管理容器，持有关联的 AgenticTeam。
    ///
    /// <para>使用方式：
    /// <code>
    /// var project = AgenticProject.Create(description, team);
    /// // ... 使用 project.WorkspacePaths / project.Team
    /// project.Dispose();
    /// </code>
    /// </para>
    /// </summary>
    public sealed class AgenticProject : IDisposable
    {
        public ProjectDescription Description { get; }

        /// <summary>关联的 AgenticTeam 实例。</summary>
        public AgenticTeam Team { get; }

        /// <summary>多个 Workspace 根路径（来自 <see cref="ProjectDescription.WorkspacePaths"/>）。</summary>
        public IReadOnlyList<string> WorkspacePaths { get; }

        private AgenticProject(ProjectDescription description, AgenticTeam team)
        {
            Description    = description;
            Team           = team;
            WorkspacePaths = description.WorkspacePaths;
        }

        /// <summary>
        /// 按 <paramref name="description"/> 和已有 <paramref name="team"/> 创建 AgenticProject。
        /// </summary>
        public static AgenticProject Create(ProjectDescription description, AgenticTeam team)
        {
            if (description == null) throw new ArgumentNullException(nameof(description));
            if (team == null)        throw new ArgumentNullException(nameof(team));

            return new AgenticProject(description, team);
        }

        public void Dispose() { }
    }
}
