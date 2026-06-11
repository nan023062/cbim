#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace CBIM.Workspace
{
    /// <summary>
    /// 把 LLM 给的 JSON 字符串数组解析为已激活的 <see cref="Module"/> 实例清单——
    /// <b>派发路径的单一权威</b>，被「synapse 工具」（<c>SynapseToolFactory</c>）与
    /// 「编译回路」（<c>BrainCallExecutor</c>）共享。两条派发路径必须用同一份解析逻辑，
    /// 否则编译期 NeuronInput.Modules 漂移会导致 MotorCortex 的文件沙箱错位。
    ///
    /// <para>解析规则（与 SynapseToolFactory 旧 ResolveModuleIds 等价）：
    /// <list type="bullet">
    /// <item>null / 空白 / JSON 解析失败 → 返回空列表（工作脑因此无文件权限，符合 Q8 fail-hard）；</item>
    /// <item>每个 id 必须命中 <see cref="WorkspaceSystem.ContainsDescription"/>，否则跳过（不静默接收陌生 id）；</item>
    /// <item>每个命中 description 用 <see cref="WorkspaceSystem.OpenInstance"/> 激活一个新 Module 实例，
    ///       工作区根 = <c>RootPath/&lt;id&gt;</c>（id == "." 时直接用 <c>RootPath</c>）；</item>
    /// <item><c>activatedByTaskId</c> 暂传 null——上层未定记账需求。</item>
    /// </list></para>
    /// </summary>
    internal static class ModuleResolver
    {
        /// <summary>解析并激活 Module 列表；workspace == null 时返回空列表（降级 / 测试模式）。</summary>
        internal static IReadOnlyList<Module> Resolve(string? moduleIdsJson, WorkspaceSystem? workspace)
        {
            if (workspace == null) return Array.Empty<Module>();
            if (string.IsNullOrWhiteSpace(moduleIdsJson)) return Array.Empty<Module>();

            string[]? ids;
            try
            {
                ids = JsonSerializer.Deserialize<string[]>(moduleIdsJson);
            }
            catch (JsonException)
            {
                return Array.Empty<Module>();
            }

            if (ids == null || ids.Length == 0) return Array.Empty<Module>();

            var rootPath = workspace.RootPath;
            var resolved = new List<Module>(ids.Length);
            foreach (var raw in ids)
            {
                if (string.IsNullOrWhiteSpace(raw)) continue;
                string id = raw.Trim();
                if (!workspace.ContainsDescription(id)) continue;
                string moduleRoot = string.Equals(id, ".", StringComparison.Ordinal)
                    ? rootPath
                    : Path.GetFullPath(Path.Combine(rootPath, id));
                var instance = workspace.OpenInstance(id, moduleRoot, activatedByTaskId: null);
                resolved.Add(instance);
            }

            return resolved;
        }
    }
}