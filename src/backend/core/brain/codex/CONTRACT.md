# Codex 适配边界

`CodexEngine` 实现公共 `AgentEngine`。固定 `@openai/codex@0.167.0` 及平台二进制通过 stdio App Server 运行；不使用 PATH 客户端、外部账号、用户 Codex HOME 或 Cindy 的运行进程。依赖方向为装配 → 引擎 → 公共契约，业务调度不进入 RPC 层。

## 生命周期与原生身份

`CodexRpc` 区分宿主请求、服务端工具请求和顺序通知，响应关联不等待工具授权。协议失败/超时终止原进程，不能重发操作；close 等待进程及已收到处理排空。主会话和成员分别持有自己的 Codex HOME。

新建 thread 由服务端分配 ID，实际回执经 `session.bound` 落盘。成员只在首次 starting→running 采纳该 ID，不能用逻辑 agentSessionId 伪造原生线程。恢复必须核对私有 sessions 目录、完整 JSONL、metadata.id/cwd、文件名及当前工具是否已注册；在 thread/resume 前再次核实完整成员恢复证明。恢复会追加 thread_settings_applied，因此动作后核对实际线程/文件身份，不再将原生自己的追加误当作旧证明损坏。跨引擎主会话恢复目标引擎自己的 ID/文件，并只转交公开历史资料。

## 工具与权限

启动时关闭原生 shell、编辑、web、MCP、插件、hooks、记忆和额外实验功能；不加载工程 AGENTS 指令。内部 cbim 工具与宿主文件操作注册为 dynamicTools。后者复用固定 Pi SDK 的独立操作，不运行 Pi 循环。

每次请求核对 threadId、turnId、callId 和唯一调用身份；先等本轮已发请求可靠结算，再走 Runtime.beforeTool，保存结果后回包。原生 `request_user_input` 不发布给模型且不处理其宿主请求，用户交互统一走已有 CBIM 工具。冻结范围成员只注册范围端口，不注册文件/命令旁路。只读模式不发布写入/命令工具；原生线程可保存全工具注册信息，但每次实际请求按当前权限投影，并在调用端再次核对。

## 请求与统计

`model-proxy` 固定供应商目标、模型、当前工具及 max_output_tokens；真实密钥只在父进程。只转发 /responses，远端专用压缩接口未接入时明确失败。启用请求预算则复用共享 reserve/issue/report/unknown 账本。无论是否启用预算，完整 SSE/usage 通过共享解析器核实，断流不补零、不自动重试。

本轮用量来自实际 HTTP 响应求和，不取恢复线程的历史累计数。仅完整成功轮次发布 run-usage；价格来自本轮冻结配置，未知价格保留未知。模型结束仅表示执行回合结束，不是业务验收。

## 当前边界

支持排队、停止、文本/图片输入、工具调用和同引擎恢复；没有实现运行内插入确认。恢复时新增工具名称需要新建对话，因为 App Server 恢复接口不接受替换 dynamicTools。原生文件含引擎自行保存的私有内容，公开 CBIM 事件只投影助手正文和工具回执，不转发私有推理。测试使用真实二进制与本机确定性模型，不等于线上模型或整包桌面验收。

### 通用能力注入

工具从 EngineContext.tools 的通用目录注册；nativeTools=disabled 时关闭全部原生文件和命令，不依赖某个业务工具槽位。业务指引作为可信装配说明传入，授权、原调用身份、结果保存与停止顺序保持原协议。
