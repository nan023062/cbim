# 运行装配的上下文边界

## 统一 Agent 工具执行

可信 `ExecutionLaunchContext.executionModel` 选择新调用模型，公开运行选项不能自行改协议。`agent-calls.ts` 组合 Agent 对象、execution 的 AgentCallScheduler 与 LoopRuntime；主与子直接使用同一 Runtime 生命周期，prepare 只通过现有 GlobalRunAdmission 领取真实许可。新主运行只建立无 goal 的预算作用域、持有真实主运行并在终态关闭；不由旧 AutoCollaboration 同时推进。

根工作区租约在子调用中保留，子独立领取 GlobalRunAdmission 名额。Runtime 先核实父工具批次独占并阻止父并发工具，后代排空才释放根。子 Agent 使用冻结岗位指令与自己的引擎、模型、凭据和价格端口；账本作用域仍归根，agentRun 只标记实际子请求来源。捕获配置时再次核实哈希，不继承根 process 覆盖。未确认配置、旧非逐请求预算和缺少真实准入均明确拒绝，不降权限或绕过计量。子问题端口经 Runtime 独占核验，只交给调度器中的直接调用方；回复续跑同一 child runtime。详见 [Agent 契约](../../agents/CONTRACT.md)。

## 旧派发读取与恢复

`member-dispatch` 在成员领取提交后读取唯一 DispatchStore，按该轮冻结 `topicContext` 引用解析当前办公室、话题和角色的有界资料，再交给共用 `memberExecutionPrompt`。版本或引用变化拒绝启动，不回退到最近话题；上下文引用不另存一份聊天正文。Pi、Claude Code、Codex 共用这条装配链，仍沿原任务的原生身份和检查点证明执行。

其他装配入口继续由 Application 持有唯一生命周期；本模块不成为第二份调度状态源，不把界面选择或角色名称当作授权。

### 多角色装配

主运行解析 options.modelRoles；成员运行消费领取事务冻结的 ResolvedEngineModel，不二次查询选型。主模型及附加角色凭据都只存在可信准备结果，公开任务快照只保存无密钥配置。

### 逐角色预算工厂传播

主/成员装配把统一适配器请求的 role 传给同一工作区 ModelRequestBudgetService.forRun；省略 role 沿 primary。角色身份、配置与价格只能从原冻结模型快照取得，不从工具请求读取。

递归模型捕获使用 EngineModelProfiles，包括岗位冻结的 modelRoles；根与子预算均按 role 缓存独立计价端口，继续共享根账本。子发送门禁作为 forRun 第四参，与第三参角色选型分离。

## Agent 业务验证迁移

`cbim_agent_call.business` 显式给出模块、验收项及可选 Workflow。agent-business 在原岗位、来源和模型快照下冻结知识，再注入既有采集、JSON/CSV/PNG、清单和代码检查端口。普通调用保持 chat；业务调用使用 LoopRuntime.startMember 的可信身份入口，保留 agent-tools-v1 与父工具引用，不创建派发图任务、消息队列或 Team UI。

TaskNode/DispatchRun 在本装配中仅是既有知识冻结及 canonical 验证器所需的私有输入投影，不写入 DispatchStore，不代表旧派发已发生。真实副作用与结算事实来自 LoopRuntime 的原始日志。再次核验读取同一 taskId/runId 的 canonical 和当前文件；不重启模型、不修改旧证据、不声明人工验收。原知识变化拒绝核验。需要隔离执行而尚未装配的平台能力明确拒绝启动，不降级到普通命令。

模型配置捕获使用 workspaceMemberEngine 的原缺省值；实际执行可默认 Pi，但不得把 engine 字段补进既有采纳快照而改变其哈希。业务递归不能省略业务上下文或扩大父模块范围。旧人工目标决策与持久检查点流程仍属历史协议，未在本次九项文件验证迁移中改写。
