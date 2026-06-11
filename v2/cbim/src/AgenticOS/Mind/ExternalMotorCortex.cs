#nullable enable
using System;
using System.Collections.Generic;
using CBIM.LlmClient;

namespace CBIM.Mind
{
    /// <summary>
    /// ExternalMotorCortex —— 桥接外部 agent 引擎（Claude Code / Cursor / Cline 等）的运动皮层抽象。
    /// </summary>
    public abstract class ExternalMotorCortex : MotorCortex
    {
        /// <summary>Memory 与外部引擎的共享桥模式——从描述符透传。</summary>
        public MemoryShareMode ShareMode => _descriptor.MemoryShareMode;

        private ExternalMotorCortexDescriptor _descriptor;

        protected ExternalMotorCortex(IBrainAgent agent, ChatClientFactory chatClientFactory, ExternalMotorCortexDescriptor descriptor)
            : base(agent, chatClientFactory, descriptor)
        {
            _descriptor = descriptor;
        }
    }
    
    /// <summary>
    /// ExternalMotorCortex 与 CBIM Memory 之间的共享桥模式。
    /// 「同一具身一份记忆」铁律的物理桥接选项。
    ///
    /// 当前 v1 实施仅 <see cref="McpServer"/> 走通；其他模式预留枚举位置。
    /// </summary>
    public enum MemoryShareMode
    {
        /// <summary>默认：CBIM 起 <c>cbim-memory-bridge-mcp</c> server 暴露 IMemoryService，外部以 MCP client 接入。</summary>
        McpServer,

        /// <summary>文件桥：CBIM 写记忆快照到约定目录，外部读（v1 不实施）。</summary>
        FileBridge,

        /// <summary>HTTP 桥：CBIM 起 HTTP 服务，外部主动调（v1 不实施）。</summary>
        HttpEndpoint,

        /// <summary>不共享（破坏「同一具身」铁律，不推荐 · v1 不实施）。</summary>
        None
    }

    /// <summary>
    /// 外部 AI 引擎种类——<see cref="ExternalMotorCortexDescriptor"/> 通过本枚举声明
    /// 自己桥接的是哪种外部 agent 引擎。
    /// 本轮（v1）仅首发 <see cref="ClaudeCode"/>；其他成员预留待后续切片接入。
    /// </summary>
    public enum ExternalEngineKind
    {
        /// <summary>Anthropic Claude Code CLI（首发桥接目标）。</summary>
        ClaudeCode,

        /// <summary>Cursor IDE agent（预留）。</summary>
        Cursor,

        /// <summary>Cline VS Code 扩展（预留）。</summary>
        Cline,

        /// <summary>Aider CLI（预留）。</summary>
        Aider,

        /// <summary>OpenAI Codex CLI（预留）。</summary>
        Codex,

        /// <summary>自定义引擎（预留 · 由调用方提供 Adapter）。</summary>
        Custom
    }
    
    /// <summary>
    /// External 运动皮层描述符
    /// </summary>
    public sealed class ExternalMotorCortexDescriptor : MotorCortexDescriptor
    {
        // These public properties are part of the adapter contract and will be read by adapter
        // implementations. The getters are intentionally public API; suppress the "getter never
        // used" analyzer warning that fires because no in-tree call site reads them yet.
#pragma warning disable IDE0051
        /// <summary>外部引擎种类（v1 仅 ClaudeCode）。</summary>
        public ExternalEngineKind EngineKind { get; }

        /// <summary>引擎接入点——CLI 路径 / HTTP URL 等。</summary>
        public string EngineEndpoint { get; }

        /// <summary>引擎自有配置（key-value · 由具体 Adapter 解析）。</summary>
        public IReadOnlyDictionary<string, object> AdapterConfig { get; }
#pragma warning restore IDE0051

        /// <summary>Memory 共享桥模式（默认 <see cref="MemoryShareMode.McpServer"/>）。</summary>
        public MemoryShareMode MemoryShareMode { get; set; } = MemoryShareMode.McpServer;

        public ExternalMotorCortexDescriptor(string brainId, string systemPrompt,
            ExternalEngineKind engineKind, string engineEndpoint,
            string name = "ExternalMotorCortex",
            string identity = "外部引擎运动皮层",
            IReadOnlyDictionary<string, object>? adapterConfig = null)
            : base(brainId, systemPrompt, name, identity)
        {
            if (!brainId.StartsWith("motor-cortex.", StringComparison.Ordinal))
                throw new InvalidOperationException(
                    $"ExternalMotorCortexDescriptor.BrainId 必须以 'motor-cortex.' 开头（实际: '{brainId}'）");
            if (string.IsNullOrWhiteSpace(engineEndpoint))
                throw new ArgumentException(
                    "ExternalMotorCortexDescriptor.EngineEndpoint 不能为空", nameof(engineEndpoint));

            EngineKind = engineKind;
            EngineEndpoint = engineEndpoint;
            AdapterConfig = adapterConfig ?? new Dictionary<string, object>();
        }
    }
}
