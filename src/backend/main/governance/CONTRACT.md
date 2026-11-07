# 单模块知识治理服务

`ModuleGovernanceService` 是每个工作区唯一的治理门面，同时实现知识提交所需的私有授权端口。服务不拥有第二个队列；登记、观察、提案、决定、实施和回执读取都通过 `Workspace.governed` 进入 `KnowledgeStore` 的同一串行屏障。回调内只能使用未再次排队的事务端口，不得重入公开 `commit/preview`。

`mainGovernanceTools` 只在真实主运行工厂创建，固定 workspace/instance、根会话、主实例/逻辑通道与 run。模型端口仅有 get/observe/propose/receipt，原输入先严格校验再注入可信身份；普通桌面 IPC 没有 origin 参数。模型观察和提案记录 `main_agent` 来源，新的桌面观察/提案记录本机来源，旧缺省不补造。模型提案只能引用同一主实例/逻辑通道的真实观察。

原命令 UUID 由工作区、根会话、run、真实 toolCallId 和精确工具名稳定派生；重开只读查询不依赖旧 instanceId。接收和保存前检查当前实例及取消信号；进入可靠保存后不承诺取消或回滚，响应失败给出原 commandId，不能自动新建请求。回执只投影同根会话模型来源，不存在返回 unknown；未知不是未受理证明。

主工具读取只交有界目录和显式所选记录，缺失 ID 不换为最新。原/新正文各限 16 KiB UTF-8，原正文不能完整交付时返回 oversized/recorded=false 且不保存观察。提案和治理读回执不是业务完成证据，批准和独立 apply 仍仅由桌面明确操作。

用户明确登记真实 Module 的定义和 overview；首片没有解除、移动、删除或定义修改入口。观察保存当时的结构校验和原正文，提案固定唯一 overview 差异及理由、替代方案、不变量、恢复说明。决定仅接受可信桌面闭包的 `local_desktop / explicit_submit`，它不代表认证负责人或业务验收。批准、驳回和暂缓只保存记录，不写正式知识。

`apply` 重新核当前知识、保护、提案和最新批准，先持久化精确原 ChangeRequest 与意图，再调用事务端口 `apply(intentId)`。普通 ChangeRequest 不接受 permit；原始 CRUD、架构表单、资源整包和索引刷新都经过同一最终投影门禁，不能以 ignore 隐藏受保护模块。

账本中的 apply 永久保留原 pending 意图。公开 `committed` 和保护新 revision/hash 从匹配的原知识 journal 派生；必须核前后正文、请求指纹、治理关联及真实 changed 集合，不凭当前文件相同推断成功。旧实例的意图完全没有 journal 时显示 `not_applied`，不冒称回滚；当前实例未知或尚在提交仍显示 pending。准备/提交中、回滚和恢复冲突分别保留原事实，不自动实施。

`receipt` 只查询原命令，可返回旧实例身份；重复命令不同内容拒绝。`unaccepted` 仅在旧实例退役、同队列排空、账本和原 journal 都无记录时为 true。不存在、通信错误或版本错误本身不是未受理证明。重新打开只校验历史并恢复元数据，不能唤醒模型、调用业务执行或重放知识写入。

本机 `decide` 可在暂缓/驳回时分别记录补证/异议 feedback；关切沿原 comment，期望回应和关注类别单独保存。`propose.respondsToDecisionIds` 只接受同保护对象的当前最新、实际带反馈的决定，服务在同一知识串行队列冻结原提案、basis 和决定版本到新提案 `respondsTo`。引用进入提案 basis，但不代表问题已经解决。

本机 assessments 仅针对该提案冻结引用，允许部分评价，缺省保持未评价；不要求全部 addressed，批准不表示已理解。保存新批准或任何带评价的决定、新 apply 以及 KnowledgeStore 的最终可信门禁，都复核回应来源仍是最新决定。来源已替代返回 `GOVERNANCE_FEEDBACK_STALE`；不含评价的普通驳回/暂缓仍可保留明确否定意见。

`list.selected.responseStates` 从真实当前历史派生 current/superseded，保留原意见、最新决定 ID 和版本；不改写提案、原评价或回执。已 committed 的真实 journal 按原记录派生成功，后来反馈替代不会倒推回滚，重开不自动重新评审或执行。旧无反馈/引用/评价字段的记录继续沿用原 basis 和指纹。
