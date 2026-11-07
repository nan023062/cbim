# 主进程运行装配契约

## 本机资源仓库连接生命周期

`Application.repositoryConnections` 是应用唯一的桌面连接服务，使用 `ResourceRepositories` 当前真实共享闭包和工作区知识事务端口；用户目录保存授权与命令回执，知识目录只保存可移植的链接器定义。初始化读取授权但不自动共享或联网，工作区关闭/重开先取消该工作区在途核验；应用退出先拒绝新连接操作、排空读写，再关闭共享服务。原回执查询不创建运行、调用模型或恢复旧工作区实例。

## 正式成员的 Workflow 能力装配

`member-dispatch.prepare` 从与 Pi 实际注册相同的 `core/tools/native-tools` 清单，按本轮 permission 返回 availableTools；密钥和实际模型留在可信工厂。执行服务在 claim/run 之前预检冻结的模块约定。创建 Runtime 时注入全部 `preparedWorkflowContracts(run.prepared)`，普通主聊天不接此业务执行门禁，也不因此获得业务写入或命令权限。

## 本机显式人工决定

`member-dispatch` 为 `WorkspaceDispatchService.humanDecisions` 复用工作区固定的 canonical 日志、`ArtifactFiles` 与业务只读占用。没有选择基线时不读业务文件；明确选择的全部候选共用一次文件计量上限，不取得模型运行槽位。工作区退役、关闭或读取期间变化拒绝新的记录，回执查询不重新核实或启动执行。

人工决定只在可信桌面 IPC 路由注入本机 explicit_submit 标记，不从渲染参数或模型工具接受 actor/proof/文件哈希；该标记不代表已登录身份。单独保存 waiting 周期的记录，不调用执行管理器，也不消费等待、继续队列或更改权限。

## 文件基线采集与只读复核

`member-dispatch` 为每个成员运行注入 `ArtifactFiles`、固定知识版本及 `recheckDispatchExecutionContext` 实时复核闭包。普通主会话没有采集端口。平台路径仅从可信同轮工具来源解析，不接受前端或模型提交哈希；文件读取不返回正文。

历史报告复用同一平台限额，由 `MemberExecutionManager` 按明确运行交独立报告服务。只有显式指定 baselineId 才临时取得 `WorkspaceExecutionLease` 读占用，未指定仅列日志引用；报告不获取模型名额、不唤醒调度、不修复日志，也不将知识事务与文件系统观察宣称为跨存储原子快照。

## 应用级执行准入

成员检查点的私有 native 读取由 `NativeSessionFiles` 固定在本工作区 dispatch/runs/pi/sessions 内。结算在真实 close 之后记录指纹；续执行使用原 run 的固定配置，并通过 `assertMemberResume` 在领取后 Runtime/Pi 准备窗口再次复核全部冻结证明。该闭包不接客户端路径或模型声明，也不刷新原 proof 来掩盖知识、业务文件或 native 变化。关闭及启动恢复沿原安全规则封存 active 周期，不自动重放预约。

`Application` 持有唯一 `GlobalRunAdmission`，与只读 `GlobalRuntimeManager` 分开。`AdmissionSettings` 在恢复工作区之前安装已保存策略；默认额度 4，策略调整不停止已有运行。每次工作区装配产生本进程正整数 `ownerEpoch`，关闭、重开或初始化失败先退役旧代际并撤销等待票，实际运行名额仍由原释放函数归还。

`execution-admission.ts` 将全局资格与 `WorkspaceExecutionLease` 同步组合。请求键由主/成员来源加稳定命令 SHA-256 摘要组成，满足身份长度与字符约束；撤票只传 `AdmissionIdentity`，不夹带请求权限和来源字段。所有桌面主轮与成员轮使用同一服务，测试或独立装配未传服务时仍沿用已有工作区租约。

主普通聊天在 `LoopRuntime.acquireLease` 成功之后才调用 `beforeRun` 打开目标周期，额度不足不会创建 scope、运行日志或模型请求。主轮始终只领取业务只读租约；知识写仍经过内部知识服务事务与用户权限。成员在派发存储事务内、领取信封和记录 run 之前取得全局及本地资格；准备、原生锁或持久化失败释放已取得资源。成员的未知终态仍保留原有占用规则，不能为了展示空闲而假释放。

成员准备知识、解析模型和最终重查基线后都重新核对批次及工作区代际。装配 `isCurrent` 在工作区退役时立即失效，手动成员启动同样受约束；不依赖稍后才执行的 manager.close。若停止发生在已经开始的持久提交期间，保留真实启动意图并结算取消，但不创建模型。代际同时发出 AbortSignal，成员启动信号贯穿尚未登记 active 的原生准备阶段；异常启动继续按 interrupted 留证，不伪装为未执行。

`CAPACITY_BUSY` 只表示直接请求在受理前被全局额度或公平顺序拒绝，不留下自动重试票。显式补充、只读核实和业务重规划在此门禁之后才保存受理意图；已保存命令仍优先查原回执。已受理协作的成员和结果回注使用 `CAPACITY_WAITING`，票据只含身份和权限，不含用户正文或凭据。回调由原 `AutoCollaboration` 批次持有，不由 IPC 或模型传入；释放只通知原协调器重新核实，不能直接重放运行。

本地租约释放通知全局资格变化；单纯读取监管或准入快照不触发执行。退出先撤票，再停止与排空主/成员运行及历史服务。等待票不持久化，重启继续沿用安全等待占位和历史中断处理，不依据旧票恢复模型。

## 目标周期消耗读取

`dispatch.scopeUsage` 接受明确 workspaceId/rootSessionId/scopeId，将请求交给 `WorkspaceDispatchService.usage`。服务复用工作区装配已有的主/成员 canonical 日志端口，文件路径由后端可信身份解析，不接受客户端路径或用量正文。返回白名单统计、来源身份和安全诊断，不暴露日志正文、原生路径或密钥。读取不会创建运行、领取名额、批准任务或更新知识；本步没有预算配置或计费扣款。
`Application.budgetSettings` 在恢复工作区前初始化，`budget.settings` / `budget.configure` 只读写未来周期的默认软限额。工作区给派发服务注入可靠设置读取闭包；新周期在创建事务中复制策略，当前和 waiting 周期保持原值。成员与主调度共享同一 ScopeBudgetService 和可信日志端口，不能从 IPC 参数、统计界面缓存或重建监管索引签发额度许可。
