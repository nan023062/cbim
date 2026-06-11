using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace CBIM.Workspace;

/// <summary>
/// 单个拆分目标——<see cref="WorkspaceSystem.DnaSplit"/> 入参。
/// 与 v1 Python <c>split_module</c> 的 split spec 字段一一对应。
/// </summary>
public sealed class SplitSpec
{
    /// <summary>
    /// 新模块目录路径（相对工作区根或绝对路径）。
    /// </summary>
    public string Path { get; }

    /// <summary>
    /// 新模块 frontmatter <c>name</c>。
    /// </summary>
    public string Name { get; }

    /// <summary>
    /// 从源模块 body 抽取的 H2 标题列表（带或不带 "## " 前缀皆可）。
    /// </summary>
    public IReadOnlyList<string> Headings { get; }

    /// <summary>
    /// 新模块 owner——为空则继承源模块 owner。
    /// </summary>
    public string Owner { get; }

    /// <summary>
    /// 可选 description（写入新模块 frontmatter）。
    /// </summary>
    public string Description { get; }

    public SplitSpec(string path, string name, IReadOnlyList<string> headings,
                     string owner = "", string description = "")
    {
        if (string.IsNullOrWhiteSpace(path))
            throw new ArgumentException("SplitSpec.Path 不能为空", nameof(path));
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("SplitSpec.Name 不能为空", nameof(name));
        if (headings == null || headings.Count == 0)
            throw new ArgumentException("SplitSpec.Headings 至少要有一个", nameof(headings));

        Path = path;
        Name = name;
        Headings = headings;
        Owner = owner ?? string.Empty;
        Description = description ?? string.Empty;
    }
}

/// <summary>
/// <see cref="WorkspaceSystem.DnaSplit"/> 返回值。镜像 v1 Python 同名结构。
/// </summary>
public sealed class SplitResult
{
    /// <summary>
    /// 新建的每一份 module.md 的绝对路径。
    /// </summary>
    public IReadOnlyList<string> Created { get; }

    /// <summary>
    /// 依赖反向引用扫描——其它模块 frontmatter <c>dependencies:</c> 中提到了源模块路径的清单。
    /// SCAN ONLY：本命令不改这些模块，架构师后续 <c>dna_edit frontmatter</c> 处理。
    /// </summary>
    public IReadOnlyList<DependencyRef> DependencyRefs { get; }

    public SplitResult(IReadOnlyList<string> created, IReadOnlyList<DependencyRef> deps)
    {
        Created = created ?? Array.Empty<string>();
        DependencyRefs = deps ?? Array.Empty<DependencyRef>();
    }
}

/// <summary>
/// 反向依赖引用记录——<see cref="SplitResult.DependencyRefs"/> 元素。
/// </summary>
public sealed class DependencyRef
{
    public string Module { get; }
    public string DepLine { get; }
    public string ActionRequired { get; }

    public DependencyRef(string module, string depLine, string actionRequired)
    {
        Module = module ?? string.Empty;
        DepLine = depLine ?? string.Empty;
        ActionRequired = actionRequired ?? string.Empty;
    }
}

/// <summary>
/// frontmatter / 区段解析与渲染工具。
///
/// <para>对偶 v1 Python <c>services/_fm.py</c> + <c>cbi/_primitives/modules.py</c>。
/// 手写实现，刻意保持与 read 侧（<see cref="DnaToolProvider"/>）的解析风格对称——
/// 读路径走 <c>File.ReadAllText</c> 不解析 YAML；写路径在这里集中做解析 + 校验 + 渲染。</para>
///
/// <para>不引入第三方 YAML 库——v1 Python 同样手写以避免 PyYAML 依赖；此处沿袭。</para>
/// </summary>
internal static class DnaFrontmatter
{
    // 与 v1 Python `_MODULE_FM_SCHEMA` 对齐。
    public static readonly string[] Schema =
    {
        "name", "owner", "description",
        "keywords", "dependencies", "includeDirs",
        "status",
    };

    // 与 v1 Python `_MODULE_FM_LIST_FIELDS` 对齐。
    public static readonly HashSet<string> ListFields = new HashSet<string>(StringComparer.Ordinal)
    {
        "keywords", "dependencies", "includeDirs",
    };

    // 与 v1 Python `_MODULE_FM_STATUS_VALUES` 对齐。
    public static readonly string[] StatusValues = { "spec", "planned", "implemented" };

    public static readonly string[] KindValues = { "root", "parent", "leaf" };

    // 标题正则——1-6 个 '#'，空格，标题文本，可选尾部 '#'。
    private static readonly Regex HeadingRe =
        new Regex(@"^(#{1,6})\s+(.+?)\s*#*\s*$", RegexOptions.Compiled);

    // 代码围栏（``` 或 ~~~）。
    private static readonly Regex FenceRe =
        new Regex(@"^(?:```|~~~)", RegexOptions.Compiled);

    /// <summary>
    /// 解析以 <c>---\n...\n---</c> 包裹的 frontmatter。无 frontmatter 时返回空字典。
    ///
    /// <para>支持：scalar、行内 list（<c>[a, b]</c>）、块状 list（<c>key:</c> 后跟 <c>  - item</c>）。
    /// 与 v1 Python <c>parse_frontmatter</c> 行为对齐。</para>
    /// </summary>
    public static Dictionary<string, object> Parse(string text)
    {
        var meta = new Dictionary<string, object>(StringComparer.Ordinal);
        if (string.IsNullOrEmpty(text) || !text.StartsWith("---", StringComparison.Ordinal))
            return meta;

        int end = text.IndexOf("\n---", 3, StringComparison.Ordinal);
        if (end < 0)
            return meta;

        string fmBlock = text.Substring(3, end - 3);
        string currentKey = string.Empty;
        foreach (var rawLine in fmBlock.Split('\n'))
        {
            string line = rawLine.TrimEnd('\r');
            string stripped = line.Trim();
            if (stripped.Length == 0 || stripped.StartsWith("#", StringComparison.Ordinal))
                continue;

            // 块状 list 项：以 "  - " 开头。
            if (line.StartsWith("  - ", StringComparison.Ordinal) && currentKey.Length > 0)
            {
                string val = line.TrimStart().TrimStart('-').Trim();
                if (!(meta.TryGetValue(currentKey, out var existing) && existing is List<object>))
                    meta[currentKey] = new List<object>();
                ((List<object>)meta[currentKey]).Add(val);
                continue;
            }

            int colon = stripped.IndexOf(':');
            if (colon < 0)
                continue;

            string k = stripped.Substring(0, colon).Trim();
            string v = stripped.Substring(colon + 1).Trim();
            currentKey = k;

            if (v.Length == 0)
            {
                meta[k] = new List<object>();
            }
            else if (v.StartsWith("[", StringComparison.Ordinal) && v.EndsWith("]", StringComparison.Ordinal))
            {
                string inner = v.Substring(1, v.Length - 2).Trim();
                var list = new List<object>();
                if (inner.Length > 0)
                {
                    foreach (var item in inner.Split(','))
                        list.Add(item.Trim().Trim('\'', '"'));
                }
                meta[k] = list;
            }
            else
            {
                meta[k] = v.Trim('\'', '"');
            }
        }

        return meta;
    }

    /// <summary>
    /// 剥掉 <c>---\n...\n---</c> 块，返回 body（去首尾空白）。无 frontmatter 时返回原文（去首尾空白）。
    /// </summary>
    public static string StripFrontmatter(string text)
    {
        if (string.IsNullOrEmpty(text))
            return string.Empty;
        if (text.StartsWith("---", StringComparison.Ordinal))
        {
            int end = text.IndexOf("\n---", 3, StringComparison.Ordinal);
            if (end >= 0)
                return text.Substring(end + 4).Trim();
        }
        return text.Trim();
    }

    /// <summary>
    /// 渲染 frontmatter——schema 字段先按顺序输出，剩余按字典插入序输出。
    /// 末尾以 <c>---\n</c> 收尾。与 v1 Python <c>render_frontmatter</c> 对齐。
    /// </summary>
    public static string Render(IDictionary<string, object> meta)
    {
        var sb = new StringBuilder();
        sb.Append("---\n");
        var emitted = new HashSet<string>(StringComparer.Ordinal);
        foreach (var key in Schema)
        {
            if (meta.TryGetValue(key, out var val))
            {
                AppendField(sb, key, val);
                emitted.Add(key);
            }
        }
        foreach (var kv in meta)
        {
            if (emitted.Contains(kv.Key))
                continue;
            AppendField(sb, kv.Key, kv.Value);
        }
        sb.Append("---\n");
        return sb.ToString();
    }

    private static void AppendField(StringBuilder sb, string key, object val)
    {
        if (val is IList<object> list || val is List<object>)
        {
            var l = (System.Collections.IList)val;
            if (l.Count == 0)
            {
                sb.Append(key).Append(": []\n");
                return;
            }
            sb.Append(key).Append(":\n");
            foreach (var item in l)
                sb.Append("  - ").Append(item ?? string.Empty).Append('\n');
            return;
        }
        sb.Append(key).Append(": ").Append(val ?? string.Empty).Append('\n');
    }

    /// <summary>
    /// 切分 frontmatter 块与 body。返回 (frontmatterIncludingTrailingNewline, body)。
    /// 无 frontmatter 时第一项为空串、第二项为原文。
    /// </summary>
    public static (string FrontmatterBlock, string Body) Split(string text)
    {
        if (string.IsNullOrEmpty(text))
            return (string.Empty, string.Empty);
        if (!text.StartsWith("---", StringComparison.Ordinal))
            return (string.Empty, text);

        int end = text.IndexOf("\n---", 3, StringComparison.Ordinal);
        if (end < 0)
            return (string.Empty, text);

        int fmEnd = end + 4; // past "\n---"
        if (fmEnd < text.Length && text[fmEnd] == '\n')
            fmEnd++;
        return (text.Substring(0, fmEnd), text.Substring(fmEnd));
    }

    /// <summary>
    /// 校验 frontmatter 至少含 <c>name / owner / kind / status</c>。
    /// kind ∈ root|parent|leaf；status ∈ spec|planned|implemented。
    /// </summary>
    public static void ValidateMandatory(IDictionary<string, object> meta)
    {
        if (meta == null)
            throw new ArgumentException("frontmatter 不能为 null");
        string[] required = { "name", "owner", "kind", "status" };
        foreach (var key in required)
        {
            if (!meta.TryGetValue(key, out var v) || v == null ||
                (v is string s && string.IsNullOrWhiteSpace(s)))
            {
                throw new ArgumentException($"frontmatter 缺少必备字段：{key}");
            }
        }
        string kind = meta["kind"]?.ToString() ?? string.Empty;
        if (Array.IndexOf(KindValues, kind) < 0)
            throw new ArgumentException(
                $"kind 必须为 {{root, parent, leaf}} 之一；得到：{kind}");
        string status = meta["status"]?.ToString() ?? string.Empty;
        if (Array.IndexOf(StatusValues, status) < 0)
            throw new ArgumentException(
                $"status 必须为 {{spec, planned, implemented}} 之一；得到：{status}");
    }

    // -------- 区段编辑 --------

    /// <summary>
    /// 区段——记录标题层级、文本、起止行索引。
    /// </summary>
    public sealed class Section
    {
        public int Level;       // 1..6
        public string Heading;  // 去首尾空白
        public int Start;       // 标题行索引
        public int End;         // 区段下界行索引（exclusive）
    }

    /// <summary>
    /// 切分 body 为区段集合。跳过代码围栏内的标题。
    /// </summary>
    public static List<Section> SplitSections(string bodyText)
    {
        var lines = (bodyText ?? string.Empty).Split('\n');
        // 注意：System split 会把 "" 作为最后一段——对齐 Python splitlines 需要去掉末尾空段；
        // 但只在原文以 \n 结尾时去；否则保留。
        var lineList = new List<string>(lines);
        if (lineList.Count > 0 && bodyText != null && bodyText.EndsWith("\n", StringComparison.Ordinal))
            lineList.RemoveAt(lineList.Count - 1);

        // 去掉末尾的 \r（CRLF -> LF）
        for (int i = 0; i < lineList.Count; i++)
            lineList[i] = lineList[i].TrimEnd('\r');

        var sections = new List<Section>();
        bool inFence = false;
        for (int i = 0; i < lineList.Count; i++)
        {
            string line = lineList[i];
            if (FenceRe.IsMatch(line))
            {
                inFence = !inFence;
                continue;
            }
            if (inFence)
                continue;
            var m = HeadingRe.Match(line);
            if (!m.Success)
                continue;

            sections.Add(new Section
            {
                Level = m.Groups[1].Value.Length,
                Heading = m.Groups[2].Value.Trim(),
                Start = i,
                End = lineList.Count,
            });
        }
        // 计算每段 End——下一个 level <= 自身 level 的标题位置。
        for (int idx = 0; idx < sections.Count; idx++)
        {
            int end = lineList.Count;
            for (int j = idx + 1; j < sections.Count; j++)
            {
                if (sections[j].Level <= sections[idx].Level)
                {
                    end = sections[j].Start;
                    break;
                }
            }
            sections[idx].End = end;
        }
        return sections;
    }

    /// <summary>
    /// 把 body 文本按行装载为可变 List（去掉末尾空行——对齐 Python splitlines 行为）。
    /// </summary>
    public static List<string> ToLineList(string bodyText)
    {
        if (string.IsNullOrEmpty(bodyText))
            return new List<string>();
        var lines = bodyText.Split('\n');
        var lineList = new List<string>(lines);
        if (lineList.Count > 0 && bodyText.EndsWith("\n", StringComparison.Ordinal))
            lineList.RemoveAt(lineList.Count - 1);
        for (int i = 0; i < lineList.Count; i++)
            lineList[i] = lineList[i].TrimEnd('\r');
        return lineList;
    }

    public static List<string> NormalizeContentLines(string content)
    {
        if (string.IsNullOrEmpty(content))
            return new List<string>();
        string trimmed = content.Trim('\n');
        return ToLineList(trimmed);
    }
}
