using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.AI;

namespace CBIM.Workspace
{
    /// <summary>
    /// DNA AITool 提供者——按读写权限返回 dna_* 工具列表。
    ///
    /// <para>权限分层：
    /// <list type="bullet">
    /// <item><see cref="GetReadWriteTools(WorkspaceSystem)"/> — 读+写（仅 ParietalLobe 调用）</item>
    /// <item><see cref="GetReadOnlyTools(string)"/> — 只读（PrefrontalCortex / MotorCortex 调用，Hippocampus 完全无 DNA 权限）</item>
    /// </list>
    /// </para>
    ///
    /// <para>实现说明：写侧（init / edit / split / deprecate / reindex）的真实落盘逻辑挂在
    /// <see cref="WorkspaceSystem"/> 的 <c>Dna*</c> 方法上（Option A：方法直接挂在类上，不抽 IDnaService）。
    /// 本提供者只做"工具描述符 + 入参解析 + 结果序列化"的薄壳。</para>
    /// </summary>
    public static class DnaToolProvider
    {
        /// <summary>
        /// 读+写 DNA 工具集（供 ParietalLobe）——返回 dna_list / dna_show 加 dna_init / dna_edit /
        /// dna_split / dna_deprecate / dna_reindex 共 7 个 AIFunction。
        /// </summary>
        public static IReadOnlyList<AITool> GetReadWriteTools(WorkspaceSystem workspace)
        {
            if (workspace == null) return Array.Empty<AITool>();

            string root = workspace.RootPath;
            var tools = new List<AITool>(7)
            {
                BuildDnaListTool(root),
                BuildDnaShowTool(root),
                BuildDnaInitTool(workspace),
                BuildDnaEditTool(workspace),
                BuildDnaSplitTool(workspace),
                BuildDnaDeprecateTool(workspace),
                BuildDnaReindexTool(workspace),
            };
            return tools;
        }

        /// <summary>
        /// 只读 DNA 工具集（供其它内置脑）。
        /// 提供 dna_list（按工作区根扫描全部 <c>.dna</c> 模块）+ dna_show（读单个 module.md）.
        /// </summary>
        public static IReadOnlyList<AITool> GetReadOnlyTools(string workspaceRoot)
        {
            if (string.IsNullOrWhiteSpace(workspaceRoot))
                return Array.Empty<AITool>();

            string root = workspaceRoot;
            var tools = new List<AITool>(2)
            {
                BuildDnaListTool(root),
                BuildDnaShowTool(root),
            };
            return tools;
        }

        #region dna_list

        private static AIFunction BuildDnaListTool(string workspaceRoot)
        {
            var trampoline = new DnaListTrampoline(workspaceRoot);
            var method = typeof(DnaListTrampoline).GetMethod(
                nameof(DnaListTrampoline.Invoke),
                BindingFlags.Instance | BindingFlags.Public);
            return AIFunctionFactory.Create(
                method,
                target: trampoline,
                name: "dna_list",
                description:
                "List every registered .dna/ module under the workspace root. " +
                "Returns a JSON array of {modulePath, dnaPath, hasModuleMd} entries. " +
                "modulePath is the relative path of the module directory (the parent of .dna/).");
        }

        private sealed class DnaListTrampoline
        {
            private readonly string _root;

            public DnaListTrampoline(string root)
            {
                _root = root;
            }

            public string Invoke(
                [Description(
                    "Optional sub-directory (relative to workspace root) to scope the listing; pass null for whole workspace.")]
                string scope)
            {
                string baseDir = _root;
                if (!string.IsNullOrWhiteSpace(scope))
                {
                    baseDir = Path.GetFullPath(Path.Combine(_root, scope));
                    if (!IsWithin(baseDir, _root))
                        return "ERROR: SandboxViolation: scope escapes workspace root";
                }

                if (!Directory.Exists(baseDir))
                    return "ERROR: NotFound: " + baseDir;

                var entries = new List<Dictionary<string, object>>();
                foreach (var dnaDir in EnumerateDnaDirs(baseDir))
                {
                    string moduleDir = Path.GetDirectoryName(dnaDir);
                    if (string.IsNullOrEmpty(moduleDir)) continue;
                    string moduleRel = MakeRelative(_root, moduleDir);
                    string dnaRel = MakeRelative(_root, dnaDir);
                    bool hasModuleMd = File.Exists(Path.Combine(dnaDir, "module.md"));
                    entries.Add(new Dictionary<string, object>
                    {
                        { "modulePath", moduleRel },
                        { "dnaPath", dnaRel },
                        { "hasModuleMd", hasModuleMd },
                    });
                }

                entries.Sort((a, b) => string.CompareOrdinal(
                    (string)a["modulePath"], (string)b["modulePath"]));
                return JsonSerializer.Serialize(entries);
            }
        }

        #endregion

        #region dna_show

        private static AIFunction BuildDnaShowTool(string workspaceRoot)
        {
            var trampoline = new DnaShowTrampoline(workspaceRoot);
            var method = typeof(DnaShowTrampoline).GetMethod(
                nameof(DnaShowTrampoline.Invoke),
                BindingFlags.Instance | BindingFlags.Public);
            return AIFunctionFactory.Create(
                method,
                target: trampoline,
                name: "dna_show",
                description:
                "Read the .dna/module.md (or another named .dna doc) for a given module. " +
                "modulePath is relative to the workspace root and identifies the module directory " +
                "(the parent of .dna/). docName defaults to 'module.md'.");
        }

        private sealed class DnaShowTrampoline
        {
            private readonly string _root;

            public DnaShowTrampoline(string root)
            {
                _root = root;
            }

            public string Invoke(
                [Description("Module path relative to workspace root (parent of .dna/). E.g. 'src/combat'.")]
                string modulePath,
                [Description("Doc name inside .dna/; defaults to 'module.md'. Other examples: 'contract.md'.")]
                string docName)
            {
                if (string.IsNullOrWhiteSpace(modulePath))
                    return "ERROR: InvalidArgument: modulePath must be non-empty";
                string doc = string.IsNullOrWhiteSpace(docName) ? "module.md" : docName;

                string full = Path.GetFullPath(Path.Combine(_root, modulePath, ".dna", doc));
                if (!IsWithin(full, _root))
                    return "ERROR: SandboxViolation: path escapes workspace root";
                if (!File.Exists(full))
                    return "ERROR: NotFound: " + full;

                try
                {
                    return File.ReadAllText(full, new UTF8Encoding(false));
                }
                catch (Exception ex)
                {
                    return "ERROR: " + ex.GetType().Name + ": " + ex.Message;
                }
            }
        }

        #endregion

        #region dna_init

        private static AIFunction BuildDnaInitTool(WorkspaceSystem workspace)
        {
            var trampoline = new DnaInitTrampoline(workspace);
            var method = typeof(DnaInitTrampoline).GetMethod(
                nameof(DnaInitTrampoline.Invoke),
                BindingFlags.Instance | BindingFlags.Public);
            return AIFunctionFactory.Create(
                method,
                target: trampoline,
                name: "dna_init",
                description:
                "Create a new .dna/ module at the given path. Required: modulePath (relative to workspace root), " +
                "kind ∈ {root,parent,leaf}, name, owner. Optional: description, withContract (bool), " +
                "status ∈ {spec,planned,implemented} (default: implemented for root, spec otherwise). " +
                "Returns 'OK: <abs path of created .dna/>' on success.");
        }

        private sealed class DnaInitTrampoline
        {
            private readonly WorkspaceSystem _ws;
            public DnaInitTrampoline(WorkspaceSystem ws) { _ws = ws; }

            public string Invoke(
                [Description("Target module path (relative to workspace root or absolute). E.g. 'src/combat'.")]
                string modulePath,
                [Description("'root' | 'parent' | 'leaf'.")]
                string kind,
                [Description("Frontmatter `name` field (human-readable label).")]
                string name,
                [Description("Frontmatter `owner` field (owning role / team).")]
                string owner,
                [Description("Optional frontmatter `description`.")]
                string description,
                [Description("Also create .dna/contract.md when true.")]
                bool withContract,
                [Description("Optional `status` ∈ {spec,planned,implemented}. Empty = use default per kind.")]
                string status)
            {
                try
                {
                    string created = _ws.DnaInit(modulePath, kind, name, owner,
                        description ?? string.Empty, withContract, status ?? string.Empty);
                    return "OK: " + created;
                }
                catch (Exception ex)
                {
                    return "ERROR: " + ex.GetType().Name + ": " + ex.Message;
                }
            }
        }

        #endregion

        #region dna_edit

        private static AIFunction BuildDnaEditTool(WorkspaceSystem workspace)
        {
            var trampoline = new DnaEditTrampoline(workspace);
            var method = typeof(DnaEditTrampoline).GetMethod(
                nameof(DnaEditTrampoline.Invoke),
                BindingFlags.Instance | BindingFlags.Public);
            return AIFunctionFactory.Create(
                method,
                target: trampoline,
                name: "dna_edit",
                description:
                "Edit an existing .dna module. target ∈ {frontmatter, body, section, contract, contract-section, workflow}. " +
                "payloadJson is a JSON object whose keys depend on target: " +
                "frontmatter -> {field, value | value_list}; " +
                "body / contract -> {content}; " +
                "section / contract-section -> {heading, content?, level?, mode?, create_if_missing?}; " +
                "workflow -> {name, content}. " +
                "mode (default 'replace') ∈ {replace, append, insert-after, delete} for section targets. " +
                "Returns 'OK: <abs path of written file>' on success.");
        }

        private sealed class DnaEditTrampoline
        {
            private readonly WorkspaceSystem _ws;
            public DnaEditTrampoline(WorkspaceSystem ws) { _ws = ws; }

            public string Invoke(
                [Description("Module path (relative to workspace root). E.g. 'src/combat'.")]
                string modulePath,
                [Description("'frontmatter' | 'body' | 'section' | 'contract' | 'contract-section' | 'workflow'.")]
                string target,
                [Description("JSON object with target-specific fields. See tool description for shapes.")]
                string payloadJson,
                [Description("Section mode (only used for section / contract-section). Default 'replace'.")]
                string mode)
            {
                try
                {
                    var payload = ParsePayload(payloadJson);
                    string written = _ws.DnaEdit(modulePath, target, payload,
                        string.IsNullOrWhiteSpace(mode) ? "replace" : mode);
                    return "OK: " + written;
                }
                catch (Exception ex)
                {
                    return "ERROR: " + ex.GetType().Name + ": " + ex.Message;
                }
            }
        }

        #endregion

        #region dna_split

        private static AIFunction BuildDnaSplitTool(WorkspaceSystem workspace)
        {
            var trampoline = new DnaSplitTrampoline(workspace);
            var method = typeof(DnaSplitTrampoline).GetMethod(
                nameof(DnaSplitTrampoline.Invoke),
                BindingFlags.Instance | BindingFlags.Public);
            return AIFunctionFactory.Create(
                method,
                target: trampoline,
                name: "dna_split",
                description:
                "Split a source .dna module into one source + N new leaf modules by extracting H2 sections. " +
                "splitsJson is a JSON array of {path, name, headings:[...], owner?, description?}. " +
                "strategy ∈ {comment (default), move}: comment leaves a marker in source body; move strips section. " +
                "Returns JSON {created:[...], dependencyRefs:[{module, depLine, actionRequired}, ...]} on success " +
                "(prefixed 'OK: ').");
        }

        private sealed class DnaSplitTrampoline
        {
            private readonly WorkspaceSystem _ws;
            public DnaSplitTrampoline(WorkspaceSystem ws) { _ws = ws; }

            public string Invoke(
                [Description("Source module path (relative to workspace root).")]
                string sourceModulePath,
                [Description("JSON array of split specs: [{path, name, headings:[...], owner?, description?}].")]
                string splitsJson,
                [Description("'comment' (default) leaves a marker; 'move' strips the section from source.")]
                string strategy)
            {
                try
                {
                    var splits = ParseSplitSpecs(splitsJson);
                    var result = _ws.DnaSplit(sourceModulePath, splits,
                        string.IsNullOrWhiteSpace(strategy) ? "comment" : strategy);
                    var report = new Dictionary<string, object>
                    {
                        { "created", result.Created.ToList() },
                        {
                            "dependencyRefs",
                            result.DependencyRefs
                                .Select(r => new Dictionary<string, object>
                                {
                                    { "module", r.Module },
                                    { "depLine", r.DepLine },
                                    { "actionRequired", r.ActionRequired },
                                })
                                .ToList()
                        },
                    };
                    return "OK: " + JsonSerializer.Serialize(report);
                }
                catch (Exception ex)
                {
                    return "ERROR: " + ex.GetType().Name + ": " + ex.Message;
                }
            }
        }

        #endregion

        #region dna_deprecate

        private static AIFunction BuildDnaDeprecateTool(WorkspaceSystem workspace)
        {
            var trampoline = new DnaDeprecateTrampoline(workspace);
            var method = typeof(DnaDeprecateTrampoline).GetMethod(
                nameof(DnaDeprecateTrampoline.Invoke),
                BindingFlags.Instance | BindingFlags.Public);
            return AIFunctionFactory.Create(
                method,
                target: trampoline,
                name: "dna_deprecate",
                description:
                "Deprecate a module by renaming its .dna/ to .dna.archived/. Source code is untouched. " +
                "Fails if .dna.archived/ already exists (history is not overwritten). " +
                "Returns 'OK' on success.");
        }

        private sealed class DnaDeprecateTrampoline
        {
            private readonly WorkspaceSystem _ws;
            public DnaDeprecateTrampoline(WorkspaceSystem ws) { _ws = ws; }

            public string Invoke(
                [Description("Module path (relative to workspace root).")]
                string modulePath)
            {
                try
                {
                    _ws.DnaDeprecate(modulePath);
                    return "OK";
                }
                catch (Exception ex)
                {
                    return "ERROR: " + ex.GetType().Name + ": " + ex.Message;
                }
            }
        }

        #endregion

        #region dna_reindex

        private static AIFunction BuildDnaReindexTool(WorkspaceSystem workspace)
        {
            var trampoline = new DnaReindexTrampoline(workspace);
            var method = typeof(DnaReindexTrampoline).GetMethod(
                nameof(DnaReindexTrampoline.Invoke),
                BindingFlags.Instance | BindingFlags.Public);
            return AIFunctionFactory.Create(
                method,
                target: trampoline,
                name: "dna_reindex",
                description:
                "Rescan workspace, rebuild the in-memory module registry. " +
                "If a root-level .dna/ exists, also writes a top-level index.md listing all registered module paths. " +
                "Returns 'OK' on success.");
        }

        private sealed class DnaReindexTrampoline
        {
            private readonly WorkspaceSystem _ws;
            public DnaReindexTrampoline(WorkspaceSystem ws) { _ws = ws; }

            public string Invoke()
            {
                try
                {
                    _ws.DnaReindex();
                    return "OK";
                }
                catch (Exception ex)
                {
                    return "ERROR: " + ex.GetType().Name + ": " + ex.Message;
                }
            }
        }

        #endregion

        #region 共享辅助

        /// <summary>
        /// 枚举 <paramref name="root"/> 之下所有名为 <c>.dna</c> 的目录。
        /// 跳过常见噪音目录（node_modules / Library / obj / bin / .git 等）以保证启动可接受。
        /// </summary>
        internal static IEnumerable<string> EnumerateDnaDirs(string root)
        {
            var stack = new Stack<string>();
            stack.Push(root);
            while (stack.Count > 0)
            {
                string dir = stack.Pop();
                string[] subs;
                try
                {
                    subs = Directory.GetDirectories(dir);
                }
                catch
                {
                    continue;
                }

                Array.Sort(subs, StringComparer.Ordinal);
                for (int i = subs.Length - 1; i >= 0; i--)
                {
                    string sub = subs[i];
                    string name = Path.GetFileName(sub);
                    if (string.Equals(name, ".dna", StringComparison.Ordinal))
                    {
                        yield return sub;
                        continue; // 不下钻 .dna 内部
                    }

                    if (IsNoiseDir(name)) continue;
                    stack.Push(sub);
                }
            }
        }

        private static bool IsNoiseDir(string name)
        {
            if (string.IsNullOrEmpty(name)) return true;
            // 常见构建/缓存/版控目录——可视为永远不会承载 .dna 模块
            return name == ".git"
                   || name == "node_modules"
                   || name == "Library"
                   || name == "Temp"
                   || name == "obj"
                   || name == "bin"
                   || name == ".vs"
                   || name == ".idea";
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

        private static bool IsWithin(string candidate, string prefix)
        {
            string c = Path.GetFullPath(candidate);
            string p = Path.GetFullPath(prefix);
            if (c.Equals(p, StringComparison.OrdinalIgnoreCase)) return true;
            if (!c.StartsWith(p, StringComparison.OrdinalIgnoreCase)) return false;
            char boundary = c[p.Length];
            return boundary == Path.DirectorySeparatorChar || boundary == Path.AltDirectorySeparatorChar;
        }

        // -------- payload JSON 解析 --------

        /// <summary>
        /// 把 JSON 对象字符串转成 <see cref="Dictionary{String,Object}"/>，元素递归还原为 string / bool / int / double / List。
        /// 用于 <c>dna_edit</c> 的 payloadJson 入参——AIFunctionFactory 不直接支持 IDictionary 入参。
        /// </summary>
        private static IReadOnlyDictionary<string, object> ParsePayload(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
                return new Dictionary<string, object>();
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                throw new ArgumentException("payloadJson 必须是 JSON 对象");
            return (Dictionary<string, object>)JsonElementToObject(doc.RootElement);
        }

        private static IReadOnlyList<SplitSpec> ParseSplitSpecs(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
                throw new ArgumentException("splitsJson 不能为空");
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                throw new ArgumentException("splitsJson 必须是 JSON 数组");

            var specs = new List<SplitSpec>();
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                if (el.ValueKind != JsonValueKind.Object)
                    throw new ArgumentException("splits 元素必须是 JSON 对象");
                string path = el.TryGetProperty("path", out var p) ? p.GetString() : null;
                string name = el.TryGetProperty("name", out var n) ? n.GetString() : null;
                var headings = new List<string>();
                if (el.TryGetProperty("headings", out var hs) && hs.ValueKind == JsonValueKind.Array)
                {
                    foreach (var h in hs.EnumerateArray())
                        headings.Add(h.GetString() ?? string.Empty);
                }
                string owner = el.TryGetProperty("owner", out var o) ? (o.GetString() ?? string.Empty) : string.Empty;
                string desc = el.TryGetProperty("description", out var d)
                    ? (d.GetString() ?? string.Empty) : string.Empty;
                specs.Add(new SplitSpec(path, name, headings, owner, desc));
            }
            return specs;
        }

        private static object JsonElementToObject(JsonElement el)
        {
            switch (el.ValueKind)
            {
                case JsonValueKind.Object:
                    {
                        var d = new Dictionary<string, object>(StringComparer.Ordinal);
                        foreach (var prop in el.EnumerateObject())
                            d[prop.Name] = JsonElementToObject(prop.Value);
                        return d;
                    }
                case JsonValueKind.Array:
                    {
                        var l = new List<object>();
                        foreach (var item in el.EnumerateArray())
                            l.Add(JsonElementToObject(item));
                        return l;
                    }
                case JsonValueKind.String:
                    return el.GetString();
                case JsonValueKind.True:
                    return true;
                case JsonValueKind.False:
                    return false;
                case JsonValueKind.Number:
                    if (el.TryGetInt64(out var i)) return i;
                    return el.GetDouble();
                case JsonValueKind.Null:
                    return null;
                default:
                    return el.ToString();
            }
        }

        #endregion
    }
}
