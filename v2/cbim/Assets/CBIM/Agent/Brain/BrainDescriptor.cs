using System;

namespace CBIM.AgentSystem
{
    /// <summary>
    /// 脑区描述符公共基类——声明「这是什么脑区」的静态信息（不含运行态资源）。
    /// </summary>
    public abstract class BrainDescriptor
    {
        /// <summary>脑区在 AgentInstance 内的唯一标识。如 "prefrontal-cortex" / "motor-cortex.claude-code"。</summary>
        public string BrainId { get; }

        /// <summary>脑区的系统提示词（装入 ChatClientAgentOptions.Instructions）。</summary>
        public string SystemPrompt { get; }

        /// <summary>
        /// 期望使用的 LLM 模型标识（可空）——传给 <see cref="IChatClientFactory.Create"/> 供工厂路由。
        /// 例："gpt-4o" / "gpt-4o-mini" / "claude-sonnet-4"。
        /// null 表示由工厂自行决策（回退到默认模型）。
        /// </summary>
        public string ModelHint { get; set; }

        protected BrainDescriptor(string brainId, string systemPrompt)
        {
            if (string.IsNullOrWhiteSpace(brainId))
                throw new ArgumentException("BrainDescriptor.BrainId 不能为空", nameof(brainId));
            
            if (string.IsNullOrWhiteSpace(systemPrompt))
                throw new ArgumentException("BrainDescriptor.SystemPrompt 不能为空——脑区必须有系统提示词", nameof(systemPrompt));

            BrainId = brainId;
            SystemPrompt = systemPrompt;
        }
    }
}
