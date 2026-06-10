using System;
using System.Collections.Generic;
using Microsoft.Extensions.AI;

namespace CBIM.Memory
{
    /// <summary>
    /// Memory AITool 提供者——按读写权限返回 memory_* 工具列表。
    ///
    /// <para>权限分层：
    /// <list type="bullet">
    /// <item><see cref="GetReadWriteTools"/> — 读+写（仅 Hippocampus 调用）</item>
    /// <item><see cref="GetReadOnlyTools"/> — 只读（PrefrontalCortex / ParietalLobe 等其他内置脑调用）</item>
    /// </list>
    /// </para>
    /// </summary>
    public static class MemoryToolProvider
    {
        /// <summary>
        /// 读+写 Memory 工具集（供 Hippocampus）。
        /// </summary>
        public static IReadOnlyList<AITool> GetReadWriteTools(IMemoryService memory) =>
            Array.Empty<AITool>();  // TODO: 接入实际 memory_write / memory_query / memory_get / memory_scan / memory_stats

        /// <summary>
        /// 只读 Memory 工具集（供其他内置脑）。
        /// </summary>
        public static IReadOnlyList<AITool> GetReadOnlyTools(IMemoryService memory) =>
            Array.Empty<AITool>();  // TODO: 接入实际 memory_query / memory_get / memory_scan / memory_stats（不含 memory_write）
    }
}
