using System.Collections.Generic;
using CBIM.LlmClient;

namespace CBIM.Mind
{
    /// <summary>
    /// MotorCortex（运动皮层）—— 工作脑。
    /// 沙箱白名单按 NeuronInput.Modules 逐次重建（见 <see cref="Brain.ExecuteInvokeAsync"/>）；
    /// 每次调用启用 files + search + bash 三族标准工具，受指派 Module.WorkspaceRoot 限定。
    /// </summary>
    public class MotorCortex : Brain
    {
        public sealed override BrainKind Kind => BrainKind.MotorCortex;

        public MotorCortex(IBrainAgent agent, ChatClientFactory chatClientFactory, MotorCortexDescriptor descriptor)
            : base(agent, chatClientFactory, descriptor)
        {
        }
    }

    /// <summary>
    /// 擅长专业领域的工作执行、工具使用、问题解决等「干活」的运动皮层描述符。
    ///
    /// <para>ToolIds 默认写入 <c>files + search + bash</c> 三族——这是工作脑权限模型的硬上限：
    /// 文件读写、grep/glob、bash 全部按 Module.WorkspaceRoot 沙箱限定。
    /// 调用方仍可通过下方公开 ctor 自定义 ToolIds（用于裁剪）。</para>
    /// </summary>
    public class MotorCortexDescriptor : BrainDescriptor
    {
        /// <summary>工作脑默认工具家族——files (含 readfile/writefile/editfile/deletefile/listdir) + search + bash。</summary>
        public static readonly IReadOnlyList<string> DefaultWorkerToolIds = new[]
        {
            "files", "search", "bash",
        };

        public MotorCortexDescriptor(string brainId, string systemPrompt, string name = "", string identity = "")
            : base(brainId, systemPrompt, name, identity, toolIds: DefaultWorkerToolIds)
        {
        }

        /// <summary>
        /// 自定义构造——允许 caller 裁剪 ToolIds（例如只要读写文件、不要 bash）。
        /// 仍受 BrainKind 写死的「沙箱白名单 = 指派 Modules.WorkspaceRoot」上限约束。
        /// </summary>
        public MotorCortexDescriptor(
            string brainId,
            string systemPrompt,
            string name,
            string identity,
            IReadOnlyList<string> toolIds)
            : base(brainId, systemPrompt, name, identity, toolIds: toolIds ?? DefaultWorkerToolIds)
        {
        }
    }
}
