using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
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
        /// <summary>
        /// 工作区根路径（绝对路径）。
        /// </summary>
        public string RootPath { get; }

        /// <summary>
        /// 只读 DNA 工具集——供 PrefrontalCortex / MotorCortex 等使用（Hippocampus 由 Brain 层屏蔽）。
        /// </summary>
        public IReadOnlyList<AITool> ReadOnlyDnaTools { get; }

        /// <summary>
        /// 读写 DNA 工具集——仅供 ParietalLobe 使用。
        /// </summary>
        public IReadOnlyList<AITool> ReadWriteDnaTools { get; }

        private readonly Dictionary<string, ModuleDescription> _descriptions;
        private readonly Dictionary<string, Module> _activeInstances;
        private readonly object _instancesLock = new object();

        /// <summary>
        /// 默认构造——根据 <paramref name="rootPath"/> 扫描 <c>.dna/</c> 自动发现 ModuleDescription。
        /// 适用于绝大多数生产场景：知识库即模块清单。
        /// </summary>
        /// <param name="rootPath">
        /// 工作区根路径，由 AgenticOS 在初始化时传入。
        /// </param>
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

            RootPath = rootPath;
            ReadOnlyDnaTools = DnaToolProvider.GetReadOnlyTools(rootPath);

            _descriptions = new Dictionary<string, ModuleDescription>(StringComparer.Ordinal);
            _activeInstances = new Dictionary<string, Module>(StringComparer.Ordinal);

            // ReadWriteDnaTools 需要 WorkspaceSystem 引用（写工具回调到本类的 Dna* 方法）——
            // 在 _descriptions 初始化之后构造，但不依赖 seed 内容，故顺序无虞。
            ReadWriteDnaTools = DnaToolProvider.GetReadWriteTools(this);

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

        /// <summary>
        /// 列出全部已注册的 ModuleDescription。
        /// </summary>
        public IReadOnlyList<ModuleDescription> ListDescriptions()
        {
            return new List<ModuleDescription>(_descriptions.Values);
        }

        /// <summary>
        /// 按 Id 找 ModuleDescription。找不到返 null。
        /// </summary>
        public ModuleDescription GetDescription(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            return _descriptions.TryGetValue(id, out var d) ? d : null;
        }

        /// <summary>
        /// 判断指定 Id 的 ModuleDescription 是否已注册。
        /// </summary>
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

        /// <summary>
        /// 关闭一个 Module 实例：从活动表移除。无外部资源需关。
        /// </summary>
        public void CloseInstance(Module instance)
        {
            if (instance == null) return;
            lock (_instancesLock)
            {
                _activeInstances.Remove(instance.InstanceId);
            }
        }

        /// <summary>
        /// 列出当前活动中的 Module 实例。
        /// </summary>
        public IReadOnlyList<Module> ListActiveInstances()
        {
            lock (_instancesLock)
            {
                return new List<Module>(_activeInstances.Values);
            }
        }

        /// <summary>
        /// 按 InstanceId 查活动实例。找不到返 null。
        /// </summary>
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

        #region DNA 写 CRUD（init / edit / split / deprecate / reindex）

        // 工作区根 + .dna 写工具的统一入口。设计为 Option A：直接挂在 WorkspaceSystem 上，
        // 不抽 IDnaService——KISS。所有方法对偶 v1 Python knowledge_service.py。
        //
        // 不变量：
        //   - 沙箱：所有目标路径 ResolveAndGuard 校验在 RootPath 之下；
        //   - 原子写：UTF-8 no BOM；写 .tmp 后 File.Move(overwrite:true)；
        //   - frontmatter：手写解析/渲染（DnaFrontmatter），与 read 侧对称；
        //   - 注册表：结构变化（init / split / deprecate / reindex）后调用 ReseedDescriptions，
        //     在 _instancesLock 守护下原子替换 _descriptions 内容；
        //   - 命名：模块 Id = kebab 风格相对路径（正斜杠）；非法 / 越界路径直接抛。

        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

        private static readonly string[] LeafBodyTemplate =
        {
            "",
            "## Positioning",
            "",
            "<!-- One sentence: what this module is and why it exists. -->",
            "",
            "## Class Diagram",
            "",
            "```mermaid",
            "classDiagram",
            "    %% classes, interfaces, key method signatures, relationships",
            "```",
            "",
            "## Key Decisions",
            "",
            "<!-- Design choices whose \"why\" is invisible from the code itself. -->",
            "",
        };

        private static readonly string[] ParentBodyTemplate =
        {
            "",
            "## Positioning",
            "",
            "<!-- One sentence: what this module is and why it exists. -->",
            "",
            "## Class Diagram",
            "",
            "```mermaid",
            "classDiagram",
            "    %% Each class node = one sub-module (use <<module>> stereotype).",
            "```",
            "",
            "## Key Decisions",
            "",
            "<!-- Cross-sub-module emergent insights only. -->",
            "",
        };

        private static readonly string[] SectionModes = { "replace", "append", "insert-after", "delete" };

        /// <summary>
        /// 初始化一个新 DNA 模块。在 <paramref name="modulePath"/> 下创建 <c>.dna/module.md</c>
        /// （可选 <c>.dna/contract.md</c>），写入合法 frontmatter，并刷新模块注册表。
        ///
        /// <para>kind 必须为 <c>root|parent|leaf</c>；status 留空时按 kind 推默认（root → implemented，其余 spec）。</para>
        /// </summary>
        /// <returns>
        /// 新建的 .dna/ 目录绝对路径。
        /// </returns>
        public string DnaInit(string modulePath, string kind, string name, string owner,
                              string description = "", bool withContract = false, string status = "")
        {
            if (string.IsNullOrWhiteSpace(modulePath))
                throw new ArgumentException("modulePath 不能为空", nameof(modulePath));
            if (string.IsNullOrWhiteSpace(name))
                throw new ArgumentException("name 不能为空", nameof(name));
            if (string.IsNullOrWhiteSpace(owner))
                throw new ArgumentException("owner 不能为空", nameof(owner));
            if (Array.IndexOf(DnaFrontmatter.KindValues, kind) < 0)
                throw new ArgumentException(
                    $"kind 必须为 {{root, parent, leaf}} 之一；得到：{kind}", nameof(kind));

            string finalStatus = string.IsNullOrWhiteSpace(status)
                ? (kind == "root" ? "implemented" : "spec")
                : status;
            if (Array.IndexOf(DnaFrontmatter.StatusValues, finalStatus) < 0)
                throw new ArgumentException(
                    $"status 必须为 {{spec, planned, implemented}} 之一；得到：{finalStatus}", nameof(status));

            string moduleDir = ResolveAndGuard(modulePath);
            string dnaDir = Path.Combine(moduleDir, ".dna");
            if (Directory.Exists(dnaDir))
                throw new IOException($".dna 已存在：{dnaDir}");

            var meta = new Dictionary<string, object>(StringComparer.Ordinal)
            {
                { "name", name },
                { "owner", owner },
                { "kind", kind },
                { "status", finalStatus },
            };
            if (!string.IsNullOrEmpty(description)) meta["description"] = description;
            meta["keywords"] = new List<object>();
            meta["dependencies"] = new List<object>();
            DnaFrontmatter.ValidateMandatory(meta);

            Directory.CreateDirectory(moduleDir);
            Directory.CreateDirectory(dnaDir);

            string body = string.Join("\n",
                kind == "leaf" ? LeafBodyTemplate : ParentBodyTemplate);
            string moduleMd = DnaFrontmatter.Render(meta) + body;
            WriteAtomic(Path.Combine(dnaDir, "module.md"), moduleMd);

            if (withContract)
            {
                string contractText = $"# {name} — Contract\n\n## Interfaces\n\n## Events\n";
                WriteAtomic(Path.Combine(dnaDir, "contract.md"), contractText);
            }

            ReseedDescriptions();
            return Path.GetFullPath(dnaDir);
        }

        /// <summary>
        /// 编辑现有 DNA 模块。target ∈ frontmatter|body|section|contract|contract-section|workflow。
        /// payload 字段语义对偶 v1 Python <c>edit_module</c>。
        /// </summary>
        /// <returns>
        /// 被写入的目标文件绝对路径。
        /// </returns>
        public string DnaEdit(string modulePath, string target,
                              IReadOnlyDictionary<string, object> payload, string mode = "replace")
        {
            if (string.IsNullOrWhiteSpace(modulePath))
                throw new ArgumentException("modulePath 不能为空", nameof(modulePath));
            if (string.IsNullOrWhiteSpace(target))
                throw new ArgumentException("target 不能为空", nameof(target));
            if (payload == null)
                throw new ArgumentException("payload 不能为 null", nameof(payload));

            string moduleDir = ResolveAndGuard(modulePath);
            string dnaDir = Path.Combine(moduleDir, ".dna");
            if (!Directory.Exists(dnaDir))
                throw new DirectoryNotFoundException($".dna 不存在：{dnaDir}（请先 DnaInit）");

            string moduleMd = Path.Combine(dnaDir, "module.md");
            string contractMd = Path.Combine(dnaDir, "contract.md");

            switch (target)
            {
                case "frontmatter":
                    return EditFrontmatter(moduleMd, payload);
                case "body":
                    return EditBody(moduleMd, payload);
                case "section":
                    return EditSection(moduleMd, payload, mode);
                case "contract":
                    return EditContract(contractMd, payload);
                case "contract-section":
                    EnsureContract(contractMd);
                    return EditSection(contractMd, payload, mode);
                case "workflow":
                    return EditWorkflow(dnaDir, payload);
                default:
                    throw new ArgumentException($"未知 target：{target}", nameof(target));
            }
        }

        /// <summary>
        /// 把源模块按 H2 标题拆分为新的 N 个 leaf 模块。
        ///
        /// <para>strategy:
        /// <list type="bullet">
        /// <item><c>"comment"</c>（默认）：源模块 body 保留区段，标题下方注入 <c>&lt;!-- split: moved ... --&gt;</c> 注释；</item>
        /// <item><c>"move"</c>：源模块 body 中删除区段。</item>
        /// </list></para>
        ///
        /// <para>原子性：所有校验在 IO 之前完成；任何 IO 失败时尽力回滚已建目录。
        /// 对偶 v1 Python <c>split_module</c>。依赖反向引用扫描结果包含在 <see cref="SplitResult.DependencyRefs"/>
        /// 中——本命令不修改其它模块的 frontmatter。</para>
        /// </summary>
        public SplitResult DnaSplit(string sourceModulePath, IReadOnlyList<SplitSpec> splits,
                                    string strategy = "comment")
        {
            if (string.IsNullOrWhiteSpace(sourceModulePath))
                throw new ArgumentException("sourceModulePath 不能为空", nameof(sourceModulePath));
            if (splits == null || splits.Count == 0)
                throw new ArgumentException("splits 至少需要一个", nameof(splits));
            if (strategy != "comment" && strategy != "move")
                throw new ArgumentException($"strategy 必须为 comment|move；得到：{strategy}", nameof(strategy));
            bool keepSource = strategy == "comment";

            string sourceDir = ResolveAndGuard(sourceModulePath);
            string sourceDna = Path.Combine(sourceDir, ".dna");
            string sourceMd = Path.Combine(sourceDna, "module.md");
            if (!File.Exists(sourceMd))
                throw new FileNotFoundException($"源模块缺少 .dna/module.md：{sourceMd}");

            string sourceRaw = File.ReadAllText(sourceMd, Utf8NoBom);
            var sourceMeta = DnaFrontmatter.Parse(sourceRaw);
            string sourceBody = DnaFrontmatter.StripFrontmatter(sourceRaw);
            string sourceOwner = sourceMeta.TryGetValue("owner", out var ov) ? ov?.ToString() ?? "" : "";
            string sourceRel = MakeRelative(RootPath, sourceDir);

            // -- 1. 校验 splits + 计算 normHeadings --
            var requestedHeadings = new List<string>();
            var normSplits = new List<(string Path, string Name, List<string> Headings, string Owner, string Description)>();
            foreach (var spec in splits)
            {
                string targetDir = ResolveAndGuard(spec.Path);
                if (Directory.Exists(Path.Combine(targetDir, ".dna")))
                    throw new IOException($"目标模块已含 .dna/：{targetDir}");

                var normHeadings = new List<string>();
                foreach (var h in spec.Headings)
                {
                    string hh = h.Trim();
                    if (hh.StartsWith("## ", StringComparison.Ordinal)) hh = hh.Substring(3).Trim();
                    else if (hh.StartsWith("##", StringComparison.Ordinal)) hh = hh.Substring(2).Trim();
                    normHeadings.Add(hh);
                    requestedHeadings.Add(hh);
                }
                normSplits.Add((
                    Path: targetDir,
                    Name: spec.Name,
                    Headings: normHeadings,
                    Owner: string.IsNullOrEmpty(spec.Owner) ? sourceOwner : spec.Owner,
                    Description: spec.Description));
            }

            var seenHeadings = new HashSet<string>(StringComparer.Ordinal);
            foreach (var h in requestedHeadings)
            {
                if (!seenHeadings.Add(h))
                    throw new ArgumentException($"标题 '{h}' 被多个拆分目标同时声明");
            }

            // -- 2. 校验 H2 标题在源 body 中存在 --
            var sections = DnaFrontmatter.SplitSections(sourceBody);
            var h2Index = new Dictionary<string, DnaFrontmatter.Section>(StringComparer.Ordinal);
            foreach (var s in sections)
                if (s.Level == 2) h2Index[s.Heading] = s;
            var missing = requestedHeadings.Where(h => !h2Index.ContainsKey(h)).ToList();
            if (missing.Count > 0)
                throw new InvalidOperationException(
                    $"源模块缺少必备 H2 标题：[{string.Join(", ", missing)}]");

            // -- 3. 抽取每个标题对应的行块 --
            var bodyLines = DnaFrontmatter.ToLineList(sourceBody);
            var extracted = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (var h in requestedHeadings)
            {
                var sec = h2Index[h];
                extracted[h] = bodyLines.GetRange(sec.Start, sec.End - sec.Start);
            }

            // -- 4. 改写源 body --
            var newSourceLines = new List<string>(bodyLines);
            var headingToDest = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var s in normSplits)
            {
                string destRel = MakeRelative(RootPath, s.Path);
                foreach (var h in s.Headings) headingToDest[h] = destRel;
            }

            // 自下向上处理，避免索引漂移
            var orderedSecs = requestedHeadings
                .Select(h => (Heading: h, Sec: h2Index[h]))
                .OrderByDescending(t => t.Sec.Start)
                .ToList();
            if (keepSource)
            {
                foreach (var (h, sec) in orderedSecs)
                {
                    string comment = $"<!-- split: moved '{h}' -> {headingToDest[h]} -->";
                    newSourceLines.Insert(sec.Start + 1, comment);
                }
            }
            else
            {
                foreach (var (_, sec) in orderedSecs)
                {
                    newSourceLines.RemoveRange(sec.Start, sec.End - sec.Start);
                }
            }

            while (newSourceLines.Count > 0 && newSourceLines[newSourceLines.Count - 1].Trim().Length == 0)
                newSourceLines.RemoveAt(newSourceLines.Count - 1);
            string newSourceBody = newSourceLines.Count == 0 ? "" : string.Join("\n", newSourceLines) + "\n";

            var (sourceFmBlock, _) = DnaFrontmatter.Split(sourceRaw);
            string newSourceText = sourceFmBlock.Length > 0
                ? sourceFmBlock + "\n" + newSourceBody
                : newSourceBody;

            // -- 5. 扫描反向依赖引用 --
            var depRefs = ScanDependencyRefs(sourceRel);

            // -- 6. 执行：先把源 .tmp 落盘；再为每个 split 调 DnaInit + 写 body；最后原子替换源
            string sourceTmp = sourceMd + ".tmp";
            try
            {
                File.WriteAllText(sourceTmp, newSourceText, Utf8NoBom);
            }
            catch
            {
                TryDelete(sourceTmp);
                throw;
            }

            var createdDnaDirs = new List<string>();
            var createdPaths = new List<string>();
            try
            {
                foreach (var s in normSplits)
                {
                    string relPath = MakeRelative(RootPath, s.Path);
                    DnaInit(relPath, "leaf", s.Name, s.Owner, s.Description, withContract: false, status: "spec");
                    string dnaDir = Path.Combine(s.Path, ".dna");
                    createdDnaDirs.Add(dnaDir);

                    var bodyChunks = new List<string>();
                    foreach (var h in s.Headings)
                        bodyChunks.Add(string.Join("\n", extracted[h]));
                    string newBody = string.Join("\n\n", bodyChunks) + "\n";
                    var bodyPayload = new Dictionary<string, object>(StringComparer.Ordinal)
                    {
                        { "content", newBody },
                    };
                    DnaEdit(relPath, "body", bodyPayload);
                    createdPaths.Add(Path.Combine(dnaDir, "module.md"));
                }
                // 原子替换源——同 WriteAtomic 一样走 File.Replace fallback（4.7.1 无 3-arg Move）。
                if (File.Exists(sourceMd))
                    File.Replace(sourceTmp, sourceMd, destinationBackupFileName: null);
                else
                    File.Move(sourceTmp, sourceMd);
            }
            catch
            {
                TryDelete(sourceTmp);
                foreach (var d in createdDnaDirs)
                    TryDeleteDir(d);
                ReseedDescriptions();
                throw;
            }

            ReseedDescriptions();
            return new SplitResult(createdPaths, depRefs);
        }

        /// <summary>
        /// 弃用模块——把 <c>.dna/</c> 重命名为 <c>.dna.archived/</c>，并刷新注册表。
        /// 不动业务代码。如果已存在 <c>.dna.archived/</c> 就抛——不覆盖历史归档。
        /// </summary>
        public void DnaDeprecate(string modulePath)
        {
            if (string.IsNullOrWhiteSpace(modulePath))
                throw new ArgumentException("modulePath 不能为空", nameof(modulePath));

            string moduleDir = ResolveAndGuard(modulePath);
            string dnaDir = Path.Combine(moduleDir, ".dna");
            string archived = Path.Combine(moduleDir, ".dna.archived");

            if (!Directory.Exists(dnaDir))
                throw new DirectoryNotFoundException($".dna 不存在：{dnaDir}");
            if (Directory.Exists(archived))
                throw new IOException($".dna.archived 已存在，拒绝覆盖：{archived}");

            Directory.Move(dnaDir, archived);
            ReseedDescriptions();
        }

        /// <summary>
        /// 重扫工作区，重建 <see cref="_descriptions"/>。如果根目录持 root 模块，
        /// 在工作区根写一份 <c>index.md</c>（列出全部已注册模块路径）。
        ///
        /// <para>注意：不写 <c>.cbim/index.md</c>——CBIM 内核目录对 LLM 工具不可见，
        /// 这里维护的是工作区可见的"模块清单文档"。</para>
        /// </summary>
        public void DnaReindex()
        {
            ReseedDescriptions();

            // 仅当根目录持 .dna/ 时才写顶层 index.md（即"有 root 模块"语义）。
            string rootDna = Path.Combine(RootPath, ".dna");
            if (!Directory.Exists(rootDna)) return;

            var paths = new List<string>();
            foreach (var d in _descriptions.Values)
                paths.Add(d.Id);
            paths.Sort(StringComparer.Ordinal);

            var sb = new StringBuilder();
            sb.Append("# Module Index\n\n");
            foreach (var p in paths)
                sb.Append("- ").Append(p).Append('\n');
            WriteAtomic(Path.Combine(RootPath, "index.md"), sb.ToString());
        }

        // -------- 私有辅助 --------

        /// <summary>
        /// 把 <paramref name="modulePath"/> 解析为绝对路径，并校验在 RootPath 之下。
        /// </summary>
        private string ResolveAndGuard(string modulePath)
        {
            string full = Path.IsPathRooted(modulePath)
                ? Path.GetFullPath(modulePath)
                : Path.GetFullPath(Path.Combine(RootPath, modulePath));
            if (!IsWithinRoot(full))
                throw new UnauthorizedAccessException(
                    $"modulePath 越出工作区根：{modulePath}");
            return full;
        }

        private bool IsWithinRoot(string candidate)
        {
            string c = Path.GetFullPath(candidate);
            string p = Path.GetFullPath(RootPath);
            if (c.Equals(p, StringComparison.OrdinalIgnoreCase)) return true;
            if (!c.StartsWith(p, StringComparison.OrdinalIgnoreCase)) return false;
            char boundary = c[p.Length];
            return boundary == Path.DirectorySeparatorChar || boundary == Path.AltDirectorySeparatorChar;
        }

        private void ReseedDescriptions()
        {
            var fresh = new List<ModuleDescription>(DiscoverModules(RootPath));
            lock (_instancesLock)
            {
                _descriptions.Clear();
                foreach (var d in fresh)
                {
                    if (d == null) continue;
                    _descriptions[d.Id] = d;
                }
            }
        }

        internal static void WriteAtomic(string path, string content)
        {
            string parent = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(parent) && !Directory.Exists(parent))
                Directory.CreateDirectory(parent);
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, content ?? string.Empty, Utf8NoBom);
            // Unity 目标 .NET Framework 4.7.1，无 File.Move(overwrite:true) 重载——
            // 与 Storage.FileBackend.WriteAtomic 同款 fallback：File.Replace 走原子；不存在时 File.Move。
            if (File.Exists(path))
                File.Replace(tmp, path, destinationBackupFileName: null);
            else
                File.Move(tmp, path);
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { /* 忽略 */ }
        }

        private static void TryDeleteDir(string dir)
        {
            try { if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true); } catch { /* 忽略 */ }
        }

        // -------- DnaEdit 子分支实现 --------

        private static string EditFrontmatter(string moduleMd, IReadOnlyDictionary<string, object> payload)
        {
            if (!File.Exists(moduleMd))
                throw new FileNotFoundException($"module.md 不存在：{moduleMd}");
            if (!payload.TryGetValue("field", out var fieldObj) || fieldObj == null)
                throw new ArgumentException("frontmatter 编辑需要 payload.field");
            string field = fieldObj.ToString();

            bool hasScalar = payload.TryGetValue("value", out var scalar) && scalar != null;
            bool hasList = payload.TryGetValue("value_list", out var listObj) && listObj != null;
            if (hasScalar && hasList)
                throw new ArgumentException("payload.value 与 payload.value_list 互斥");
            if (!hasScalar && !hasList)
                throw new ArgumentException("payload.value 或 payload.value_list 至少需要一个");

            object newValue;
            if (hasList)
            {
                var copied = new List<object>();
                if (listObj is System.Collections.IEnumerable enumerable && !(listObj is string))
                {
                    foreach (var item in enumerable)
                        copied.Add(item ?? string.Empty);
                }
                else
                {
                    throw new ArgumentException("payload.value_list 必须是数组类型");
                }
                if (DnaFrontmatter.ListFields.Contains(field) == false && copied.Count == 0)
                    throw new ArgumentException(
                        $"字段 '{field}' 非 list 类型，无法用空数组清空");
                newValue = copied;
            }
            else
            {
                if (DnaFrontmatter.ListFields.Contains(field))
                    throw new ArgumentException(
                        $"字段 '{field}' 是 list 类型，必须用 payload.value_list");
                newValue = scalar;
            }

            if (field == "status")
            {
                if (hasList)
                    throw new ArgumentException("'status' 是标量枚举，请用 payload.value");
                string sv = scalar?.ToString() ?? string.Empty;
                if (Array.IndexOf(DnaFrontmatter.StatusValues, sv) < 0)
                    throw new ArgumentException(
                        $"status 必须为 {{spec, planned, implemented}} 之一；得到：{sv}");
            }
            if (field == "kind")
            {
                if (hasList)
                    throw new ArgumentException("'kind' 是标量枚举，请用 payload.value");
                string kv = scalar?.ToString() ?? string.Empty;
                if (Array.IndexOf(DnaFrontmatter.KindValues, kv) < 0)
                    throw new ArgumentException(
                        $"kind 必须为 {{root, parent, leaf}} 之一；得到：{kv}");
            }

            string raw = File.ReadAllText(moduleMd, Utf8NoBom);
            var meta = DnaFrontmatter.Parse(raw);
            string body = DnaFrontmatter.StripFrontmatter(raw);
            meta[field] = newValue;
            DnaFrontmatter.ValidateMandatory(meta);

            string newText = DnaFrontmatter.Render(meta) + "\n" + body + "\n";
            WriteAtomic(moduleMd, newText);
            return Path.GetFullPath(moduleMd);
        }

        private static string EditBody(string moduleMd, IReadOnlyDictionary<string, object> payload)
        {
            if (!payload.TryGetValue("content", out var c) || c == null)
                throw new ArgumentException("body 编辑需要 payload.content");
            string content = c.ToString();

            string raw = File.Exists(moduleMd) ? File.ReadAllText(moduleMd, Utf8NoBom) : "";
            var (fmBlock, _) = DnaFrontmatter.Split(raw);
            string bodyText = content.EndsWith("\n", StringComparison.Ordinal) ? content : content + "\n";
            string newText = fmBlock.Length > 0 ? fmBlock + "\n" + bodyText : bodyText;
            WriteAtomic(moduleMd, newText);
            return Path.GetFullPath(moduleMd);
        }

        private static string EditContract(string contractMd, IReadOnlyDictionary<string, object> payload)
        {
            if (!payload.TryGetValue("content", out var c) || c == null)
                throw new ArgumentException("contract 编辑需要 payload.content");
            string content = c.ToString();
            string text = content.EndsWith("\n", StringComparison.Ordinal) ? content : content + "\n";
            WriteAtomic(contractMd, text);
            return Path.GetFullPath(contractMd);
        }

        private static void EnsureContract(string contractMd)
        {
            if (File.Exists(contractMd)) return;
            WriteAtomic(contractMd, "# Contract\n\n## Interfaces\n\n## Events\n");
        }

        private static string EditSection(string filePath, IReadOnlyDictionary<string, object> payload, string defaultMode)
        {
            if (!File.Exists(filePath))
                throw new FileNotFoundException($"目标文件不存在：{filePath}");
            if (!payload.TryGetValue("heading", out var hObj) || hObj == null)
                throw new ArgumentException("section 编辑需要 payload.heading");
            string heading = hObj.ToString();

            string secMode = (payload.TryGetValue("mode", out var mObj) && mObj is string ms && !string.IsNullOrWhiteSpace(ms))
                ? ms
                : defaultMode ?? "replace";
            if (Array.IndexOf(SectionModes, secMode) < 0)
                throw new ArgumentException($"section mode 必须 ∈ {{replace, append, insert-after, delete}}；得到：{secMode}");

            bool needsContent = secMode != "delete";
            payload.TryGetValue("content", out var contentObj);
            string content = contentObj?.ToString();
            if (needsContent && content == null)
                throw new ArgumentException("payload.content 在非 delete 模式下必填");
            if (!needsContent && content != null)
                throw new ArgumentException("payload.content 在 delete 模式下禁止");

            int level = 2;
            if (payload.TryGetValue("level", out var lvObj) && lvObj != null)
            {
                if (!int.TryParse(lvObj.ToString(), out level))
                    throw new ArgumentException("payload.level 必须是整数");
            }
            if (level < 2 || level > 3)
                throw new ArgumentException("level 必须为 2 或 3");

            bool createIfMissing = payload.TryGetValue("create_if_missing", out var cmObj)
                && cmObj is bool cm && cm;

            string raw = File.ReadAllText(filePath, Utf8NoBom);
            var (fmBlock, body) = DnaFrontmatter.Split(raw);
            var lines = DnaFrontmatter.ToLineList(body);
            var sections = DnaFrontmatter.SplitSections(body);
            var matches = sections.Where(s => s.Level == level && s.Heading == heading).ToList();

            if (matches.Count > 1)
                throw new InvalidOperationException(
                    $"区段歧义：'{heading}' (level {level}) 匹配 {matches.Count} 个；标题在文件内必须唯一");

            List<string> contentLines = needsContent
                ? DnaFrontmatter.NormalizeContentLines(content)
                : new List<string>();

            if (matches.Count == 0)
            {
                if (secMode == "delete")
                    return Path.GetFullPath(filePath); // no-op
                if (secMode == "insert-after")
                    throw new InvalidOperationException(
                        $"找不到标题：'{heading}' (level {level})——insert-after 无 create-if-missing 兜底");
                if (!createIfMissing)
                    throw new InvalidOperationException(
                        $"找不到标题：'{heading}' (level {level})——传 create_if_missing=true 即可在末尾追加");

                while (lines.Count > 0 && lines[lines.Count - 1].Trim().Length == 0)
                    lines.RemoveAt(lines.Count - 1);
                if (lines.Count > 0) lines.Add("");
                lines.Add(new string('#', level) + " " + heading);
                lines.Add("");
                lines.AddRange(contentLines);
            }
            else
            {
                var sec = matches[0];
                if (secMode == "replace")
                {
                    var replacement = new List<string> { "" };
                    replacement.AddRange(contentLines);
                    replacement.Add("");
                    lines.RemoveRange(sec.Start + 1, sec.End - (sec.Start + 1));
                    lines.InsertRange(sec.Start + 1, replacement);
                }
                else if (secMode == "append")
                {
                    var insertion = new List<string>();
                    bool tailBlank = (sec.End - 1 >= sec.Start + 1) &&
                                     lines[sec.End - 1].Trim().Length == 0;
                    if (!tailBlank) insertion.Add("");
                    insertion.AddRange(contentLines);
                    insertion.Add("");
                    lines.InsertRange(sec.End, insertion);
                }
                else if (secMode == "insert-after")
                {
                    var insertion = new List<string> { "" };
                    insertion.AddRange(contentLines);
                    insertion.Add("");
                    lines.InsertRange(sec.End, insertion);
                }
                else if (secMode == "delete")
                {
                    lines.RemoveRange(sec.Start, sec.End - sec.Start);
                    int i = sec.Start;
                    if (0 < i && i < lines.Count &&
                        lines[i - 1].Trim().Length == 0 && lines[i].Trim().Length == 0)
                    {
                        lines.RemoveAt(i);
                    }
                }
            }

            while (lines.Count > 0 && lines[0].Trim().Length == 0)
                lines.RemoveAt(0);
            string newBody = lines.Count == 0
                ? "\n"
                : string.Join("\n", lines).TrimEnd() + "\n";
            string newText = fmBlock.Length > 0 ? fmBlock + "\n" + newBody : newBody;

            WriteAtomic(filePath, newText);
            return Path.GetFullPath(filePath);
        }

        private static string EditWorkflow(string dnaDir, IReadOnlyDictionary<string, object> payload)
        {
            if (!payload.TryGetValue("name", out var nObj) || nObj == null)
                throw new ArgumentException("workflow 编辑需要 payload.name");
            string wfName = nObj.ToString();
            if (string.IsNullOrWhiteSpace(wfName))
                throw new ArgumentException("payload.name 不能为空");
            if (!payload.TryGetValue("content", out var cObj) || cObj == null)
                throw new ArgumentException("workflow 编辑需要 payload.content");
            string content = cObj.ToString();

            if (wfName.Contains("/") || wfName.Contains("\\") || wfName.Contains(".."))
                throw new ArgumentException($"非法 workflow 名：{wfName}");

            string wfDir = Path.Combine(dnaDir, "workflows", wfName);
            Directory.CreateDirectory(wfDir);
            string wfPath = Path.Combine(wfDir, "workflow.md");
            string text = content.EndsWith("\n", StringComparison.Ordinal) ? content : content + "\n";
            WriteAtomic(wfPath, text);
            return Path.GetFullPath(wfPath);
        }

        // -------- 反向依赖扫描 --------

        private List<DependencyRef> ScanDependencyRefs(string sourceRel)
        {
            var refs = new List<DependencyRef>();
            foreach (var dnaDir in DnaToolProvider.EnumerateDnaDirs(RootPath))
            {
                string mm = Path.Combine(dnaDir, "module.md");
                if (!File.Exists(mm)) continue;
                string raw;
                try { raw = File.ReadAllText(mm, Utf8NoBom); } catch { continue; }
                var meta = DnaFrontmatter.Parse(raw);
                if (!meta.TryGetValue("dependencies", out var deps)) continue;
                if (!(deps is List<object> list)) continue;

                foreach (var dep in list)
                {
                    string ds = dep?.ToString();
                    if (string.IsNullOrWhiteSpace(ds)) continue;
                    if (string.Equals(ds.Trim(), sourceRel, StringComparison.Ordinal))
                    {
                        string moduleDir = Path.GetDirectoryName(dnaDir);
                        string modRel = MakeRelative(RootPath, moduleDir);
                        refs.Add(new DependencyRef(
                            modRel, ds,
                            $"`dependencies:` lists '{sourceRel}'; consider updating to point at the new split target(s)."));
                        break;
                    }
                }
            }
            return refs;
        }

        #endregion
    }
}