# 运行装配的上下文边界

## 统一 Agent 工具执行

可信 `ExecutionLaunchContext.executionModel` 选择新调用模型，公开运行选项不能自行改协议。`agent-calls.ts` 独立装配 Agent 对象、AgentExecutionLoop 与 AgentCallScheduler；主与子使用同一生命周期协议。新主运行只建立无 goal 的预算作用域、持有真实主运行并在终态关闭；不由旧 AutoCollaboration 同时推进。

根工作区租约在子调用中保留，子独立领取 GlobalRunAdmission 名额。Runtime 先核实父工具批次独占并阻止父并发工具，后代排空才释放根。子 Agent 使用冻结岗位指令与同一模型预算端口；模型不一致、未确认配置、旧非逐请求预算和缺少真实准入均明确拒绝，不降权限或绕过计量。详见 [Agent 契约](../../agents/CONTRACT.md)。

## 旧派发读取与恢复

`member-dispatch` 在成员领取提交后读取唯一 DispatchStore，按该轮冻结 `topicContext` 引用解析当前办公室、话题和角色的有界资料，再交给共用 `memberExecutionPrompt`。版本或引用变化拒绝启动，不回退到最近话题；上下文引用不另存一份聊天正文。Pi、Claude Code、Codex 共用这条装配链，仍沿原任务的原生身份和检查点证明执行。

其他装配入口继续由 Application 持有唯一生命周期；本模块不成为第二份调度状态源，不把界面选择或角色名称当作授权。
