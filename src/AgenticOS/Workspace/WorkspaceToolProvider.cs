using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.AI;

namespace CBIM.Workspace;

/// <summary>
/// Workspace 维度的 AITool 提供者——目前仅产出主脑用的 <c>module_list</c> 只读工具。
///
/// <para>主脑（PrefrontalCortex）调度 MotorCortex 时，需要先了解工作区有哪些模块，
/// 才能在 <c>__brain_call_*</c> 的 moduleIdsJson 入参里报上正确的 module id。</para>
/// </summary>
public static class WorkspaceToolProvider
{
    /// <summary>
    /// 返回主脑用的 Workspace 工具集。当前只有 <c>module_list</c>。
    /// </summary>
    public static IReadOnlyList<AITool> GetReadOnlyTools(WorkspaceSystem? workspace)
    {
        if (workspace == null)
            return Array.Empty<AITool>();
        return new List<AITool>(1) { BuildModuleListTool(workspace) };
    }

    private static AIFunction BuildModuleListTool(WorkspaceSystem workspace)
    {
        var trampoline = new ModuleListTrampoline(workspace);
        var method = typeof(ModuleListTrampoline).GetMethod(
            nameof(ModuleListTrampoline.Invoke),
            BindingFlags.Instance | BindingFlags.Public);
        if (method == null)
            throw new InvalidOperationException("ModuleListTrampoline.Invoke 未找到——内部不变量违反。");

        return AIFunctionFactory.Create(
            method,
            target: trampoline,
            name: "module_list",
            description:
            "List every registered Module Description in the current workspace. " +
            "Returns a JSON array of {id, name, metadataKind, metadataLocation}. " +
            "Use the returned ids in __brain_call_* moduleIdsJson to scope a worker brain's filesystem sandbox.");
    }

    private sealed class ModuleListTrampoline
    {
        private readonly WorkspaceSystem _ws;

        public ModuleListTrampoline(WorkspaceSystem ws)
        {
            _ws = ws;
        }

        public string Invoke()
        {
            var descs = _ws.ListDescriptions();
            var list = new List<Dictionary<string, object>>(descs.Count);
            foreach (var d in descs)
            {
                if (d == null)
                    continue;
                list.Add(new Dictionary<string, object>
                {
                    { "id", d.Id },
                    { "name", d.Name },
                    { "metadataKind", d.Metadata.Kind.ToString() },
                    { "metadataLocation", d.Metadata.Location },
                });
            }

            list.Sort((a, b) => string.CompareOrdinal((string)a["id"], (string)b["id"]));
            return JsonSerializer.Serialize(list);
        }
    }
}
