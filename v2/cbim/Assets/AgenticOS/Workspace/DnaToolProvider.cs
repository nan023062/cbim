using System;
using System.Collections.Generic;
using Microsoft.Extensions.AI;

namespace CBIM.Workspace
{
    /// <summary>
    /// DNA AITool 提供者——按读写权限返回 dna_* 工具列表。
    ///
    /// <para>权限分层：
    /// <list type="bullet">
    /// <item><see cref="GetReadWriteTools"/> — 读+写（仅 ParietalLobe 调用）</item>
    /// <item><see cref="GetReadOnlyTools"/> — 只读（PrefrontalCortex / Hippocampus 等其他内置脑调用）</item>
    /// </list>
    /// </para>
    /// </summary>
    public static class DnaToolProvider
    {
        /// <summary>
        /// 读+写 DNA 工具集（供 ParietalLobe）。
        /// </summary>
        public static IReadOnlyList<AITool> GetReadWriteTools() =>
            Array.Empty<AITool>();  // TODO: 接入实际 dna_* 读写工具

        /// <summary>
        /// 只读 DNA 工具集（供其他内置脑）。
        /// </summary>
        public static IReadOnlyList<AITool> GetReadOnlyTools() =>
            Array.Empty<AITool>();  // TODO: 接入实际 dna_* 只读工具
    }
}
