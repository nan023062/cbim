# Codex Loop Engine

CBIM 支持 Pi、Claude Code 和 Codex。Codex 参考 [Cindy](https://github.com/makecindy/cindy) 的 App Server 装配方式，使用固定 `@openai/codex@0.167.0` 的原生进程，通过 [App Server 协议](https://developers.openai.com/codex/app-server)管理线程、轮次和动态工具。运行资源、模型配置及原生历史归 CBIM 管理。

## 使用

1. 打开“设置 → 模型供应商”，选择 Loop 引擎 **Codex**，协议固定为 **OpenAI Responses**，填写兼容服务的地址、凭据及真实模型 ID。
2. 静态 Agent、项目岗位和主 Agent 对话栏共用引擎/模型级联菜单。菜单只列用户已配置且启用的模型；没有 Codex 配置时不会出现可选的 Codex 模型。
3. 主对话的选择影响下一轮和新排队项。岗位仍使用自己明确采纳的配置，主模型不会覆盖岗位模型。已有岗位改配置后须按原流程明确采纳。

旧配置缺少 engine 时仍使用 Pi，不改写历史指纹。同一个服务要用于多个引擎时分别保存配置。Codex 不读取 Cindy、系统 Codex 或其他客户端的账号。

## 维护入口

| 修改目的 | 代码与责任 |
| --- | --- |
| 引擎/模型菜单、协议约束 | [引擎契约](../src/backend/core/brain/llm/engine.ts)、[供应商表单](../src/frontend/settings/ModelSettings.tsx)、[共用选择器](../src/frontend/components/EngineModelPicker.tsx) |
| App Server 生命周期 | [CodexEngine](../src/backend/core/brain/codex/engine.ts)、[双向 RPC](../src/backend/core/brain/codex/rpc.ts) |
| 工具调用、取消及结果保存 | [动态工具适配](../src/backend/core/brain/codex/tools.ts)、[公共工具路由](../src/backend/core/brain/engine-tools.ts)、[宿主文件操作](../src/backend/core/brain/native-tools.ts) |
| 模型请求、输出上限与用量 | [Codex 请求代理](../src/backend/core/brain/codex/model-proxy.ts)、[共享请求账本传输](../src/backend/core/brain/llm/request-budget-transport.ts) |
| 会话恢复与成员绑定 | [原生文件检查](../src/backend/core/brain/codex/session.ts)、[目标引擎历史选择](../src/backend/core/brain/engine-session.ts)、[成员生命周期](../src/backend/scheduler-engine/execution/member-execution.ts) |
| 固定运行资源 | [原生二进制定位](../src/backend/core/brain/codex/binary.ts)、[独立资源复制](../scripts/package-pi-runtime.mjs)、[打包装配](../forge.config.ts) |

稳定的权限、知识事务、任务计划、业务证据和预算账本仍由原服务管理。Codex 的内置执行能力关闭，文件/命令通过宿主动态工具复用已有实现，每次调用仍须 CBIM 授权。冻结范围成员使用已有范围工具，不获得普通文件操作入口。

Codex 自行分配原生线程 ID；CBIM 先记录实际回执，再开始生成。成员首次采纳后固定身份，检查点仍要求完整原生文件与原证据。主对话跨引擎切换使用各自的文件和 ID，并补入其缺失的公开消息/工具结果；不会互读原生格式或重放工具。

每次 Responses 请求固定真实模型、输出上限和当前工具目录。启用逐请求预算时，先预留再发网；工具执行前等待可靠结算，保存失败阻止副作用。用量只累加本轮真实响应，恢复历史不会重复收费统计，金额使用用户配置的价格。

## 当前边界与验证

- Codex 支持排队，不提供运行内插入确认。上下文预算/压缩阈值映射到原生配置；专用远端 `/responses/compact` 未接入，不伪装成已支持。
- 原生恢复会保留最初注册的工具。新版本增加工具名称后若原线程未注册，会提示新建对话；权限和参数仍按本轮配置核对。
- 原生历史位于 `loop-engine/codex/sessions/` 或成员的 `dispatch/runs/codex/sessions/`。这些私有文件由 Codex 保存；CBIM 的公开日志不转发私有推理。
- 本机真实进程已验证文本流、工具允许/拒绝、预算结算、停止、恢复、岗位启动及 Pi → Codex → Claude → Codex → Pi 往返；资源复制验证独立平台包可启动。完整桌面交互、线上供应商和安装升级留待后续集成。实际命令见[专项验证](../design/verification/codex-engine-20261110.md)。
