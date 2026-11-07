### 已提交的前置替换审计

`dispatch.ts` 重导出 `DependencyReplacement` 和严格 `dependencyReplacementSchema`；`TaskNode.dependencyReplacements` 随既有图增量传递。界面可显示替换前后身份与原因，但没有通过该 DTO 直接修改边、启动成员或批准验收的入口；真实换边只由可信主调度运行调用服务。

### 目标软限额设置与投影

`scope-budget` 仅导出严格软限额策略与周期摘要。桌面可明确保存新周期默认值，不能指定当前周期的新限额、编造准入证明或预算消费；当前策略与拒绝从真实目标摘要读取。

### 主会话历史展示契约

`execution.ts` 导出 `ConversationThreadView {runs,issues,resumeRunId?}`。坏日志问题独立于运行摘要，仍可显示正常历史；没有可续聊头时不得从 `runs.at(-1)` 推导执行目标。后端明确隔离旧上下文后，新链可以使用同一主实例继续调度，当前链损坏仍阻止续接。

### 显式补充请求与回执

`dispatch.ts` 重导出 `GoalContinuationRequest / GoalContinuationReceipt` 及两者 Schema。请求冻结完整目标身份、waitId、目标与输入版本、稳定 commandId、原文和明确模型/权限；本步无附件。回执携带同一身份、scopeStatus、continuationId、旧检查点、输入版本、真实 runId 与已保存配置。前端校验响应和冻结请求匹配，未知响应只查询或原请求重试，不能换 ID 自动再次执行。

### 任务派发图公开契约

已通过 `dispatch.ts` 导出真实节点/增量及命令回执类型，以及无 IO 的 `applyGraphBatch / validateGraph` 供前端校验并归并图增量。Application IPC 已接 `dispatch.open / dispatch.memberCreate / dispatch.task / dispatch.graphSnapshot / dispatch.graphDelta / dispatch.sessionRead`；主会话模型派发工具和当前批次自动执行/回注已接通，图订阅推送与通用历史协作恢复仍为后续能力。

### 主会话图与目标周期联合读取

`dispatch.sessionRead({identity,graphCursor?,scopeCursor?,selectedScopeId?,detailStamp?,limit?})` 返回 `DispatchSessionRead {graph:GraphDelta,scopes:ScopeDelta,detail:ScopeDetailRead}`，三份数据来自同一已提交存储屏障。工作区/主会话身份显式绑定，跨会话游标或选择拒绝，不依赖当前 UI 选中项；读取不创建任务或启动模型。

`ScopeCursor` 增加 `kind:'scopes'`，使用独立 streamId/seq；plan/review/block/close 只能推进本流，不推进任务图。`ScopeSnapshot {identity,cursor,scopes}` 与 `ScopeEventBatch {identity,streamId,seq,scopes}` 只携带变更摘要。`ScopeSummary` 含 scopeId、status、createdAt、可选 closedAt/outcome、hasGoal/hasPlan、可选 goalRevision/inputPreview/objective/reviewDecision/blockedReason，以及 `{scopeId,streamId,seq}` stamp；三个文本摘要最多 240 字符。`ScopeDelta` 保持 reset/delta/noop 结构，scope 历史超过 256 批后 reset，limit 每页 1–500 个完整批次。

`ScopeDetailRead` 为 updated `{stamp,scope:DispatchScope}`、noop `{stamp}` 或 empty。缺省选择 active 或 waiting 的未关闭周期，否则最后创建的周期；选择固定后可检查历史完整输入、计划、逐项审阅和阻塞原因。详情 stamp 包含最后周期变更序号，block/close 即使目标版本不增加仍刷新详情。完整 `goal.input` 可包含大正文，仅在选择或 stamp 改变时传输。分页增量尚未到头部时 detail 可能比本页 cursor 新，不能因此拒绝有效响应。前端须先验证全部响应再统一替换投影，并使用同一个轮询请求消费两条流。

`DispatchScope` 的 closed/outcome 是周期终态；`goal.review.decision:'complete'` 仅为等待复核的完成申请。模型运行 completed 不等于目标成功，历史没有 goal 时保持无记录。`applyScopeBatch / validateScopeSnapshot` 经 Bridge 提供纯归并与结构校验，不导入后端存储实现。

成员执行已接 `dispatch.executionStart / dispatch.executionStop / dispatch.executionInspect`，可信桌面请求须携带 `workspaceId + rootSessionId + taskId`，启动另带幂等 `commandId`、`expectedRevision` 及公开模型/权限选项。`MemberExecutionView` 只公开任务和运行状态，不返回原生会话路径、完整提示词或密钥。`dispatch.approvals / dispatch.approve / dispatch.questions / dispatch.answerQuestion` 使用相同任务身份；批准仅对当前执行有效。

`dispatch.messages / dispatch.acknowledge` 使用 `workspaceId + rootSessionId + agentSessionId` 限定收件人。确认只消费结果信封，不把任务候选变为已验收；读取或收件本身不会发起模型调用。派发和成员执行共用同一事务存储，终态提交完成后才能释放成员占用。手工派发仍需明确启动；主会话本轮工具派发由协调器推进并可靠回注。执行者无递归派发权，历史唤醒和失败任务重试尚未接通。

跨进程的图快照与增量只包含可序列化数据；Bridge 另重导出无 IO 的图校验/归并函数供前端本地消费，不把这些函数作为 IPC 数据传输。节点约束、角色实例和任务状态由 Core 定义，调度产生真实事实；前端不得根据助手回复文字推断“已派发”或直接写图状态。

### 成员执行增量入口

`dispatch.executionEvents` 接收 `workspaceId/rootSessionId/taskId/runId` 和可选 `{runId,seq}` cursor、limit（默认 200，最大 500）。返回 `MemberEventsRead`：reset/delta 携带当前 `MemberRunView`、cursor、连续 `StoredEvent[]` 和 hasMore；noop 仍携带 run/cursor，用于同步最终事务状态而不替换事件数组。游标属于其他 run 时拒绝，游标超前时 reset，分页必须消费到 hasMore=false 后再等待下一次更新。

公开投影在后端按事件类型和字段白名单完成：保留公开对话文本、有限用量/状态、结构化计划、工具名、授权/成功/失败/未知状态、本轮回执和工作区业务路径。工具原始 input/result、write.content、知识工具正文、命令参数、冻结知识及原生 Session 路径字段不透传；工具结果只返回受限摘要，内部错误替换为通用文案。`session.bound` 替换为 `engine.status` 并保留原 seq，未识别事件也只保留通用状态。公开对话、任务目标/验收要求和计划正文仍作为业务文本保留，不保证自动识别其中的密钥或个人信息，前端不再执行二次脱敏。首次读取恢复日志后仅合并已落盘观察事件，后续轮询不重复扫描日志。

### 静态 Agent 的 Session 履历

`agent-history.ts` 公开 `AgentHistoryRole / AgentHistorySession / AgentHistoryRun` 与只读分页协议。四个 IPC 入口分别为：

- `agentHistory.roles({workspaceId})`：已有履历的静态角色及记录数，包含当前定义已不存在的角色。
- `agentHistory.sessions({workspaceId,agentId,cursor?,limit?})`：角色的独立 Session 分组。
- `agentHistory.runs({workspaceId,agentId,sessionId,cursor?,limit?})`：本 Session 的任务运行摘要。
- `agentHistory.events({workspaceId,agentId,sessionId,taskId,runId,cursor?,limit?})`：指定轮次的公开事件增量，复用 `MemberEventsRead` 的 reset/delta/noop。

列表默认每页 30 条、最多 100 条；事件默认 200 条、最多 500 条。游标与身份绑定，跨角色、Session 或运行复用不能静默切换目标。详情仍核验全部归属，不接收客户端文件路径。诊断字段报告未能归档或恢复的记录，不以空列表伪装完整。

主/成员详情共用 `public-run-events.ts` 白名单。主会话保留本轮用户输入；回注显示系统来源；成员启动只显示正式任务目标，不公开内部启动提示词。所有入口都不启动/恢复执行、不审批、不确认信封；实例释放和知识定义删除不改变读取历史的身份。

### 稳定身份与节点范围

```ts
interface GraphIdentity {
  workspaceId: string;
  rootSessionId: string;
}

interface GraphCursor extends GraphIdentity {
  streamId: string;
  seq: number;
}

interface GraphSnapshot {
  version: 1;
  identity: GraphIdentity;
  cursor: GraphCursor;
  root: SessionRootNode;
  tasks: TaskNode[];
  edges: GraphEdge[];
  agents: AgentGraphView[];
}
```

根节点 `SessionRootNode` 表示主 Agent 的当前 Session，图内普通任务节点表达执行 Agent、涉及模块列表、任务目标、状态和结果引用。节点、边与成员投影的完整领域结构以 Core 契约为准，本层重导出公开类型和纯校验/归并函数，不引用具体执行器或存储实现。

`rootSessionId` 是最初主 Agent 的会话范围；被派发成员拥有自己的 `agentSessionId`。`taskId` 是图节点身份，`runId` 是执行尝试身份，不能用现有 `loop.taskId` 同时代替这三类标识。

任务改派、重试和重规划遵循领域版本规则。完成和取消节点保留以供追溯；当前协议不提供物理删除节点事件。返回结果更新对应节点和等待状态，不增加反向返回边。

### 原子增量批次

```ts
type GraphChange =
  | { type: 'root.upserted'; root: SessionRootNode }
  | { type: 'task.upserted'; task: TaskNode }
  | { type: 'edge.upserted'; edge: GraphEdge }
  | { type: 'agent.upserted'; agent: AgentGraphView };

interface GraphEventBatch {
  version: 1;
  identity: GraphIdentity;
  streamId: string;
  seq: number;
  eventId: string;
  commandId: string;
  cause: GraphCause;
  committedAt: string;
  changes: GraphChange[];
}

type GraphDelta =
  | { mode: 'noop'; cursor: GraphCursor }
  | {
      mode: 'delta';
      from: GraphCursor; cursor: GraphCursor;
      batches: GraphEventBatch[]; hasMore: boolean;
    }
  | {
      mode: 'reset';
      reason: 'initial' | 'stream_changed' | 'history_compacted' | 'cursor_ahead';
      snapshot: GraphSnapshot; cursor: GraphCursor;
    };
```

- `seq` 按原子提交批次递增，从 1 开始，跨正常重启保持连续。0 仅代表内部空前缀；graph.created 在 seq=1 原子提交根，公开快照始终有根。一次命令造成多个对象变化时，必须在同一个批次中发布。
- `changes` 只包含有变化对象，但每个对象都是完整新快照；使用稳定 ID 替换旧对象，不把局部字段缺省错误地理解为“保留旧值”。
- `committedAt` 为 UTC ISO 8601 时间；顺序以 `seq` 为准。`cause` 是 Core 定义的 `GraphCause` 事实枚举，由后端根据真实提交填写，不接受模型自报的发送者。可信发送者等审计信息保存在内部命令记录；公开批次不包含私有推理、密钥或原始凭据。
- `delta.from` 必须等于客户端提交的游标；`cursor` 表示本次响应已经返回到的最后提交位置，不直接跳到尚未返回的服务端头部。
- `batches` 内序号必须连续；一次响应不拆开批次。`hasMore` 为 true 时，客户端使用返回的 `cursor` 继续读取。
- `noop` 不带对象列表或正文，前端保留已有引用与布局。`reset` 的快照整体替换相同图身份的本地投影，不能与旧流对象混合。
- 每种响应均由 `cursor` 携带明确图身份；`reset.cursor` 必须与 `reset.snapshot.cursor` 完全一致，且快照的 `identity` 与游标身份一致。

### IPC 与后续订阅入口

```ts
// 当前 IPC action 为 dispatch.graphSnapshot / dispatch.graphDelta。
interface DispatchGraphApi {
  graphSnapshot(input: { identity: GraphIdentity }): Promise<GraphSnapshot>;
  graphDelta(input: {
    identity: GraphIdentity; cursor?: GraphCursor; limit?: number;
  }): Promise<GraphDelta>;
}
```

`limit` 按完整批次计数，建议默认 100、允许 1～500，由后端严格校验。首次未提供游标时返回 `mode:'reset', reason:'initial'`；图尚不存在时返回 `GRAPH_NOT_FOUND`，读取不能暗中创建执行任务。

后续订阅使用相同 `GraphEventBatch`，不另造 UI 专用状态协议。订阅断线不影响任务执行；客户端以最后成功应用的游标调用增量接口补读。初始快照与订阅之间发生的变更也通过游标补读消除缺口。

任何调用与返回都核验 `workspaceId + rootSessionId`。当工作区或会话切换时，前端取消旧订阅并丢弃不匹配的迟到响应；不能只比较 `seq` 或 `taskId`。IPC 调用者的权限由主进程核验，图身份不是授权凭据。

### 消费与错误处理

前端只有整份响应校验通过后才替换投影并推进游标；`delta.from` 必须等于当前游标，重复的旧 delta 也会因起点不匹配而被拒绝，随后由 Hook 不带游标请求权威 reset。相同游标的 noop，以及相同游标且内容一致的 reset，保留已有对象引用；同版本内容冲突或序号断档均保留旧图并重载，不直接跳过批次。Core 归并函数的批次幂等只在保留对应重放证明时成立，不能据此承诺前端任意历史 delta 都可自动去重。

| 情况 | 返回与处理 |
| --- | --- |
| 请求身份与游标身份不同、或者订阅越过已授权图范围 | `GRAPH_IDENTITY_MISMATCH`，拒绝；不能 reset 到另一张图 |
| 当前图没有新提交 | `noop`，不替换节点或重复回读全图 |
| 同图合法游标属于旧流 | `reset / stream_changed` |
| 游标早于保留历史区间 | `reset / history_compacted` |
| 游标序号超出当前持久化头部 | `reset / cursor_ahead`；不假装已经同步 |
| 参数非法或 limit 越界 | `GRAPH_INPUT_INVALID` |
| 协议版本无法识别 | `GRAPH_VERSION_UNSUPPORTED`，停止应用，提示升级或重新加载 |
| 工作区未运行或正在关闭 | 返回明确生命周期错误，保留本地最后已确认投影并标记暂不可更新 |

读取接口不包含写权限、命令输入或模型参数。后续任务命令与图增量查询分别定义：命令需要 `commandId` 和预期对象版本，重复命令返回原回执；前端不能通过发送 `GraphChange` 绕过调度创建任务。

### 当前会话与团队全局状态

此图只显示当前主 Agent Session 调度的任务；执行者没有递归派发权。`agents` 的状态及任务引用均为本图局部事实投影；兼容历史成员可能跨图共享引用，本图 idle 不意味着全局空闲。工作区组织图保持静态定义，其角色履历使用独立的只读历史接口，不在任务图协议中隐式夹带其他会话内容。

图中的 `result_ready` 表示待交接候选，与执行完成、消息确认及业务验收分别表达。公开图不允许前端或模型把“收到返回消息”“进程结束”“有成功工具回执”自动转换成业务验收通过。

### 周期用量读取

`scope-usage.ts` 重导出严格的 `ScopeUsageInput / ScopeUsageReport` 及 Schema。`dispatch.scopeUsage` 只接 workspaceId/rootSessionId/scopeId，不接路径或写入操作。公开已登记运行、已报告 token、估算美元、读取时间及缺失/未知情况；不包含原生会话文件、模型凭据或聊天/工具正文。完整归属与完整计量分别声明，读取不是预算授权或业务验收。

### 桌面架构 CRUD 契约

`architecture.ts` 导出 `ObjectOperation`、`ArchitecturePreviewRequest/CommitRequest` 和对应回执。预览绑定工作区/实例/知识版本，响应保留完整校验、差异、受影响路径、对象 ID 和 planId；确认提交只携带身份及 planId。创建/编辑模块时，界面显式选择真实维护人并确认，可附 `peopleUpserts` 在同一事务增加真人。后端生成维护记录，前端不能伪造 `confirmation`；声明不授予模型写权限。字段类型不暴露桌面服务实例或存储实现。
### 只读执行核实

`dispatch.ts` 重导出 Core 的 `ExecutionReportInput / ExecutionReport` 和相应 Schema。报告区分在途、结算与未知，不把失败/取消当作回滚；不包含原始工具参数、结果或原生路径。分页基线变化时重置第一页，前端不能合并不同核实版本。该契约不提供批准、复活或重派命令。

### 显式新只读核实周期

`dispatch.ts` 导出 `RecoveryRequest / RecoveryLookup / RecoveryReceipt` 及对应 Schema。`loop.recoveryStart` 接收 workspace/root/commandId、来源 scope/task/可选 run/reportBasis、固定 inspect_effects、分开的用户观察和目标、明确模型及 read 权限；没有附件或任意路径。`loop.recoveryReceipt` 只按 workspace/root/command 查询，不要求调用方先知道新周期 ID。

回执外层包含新 scopeId/status，recovery 返回原命令/source+basis/operation/观察/目标/options、可信来源状态与新 runId。原生 ID 和旧运行排除集合不在公开回执中。回执表示持久受理，不保证模型仍在运行；身份或冻结内容不匹配不能视作成功。`ScopeSummary.readOnly` 只公开核实周期的只读约束，供后续显式补充继续固定 read。

### 独立正式业务重规划

`dispatch.ts` 导出 `ReplanPreviewInput / ReplanPreview / ReplanRequest / ReplanLookup / ReplanReceipt` 及严格 Schema。`dispatch.replans.preview` 按 workspace/root/inspectionScopeId 只读返回 eligible、联合 basis、图/目标/知识版本、requiredModules、inheritedHuman 和问题列表；预览不是启动许可。

`loop.replanStart` 只接新 UUID、明确 source.inspectionScopeId/expectedBasis、纯文本新目标与 ask/execute 模型配置。`loop.replanReceipt` 按 workspace/root/command 查询原意图。公开 replan 包含 acceptedAt、business_replan、冻结目标与配置、source.proof 和新 runId；proof 是可信版本摘要而非新的工具回执，不含私有原生 ID/排除集合。回执只证明已受理，不代表业务验收完成。`ScopeSummary.origin` 区分 inspection 与 business_replan，普通和旧周期保持缺省。
