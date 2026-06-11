using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace CBIM.Memory;

/// <summary>
/// CBIM Memory 基建抽象接口——中期记忆条目的完整读写契约。
/// </summary>
public interface IMemoryService
{
    #region 存储

    /// <summary>
    /// 写入或覆盖一条记忆条目。同一 <see cref="MemoryEntry.Id"/> 会原子覆盖旧值。
    /// </summary>
    /// <param name="entry">条目；不为 null；<see cref="MemoryEntry.Id"/> 不为空白。</param>
    void Store(MemoryEntry entry);

    /// <summary>
    /// 异步写入或覆盖一条记忆条目。
    /// </summary>
    Task StoreAsync(MemoryEntry entry, CancellationToken ct = default);

    #endregion

    #region 查询（语义相似度）

    /// <summary>
    /// 按文本检索——返回与 <paramref name="text"/> 最相关的前 <paramref name="topK"/> 条。
    ///
    /// 检索算法由实现决定：可为关键词匹配（默认 <see cref="LocalMemoryService"/>）或
    /// 向量相似度检索（Pinecone / VectorStore 等）。
    /// 接口契约仅承诺「返回 topK 相关条目」，不约束算法细节。
    /// </summary>
    /// <param name="text">查询文本；空白时返回空集合。</param>
    /// <param name="topK">返回数量上限；&lt;= 0 时返回空集合。</param>
    /// <returns>按相关度倒序的条目集合（可能少于 topK；不为 null）。</returns>
    IReadOnlyList<MemoryEntry> Query(string text, int topK = 5);

    /// <summary>
    /// 异步按文本检索。
    /// </summary>
    Task<IReadOnlyList<MemoryEntry>> QueryAsync(string text, int topK = 5, CancellationToken ct = default);

    #endregion

    #region 读取

    /// <summary>
    /// 按 Id 取条目。
    /// </summary>
    /// <param name="id">条目 Id。</param>
    /// <returns>命中返回条目；<b>不存在或 Id 空白时返回 <c>null</c></b>。</returns>
    MemoryEntry? Get(string id);

    /// <summary>
    /// 枚举所有条目——按 <see cref="MemoryEntry.CreatedAt"/> 倒序。
    /// </summary>
    IReadOnlyList<MemoryEntry> List();

    #endregion

    #region 删除

    /// <summary>
    /// 按 Id 删除条目。Id 不存在时静默返回。
    /// </summary>
    void Delete(string id);

    /// <summary>
    /// 异步删除条目。
    /// </summary>
    Task DeleteAsync(string id, CancellationToken ct = default);

    #endregion

    #region 清空

    /// <summary>
    /// 清空所有条目。
    /// </summary>
    void Clear();

    #endregion

    #region 扩展（结构化过滤 / 统计）

    /// <summary>
    /// 按结构化过滤条件枚举——AND 各字段、按 <see cref="MemoryEntry.CreatedAt"/> 倒序。
    /// 实现按支持程度过滤；不支持的字段忽略。
    /// </summary>
    IReadOnlyList<MemoryEntry> Scan(MemoryScanFilter filter);

    /// <summary>
    /// 仓库实时统计快照——总条目数 + 最早 / 最新 <see cref="MemoryEntry.CreatedAt"/>。
    /// </summary>
    MemoryStats Stats();

    #endregion
}
