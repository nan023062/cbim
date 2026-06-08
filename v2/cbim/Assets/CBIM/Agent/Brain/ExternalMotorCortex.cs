using System;
using System.Collections.Generic;

namespace CBIM.AgentSystem
{
    /// <summary>
    /// ExternalMotorCortex —— 桥接外部 agent 引擎（Claude Code / Cursor / Cline 等）的运动皮层抽象。
    /// </summary>
    public abstract class ExternalMotorCortex : MotorCortex
    {
        /// <summary>Memory 与外部引擎的共享桥模式——从描述符透传。</summary>
        public MemoryShareMode ShareMode => _descriptor.MemoryShareMode;

        private ExternalMotorCortexDescriptor _descriptor;

        protected ExternalMotorCortex(IBrainAgent agent, ExternalMotorCortexDescriptor descriptor): 
            base( agent, descriptor)
        {
            _descriptor = descriptor;
        }
    }
    
    /// <summary>
    /// External 运动皮层描述符
    /// </summary>
    public sealed class ExternalMotorCortexDescriptor : MotorCortexDescriptor
    {
        /// <summary>外部引擎种类（v1 仅 ClaudeCode）。</summary>
        public ExternalEngineKind EngineKind { get; }

        /// <summary>引擎接入点——CLI 路径 / HTTP URL 等。</summary>
        public string EngineEndpoint { get; }

        /// <summary>引擎自有配置（key-value · 由具体 Adapter 解析）。</summary>
        public IReadOnlyDictionary<string, object> AdapterConfig { get; }

        /// <summary>Memory 共享桥模式（默认 <see cref="MemoryShareMode.McpServer"/>）。</summary>
        public MemoryShareMode MemoryShareMode { get; set; } = MemoryShareMode.McpServer;

        public ExternalMotorCortexDescriptor(string brainId, string systemPrompt,
            ExternalEngineKind engineKind, string engineEndpoint,
            IReadOnlyDictionary<string, object>? adapterConfig = null)
            : base(brainId, systemPrompt)
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
