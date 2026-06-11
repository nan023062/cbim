using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace CBIM.Memory;

/// <summary>
/// 空记忆服务——占位实现。
/// 所有写入静默丢弃，所有查询返回空结果。
///</summary>
public sealed class NullMemoryService : IMemoryService
{
    /// <summary>单例——无状态，可安全共享。</summary>
    public static readonly NullMemoryService Instance = new NullMemoryService();

    private NullMemoryService() { }

    public void Store(MemoryEntry entry) { }
    public Task StoreAsync(MemoryEntry entry, CancellationToken ct = default) => Task.CompletedTask;

    public IReadOnlyList<MemoryEntry> Query(string text, int topK = 5) => Array.Empty<MemoryEntry>();
    public Task<IReadOnlyList<MemoryEntry>> QueryAsync(string text, int topK = 5, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<MemoryEntry>>(Array.Empty<MemoryEntry>());

    public MemoryEntry Get(string id) => null;
    public IReadOnlyList<MemoryEntry> List() => Array.Empty<MemoryEntry>();

    public void Delete(string id) { }
    public Task DeleteAsync(string id, CancellationToken ct = default) => Task.CompletedTask;

    public void Clear() { }

    public IReadOnlyList<MemoryEntry> Scan(MemoryScanFilter filter) => Array.Empty<MemoryEntry>();
    public MemoryStats Stats() => new MemoryStats(0, null, null);
}
