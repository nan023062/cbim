using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using CBIM.Agent;
using CBIM.LlmClient;
using CBIM.Mcp;
using CBIM.Memory;
using CBIM.Skills;
using CBIM.Storage;
using CBIM.Workflow;
using CBIM.Workspace;

#nullable enable

namespace CBIM;

/// <summary>
/// Cbim — CBIM 系统根容器。
/// </summary>
public sealed class Cbim : IDisposable
{
    #region 配置层（FileStore）

    /// <summary>模型配置注册表（<c>models/</c> 子目录）。</summary>
    public FileModelStore ModelStore { get; }

    /// <summary>技能配置注册表（<c>skills/</c> 子目录）。</summary>
    public FileSkillStore SkillStore { get; }

    /// <summary>工作流配置注册表（<c>workflows/</c> 子目录）。</summary>
    public FileWorkflowStore WorkflowStore { get; }

    /// <summary>MCP 描述符注册表（<c>mcps/</c> 子目录）。</summary>
    public FileMcpStore McpStore { get; }

    #endregion

    #region 文件后端（各 FileStore 共享）

    /// <summary>文件系统存取原语——各 FileStore 的共享后端。</summary>
    public FileBackend FileBackend { get; }

    #endregion

    #region 实例层

    /// <summary>IChatClient 工厂——按 <see cref="ModelDescriptor"/> 路由到对应 Provider 构建器。</summary>
    public ChatClientFactory LlmClient { get; }

    /// <summary>MCP 实例管理器——Shared / 隔离双模式生命周期管理。</summary>
    public McpManager Mcp { get; }

    #endregion

    #region 服务层

    /// <summary>
    /// Memory 服务——Cbim 统一持有的记忆后端。
    /// Hippocampus 通过 <c>agent.Os.Memory</c> 访问；外部可通过 <see cref="SwitchMemory"/> 热切换。
    /// </summary>
    public IMemoryService Memory { get; private set; }

    /// <summary>Workspace 子系统——封装工作区根路径 + 按权限分层的 DNA AITool 列表。</summary>
    public WorkspaceSystem Workspace { get; }

    #endregion

    #region Session 管理（直接在 Cbim 上）

    /// <summary>
    /// 创建时传入的 Agent 描述——OpenSessionAsync 据此构造每个 Session 的独立 Agent。
    /// </summary>
    private readonly AgentDescription _agentDescription;

    private readonly Dictionary<string, Session> _sessions = new Dictionary<string, Session>();

    private readonly object _sessionLock = new object();

    #endregion

    #region 构造（私有）

    /// <summary>
    /// 按 <paramref name="options"/> 初始化并返回一个完整的 Cbim 实例。
    /// </summary>
    public static Cbim Create(CbimOptions options)
    {
        if (options == null)
            throw new ArgumentNullException(nameof(options));

        if (string.IsNullOrWhiteSpace(options.RootPath))
            throw new ArgumentException(
                "CbimOptions.RootPath 不能为空——请提供数据根目录路径。",
                nameof(options));

        if (options.Agent == null)
            throw new ArgumentException(
                "CbimOptions.Agent 不能为空——请提供 AgentDescription。",
                nameof(options));

        // 1. 文件后端
        var backend = new FileBackend(options.RootPath);

        // 2. 配置层 FileStore
        var modelStore = new FileModelStore(backend);
        var skillStore = new FileSkillStore(backend);
        var workflowStore = new FileWorkflowStore(backend);
        var mcpStore = new FileMcpStore(backend);

        // 3. IChatClient 工厂（默认 ProviderRegistry，含所有内置 Provider）
        var llmClient = new ChatClientFactory();

        // 4. MCP 实例管理器
        IMcpClientStarter starter = options.McpStarter ?? new NullMcpClientStarter();
        var mcp = new McpManager(starter);

        // 5. Memory 服务——外部注入优先；否则按 RootPath/memory 默认落盘。
        var memory = options.Memory ?? new LocalMemoryService(Path.Combine(options.RootPath, "memory"));

        // 6. Workspace 子系统——根路径 + DNA 工具列表 + ModuleDescription 注册表（按 .dna/ 自动发现）
        var workspace = new WorkspaceSystem(options.RootPath);

        // 7. 构造并返回 Cbim 根容器
        return new Cbim(options.Agent, backend, modelStore, skillStore, workflowStore, mcpStore, llmClient, mcp,
            memory, workspace);
    }

    /// <summary>
    /// 进程退出回退处理器——已订阅 <see cref="AppDomain.ProcessExit"/>。
    /// 显式 Dispose 时解除订阅，避免静态事件 GC-rooting 本实例。
    /// 已被 <see cref="Dispose"/> 调用置 null，作为「未订阅」标识。
    /// </summary>
    private EventHandler? _processExitHandler;

    /// <summary>
    /// Dispose 幂等闸——0 = 未释放，1 = 已释放。
    /// 同时被显式 <see cref="Dispose"/> 与 ProcessExit 回退路径竞争，需用 Interlocked 序列化。
    /// </summary>
    private int _disposed;

    private Cbim(
        AgentDescription agentDescription,
        FileBackend fileBackend,
        FileModelStore modelStore,
        FileSkillStore skillStore,
        FileWorkflowStore workflowStore,
        FileMcpStore mcpStore,
        ChatClientFactory llmClient,
        McpManager mcp,
        IMemoryService memory,
        WorkspaceSystem workspace)
    {
        _agentDescription = agentDescription;
        FileBackend = fileBackend;
        ModelStore = modelStore;
        SkillStore = skillStore;
        WorkflowStore = workflowStore;
        McpStore = mcpStore;
        LlmClient = llmClient;
        Mcp = mcp;
        Memory = memory;
        Workspace = workspace;

        // 订阅 ProcessExit 作为防御性兜底——硬 kill 绕过此事件，~2s 预算，
        // 正常关闭仍应走显式 Dispose（见 Dispose 幂等保护）。
        _processExitHandler = OnProcessExit;
        AppDomain.CurrentDomain.ProcessExit += _processExitHandler;
    }

    private void OnProcessExit(object? sender, EventArgs e)
    {
        // ProcessExit 回退：本回调若被触发，说明显式 Dispose 未被调用。
        // Dispose 幂等且会解除自身订阅，重复触发安全。
        try
        {
            Dispose();
        }
        catch
        {
            /* best-effort：进程退出期错误不上抛 */
        }
    }

    #endregion

    /// <summary>
    /// 热切换记忆后端——将 <see cref="Memory"/> 替换为新的 <see cref="IMemoryService"/> 实例。
    /// 切换后 Hippocampus 下次通过 <c>agent.Os.Memory</c> 取到的即为新实例。
    /// </summary>
    /// <param name="newMemoryService">新的记忆服务实例，不能为 null。</param>
    public void SwitchMemory(IMemoryService newMemoryService)
    {
        if (newMemoryService == null)
            throw new ArgumentNullException(nameof(newMemoryService));

        Memory = newMemoryService;
    }


    #region Session 管理接口

    /// <summary>
    /// 开通一个新 Session——每个 Session 独立持有自己的 Agent 实例。
    /// </summary>
    public Task<Session> OpenSessionAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        var agent = new Session(this, _agentDescription);
        lock (_sessionLock)
        {
            _sessions[agent.SessionId] = agent;
        }

        return Task.FromResult(agent);
    }

    /// <summary>
    /// 关闭指定 Session——从注册表移除并释放 Agent。
    /// </summary>
    public Task CloseSessionAsync(string sessionId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionId))
            return Task.CompletedTask;

        Session? session;
        lock (_sessionLock)
        {
            _sessions.TryGetValue(sessionId, out session);
            _sessions.Remove(sessionId);
        }

        session?.Dispose();
        return Task.CompletedTask;
    }

    /// <summary>
    /// 按 ID 查活动 Session（Agent 实例）。找不到返回 null。
    /// </summary>
    public Session? GetSession(string sessionId)
    {
        lock (_sessionLock)
        {
            _sessions.TryGetValue(sessionId, out var session);
            return session;
        }
    }

    #endregion

    #region 生命周期

    /// <summary>
    /// 释放所有持有生命周期的资源（全部 Session Agent + MCP）。
    /// 幂等——可被显式调用与 <see cref="AppDomain.ProcessExit"/> 兜底路径同时竞争。
    /// </summary>
    public void Dispose()
    {
        // Interlocked 闸：只有第一个调用者真正执行释放，后续直接返回。
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
            return;

        // 解除 ProcessExit 订阅，避免静态事件 GC-rooting 本实例。
        var handler = _processExitHandler;
        if (handler != null)
        {
            _processExitHandler = null;
            try
            {
                AppDomain.CurrentDomain.ProcessExit -= handler;
            }
            catch
            {
                /* best-effort：进程退出期 AppDomain 可能已不可用 */
            }
        }

        List<Session> snapshot;
        lock (_sessionLock)
        {
            snapshot = new List<Session>(_sessions.Values);
            _sessions.Clear();
        }

        foreach (var session in snapshot)
        {
            try
            {
                session.Dispose();
            }
            catch
            {
                /* best-effort：单个 Session 释放失败不阻断其余 */
            }
        }

        try
        {
            Mcp.Dispose();
        }
        catch
        {
            /* best-effort：MCP 释放失败不上抛 */
        }
    }

    #endregion
}

#region NullMcpClientStarter — 未配置 MCP 时的占位实现

/// <summary>
/// <see cref="IMcpClientStarter"/> 的空实现——当 <see cref="CbimOptions.McpStarter"/>
/// 未配置时注入，任何 MCP 实例化尝试都将抛出明确错误。
/// </summary>
internal sealed class NullMcpClientStarter : IMcpClientStarter
{
    /// <inheritdoc/>
    /// <exception cref="InvalidOperationException">
    /// 始终抛出——提示调用方在 <see cref="CbimOptions"/> 中配置真实的 MCP 启动器。
    /// </exception>
    public IStartedMcpClient Start(McpDescriptor descriptor)
    {
        throw new InvalidOperationException(
            "McpStarter not configured in CbimOptions. " +
            "Set CbimOptions.McpStarter to a real IMcpClientStarter implementation " +
            "(e.g., one backed by Microsoft.Agents.AI.Mcp) before using MCP features.");
    }
}

#endregion
