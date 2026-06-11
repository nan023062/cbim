using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.Extensions.AI;

namespace CBIM.Workspace
{
    /// <summary>
    /// WorkspaceSystem——CBIM 工作区子系统。
    ///
    /// <para>统一持有「静态侧」与「动态侧」（Q6 合并旧 <c>Workspace</c> 与 <c>WorkspaceSystem</c>）：
    /// <list type="bullet">
    /// <item><b>RootPath</b> + 按权限分层的 DNA AITool 列表（供各脑区取用）；</item>
    /// <item><b>ModuleDescription 注册表</b>（Q7：构造期由 <see cref="DiscoverModules"/> 扫描
    /// <see cref="RootPath"/> 之下所有 <c>.dna/</c> 目录自动发现）；</item>
    /// <item><b>活动 Module 实例表</b>（任务派发期 OpenInstance / CloseInstance）。</item>
    /// </list></para>
    ///
    /// <para>类比：办公室管理员 + 工位调度。
    ///   - 静态：维护「公司有哪些办公位」（ModuleDescription 注册表）
    ///   - 动态：派工时「激活某个工位给本任务用」（OpenInstance）和「用完释放」（CloseInstance）</para>
    ///
    /// <para>与 AgenticOS 完全对偶——AgenticOS 管「人」（AgentDescription），
    /// WorkspaceSystem 管「工位」（ModuleDescription）；区别在重量：
    /// Module 远轻量，纯激活记录。</para>
    /// </summary>
    public sealed class WorkspaceSystem
    {
        /// <summary>工作区根路径（绝对路径）。</summary>
        public string RootPath { get; }

        /// <summary>只读 DNA 工具集——供 PrefrontalCortex / MotorCortex 等使用（Hippocampus 由 Brain 层屏蔽）。</summary>
        public IReadOnlyList<AITool> ReadOnlyDnaTools { get; }

        /// <summary>读写 DNA 工具集——仅供 ParietalLobe 使用。</summary>
        public IReadOnlyList<AITool> ReadWriteDnaTools { get; }

        private readonly Dictionary<string, ModuleDescription> _descriptions;
        private readonly Dictionary<string, Module> _activeInstances;
        private readonly object _instancesLock = new object();

        /// <summary>
        /// 默认构造——根据 <paramref name="rootPath"/> 扫描 <c>.dna/</c> 自动发现 ModuleDescription。
        /// 适用于绝大多数生产场景：知识库即模块清单。
        /// </summary>
        /// <param name="rootPath">工作区根路径，由 AgenticOS 在初始化时传入。</param>
        public WorkspaceSystem(string rootPath)
            : this(rootPath, descriptions: null)
        {
        }

        /// <summary>
        /// 完整构造——允许覆盖 ModuleDescription 注册表（测试 / 嵌入式场景使用）。
        /// 当 <paramref name="descriptions"/> 为 null 时退化为自动发现。
        /// </summary>
        public WorkspaceSystem(string rootPath, IEnumerable<ModuleDescription> descriptions)
        {
            if (string.IsNullOrWhiteSpace(rootPath))
                throw new ArgumentException("rootPath 不能为空", nameof(rootPath));

            RootPath          = rootPath;
            ReadOnlyDnaTools  = DnaToolProvider.GetReadOnlyTools(rootPath);
            ReadWriteDnaTools = DnaToolProvider.GetReadWriteTools(rootPath);

            _descriptions    = new Dictionary<string, ModuleDescription>(StringComparer.Ordinal);
            _activeInstances = new Dictionary<string, Module>(StringComparer.Ordinal);

            var seed = descriptions ?? DiscoverModules(rootPath);
            foreach (var d in seed)
            {
                if (d == null) continue;
                if (_descriptions.ContainsKey(d.Id))
                    throw new ArgumentException($"ModuleDescription.Id 重复：{d.Id}");
                _descriptions[d.Id] = d;
            }
        }

#region 静态侧：ModuleDescription 注册表

        /// <summary>列出全部已注册的 ModuleDescription。</summary>
        public IReadOnlyList<ModuleDescription> ListDescriptions()
        {
            return new List<ModuleDescription>(_descriptions.Values);
        }

        /// <summary>按 Id 找 ModuleDescription。找不到返 null。</summary>
        public ModuleDescription GetDescription(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            return _descriptions.TryGetValue(id, out var d) ? d : null;
        }

        /// <summary>判断指定 Id 的 ModuleDescription 是否已注册。</summary>
        public bool ContainsDescription(string id) =>
            !string.IsNullOrWhiteSpace(id) && _descriptions.ContainsKey(id);

#endregion

#region 动态侧：Module 实例生命周期

        /// <summary>
        /// 激活一个 Module：把 ModuleDescription 绑定到具体工作区根路径。
        /// 不做任何 IO 操作——纯数据组装。
        /// </summary>
        public Module OpenInstance(
            string descriptionId,
            string workspaceRoot,
            string activatedByTaskId = null)
        {
            var desc = GetDescription(descriptionId);
            if (desc == null)
                throw new ArgumentException($"未找到 ModuleDescription: {descriptionId}", nameof(descriptionId));

            if (string.IsNullOrWhiteSpace(workspaceRoot))
                throw new ArgumentException("workspaceRoot 不能为空", nameof(workspaceRoot));

            var instanceId = Guid.NewGuid().ToString();
            var instance = new Module(
                instanceId: instanceId,
                description: desc,
                workspaceRoot: workspaceRoot,
                activatedByTaskId: activatedByTaskId);

            lock (_instancesLock)
            {
                _activeInstances[instanceId] = instance;
            }

            return instance;
        }

        /// <summary>关闭一个 Module 实例：从活动表移除。无外部资源需关。</summary>
        public void CloseInstance(Module instance)
        {
            if (instance == null) return;
            lock (_instancesLock)
            {
                _activeInstances.Remove(instance.InstanceId);
            }
        }

        /// <summary>列出当前活动中的 Module 实例。</summary>
        public IReadOnlyList<Module> ListActiveInstances()
        {
            lock (_instancesLock)
            {
                return new List<Module>(_activeInstances.Values);
            }
        }

        /// <summary>按 InstanceId 查活动实例。找不到返 null。</summary>
        public Module GetActiveInstance(string instanceId)
        {
            if (string.IsNullOrWhiteSpace(instanceId)) return null;
            lock (_instancesLock)
            {
                return _activeInstances.TryGetValue(instanceId, out var i) ? i : null;
            }
        }

#endregion

#region .dna/ 自动发现

        /// <summary>
        /// 扫描 <paramref name="rootPath"/> 之下所有 <c>.dna/</c> 目录，逐一构建 ModuleDescription。
        ///
        /// <para>规则：
        /// <list type="bullet">
        /// <item>每个 <c>.dna</c> 目录的父目录视为一个模块根；</item>
        /// <item>模块 Id = 父目录相对 root 的路径，规范化为正斜杠（例 <c>"src/combat"</c>），
        ///       根目录直接持 <c>.dna</c> 时 Id = <c>"."</c>；</item>
        /// <item>模块 Name = 模块根目录最末一级名（例 <c>"combat"</c>），根 = <c>"&lt;root&gt;"</c>；</item>
        /// <item>Metadata = <see cref="LocalModuleMetadata"/> 指向 <c>module.md</c>（即便缺失也注册描述符）。</item>
        /// </list></para>
        ///
        /// <para>模块 Id 由路径推导，不读 module.md frontmatter——与 v1 Python 内核保持一致
        /// （v1 同样以路径为键）。frontmatter 中的 <c>name</c> 字段是面向人类阅读的标签，
        /// 而非寻址主键；路径作为唯一键更稳定（文件系统不允许重复路径，frontmatter 可能漂移 / 撞名）。</para>
        /// </summary>
        public static IEnumerable<ModuleDescription> DiscoverModules(string rootPath)
        {
            if (string.IsNullOrWhiteSpace(rootPath)) yield break;
            string rootFull = Path.GetFullPath(rootPath);
            if (!Directory.Exists(rootFull)) yield break;

            foreach (var dnaDir in DnaToolProvider.EnumerateDnaDirs(rootFull))
            {
                string moduleDir = Path.GetDirectoryName(dnaDir);
                if (string.IsNullOrEmpty(moduleDir)) continue;

                string id = MakeRelative(rootFull, moduleDir);
                string name = string.Equals(id, ".", StringComparison.Ordinal)
                    ? "<root>"
                    : Path.GetFileName(moduleDir);

                string moduleMdPath = Path.Combine(dnaDir, "module.md");
                ModuleMetadata metadata = new LocalModuleMetadata(moduleMdPath);

                yield return new ModuleDescription(
                    id: id,
                    name: string.IsNullOrWhiteSpace(name) ? id : name,
                    metadata: metadata);
            }
        }

        private static string MakeRelative(string root, string full)
        {
            string rootFull = Path.GetFullPath(root);
            string targetFull = Path.GetFullPath(full);
            if (targetFull.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase))
            {
                string rel = targetFull.Substring(rootFull.Length)
                    .TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                return rel.Length == 0 ? "." : rel.Replace(Path.DirectorySeparatorChar, '/');
            }
            return targetFull;
        }

#endregion
    }
}
