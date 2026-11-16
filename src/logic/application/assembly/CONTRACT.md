# 运行装配的上下文边界

## 统一 Agent 工具执行

可信 `ExecutionLaunchContext.executionModel` 选择新调用模型，公开运行选项不能自行改协议。`agent-calls.ts` 组合 Agent 对象、execution 的 AgentCallScheduler 与 LoopRuntime；主与子直接使用同一 Runtime 生命周期，prepare 只通过现有 GlobalRunAdmission 领取真实许可。新主运行按本轮输入建立目标及预算作用域、持有真实主运行并在终态关闭；不由旧 AutoCollaboration 同时推进。

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

TaskNode/DispatchRun 在本装配中仅是既有知识冻结及 canonical 验证器所需的私有输入投影，不写入 DispatchStore，不代表旧派发已发生。真实副作用与结算事实来自 LoopRuntime 的原始日志。再次核验读取同一 taskId/runId 的 canonical 和当前文件；不重启模型、不修改旧证据、不声明人工验收。原知识变化拒绝核验。冻结的 executionScope 通过既有 ScopedExecutionFiles 装配读取、写入范围和隔离生命周期；缺少可信平台服务时明确拒绝启动，不降级到普通命令。

模型配置捕获使用 workspaceMemberEngine 的原缺省值；实际执行可默认 Pi，但不得把 engine 字段补进既有采纳快照而改变其哈希。业务递归不能省略业务上下文或扩大父模块范围。旧人工目标决策与持久检查点流程仍属历史协议，未在本次九项文件验证迁移中改写。

### 主 Agent 人工评审

agent-calls 仅把本根对话已捕获的 requestQuestion 注入 requestReview；这是原用户问题队列，不创建另一个消息或协作服务。子工具目录不公开直接评审，子求助仍面向直接调用方。人工决定由调度工具写入原运行日志，既有 AgentCallAssembly 生命周期负责关闭，不恢复旧人工目标服务。


## 根运行插入回执

根运行按本轮输入打开目标周期，队列启动保留 queueId 与 followupOf。插入消息复用 ScopeActiveInputService.send，收尾等待在途插入；完成核证返回 GOAL_* 错误时保留阻塞原因并以 failed 封存，错误仍返回对话，不把模型退出认定为业务成功。


### 统一主会话归档

根装配单独提供 OfficeHistoryTools，身份固定为当前 workspace/rootSession；执行 Agent 不继承此归档入口。读取历史不恢复旧周期、不产生新授权。


### 递归业务删除与移动

Application 将可信 ControlledFileTransport 传入执行装配；每个显式业务子调用通过既有 createArtifactTransitionPort 捕获工作区实例和准入生命周期。agent-business 只传递端口，不生成新文件执行器或旧派发记录。Runtime 继续负责冻结 Workflow、权限、原清单、操作阶段和 canonical 证明，平台工人退出后才返回。无专用传输保持不可用，不回退原生命令；隔离调用仍核对冻结范围。当前结果复核读取原子调用日志及文件，重启不自动重放。

## 递归业务运行身份与平台服务

Application 只装配一份 AgentBusinessRuns、ControlledFiles 和 IsolatedExecutions。agent-business 在父工具发布实际子运行引用后、LoopRuntime 开始前将冻结身份登记进原 DispatchStore；不创建旧派工图任务。最小 BusinessRunSource 让原文件服务读到同一权限、知识和绑定，protocol 决定 canonical 位于 loop-engine/tasks，旧记录仍读取 dispatch/runs/tasks。

Runtime.close 成功后才能关闭登记，关闭提交成功后才释放 GlobalRunAdmission 许可。保存未知时保留占用、错误和原句柄，后续只重试排空／关闭，不重发模型或文件操作。隔离范围同时约束读取、受控写入和产物迁移；复用平台隔离记录及显式清理，不引入第二个执行循环。

## 主 Agent 岗位与责任工具

新 AgentCallAssembly 在 beforeRun 成功后提供 MainToolContext，实际身份来自本轮 scope/run。岗位与模块责任工具复用原服务、命令 ID、审批和独立回执，使用此上下文替代 Auto 批次；只为主调用装配，子 Agent 没有管理入口。根收尾立即撤销新控制面操作，等待已登记提交和输入回执后再关闭周期及释放预算。读取或保存未知不自动重放。旧运行继续由 Auto 的原实现提供同一窄契约。

## 递归用量日志入口

member-dispatch 为 ScopeUsageService 提供独立 inspectAgent：固定 loop-engine/tasks 路径并核对工作区、项目、task/run。父调用关系及业务登记由统计服务核验；主 Agent 的 inspectMain 仍拒绝成员日志，旧成员路径不变。

## 递归业务历史回补

WorkspaceRuntimeMonitor 的两目录扫描区分旧成员和新递归业务：后者只从 loop-engine 恢复，并核对首条 agent-tools-v1/agentCall 当前子身份。业务 memberBinding 不再一概要求旧 dispatch/runs 路径。全局统计和历史索引使用同一原日志，重开不重新执行。
