using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.AI;

namespace CBIM.Memory;

/// <summary>
/// Memory AITool 提供者——按读写权限返回 memory_* 工具列表。
///
/// <para>权限分层：
/// <list type="bullet">
/// <item><see cref="GetReadWriteTools"/> — 读+写（仅 Hippocampus 调用）</item>
/// <item><see cref="GetReadOnlyTools"/> — 只读（PrefrontalCortex / ParietalLobe / MotorCortex 调用）</item>
/// </list>
/// </para>
/// </summary>
public static class MemoryToolProvider
{
    /// <summary>
    /// 读+写 Memory 工具集（供 Hippocampus）。
    /// 工具：memory_query / memory_get / memory_list / memory_stats / memory_scan / memory_write / memory_delete
    /// </summary>
    public static IReadOnlyList<AITool> GetReadWriteTools(IMemoryService memory)
    {
        if (memory == null)
            return Array.Empty<AITool>();
        var tools = new List<AITool>(GetReadOnlyTools(memory));
        tools.Add(BuildWriteTool(memory));
        tools.Add(BuildDeleteTool(memory));
        return tools;
    }

    /// <summary>
    /// 只读 Memory 工具集（供其它内置脑）。
    /// 工具：memory_query / memory_get / memory_list / memory_stats / memory_scan
    /// </summary>
    public static IReadOnlyList<AITool> GetReadOnlyTools(IMemoryService memory)
    {
        if (memory == null)
            return Array.Empty<AITool>();
        return new List<AITool>(5)
        {
            BuildQueryTool(memory),
            BuildGetTool(memory),
            BuildListTool(memory),
            BuildStatsTool(memory),
            BuildScanTool(memory),
        };
    }

    #region 读工具

    private static AIFunction BuildQueryTool(IMemoryService memory)
    {
        var t = new QueryTrampoline(memory);
        return AIFunctionFactory.Create(
            ResolveMethod(typeof(QueryTrampoline), nameof(QueryTrampoline.Invoke)),
            target: t,
            name: "memory_query",
            description:
                "Search memory entries by free-text relevance. " +
                "Returns a JSON array of entries (Id, Source, CreatedAt, Text, Tags) sorted by relevance.");
    }

    private sealed class QueryTrampoline
    {
        private readonly IMemoryService _memory;
        public QueryTrampoline(IMemoryService memory) { _memory = memory; }
        public string Invoke(
            [Description("Free-text query.")] string text,
            [Description("Maximum entries to return; defaults to 5 when 0 or negative.")] int topK)
        {
            int k = topK <= 0 ? 5 : topK;
            var results = _memory.Query(text ?? string.Empty, k);
            return JsonSerializer.Serialize(MemoryEntriesToDicts(results));
        }
    }

    private static AIFunction BuildGetTool(IMemoryService memory)
    {
        var t = new GetTrampoline(memory);
        return AIFunctionFactory.Create(
            ResolveMethod(typeof(GetTrampoline), nameof(GetTrampoline.Invoke)),
            target: t,
            name: "memory_get",
            description: "Read a single memory entry by Id. Returns a JSON entry object or 'null' when missing.");
    }

    private sealed class GetTrampoline
    {
        private readonly IMemoryService _memory;
        public GetTrampoline(IMemoryService memory) { _memory = memory; }
        public string Invoke(
            [Description("Memory entry Id.")] string id)
        {
            var e = _memory.Get(id ?? string.Empty);
            return e == null ? "null" : JsonSerializer.Serialize(MemoryEntryToDict(e));
        }
    }

    private static AIFunction BuildListTool(IMemoryService memory)
    {
        var t = new ListTrampoline(memory);
        return AIFunctionFactory.Create(
            ResolveMethod(typeof(ListTrampoline), nameof(ListTrampoline.Invoke)),
            target: t,
            name: "memory_list",
            description:
                "List all memory entries (CreatedAt descending). " +
                "Returns a JSON array; pass limit to cap the count (0 or negative = no cap).");
    }

    private sealed class ListTrampoline
    {
        private readonly IMemoryService _memory;
        public ListTrampoline(IMemoryService memory) { _memory = memory; }
        public string Invoke(
            [Description("Maximum entries to emit; 0 or negative means no cap.")] int limit)
        {
            var all = _memory.List();
            IReadOnlyList<MemoryEntry> slice = all;
            if (limit > 0 && all.Count > limit)
            {
                var trimmed = new List<MemoryEntry>(limit);
                for (int i = 0; i < limit; i++)
                    trimmed.Add(all[i]);
                slice = trimmed;
            }
            return JsonSerializer.Serialize(MemoryEntriesToDicts(slice));
        }
    }

    private static AIFunction BuildStatsTool(IMemoryService memory)
    {
        var t = new StatsTrampoline(memory);
        return AIFunctionFactory.Create(
            ResolveMethod(typeof(StatsTrampoline), nameof(StatsTrampoline.Invoke)),
            target: t,
            name: "memory_stats",
            description: "Return memory store summary: TotalEntries, OldestCreatedAt, NewestCreatedAt.");
    }

    private sealed class StatsTrampoline
    {
        private readonly IMemoryService _memory;
        public StatsTrampoline(IMemoryService memory) { _memory = memory; }
        public string Invoke()
        {
            var s = _memory.Stats();
            return JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                { "totalEntries", s.TotalEntries },
                { "oldestCreatedAt", s.OldestCreatedAt?.ToString("o") },
                { "newestCreatedAt", s.NewestCreatedAt?.ToString("o") },
            });
        }
    }

    private static AIFunction BuildScanTool(IMemoryService memory)
    {
        var t = new ScanTrampoline(memory);
        return AIFunctionFactory.Create(
            ResolveMethod(typeof(ScanTrampoline), nameof(ScanTrampoline.Invoke)),
            target: t,
            name: "memory_scan",
            description:
                "Filtered scan. AND across non-null fields: sourceEquals (exact match), " +
                "tagsAny (comma-separated; OR within), sinceIso8601 (CreatedAt >= this).");
    }

    private sealed class ScanTrampoline
    {
        private readonly IMemoryService _memory;
        public ScanTrampoline(IMemoryService memory) { _memory = memory; }
        public string Invoke(
            [Description("Match Source exactly; pass null to skip.")] string sourceEquals,
            [Description("Comma-separated tag list; OR within; pass null to skip.")] string tagsAny,
            [Description("ISO-8601 timestamp; pass null to skip.")] string sinceIso8601)
        {
            IReadOnlyList<string>? tags = null;
            if (!string.IsNullOrWhiteSpace(tagsAny))
            {
                var raw = tagsAny.Split(',');
                var trimmed = new List<string>(raw.Length);
                foreach (var r in raw)
                {
                    var t = r?.Trim();
                    if (!string.IsNullOrEmpty(t))
                        trimmed.Add(t);
                }
                if (trimmed.Count > 0)
                    tags = trimmed;
            }
            DateTime? since = null;
            if (!string.IsNullOrWhiteSpace(sinceIso8601))
            {
                if (DateTime.TryParse(sinceIso8601, out var ts))
                    since = ts;
            }
            var filter = new MemoryScanFilter(
                SourceEquals: string.IsNullOrEmpty(sourceEquals) ? null : sourceEquals,
                TagsAny: tags,
                Since: since);
            var hits = _memory.Scan(filter);
            return JsonSerializer.Serialize(MemoryEntriesToDicts(hits));
        }
    }

    #endregion

    #region 写工具

    private static AIFunction BuildWriteTool(IMemoryService memory)
    {
        var t = new WriteTrampoline(memory);
        return AIFunctionFactory.Create(
            ResolveMethod(typeof(WriteTrampoline), nameof(WriteTrampoline.Invoke)),
            target: t,
            name: "memory_write",
            description:
                "Write or overwrite a memory entry by Id (atomic). " +
                "tags is a comma-separated list (may be null/empty). " +
                "source labels the writer (e.g. 'distill', 'manual'); CreatedAt = DateTime.UtcNow.");
    }

    private sealed class WriteTrampoline
    {
        private readonly IMemoryService _memory;
        public WriteTrampoline(IMemoryService memory) { _memory = memory; }
        public string Invoke(
            [Description("Memory entry Id (caller-decided, must be unique).")] string id,
            [Description("Free-text body of the memory entry.")] string text,
            [Description("Writer label, e.g. 'distill' or 'manual'.")] string source,
            [Description("Comma-separated tags; pass null/empty for none.")] string tagsCsv)
        {
            if (string.IsNullOrWhiteSpace(id))
                return "ERROR: InvalidArgument: id must be non-empty";
            IReadOnlyList<string> tags;
            if (string.IsNullOrWhiteSpace(tagsCsv))
            {
                tags = Array.Empty<string>();
            }
            else
            {
                var raw = tagsCsv.Split(',');
                var trimmed = new List<string>(raw.Length);
                foreach (var r in raw)
                {
                    var s = r?.Trim();
                    if (!string.IsNullOrEmpty(s))
                        trimmed.Add(s);
                }
                tags = trimmed;
            }
            var entry = new MemoryEntry(
                Id: id,
                Source: source ?? string.Empty,
                CreatedAt: DateTime.UtcNow,
                Text: text ?? string.Empty,
                Tags: tags);
            try
            {
                _memory.Store(entry);
                return "OK: stored " + id;
            }
            catch (Exception ex)
            {
                return "ERROR: " + ex.GetType().Name + ": " + ex.Message;
            }
        }
    }

    private static AIFunction BuildDeleteTool(IMemoryService memory)
    {
        var t = new DeleteTrampoline(memory);
        return AIFunctionFactory.Create(
            ResolveMethod(typeof(DeleteTrampoline), nameof(DeleteTrampoline.Invoke)),
            target: t,
            name: "memory_delete",
            description: "Delete a memory entry by Id. Idempotent — missing Id is a silent success.");
    }

    private sealed class DeleteTrampoline
    {
        private readonly IMemoryService _memory;
        public DeleteTrampoline(IMemoryService memory) { _memory = memory; }
        public string Invoke(
            [Description("Memory entry Id; missing Id is treated as success.")] string id)
        {
            if (string.IsNullOrWhiteSpace(id))
                return "OK: empty id (no-op)";
            try
            {
                _memory.Delete(id);
                return "OK: deleted " + id;
            }
            catch (Exception ex)
            {
                return "ERROR: " + ex.GetType().Name + ": " + ex.Message;
            }
        }
    }

    #endregion

    #region 共享辅助

    private static MethodInfo ResolveMethod(Type trampolineType, string methodName)
    {
        var method = trampolineType.GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public);
        if (method == null)
            throw new InvalidOperationException(
                $"未找到 {trampolineType.Name}.{methodName}——内部不变量违反。");
        return method;
    }

    private static List<Dictionary<string, object>> MemoryEntriesToDicts(IReadOnlyList<MemoryEntry> entries)
    {
        var list = new List<Dictionary<string, object>>(entries?.Count ?? 0);
        if (entries == null)
            return list;
        foreach (var e in entries)
        {
            if (e == null)
                continue;
            list.Add(MemoryEntryToDict(e));
        }
        return list;
    }

    private static Dictionary<string, object> MemoryEntryToDict(MemoryEntry e)
    {
        return new Dictionary<string, object>
        {
            { "id", e.Id },
            { "source", e.Source },
            { "createdAt", e.CreatedAt.ToString("o") },
            { "text", e.Text },
            { "tags", e.Tags },
        };
    }

    #endregion
}
