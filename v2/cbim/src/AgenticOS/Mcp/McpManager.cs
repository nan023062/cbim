using System;
using System.Collections.Generic;

namespace CBIM.Mcp;

/// <summary>
/// Shared / 隔离 双模式 MCP 实例管理器，按 brainId 统一引用计数。
/// </summary>
public sealed class McpManager : IDisposable
{
    private readonly IMcpClientStarter _starter;
    private readonly object _gate = new object();

    // Shared MCP：单实例 + 引用集合
    private readonly Dictionary<string, IStartedMcpClient> _sharedInstances =
        new Dictionary<string, IStartedMcpClient>(StringComparer.Ordinal);

    private readonly Dictionary<string, HashSet<string>> _sharedRefs =
        new Dictionary<string, HashSet<string>>(StringComparer.Ordinal); // mcpId → brainIds

    // 非 Shared MCP：每个 (mcpId, brainId) 独立实例
    private readonly Dictionary<(string mcpId, string brainId), IStartedMcpClient> _isolatedInstances =
        new Dictionary<(string mcpId, string brainId), IStartedMcpClient>();

    private bool _disposed;

    /// <summary>
    /// 构造。
    /// </summary>
    /// <param name="starter">
    /// 装配侧注入的 MCP 启动器 SPI（见 <see cref="IMcpClientStarter"/>）。
    /// 不能为 null。
    /// </param>
    public McpManager(IMcpClientStarter starter)
    {
        _starter = starter ?? throw new ArgumentNullException(nameof(starter));
    }

    #region 公共 API

    /// <summary>
    /// 获取或创建一个 MCP 实例。
    ///
    /// 按 <see cref="McpDescriptor.Shared"/> 选择策略：
    ///   Shared = true  → 全局唯一实例，brainId 加入引用集合。
    ///   Shared = false → (mcpId, brainId) 独占实例。
    ///
    /// 命中缓存直接返回；未命中则调 <see cref="IMcpClientStarter.Start"/> 启动后缓存。
    /// 启动失败（starter 抛异常）原样上抛，不留字典条目。
    /// </summary>
    /// <param name="descriptor">MCP 服务描述符，不能为 null。</param>
    /// <param name="brainId">
    /// 脑区唯一标识。
    /// Shared = true 时加入引用集合，归零时触发实例释放。
    /// Shared = false 时作为隔离键的一部分。
    /// 不能为 null 或空白。
    /// </param>
    /// <returns>已完成握手 + 工具发现的 MCP client 启动产物。</returns>
    public IStartedMcpClient GetOrCreate(McpDescriptor descriptor, string brainId)
    {
        if (descriptor == null)
            throw new ArgumentNullException(nameof(descriptor));
        if (string.IsNullOrWhiteSpace(brainId))
            throw new ArgumentException("brainId 不能为空", nameof(brainId));

        lock (_gate)
        {
            ThrowIfDisposed();

            if (descriptor.Shared)
            {
                if (!_sharedInstances.TryGetValue(descriptor.Id, out var cached))
                {
                    // 在锁内启动，确保同 mcpId 并发竞况里只启一次。
                    // 启动失败则不入字典，异常原样上抛（装配侧优雅降级）。
                    var client = _starter.Start(descriptor);
                    if (client == null)
                        throw new InvalidOperationException(
                            $"IMcpClientStarter.Start returned null for descriptor '{descriptor.Id}'");

                    _sharedInstances[descriptor.Id] = client;
                    _sharedRefs[descriptor.Id] = new HashSet<string>(StringComparer.Ordinal);
                    cached = client;
                }

                _sharedRefs[descriptor.Id].Add(brainId);
                return cached;
            }
            else
            {
                var key = (descriptor.Id, brainId);
                if (!_isolatedInstances.TryGetValue(key, out var cached))
                {
                    var client = _starter.Start(descriptor);
                    if (client == null)
                        throw new InvalidOperationException(
                            $"IMcpClientStarter.Start returned null for descriptor '{descriptor.Id}'");

                    _isolatedInstances[key] = client;
                    cached = client;
                }

                return cached;
            }
        }
    }

    /// <summary>
    /// 释放指定 brainId 对某个 MCP 的引用。
    ///
    /// Shared 实例：从引用集合移除 brainId；若引用归零则 Dispose 并移除实例。
    /// 隔离实例：直接 Dispose 并移除 (mcpId, brainId) 独占实例。
    ///
    /// 若无法从 mcpId 判断类型，先查 _sharedInstances，再查 _isolatedInstances。
    /// key 未知 / 已释放时幂等无操作。Dispose 在锁外执行。
    /// </summary>
    /// <param name="mcpId">MCP 服务 Id。</param>
    /// <param name="brainId">与 GetOrCreate 时一致的脑区标识。</param>
    public void Release(string mcpId, string brainId)
    {
        if (string.IsNullOrEmpty(mcpId))
            return;
        if (string.IsNullOrEmpty(brainId))
            return;

        IStartedMcpClient toDispose = null;

        lock (_gate)
        {
            if (_disposed)
                return;

            // 先查 Shared 字典
            if (_sharedRefs.TryGetValue(mcpId, out var refs))
            {
                refs.Remove(brainId);
                if (refs.Count == 0)
                {
                    toDispose = _sharedInstances[mcpId];
                    _sharedInstances.Remove(mcpId);
                    _sharedRefs.Remove(mcpId);
                }
            }
            else
            {
                // 再查隔离字典
                var key = (mcpId, brainId);
                if (_isolatedInstances.TryGetValue(key, out toDispose))
                    _isolatedInstances.Remove(key);
            }
        }

        // 锁外 Dispose——避免 kill 子进程 / 关 socket 阻塞其他操作。
        toDispose?.Dispose();
    }

    #endregion

    /// <summary>
    /// 关闭所有仍活跃的 MCP 连接 / 子进程。
    /// 调用后 <see cref="GetOrCreate"/> 将抛 <see cref="ObjectDisposedException"/>。
    /// 多次 Dispose 安全（幂等）。
    /// </summary>
    public void Dispose()
    {
        List<IStartedMcpClient> toDisposeAll;

        lock (_gate)
        {
            if (_disposed)
                return;
            _disposed = true;

            toDisposeAll = new List<IStartedMcpClient>(
                _sharedInstances.Count + _isolatedInstances.Count);

            foreach (var client in _sharedInstances.Values)
                toDisposeAll.Add(client);
            foreach (var client in _isolatedInstances.Values)
                toDisposeAll.Add(client);

            _sharedInstances.Clear();
            _sharedRefs.Clear();
            _isolatedInstances.Clear();
        }

        // 逐一锁外 Dispose——某个 client.Dispose 抛异常不影响其他
        foreach (var client in toDisposeAll)
        {
            try
            {
                client.Dispose();
            }
            catch
            {
                /* best-effort：关闭期错误不上抛，避免阻断其余 Dispose */
            }
        }
    }

    #region 内部辅助

    private void ThrowIfDisposed()
    {
        if (_disposed)
            throw new ObjectDisposedException(nameof(McpManager));
    }

    #endregion
}
