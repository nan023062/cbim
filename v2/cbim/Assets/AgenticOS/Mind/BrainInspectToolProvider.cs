#nullable enable
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.AI;

namespace CBIM.Mind
{
    /// <summary>
    /// 主脑（PrefrontalCortex）的脑区自省工具集——只读，专供 PrefrontalCortex 使用。
    ///
    /// <para>解决 Q1：让主脑在调度前能 (1) 列出可调子脑区描述符，(2) 取单个脑区的运行时状态。
    /// 不暴露任何写入或副作用入口。</para>
    /// </summary>
    public static class BrainInspectToolProvider
    {
        /// <summary>
        /// 返回 brain_list + brain_get 两个只读 AIFunction。
        /// </summary>
        public static IReadOnlyList<AITool> GetReadOnlyTools(IBrainAgent agent)
        {
            if (agent == null) return Array.Empty<AITool>();
            return new List<AITool>(2)
            {
                BuildListTool(agent),
                BuildGetTool(agent),
            };
        }

        #region brain_list

        private static AIFunction BuildListTool(IBrainAgent agent)
        {
            var t = new ListTrampoline(agent);
            return AIFunctionFactory.Create(
                ResolveMethod(typeof(ListTrampoline), nameof(ListTrampoline.Invoke)),
                target: t,
                name: "brain_list",
                description:
                    "List the descriptors of every callable sub-brain. " +
                    "Returns a JSON array of {brainId, kind, name, identity, modelId, toolIds, mcpIds, " +
                    "skillIds, workflowIds, contextWindowTokens}.");
        }

        private sealed class ListTrampoline
        {
            private readonly IBrainAgent _agent;
            public ListTrampoline(IBrainAgent agent) { _agent = agent; }

            public string Invoke()
            {
                var callables = _agent.CallableBrains;
                var list = new List<Dictionary<string, object?>>(callables.Count);
                foreach (var b in callables)
                {
                    if (b == null) continue;
                    list.Add(BrainDescriptorToDict(b));
                }
                return JsonSerializer.Serialize(list);
            }
        }

        #endregion

        #region brain_get

        private static AIFunction BuildGetTool(IBrainAgent agent)
        {
            var t = new GetTrampoline(agent);
            return AIFunctionFactory.Create(
                ResolveMethod(typeof(GetTrampoline), nameof(GetTrampoline.Invoke)),
                target: t,
                name: "brain_get",
                description:
                    "Read one callable sub-brain's descriptor + live runtime state. " +
                    "Returns descriptor fields plus {isProcessing, contextMessageCount, contextTokenEstimate, " +
                    "cumulativeUsage:{input,output,total}}; returns 'null' if brainId is unknown.");
        }

        private sealed class GetTrampoline
        {
            private readonly IBrainAgent _agent;
            public GetTrampoline(IBrainAgent agent) { _agent = agent; }

            public string Invoke(
                [Description("Brain id from brain_list. Must match exactly.")]
                string brainId)
            {
                if (string.IsNullOrWhiteSpace(brainId))
                    return "null";
                Brain? hit = null;
                foreach (var b in _agent.CallableBrains)
                {
                    if (b != null && string.Equals(b.BrainId, brainId, StringComparison.Ordinal))
                    {
                        hit = b;
                        break;
                    }
                }
                if (hit == null) return "null";

                var doc = BrainDescriptorToDict(hit);
                doc["isProcessing"] = hit.IsProcessing;
                doc["contextMessageCount"] = hit.ContextMessageCount;
                doc["contextTokenEstimate"] = hit.ContextTokenEstimate;
                doc["cumulativeUsage"] = new Dictionary<string, object>
                {
                    { "input", hit.CumulativeUsage.InputTokens },
                    { "output", hit.CumulativeUsage.OutputTokens },
                    { "total", hit.CumulativeUsage.TotalTokens },
                };
                return JsonSerializer.Serialize(doc);
            }
        }

        #endregion

        #region 共享辅助

        private static Dictionary<string, object?> BrainDescriptorToDict(Brain b)
        {
            var d = b.Descriptor;
            return new Dictionary<string, object?>
            {
                { "brainId", b.BrainId },
                { "kind", b.Kind.ToString() },
                { "name", d.Name },
                { "identity", d.Identity },
                { "modelId", d.ModelId },
                { "toolIds", d.ToolIds },
                { "mcpIds", d.McpIds },
                { "skillIds", d.SkillIds },
                { "workflowIds", d.WorkflowIds },
                { "contextWindowTokens", d.ContextWindowTokens },
            };
        }

        private static MethodInfo ResolveMethod(Type trampolineType, string methodName)
        {
            var method = trampolineType.GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public);
            if (method == null)
                throw new InvalidOperationException(
                    $"未找到 {trampolineType.Name}.{methodName}——内部不变量违反。");
            return method;
        }

        #endregion
    }
}
