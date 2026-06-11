#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CBIM.Kernel;
using CBIM.LlmClient;
using CBIM.Mind;

namespace CBIM.Agent;

#region SessionOutcome

/// <summary>
/// <see cref="Session.SendAsync"/> 的返回值——一次 user → agent 投递的最终结果。
/// </summary>
public sealed class SessionOutcome
{
    public string ResultText { get; }
    public bool IsError { get; }
    public string? ErrorMessage { get; }

    public SessionOutcome(string resultText, bool isError, string? errorMessage)
    {
        ResultText = resultText;
        IsError = isError;
        ErrorMessage = errorMessage;
    }
}

#endregion

#region SessionEvent

/// <summary>
/// <see cref="Session.OnOutput"/> 事件载荷——每次 <see cref="Session.SendAsync"/>
/// 完成时（不论成功 / 失败）会发射一条。
///
/// <para>失败时 <see cref="Text"/> 形如 <c>"[ERROR] &lt;message&gt;"</c>。</para>
/// </summary>
public sealed class SessionEvent
{
    public string SessionId { get; }
    public string Text { get; }
    public DateTimeOffset At { get; }

    public SessionEvent(string sessionId, string text, DateTimeOffset at)
    {
        SessionId = sessionId;
        Text = text;
        At = at;
    }
}

#endregion

#region Agent

/// <summary>
/// Session 实例——一份 AgentDescription 装配后的运行态对象。
/// </summary>
public sealed class Session : IDisposable, IBrainAgent
{
    private Cbim _os;

    readonly Dictionary<string, Brain> _brains = new Dictionary<string, Brain>();

    /// <inheritdoc/>
    Cbim IBrainAgent.Os => _os;

    /// <summary>
    /// 静态描述符。运行时不变。
    /// </summary>
    public readonly AgentDescription Description;

    /// <summary>
    /// 主脑句柄——类型固定为 <see cref="PrefrontalCortex"/>。
    /// </summary>
    public readonly PrefrontalCortex Prefrontal;

    /// <summary>激活时间戳。</summary>
    public DateTimeOffset CreatedAt { get; }

    #region 会话能力

    /// <summary>
    /// 本 Agent 实例的会话唯一 ID（Guid）。
    /// </summary>
    public string SessionId { get; } = Guid.NewGuid().ToString("N");

    /// <summary>
    /// 每轮 <see cref="SendAsync"/> 完成时（成功 / 失败均）发射一次。
    /// UI / Unity 场景层订阅本事件即可获得对话流。
    /// 失败时 Text 形如 <c>"[ERROR] &lt;message&gt;"</c>。
    /// </summary>
    public event Action<SessionEvent>? OnOutput;

    #endregion

    #region 统一事件聚合

    /// <summary>
    /// 视图层唯一订阅点——所有 Brain 的事件（Token / Usage / BrainStart / BrainEnd）
    /// 均经本事件聚合分发，携带统一时间戳（UTC），时序一致。
    /// </summary>
    public event Action<AgentEvent>? OnEvent;

    /// <summary>
    /// Session 级别的 token 用量汇总——跨所有 Brain、跨多次 SendAsync 调用的累计统计。
    /// </summary>
    public AgentUsageSummary TotalUsage { get; } = new AgentUsageSummary();

    /// <summary>
    /// 按 BrainId 查询脑区实例。找不到返回 <c>null</c>。
    /// 视图层可通过返回值访问 <see cref="Brain.IsProcessing"/>、
    /// <see cref="Brain.CumulativeUsage"/>、上下文消息数等状态。
    /// </summary>
    public Brain? GetBrain(string brainId)
        => _brains.TryGetValue(brainId, out var b) ? b : null;

    private static readonly IReadOnlyDictionary<string, object> EmptyContext =
        new System.Collections.ObjectModel.ReadOnlyDictionary<string, object>(
            new Dictionary<string, object>());

    /// <summary>
    /// 投递一轮用户消息到主脑，通过内部 <see cref="SessionCallback"/> 承接进度与结果。
    /// </summary>
    public async Task<SessionOutcome> SendAsync(string userMessage, CancellationToken ct = default)
    {
        if (userMessage == null)
            throw new ArgumentNullException(nameof(userMessage));

        var tcs = new TaskCompletionSource<NeuronOutcome>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var callback = new SessionCallback(
            tcs,
            onProgress: msg => RaiseOutput("[PROGRESS] " + msg));

        var input = new NeuronInput(
            CorrelationId: SessionId,
            Intent: userMessage,
            StructuredInput: null,
            Context: EmptyContext);

        string resultText;
        try
        {
            RaiseEvent(new AgentEvent(
                DateTimeOffset.UtcNow, SessionId, Prefrontal.BrainId,
                AgentEventKind.BrainStart, null));

            _ = Prefrontal.InvokeAsync(input, ct).ContinueWith(t =>
            {
                RaiseEvent(new AgentEvent(
                    DateTimeOffset.UtcNow, SessionId, Prefrontal.BrainId,
                    AgentEventKind.BrainEnd, null));

                if (t.IsFaulted)
                    tcs.TrySetException(t.Exception!.InnerExceptions);
                else if (t.IsCanceled)
                    tcs.TrySetCanceled();
                else
                    callback.ReportOutcome(SessionId, t.Result);
            }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);

            using var reg = ct.Register(() => tcs.TrySetCanceled(ct));
            var outcome = await tcs.Task.ConfigureAwait(false);
            resultText = outcome?.Summary ?? string.Empty;
        }
        catch (Exception ex)
        {
            RaiseOutput("[ERROR] " + ex.Message);
            return new SessionOutcome(
                resultText: string.Empty,
                isError: true,
                errorMessage: ex.Message);
        }

        RaiseOutput(resultText);
        return new SessionOutcome(
            resultText: resultText,
            isError: false,
            errorMessage: null);
    }

    /// <summary>
    /// 发射 <see cref="OnOutput"/> 事件——订阅者抛异常时不向上传播。
    /// </summary>
    private void RaiseOutput(string text)
    {
        var handler = OnOutput;
        if (handler == null)
            return;

        var ev = new SessionEvent(
            sessionId: SessionId,
            text: text,
            at: DateTimeOffset.UtcNow);

        foreach (var subscriber in handler.GetInvocationList())
        {
            try
            {
                ((Action<SessionEvent>)subscriber)(ev);
            }
            catch
            {
                // 订阅者异常隔离
            }
        }
    }

    #endregion

    #region SessionCallback（内部，消除 Agent 对 IPrefrontalCallback 的直接实现）

    private sealed class SessionCallback : IPrefrontalCallback
    {
        private readonly TaskCompletionSource<NeuronOutcome> _tcs;
        private readonly Action<string>? _onProgress;

        internal SessionCallback(
            TaskCompletionSource<NeuronOutcome> tcs,
            Action<string>? onProgress = null)
        {
            _tcs = tcs;
            _onProgress = onProgress;
        }

        public void ReportOutcome(string brainId, NeuronOutcome outcome)
            => _tcs.TrySetResult(outcome);

        public void ReportProgress(string brainId, string message)
            => _onProgress?.Invoke(message);
    }

    #endregion

    #region IBrainAgent 实现

    /// <inheritdoc/>
    string IBrainAgent.Soul => Description.Soul;

    /// <inheritdoc/>
    string IBrainAgent.Identity => Description.Identity;

    /// <summary>
    /// 可调脑区快照——工作脑（不含主脑自身）按装配顺序排列。
    /// 首次读取时惰性冻结；主脑装配前已通过 _callableBrainsSnapshot 写入。
    /// </summary>
    private IReadOnlyList<Brain> _callableBrainsSnapshot = Array.Empty<Brain>();

    /// <inheritdoc/>
    IReadOnlyList<Brain> IBrainAgent.CallableBrains => _callableBrainsSnapshot;

    public Session(Cbim os, AgentDescription description)
    {
        if (os == null)
            throw new ArgumentNullException(nameof(os));
        if (description == null)
            throw new ArgumentNullException(nameof(description));

        _os = os;
        Description = description;

        #region 步骤 1：装配内置脑区（顶叶 + 海马体）和用户工作脑
        // 内置描述符由框架按 description 中的 ModelId 创建；不对外暴露。
        // 若各自 ModelId 为 null 或空，回退到 PrefrontalModelId。
        var fallbackModelId = description.PrefrontalModelId;
        AddWorkerBrain(_os.LlmClient, new ParietalLobeDescriptor(
            modelId: string.IsNullOrEmpty(description.ParietalLobeModelId)
                ? fallbackModelId : description.ParietalLobeModelId));
        AddWorkerBrain(_os.LlmClient, new HippocampusDescriptor(
            modelId: string.IsNullOrEmpty(description.HippocampusModelId)
                ? fallbackModelId : description.HippocampusModelId));

        // 用户工作脑（由 AgentDescription.WorkBrains 指定）
        if (description.WorkBrains != null)
        {
            foreach (var workDescriptor in description.WorkBrains)
            {
                AddWorkerBrain(_os.LlmClient, workDescriptor);
            }
        }

        // 可调脑区快照（不含主脑——主脑尚未创建）
        // 写入后 IBrainAgent.CallableBrains 立即返回此快照，供主脑构造器使用。
        _callableBrainsSnapshot = _brains.Values.ToList();
        #endregion

        #region 步骤 2：装配主脑 PrefrontalCortex
        // Brain 基类构造器自管理 Orchestrator / CompilerTools / SynapseTools / Neuron。
        var prefrontal = (PrefrontalCortex)BrainFactory.Create(
            agent: this,
            chatClientFactory: _os.LlmClient,
            descriptor: new PrefrontalDescriptor(modelId: fallbackModelId));

        _brains[prefrontal.BrainId] = prefrontal;
        Prefrontal = prefrontal;
        SubscribeBrainEvents(prefrontal);

        CreatedAt = DateTimeOffset.UtcNow;
        #endregion
    }

    /// <summary>
    /// 释放本实例占用的所有资源
    /// </summary>
    public void Dispose()
    {
        if (_os == null)
            return;

        _os = null;

        foreach (var brain in _brains.Values)
        {
            BrainFactory.Destroy(brain);
        }
        _brains.Clear();
    }

    public override string ToString()
    {
        return $"Agent({Description.Name}.., desc={Description.Identity})";
    }

    /// <summary>
    /// 按 BrainId 查找脑区实例。找不到返回 <c>null</c>。
    /// </summary>
    public Brain? FindBrain(string brainId)
    {
        if (brainId == null)
            throw new ArgumentNullException(nameof(brainId));

        _brains.TryGetValue(brainId, out Brain? found);
        return found;
    }

    /// <summary>
    /// <see cref="CBIM.Kernel.IBrainLookup"/> 显式实现——返回 <see cref="IInvocable"/> 抽象，
    /// 使 Kernel 层 Orchestrator 无需感知 Mind.Brain 具体类。
    /// </summary>
    IInvocable? IBrainLookup.FindBrain(string brainId)
        => _brains.TryGetValue(brainId, out var brain) ? brain : null;

    /// <summary>
    /// 装配一个工作脑区实例并加入 _brains。
    /// 工作脑不携带 SynapseTools；callableBrains 返回空快照——工作脑不感知兄弟脑区。
    /// </summary>
    private Brain AddWorkerBrain(ChatClientFactory chatClientFactory, BrainDescriptor descriptor)
    {
        if (descriptor == null)
            throw new ArgumentNullException(nameof(descriptor));

        Brain brain = BrainFactory.Create(agent: this, chatClientFactory: chatClientFactory, descriptor: descriptor);
        _brains[brain.BrainId] = brain;
        SubscribeBrainEvents(brain);
        return brain;
    }

    #endregion

    #region 事件聚合内部实现

    /// <summary>
    /// 订阅指定 Brain 的 OnToken / OnUsage 事件，将其转发为 <see cref="AgentEvent"/> 并通过
    /// <see cref="OnEvent"/> 向视图层分发；同时维护 <see cref="TotalUsage"/>。
    /// </summary>
    private void SubscribeBrainEvents(Brain brain)
    {
        brain.OnToken += e =>
            RaiseEvent(new AgentEvent(
                DateTimeOffset.UtcNow,
                SessionId,
                brain.BrainId,
                AgentEventKind.Token,
                e));

        brain.OnUsage += e =>
        {
            TotalUsage.Accumulate(brain.BrainId, e);
            RaiseEvent(new AgentEvent(
                DateTimeOffset.UtcNow,
                SessionId,
                brain.BrainId,
                AgentEventKind.Usage,
                e));
        };
    }

    /// <summary>
    /// 安全分发 <see cref="OnEvent"/>——订阅者抛异常时隔离，不向上传播。
    /// </summary>
    private void RaiseEvent(AgentEvent ev)
    {
        var handler = OnEvent;
        if (handler == null)
            return;

        foreach (var subscriber in handler.GetInvocationList())
        {
            try
            {
                ((Action<AgentEvent>)subscriber)(ev);
            }
            catch
            {
                // 订阅者异常隔离
            }
        }
    }

    #endregion
}

#endregion
