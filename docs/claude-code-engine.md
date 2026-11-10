# Claude Code 与多引擎配置

CBIM 支持 Pi、Claude Code 及 [Codex](codex-engine.md)。各引擎共用任务、权限、知识、岗位和证据服务，分别管理自己的原生会话。Claude 接法参考 [Cindy 的 SDK 装配](https://github.com/makecindy/cindy/blob/main/packages/maker-cc-manager/src/sdk-handlers.ts)，使用 [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/typescript)；运行资源与账号由 CBIM 独立管理。

## 如何配置

1. 在“设置 → 模型供应商”添加配置，选择 Loop 引擎。Claude Code 使用 Anthropic Messages 接口，填写服务地址、凭据与真实模型 ID；同一服务要供多个引擎使用时，分别保存配置。
2. 在静态 Agent 编辑器选择默认引擎和模型。新岗位登记可预选该配置，已登记岗位通过岗位表单独立修改；原模型失效会提示重新选择。
3. 在主 Agent 输入栏先选择 Loop 引擎，再选择该引擎下的模型。菜单只展示用户已配置的启用模型；选择影响下一轮和新排队项，不热替换正在执行的运行。

旧供应商未声明 engine 时继续使用 Pi，历史快照不补字段。岗位配置指纹包含显式引擎，配置被改动后仍需明确采纳。导出 Team/Agent 资源时移除本机默认模型引用，不传递密钥或无效的机器内身份。

## 维护者需要知道的边界

| 修改目的 | 入口与责任 |
| --- | --- |
| 增加配置字段或菜单规则 | [引擎契约](../src/backend/core/brain/llm/engine.ts)、[供应商契约](../src/backend/core/brain/llm/config.ts)、[共用选择器](../src/frontend/components/EngineModelPicker.tsx) |
| 修改 Claude 协议或进程生命周期 | [ClaudeCodeEngine](../src/backend/core/brain/claude/engine.ts)、[工具适配](../src/backend/core/brain/claude/tools.ts) |
| 修改业务工具或角色要求 | [共享路由](../src/backend/core/brain/engine-tools.ts)、[共享指引](../src/backend/core/brain/engine-instructions.ts)，不分别修改各个引擎 |
| 修改切换引擎的历史接续 | [会话选择](../src/backend/core/brain/engine-session.ts)、[LoopRuntime](../src/backend/core/brain/runtime.ts) |
| 修改真实模型装配或岗位绑定 | [运行工厂](../src/backend/scheduler-engine/execution/loop-engine.ts)、[成员生命周期](../src/backend/scheduler-engine/execution/member-execution.ts) |

Claude SDK 的内部工具传输只服务当前进程，不开放对外 MCP。PreToolUse 先走原 CBIM 授权并保存真实调用身份；内部调用消耗精确参数的一次性许可。原生工具与内部工具都记录同一套回执。Anthropic 不接受顶层联合工具 Schema，因此目录展示为对象字段，原领域入口继续严格校验分支。

Claude 首轮原生文件在实际结果产生后核实和绑定；不生成占位历史。成员首轮允许延迟绑定，检查点及续执行仍要求已核实的原文件。主会话跨引擎时恢复目标引擎自己的文件，并转交其缺失的公开对话资料；损坏或未决历史不能直接恢复，工具不会重放。

## 当前能力与验证范围

- 已验证真实原生进程的文本流、内部工具调用、原生读取、授权写入与命令执行、拒绝与授权保存失败、停止、原生恢复，以及完整 Application 中 Pi → Claude → Pi 切换和真实成员启动。
- 请求预算共用父进程代理；实际请求先预留和保存发送意图，可靠结算后才放行工具并交付响应终态。仅暂存终态不能阻止 Claude 提前调用工具，因此授权前还会等待账本保存。
- Claude Code 当前支持排队，不支持已确认的运行内插入；工作上下文预算及压缩阈值仍由其原生策略管理，Pi 专属配置不覆盖它。
- Claude 使用所选模型的推理开关与最大输出；供应商必须实际兼容该模型/接口。连接测试只验证短文本，不证明工具调用和业务质量。
- 本轮使用本机可控响应验证真实引擎，不代表线上供应商、完整桌面 UI、完整安装包或升级验收已通过。具体命令与结果见[开发记录](../design/development-log.md)。
