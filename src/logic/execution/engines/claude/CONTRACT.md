

# Claude Code 适配契约

## 无进展超时

`ClaudeCodeEngine.run` 使用共享 [无进展计时器](../CONTRACT.md#按执行进展续期)。SDK 文本/推理/参数的非空增量（包括子任务）和工具 Hook 的实际开始/完成续期，普通 status 消息不续期。连续静默时关闭 Query 并保存具体原因；迟到 result 不能覆盖已发生的超时，显式停止仍为取消。

engine.ts 使用固定 Claude Agent SDK Query，sdk.ts 只解析 CBIM 自带 claude-runtime 或开发依赖；SDK 与平台二进制独立随包，不访问 Cindy 的安装或账号。settingSources 为空，strictMcpConfig 开启，插件清单为空；继承的 Claude/Anthropic 凭据与启动注入被移除。真实模型、地址及推理开关取冻结快照。Pi 专属工作上下文/压缩阈值不映射成 Claude 保证。

工具经 tools.ts 的 PreToolUse 调用同一 beforeTool，先保存授权及 started，再允许执行。内部 SDK MCP 不监听端口；每次内部调用用真实 tool_use_id 绑定准确原参数并消耗一次性许可，模型不能提供该身份。原生 Read/Write/Edit/Bash/Glob/Grep 映射到现有规范名称。scopedExecutionTools 存在时不提供任何原生文件/命令工具。初始化必须确认 hooks_applied 与 hook_on_failure_supported，失败默认阻断；实际活动目录与准备目录逐名核对。

Claude 原生工具可在 SSE 终态到达前启动。PreToolUse 必须先等待本轮实际请求全部可靠结算，再进入业务授权；结算失败或停止会关闭 Query 并阻止副作用，不能只靠暂存终态帧作工具屏障。已有调用与已知用量不重放或撤销。

Anthropic API 不接受顶层 anyOf/oneOf。目录将联合输入投影为对象字段和共同必填项；投影前把原 Schema 留在不冲突的 definitions 节点，本地引用同步迁移到原图，避免删除顶层分支后指针悬空，也不通过无限展开破坏递归。原 CBIM 参数校验仍在可信入口严格执行；这不放宽领域授权。MCP 不发布不兼容的联合 outputSchema，实际结果仍经原端口及通用结果校验。私有推理不进入公开事件，工具结果保存后才返回模型。

首轮在 SDK result 时核实实际 JSONL 路径、身份及工作区，再发布 session.bound；不预造会话文件。成员 ready 允许此首轮延迟绑定，结算时核实同一原生身份。续执行在启动前核实原文件并复核检查点，主会话切换由上层选择目标引擎文件。停止先中止内部工具及请求传输，再中断/关闭 Query；未知工具仍由 Runtime 保留。只认真实 result，不把正文当完成；当前没有 steer。

SDK 0.3.322 的实际 schema 运行依赖是 zod/v4 与 zod/v4/core。工程保留 zod 3.25.76 的双版本入口，对该 SDK 显式允许这一已核实组合；未全局升级业务 Zod 3 Schema。复制运行资源时包含 SDK peer 与本平台二进制依赖。

### 通用能力注入

工具从 EngineContext.capabilities 的通用工具目录注册；可信能力 disableNativeTools=true 时关闭全部原生文件和命令，不依赖某个业务工具槽位。业务指引作为可信装配说明传入，授权、原调用身份、结果保存与停止顺序保持原协议。

### 失败后的核实

内部调用沿共同端口返回统一错误结构；原生 PostToolUseFailure 保留错误并用相同 outcome 记录日志及 additionalContext。没有领域回执时明确 null，不把异常当回滚或授权重放。


### 凭据文本替换

精确字符串替换使用后端 utility 的 redactLiteral，仍由引擎选择凭据及触发路径。Pi 保留 api-key 条件，Claude 无凭据时保留事件引用；JSON 编码后替换与异常路径保持原顺序，不新增凭据搜集、正则或解码规则。
