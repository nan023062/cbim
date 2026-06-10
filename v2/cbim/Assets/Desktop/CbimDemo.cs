using System;
using System.IO;
using CBIM.Agent;
using CBIM.LlmClient;
using CBIM;
using UnityEngine;

namespace CBIM.Desktop
{
    /// <summary>
    /// CbimDemo — 完整 AgenticOS 配置验证 Demo。
    /// </summary>
    public sealed class CbimDemo : MonoBehaviour
    {
        #region Inspector 字段

        [Header("LLM 配置")] [SerializeField] [Tooltip("LLM 提供商标识：openai / anthropic / azure / ollama")]
        private KnownProvider provider = KnownProvider.OpenAI;

        [SerializeField] [Tooltip("提供商侧模型名，如 gpt-4o-mini / claude-opus-4-8 / llama3")]
        private string modelName = "gpt-4o-mini";

        [SerializeField] [Tooltip("API Key。留空则由工厂从环境变量读取（OPENAI_API_KEY 等）。")]
        private string apiKey = "";

        [Header("Agent 配置")] [SerializeField] [Tooltip("Agent 人格/系统提示词——必填。")]
        private string agentSoul = "你是一个友善、专业的 AI 助手，回答简洁准确。";

        [SerializeField] [Tooltip("Agent 角色定位一句话简介——必填。")]
        private string agentIdentity = "通用助手，用于 CBIM 集成验证。";

        [SerializeField] [Tooltip("Phase 2 发给 Agent 的测试消息。")] [TextArea]
        private string testMessage = "你好，请用一句话介绍你自己。";

        #endregion

        #region 私有字段

        private const string ModelId = "demo-model";
        private const string AgentId = "demo-agent";
        
        [SerializeField] [Tooltip("数据根目录，相对于 Application.persistentDataPath。默认 \"CBIM\"。")]
        private string _dataPath = "CBIM";
        
        private Cbim _agenticOS;

        #endregion

        #region Unity 生命周期

        private async void Start()
        {
            try
            {
                // ================================================================
                // Phase 1：配置基础设施
                // ================================================================
                Debug.Log("[CbimDemo] Phase 1: 配置基础设施");
                Debug.Log("[CbimDemo] 状态: Phase 1: 初始化...");

                // 1a. 构造 AgentDescription
                //     内置三脑区（PrefrontalCortex / ParietalLobe / Hippocampus）由框架自动装配。
                //     prefrontalModelId 绑定 Phase 1b 中注册的 ModelDescriptor.Id。
                var agentDesc = new AgentDescription(
                    id: AgentId,
                    name: "Demo Agent",
                    soul: agentSoul,
                    identity: agentIdentity,
                    prefrontalModelId: ModelId // Phase 1b 注册的 ModelDescriptor
                );

                // 1b. 初始化 Cbim（CbimBootstrap.Initialize 内部调用 Cbim.Create，
                //     完成所有 FileStore / LlmClient / MCP / Memory / Workspace 的初始化）。
                _agenticOS?.Dispose();
                var rootPath = Path.Combine(Application.persistentDataPath, _dataPath);
                _agenticOS = Cbim.Create(new CbimOptions
                {
                    RootPath = rootPath,
                    Agent = agentDesc,
                    // MCP client 休眠：AgenticOS.Mcp 装配层被 CBIM_MCP_CLIENT define 约束排除（魔改
                    // Unity 编译 ModelContextProtocol 的 C# 11 `required` 成员触发 CS0619，跨所有 SDK
                    // 版本均不可避）。McpStarter 留空 → Cbim 走 NullMcpClientStarter，Brain 退化为
                    // StandardTools + Compiler + Memory/DNA。
                    // 接外部 MCP server 时：定义 CBIM_MCP_CLIENT 并按 Option B 在 Unity 之外预编译
                    // AgenticOS.Mcp 为 DLL 投放，再回填 McpStarter = new CBIM.Mcp.McpClientStarter()。
                });
                Debug.Log("[CbimDemo] ✓ Cbim 初始化完成");

                // 1c. 将 ModelDescriptor 写入已就绪的 ModelStore。
                //     必须在 Initialize 之后调用，因为 OS.ModelStore 此前不存在。
                //     FileModelStore.Put 是同步方法，原子写盘 + 更新内存索引。
                var modelDescriptor = new ModelDescriptor(
                    id: ModelId,
                    name: $"{provider}/{modelName}",
                    provider: provider,
                    modelName: modelName,
                    apiKey: string.IsNullOrWhiteSpace(apiKey) ? null : apiKey
                );
                _agenticOS.ModelStore.Put(modelDescriptor);
                Debug.Log($"[CbimDemo] ✓ ModelStore 注册: {modelDescriptor}");

                // ================================================================
                // Phase 2：验证 Session 链路
                // ================================================================
                Debug.Log("[CbimDemo] Phase 2: 验证 Session 链路");
                Debug.Log("[CbimDemo] 状态: Phase 2: 打开 Session...");

                // 2a. 开通 Session——Cbim.OpenSessionAsync 创建并持有独立 Agent 实例，
                //     内部生成 Guid SessionId 并将 Agent 注册到内部字典。
                var session = await _agenticOS.OpenSessionAsync();
                Debug.Log($"[CbimDemo] ✓ Session 已开启: {session.SessionId}");

                // 2b. 订阅 OnOutput 以捕获流式中间进度（[PROGRESS] 前缀）
                session.OnOutput += evt =>
                {
                    if (evt.Text.StartsWith("[PROGRESS]", StringComparison.Ordinal))
                        Debug.Log($"[CbimDemo] ◌ 进度: {evt.Text}");
                };

                // 2c. 发送测试消息，等待 SessionOutcome
                Debug.Log("[CbimDemo] 状态: Phase 2: 等待响应...");
                SessionOutcome outcome = await session.SendAsync(testMessage);

                if (outcome.IsError)
                {
                    Debug.Log($"[CbimDemo] 状态: 错误: {outcome.ErrorMessage}");
                    Debug.LogError($"[CbimDemo] ✗ Session 错误: {outcome.ErrorMessage}");
                }
                else
                {
                    Debug.Log($"[CbimDemo] 状态: 成功");
                    Debug.Log($"[CbimDemo] ✓ 响应: {outcome.ResultText}");
                }

                // 2d. 关闭 Session（从注册表移除 + Dispose Agent）
                await _agenticOS.CloseSessionAsync(session.SessionId);
                Debug.Log($"[CbimDemo] ✓ Session 已关闭: {session.SessionId}");
            }
            catch (Exception ex)
            {
                Debug.Log($"[CbimDemo] 状态: 异常: {ex.Message}");
                Debug.LogException(ex);
            }
        }
        
        private void OnDestroy()
        {
            using Cbim agenticOS = _agenticOS;
            _agenticOS = null;
        }
        
        #endregion
    }
}