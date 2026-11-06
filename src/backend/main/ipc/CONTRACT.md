### 显式新只读核实与历史诊断

`loop.recoveryStart` 将严格 `RecoveryRequest` 交执行管理器，创建独立的只读核实周期，不通过普通 resume 恢复旧日志。`loop.recoveryReceipt` 只按工作区、主会话和稳定 commandId 查持久意图；查询、重开页面或重启都不再次执行。

`loop.threadView` 返回 `ConversationThreadView`：全部可读历史、坏记录的通用问题提示和后端核实的可续聊头。缺少可续聊头时界面不能使用较早可读轮次代替。既有 `loop.thread` 保留严格执行预检语义，不把异常转为空列表。

### 显式目标补充

`loop.goalContinue` 接收完整 `GoalContinuationRequest`，纯文本、明确模型配置与权限、scope/wait/input 版本和稳定 commandId 交执行管理器。不能提交原生会话路径、来源或人工批准字段。相同请求查询原回执，不再启动；原等待已消费时换 ID 拒绝。

`loop.goalContinuation` 只读查询同一工作区/主会话/scope/commandId 的回执。返回 undefined 不保证旧请求从未在途，客户端仍须复用原 ID；回执含完整身份、当前 scopeStatus 和原补充记录，不代表模型正在运行或验收通过。普通 `loop.resume/enqueue` 不变成此入口。

### 主会话目标与任务图读取

`dispatchApplication` 将 `dispatch.sessionRead` 路由到 `app.memberDispatch(args.identity.workspaceId).sessionRead(args)`。身份、两个独立游标、所选周期和缓存 stamp 由调度服务严格校验；不从界面选中状态推断目标工作区，不返回全工作区派发存储。

该入口只读，在同一个已提交屏障读取任务图、周期摘要和选中详情。审批、任务开始/停止及信封确认保留各自命令入口；图读取不能触发它们。既有 `dispatch.graphSnapshot / dispatch.graphDelta` 保持兼容。
### 成员执行的只读核实

`dispatch.executionReport` 路由到当前工作区 `MemberExecutionManager.report`，按主会话、任务与可选明确运行查询。省略 runId 只核实领取记录，不猜最新轮次。报告包含核实基线、完整性、受限工具回执和未验收候选；不调用启动、确认、恢复或改派。分页必须绑定同一基线，服务严格校验身份。
