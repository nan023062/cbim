using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
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
    /// <item><see cref="GetReadWriteTools"/> — 读+写（仅 ParietalLobe 调用）</item>
    /// <item><see cref="GetReadOnlyTools"/> — 只读（PrefrontalCortex / MotorCortex 调用，Hippocampus 完全无 DNA 权限）</item>
    /// </list>
    /// </para>
    ///
    /// <para>实现说明：CBIM v2 当前未提供 C# 侧的 IDnaService 抽象，DNA 知识落盘形式为
    /// 工作区内任意层级的 <c>.dna/module.md</c> + <c>.dna/contract.md</c> 等文档。
    /// 本提供者直接按文件系统扫描出读取入口；写工具因需要原子化 + frontmatter 校验 +
    /// 索引一致性，目前仅留只读集合（与 NEEDS_ARCH_DECISION 同步）。</para>
    /// </summary>
    public static class DnaToolProvider
    {
        /// <summary>
        /// 读+写 DNA 工具集（供 ParietalLobe）。
        ///
        /// <para>NEEDS_ARCH_DECISION: 当前 v2 cbim 仅有只读 DNA 工具实现。写工具（dna_edit / dna_init /
        /// dna_split / dna_promote 等）需要 IDnaService C# 抽象，涉及 frontmatter 校验、依赖
        /// 规则、index.md 原子更新等不变量，需架构决策。本方法暂返回与 ReadOnly 相同的工具集——
        /// 架构脑因此能完整读，但还不能写；待 IDnaService 决策后扩展。</para>
        /// </summary>
        public static IReadOnlyList<AITool> GetReadWriteTools(string workspaceRoot) =>
            GetReadOnlyTools(workspaceRoot);

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
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public);
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
            public DnaListTrampoline(string root) { _root = root; }

            public string Invoke(
                [Description("Optional sub-directory (relative to workspace root) to scope the listing; pass null for whole workspace.")]
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
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public);
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
            public DnaShowTrampoline(string root) { _root = root; }

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
                try { subs = Directory.GetDirectories(dir); }
                catch { continue; }
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
                string rel = targetFull.Substring(rootFull.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
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

        #endregion
    }
}
