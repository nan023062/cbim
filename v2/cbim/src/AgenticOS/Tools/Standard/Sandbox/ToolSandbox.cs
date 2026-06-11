using System.Collections.Concurrent;
using System.Collections.Generic;
using CBIM.Kernel;

namespace CBIM.Tools.Standard
{
    // 不可变的、按模块隔离的沙箱描述符。承载路径前缀白名单
    // 以及每个工具族都会用到的若干硬性上限。
    //
    // 仅在构造期使用：工具实例绑定到唯一一个 ToolSandbox，
    // 运行时不允许替换（见 module.md "Iron Rule 2"）。
    //
    // 例外：SideEffects 是 append-only 遥测队列（不是配置态），由 StandardTools
    // 在每次副作用调用（bash / file.write / file.edit / file.delete）后入队，
    // Brain 层在脑区调用结束时整体出队归入 NeuronOutcome.SideEffects。
    public sealed class ToolSandbox
    {
        public IReadOnlyList<string> AllowedPathPrefixes { get; }
        public string WorkingDirectory { get; }
        public long MaxFileBytes { get; }
        public long MaxResultBytes { get; }
        public IReadOnlyList<string> BlockedExtensions { get; }
        public IReadOnlyList<string> WebAllowedHosts { get; }

        /// <summary>
        /// 本次脑区调用期间产生的副作用记录队列——线程安全（并行工具轮次会并发入队）。
        /// 仅 append；Brain 层调用结束后 drain 一次性归入 <see cref="NeuronOutcome.SideEffects"/>。
        /// </summary>
        internal ConcurrentQueue<SideEffect> SideEffects { get; } = new ConcurrentQueue<SideEffect>();

        public ToolSandbox(
            IReadOnlyList<string> allowedPathPrefixes,
            string workingDirectory = "",
            long maxFileBytes = 10L * 1024 * 1024,
            long maxResultBytes = 10L * 1024 * 1024,
            IReadOnlyList<string> blockedExtensions = null,
            IReadOnlyList<string> webAllowedHosts = null)
        {
            AllowedPathPrefixes = allowedPathPrefixes ?? new string[0];
            WorkingDirectory = workingDirectory ?? string.Empty;
            MaxFileBytes = maxFileBytes;
            MaxResultBytes = maxResultBytes;
            BlockedExtensions = blockedExtensions ?? new string[0];
            WebAllowedHosts = webAllowedHosts ?? new string[0];
        }
    }
}
