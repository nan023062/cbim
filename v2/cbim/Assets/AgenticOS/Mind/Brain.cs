#nullable enable
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using CBIM.Kernel;
using CBIM.LlmClient;
using CBIM.Memory;
using CBIM.Tools.Standard;

namespace CBIM.Mind
{
    public enum BrainKind : byte
    {
        /// <summary>前额叶皮层（主脑 · 调度中枢）</summary>
        PrefrontalCortex,

        /// <summary>顶叶（架构脑 · 模块设计 / 架构合规）。</summary>
        ParietalLobe,

        /// <summary>海马体（记忆学习 · Dream 裂变）。</summary>
        Hippocampus,

        /// <summary>运动皮层</summary>
        MotorCortex
    }

    /// <summary>
    /// 脑区的归属Agent实例，通过Agent可以获取所有能力上下文和记忆信息
    /// </summary>
    public interface IBrainAgent : IBrainLookup
    {
        Cbim Os { get; }

        /// <summary>灵魂（Soul）——agent 的人格 / 行为准则。来自 AgentDescription.Soul。</summary>
        string Soul { get; }

        /// <summary>身份（Identity）——agent 的角色定位简介。来自 AgentDescription.Identity。</summary>
        string Identity { get; }

        /// <summary>可调脑区清单——供 PrefrontalCortex 装配 SynapseTools 和 CompilerTools。</summary>
        IReadOnlyList<Brain> CallableBrains { get; }
    }

    /// <summary>
    /// 脑区契约公共基类。 其实就是封装的AI Agent
    /// </summary>
    public abstract class Brain : IInvocable, ICircuitBuilderContext, IDisposable
    {
        private bool __disposed;

#region 流式输出 & Token 统计

        /// <summary>
        /// 流式 token 事件——MsAINeuron 每输出一个 token 片段时触发，最后触发一次 IsEnd=true 的结束信号。
        /// </summary>
        public event Action<BrainTokenEvent>? OnToken;

        /// <summary>
        /// Token 用量事件——每次 LLM 调用结束后触发，携带本次输入/输出 token 数。
        /// </summary>
        public event Action<BrainUsageEvent>? OnUsage;

        /// <summary>当前脑区是否正在处理请求（InvokeAsync 执行期间为 true）。</summary>
        public bool IsProcessing { get; private set; }

        /// <summary>本脑区自激活以来的累计 token 用量。</summary>
        public BrainUsage CumulativeUsage { get; } = new BrainUsage();

#endregion

#region 上下文统计

        /// <summary>
        /// 当前上下文历史中的消息条数。
        /// 每次 <see cref="InvokeAsync"/> 完成后更新。
        /// 当脑区未配置 <see cref="BrainDescriptor.ContextWindowTokens"/>（即不启用 ChatHistoryProvider）时，值为 0。
        /// </summary>
        public int ContextMessageCount { get; internal set; }

        /// <summary>
        /// 当前上下文历史的 token 估算值。
        /// 使用最近一次 <see cref="BrainUsageEvent.InputTokens"/> 作为近似值更新；
        /// 当脑区未配置 ChatHistoryProvider 时，值为 0。
        /// </summary>
        public long ContextTokenEstimate { get; internal set; }

        /// <summary>
        /// 触发 <see cref="OnToken"/> 事件（由 <see cref="Kernel.Neuron"/> 回调，勿在业务层直接调用）。
        /// </summary>
        internal void RaiseToken(string token, bool isEnd)
            => OnToken?.Invoke(new BrainTokenEvent(BrainId, token, isEnd));

        /// <summary>
        /// 触发 <see cref="OnUsage"/> 事件，同时累加 <see cref="CumulativeUsage"/>
        /// （由 <see cref="Kernel.Neuron"/> 回调，勿在业务层直接调用）。
        /// </summary>
        internal void RaiseUsage(int input, int output)
        {
            CumulativeUsage.InputTokens  += input;
            CumulativeUsage.OutputTokens += output;
            CumulativeUsage.TotalTokens  += input + output;

            // 用输入 token 数作为上下文 token 估算的近似值（每次 LLM 调用的输入 ≈ 当前上下文大小）。
            if (input > 0)
                ContextTokenEstimate = input;

            OnUsage?.Invoke(new BrainUsageEvent(BrainId, input, output, input + output));
        }

        /// <summary>
        /// 查询并更新 <see cref="ContextMessageCount"/>——从 Neuron 持有的 HistoryProvider 读取当前会话消息数。
        /// 若 Neuron 未配置 HistoryProvider，则静默跳过（值保持 0）。
        /// </summary>
        private void RefreshContextMessageCount()
        {
            if (_neuron is Neuron msai && msai.HistoryProvider != null)
            {
                // GetMessages(null) 取默认 session（无 AgentSession 绑定时使用 null）
                var messages = msai.HistoryProvider.GetMessages(session: null);
                ContextMessageCount = messages?.Count ?? 0;
            }
        }

        public abstract BrainKind Kind { get; }

        /// <summary>
        /// 子类工厂方法——在 Brain 基类构造器内被调用，解析并返回本脑区使用的 <see cref="IMemoryService"/>。
        /// 默认返回 null；仅 <see cref="Hippocampus"/> 覆写以从 <c>agent.Os.Memory</c> 取值。
        /// 此方法在基类构造器中调用时，子类字段尚未初始化，因此实现只能依赖方法参数，不能访问 <c>this</c> 字段。
        /// </summary>
        protected IMemoryService ResolveMemory(IBrainAgent agent, BrainDescriptor descriptor)
        {
            return agent.Os.Memory;
        }

        public string BrainId => Descriptor.BrainId;

        public BrainDescriptor Descriptor { get; }

        private INeuron _neuron;

        internal IBrainAgent Agent { get; private set; }

#endregion

#region Executor + per-invocation Builder
        private readonly ICircuitExecutor _executor;

        /// <summary>per-invocation 编译器状态；null 表示当前无编译中的回路。</summary>
        private NeuralCircuitBuilder? _builder;

        /// <summary>
        /// 神经元——LLM 思维链单元。本字段是 Brain 层调用 LLM 的唯一出口（K2 铁律）。
        /// 由构造器内部通过 NeuronFactory 创建；BrainBase 与子类不感知其具体实现
        /// （<see cref="Kernel.Neuron"/> 还是 <see cref="ExternalNeuron"/>）。
        /// </summary>
        public INeuron Neuron => _neuron;

        /// <summary>
        /// 透传 <see cref="Neuron"/> 的底层 <see cref="Microsoft.Agents.AI.AIAgent"/> 引用——保留旧字段名以兼容
        /// 已持引用打 <c>SendAsync</c> 的 Channel 等调用方。
        /// <see cref="ExternalNeuron"/> 路径下恒为 <c>null</c>（外部引擎自带 LLM，无 AIAgent 句柄）。
        /// </summary>
        public AIAgent? AIAgent => Neuron.UnderlyingAgent;

        /// <summary>
        /// 构造器内部完成 Orchestrator、CompilerTools、Neuron 的完整装配。
        /// </summary>
        protected Brain(IBrainAgent agent, ChatClientFactory chatClientFactory, BrainDescriptor descriptor)
        {
            ValidateArgs(agent, chatClientFactory, descriptor);

            __disposed  = false;
            
            Agent       = agent;
            
            Descriptor  = descriptor;
            
            _executor   = new Orchestrator();
            
            IReadOnlyList<AITool> tools = BuildToolSet(agent, descriptor);
            
            IReadOnlyList<AIContextProvider> contextProviders= BuildContextProviders(agent, descriptor);

            _neuron = CreateNeuron(agent, chatClientFactory, tools, contextProviders);
        }

#endregion

#region 参数校验
        private static void ValidateArgs(IBrainAgent agent, ChatClientFactory chatClientFactory, BrainDescriptor descriptor)
        {
            if (agent == null)
                throw new ArgumentNullException(nameof(agent), "BrainBase.Agent 不允许 null。");

            if (chatClientFactory == null)
                throw new ArgumentNullException(nameof(chatClientFactory), "BrainBase.ChatClientFactory 不允许 null。");

            if (descriptor == null)
                throw new ArgumentException("BrainBase.BrainDescriptor 不能为空", nameof(descriptor));
        }

#endregion

#region 完整工具集组装
        private IReadOnlyList<AITool> BuildToolSet(IBrainAgent agent, BrainDescriptor descriptor)
        {
            var memory = agent.Os.Memory;
            
            IReadOnlyList<AITool> allTools = MergeTools(BuildCompilerTools(agent), BuildExtraTools(agent, descriptor));
            
            allTools = MergeTools(allTools, BuildStandardTools(descriptor));
            
            allTools = MergeTools(allTools, BuildMcpTools(agent, descriptor));
            
            allTools = MergeTools(allTools, BuildPermissionTools(agent, memory));

            return allTools;
        }

#endregion

#region CompilerTools（显式接口依赖 ICircuitBuilderContext）
        private IReadOnlyList<AITool> BuildCompilerTools(IBrainAgent agent)
        {
            // 显式传 this（实现了 ICircuitBuilderContext），取代原先的隐式闭包绑定
            return CompilerToolFactory.Build(this, agent.CallableBrains);
        }

        /// <summary>
        /// 子类可覆写，返回额外工具集（例如 PrefrontalCortex 追加 SynapseTools）。
        /// 默认实现返回空列表。
        /// </summary>
        protected virtual IReadOnlyList<AITool> BuildExtraTools(IBrainAgent agent, BrainDescriptor descriptor)
            => Array.Empty<AITool>();

#endregion

#region StandardTools AIFunctions
        private static IReadOnlyList<AITool> BuildStandardTools(BrainDescriptor descriptor)
        {
            if (descriptor.ToolIds.Count == 0)
                return Array.Empty<AITool>();

            // 沙箱：默认无路径限制（宽松实例；调用方可通过子类 BuildExtraTools 替换为受限沙箱）
            var toolSandbox = new ToolSandbox(allowedPathPrefixes: null);
            var standardFunctions = StandardTools.Build(descriptor.ToolIds, toolSandbox);
            if (standardFunctions.Count == 0)
                return Array.Empty<AITool>();

            var list = new List<AITool>(standardFunctions.Count);
            foreach (var fn in standardFunctions)
                list.Add(fn);
            return list;
        }

#endregion

#region MCP AITools
        private static IReadOnlyList<AITool> BuildMcpTools(IBrainAgent agent, BrainDescriptor descriptor)
        {
            if (agent.Os.Mcp == null || descriptor.McpIds.Count == 0)
                return Array.Empty<AITool>();

            var mcpTools = new List<AITool>();
            foreach (var mcpId in descriptor.McpIds)
            {
                if (string.IsNullOrWhiteSpace(mcpId)) continue;
                var mcpDescriptor = agent.Os.McpStore?.Get(mcpId);
                if (mcpDescriptor == null) continue;

                try
                {
                    var mcpClient = agent.Os.Mcp.GetOrCreate(mcpDescriptor, descriptor.BrainId);
                    foreach (var fn in mcpClient.AiFunctions)
                    {
                        if (fn is AITool tool)
                            mcpTools.Add(tool);
                    }
                }
                catch (InvalidOperationException)
                {
                    // MCP starter 未配置时优雅降级——跳过该 MCP，脑区仍可正常创建
                }
            }
            return mcpTools;
        }

#endregion

#region DNA / Memory 权限工具
        private IReadOnlyList<AITool> BuildPermissionTools(IBrainAgent agent, IMemoryService? memory)
        {
            var permTools = new List<AITool>();

            // DNA 工具：所有脑区只读；仅架构脑 ParietalLobe 升级为读写（写权限按 BrainKind 写死）
            if (agent.Os.Workspace != null)
            {
                var dnaTools = Kind == BrainKind.ParietalLobe
                    ? agent.Os.Workspace.ReadWriteDnaTools
                    : agent.Os.Workspace.ReadOnlyDnaTools;
                foreach (var t in dnaTools)
                    permTools.Add(t);
            }

            // Memory 工具：所有脑区只读；仅记忆脑 Hippocampus 升级为读写（写权限按 BrainKind 写死）
            if (memory != null)
            {
                var memTools = Kind == BrainKind.Hippocampus
                    ? MemoryToolProvider.GetReadWriteTools(memory)
                    : MemoryToolProvider.GetReadOnlyTools(memory);
                foreach (var t in memTools)
                    permTools.Add(t);
            }

            return permTools;
        }

#endregion

#region ContextProviders（Skill / Workflow / Memory）
        private IReadOnlyList<AIContextProvider> BuildContextProviders(IBrainAgent agent, BrainDescriptor descriptor)
        {
            var contextProviders = new List<AIContextProvider>();

            var memory = agent.Os.Memory;
            
            // MemoryContextProvider：自动召回记忆，仅注入记忆脑 Hippocampus
            if (Kind == BrainKind.Hippocampus && memory != null)
                contextProviders.Add(new MemoryContextProvider(memory));

            if (descriptor.SkillIds.Count > 0)
                contextProviders.Add(new SkillContextProvider(agent.Os.SkillStore, descriptor.SkillIds));

            if (descriptor.WorkflowIds.Count > 0)
                contextProviders.Add(new WorkflowContextProvider(agent.Os.WorkflowStore, descriptor.WorkflowIds));

            return contextProviders;
        }

#endregion

#region Neuron 创建
        private INeuron CreateNeuron(IBrainAgent agent, ChatClientFactory chatClientFactory, IReadOnlyList<AITool> tools, IReadOnlyList<AIContextProvider> contextProviders)
        {
            var modelDescriptor = string.IsNullOrEmpty(Descriptor.ModelId) ? null : agent.Os.ModelStore.Get(Descriptor.ModelId);
            IChatClient chatClient = chatClientFactory.Create(modelDescriptor);
            if (chatClient == null)
                throw new InvalidOperationException($"ChatClientFactory.Create 为脑区 '{BrainId}' 返回了 null。");
        
            return NeuronFactory.Create(this, agent.Soul, agent.Identity, Descriptor, chatClient, tools, contextProviders);
        }

        /// <summary>合并两份工具集为不可变快照。</summary>
        private static IReadOnlyList<AITool> MergeTools(IReadOnlyList<AITool> a, IReadOnlyList<AITool> b)
        {
            if (a.Count == 0 && b.Count == 0) return Array.Empty<AITool>();
            var merged = new List<AITool>(a.Count + b.Count);
            foreach (var t in a) merged.Add(t);
            foreach (var t in b) merged.Add(t);
            return merged;
        }
        
        NeuralCircuitBuilder? ICircuitBuilderContext.GetActiveBuilder() => _builder;

        /// <summary>
        /// 投递子任务到本脑区。
        /// </summary>
        public virtual async Task<NeuronOutcome> InvokeAsync(NeuronInput invocation, CancellationToken ct)
        {
            if (invocation == null)
                throw new ArgumentNullException(nameof(invocation));

            IsProcessing = true;
            try
            {
                return await ExecuteInvokeAsync(invocation, ct).ConfigureAwait(false);
            }
            finally
            {
                IsProcessing = false;
            }
        }

        /// <summary>
        /// InvokeAsync 的实际执行逻辑，由基类在设置 <see cref="IsProcessing"/> 后调用。
        /// 子类如需完全替代调度策略，override 此方法；如需在调度前后插入钩子，override <see cref="InvokeAsync"/> 并 await base。
        /// </summary>
        private async Task<NeuronOutcome> ExecuteInvokeAsync(NeuronInput invocation, CancellationToken ct)
        {
            if (_builder?.Compiled != null)
            {
                // 路径 2：有已提交的 NeuralCircuit，交 Orchestrator 执行
                var circuit = _builder.Compiled;
                _builder = null;
                // 若本脑区实现了 IPrefrontalCallback，以 this 作为 callback；否则用空实现
                var callback = (this as IPrefrontalCallback) ?? NullPrefrontalCallback.Instance;
                return await _executor.RunAsync(circuit, (IBrainLookup)Agent, callback, ct).ConfigureAwait(false);
            }
            else
            {
                // 路径 1：为本次 LLM 工具循环初始化新的 Builder，让 CompilerTools 可以向其写入节点/边
                _builder = new NeuralCircuitBuilder(
                    circuitId: Guid.NewGuid().ToString("N"),
                    sourceRequest: invocation.Intent ?? string.Empty);

                try
                {
                    var outcome = await Neuron.InvokeAsync(invocation, ct).ConfigureAwait(false);
                    RefreshContextMessageCount();
                    return outcome;
                }
                finally
                {
                    // 若 LLM 未调 __circuit_commit（即 Compiled 仍为 null），则丢弃本次 Builder
                    if (_builder?.Compiled == null)
                        _builder = null;
                }
            }
        }

        protected virtual void BeforeDestroy() { }

        /// <summary>
        /// 释放本脑区占用的资源。
        /// 默认实现释放 <see cref="Neuron"/>；子类如持有额外资源需重写并最后调用 base。
        /// AgentInstance 的释放顺序保证调用：MotorCortex → 其他脑区 → Prefrontal。
        /// 实现需做到多次调用幂等。
        /// </summary>
        public void Dispose()
        {
            if(__disposed) return;

            __disposed = true;

            try
            {
                BeforeDestroy();

                NeuronFactory.Destroy(_neuron);
            }
            finally
            {
                Agent = null;

                _neuron = null;
            }
        }

#endregion

#region 空回调（工作脑区不实现 IPrefrontalCallback 时的兜底）
        private sealed class NullPrefrontalCallback : IPrefrontalCallback
        {
            public static readonly NullPrefrontalCallback Instance = new NullPrefrontalCallback();
            void IPrefrontalCallback.ReportProgress(string brainId, string message) { }
            void IPrefrontalCallback.ReportOutcome(string brainId, NeuronOutcome outcome) { }
        }

#endregion
    }
}
