### 本机人工决定的独立入口

`dispatch.humanPreview / humanDecide / humanReceipt / humanHistory` 仅按明确 workspace/root/scope 访问人工决定服务。预览显式选择 criterion 与基线，提交还须携带稳定 commandId、expectedBasis、expectedDecisionRevision、决定和 comment；actor、proof、路径及文件哈希不属于请求。

Electron 接入仍核对本窗口与主 Frame；`humanDecide` 在可信闭包注入 `local_desktop / explicit_submit`，不冒充登录认证、不增加二次原生弹窗，模型工具表不注册此入口。保存只追加 waiting 周期历史，不调用模型、补充/恢复入口或批准普通队列。退出前拒绝新提交；通信未知保留原命令查询，不把查询未找到解释成可以换 ID 重发。

`loop.humanContinue` 是另外的显式运行入口，严格接收 scope/wait 与 goal/input/decision 版本、最新决定 ID 全集、固定 commandId 和实际模型/权限配置；不接 message、actor 或伪造依据。执行管理器先查原回执，再在真实 beforeRun 内消费一次等待。`loop.humanContinuation` 只查三层身份与 commandId，返回当前 scopeStatus 和不可变 human_decisions 意图；不启动、不续队列，也不把 closed/active 回执解释为正在运行。CONFLICT/UNKNOWN/REPLAY 保持原命令核实，不能自动换 ID。

### 文件基线的独立只读复核

`dispatch.artifactReport` 交当前工作区 `MemberExecutionManager.artifactReport`，必须明确 workspace/root/task/run。未指定 baselineId 只读取 canonical 日志中的已确认引用，不猜最新基线且不读业务文件；指定基线才取得短期业务读占用并有界核实。结果不包含原生会话路径、文件正文或未经核实的模型声明。

该入口与执行回执分页分开，不写日志、不领模型名额、不确认候选或启动恢复。缺失、损坏、在途及前后基线变化都明确保留未知；匹配指纹不代表整个工作区未变或业务验收通过。

### 全局并发准入与设置

`admission.read({cursor})` 仅读应用内准入器，独立于历史监管索引；返回 snapshot 或同版本 noop，不启动运行、不扫描日志。`admission.settings` 返回已经生效的策略；`admission.configure({revision,maxConcurrentRuns})` 经串行版本校验和可靠写盘后生效，关闭期间拒绝改配。IPC 不公开 attempt、withdraw 或 release，页面和模型不能自行签发或伪造归还名额。

### 正式业务重规划

`dispatch.replans.preview` 只读复核指定主会话已完成核实周期的可信证据，返回覆盖模块、继承人工约束和可核对的依据版本；不是模型已生成的执行计划，也不批准业务写入。

`loop.replanStart` 接收严格的新目标、ask/execute 配置、来源核实周期、依据版本和稳定 commandId，交执行管理器在真实运行租约内重新核验并保存启动意图。不能提交旧工具参数、执行实例或原生路径，也不修改原只读周期。`loop.replanReceipt` 只查询同一命令的持久受理事实，未知响应不允许自动改换命令。停止、重复提交和重启不重放已受理目标。

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
