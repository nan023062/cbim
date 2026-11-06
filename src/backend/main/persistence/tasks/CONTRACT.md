### 任务派发图持久化职责

已实现 `FileDispatchStore`：工作区单写入者串行事务、哈希链追加日志、fsync 后发布、幂等回执、成员/通道/图/待投递信封原子恢复，以及内存 Snapshot/Delta。日志位于应用用户目录的工作区 dispatch/dispatch.jsonl，不写入目标项目 .cbim。消息目前仅 pending，尚无 inbox 消费、结果提交和运行恢复；这些部分仍为后续契约。`RunJournal.seq` 与整图序号仍分别维护。

本目录负责图提交的可靠落盘、幂等检查、快照、增量读取与恢复。Core 定义节点、边及状态约束；调度层核验成员、模块维护关系、权限、依赖与状态迁移。本目录不替模型分析目标，不自行决定派给哪个成员。

### 图身份与存储端口

```ts
interface GraphIdentity {
  workspaceId: string;
  rootSessionId: string;
}

interface GraphCursor extends GraphIdentity {
  streamId: string;
  seq: number;
}

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
```

- `workspaceId + rootSessionId` 唯一定位主 Agent 会话的派发图。所有递归派发节点保留这个身份，接收成员使用自己的 `agentSessionId`，不得把接收会话替换为图根会话。
- `streamId` 在创建图时产生并持久化，正常进程重启不更换；它区别图流重建或迁移后的序号空间。
- `seq` 是原子提交批次序号，从 1 递增；0 仅为内部空前缀。graph.created 在 seq=1 原子保存根及主成员投影，公开快照始终有根。一个命令引起的多个节点、边、成员状态变化属于同一批次。不能用时间戳排序，也不能把一个批次拆成多个可见中间状态。
- `eventId` 唯一标识已提交批次；`commandId` 关联请求与幂等结果。`cause` 是 Core 定义的 `GraphCause` 事实枚举，由可信调度上下文形成。用户或成员的可信发送者身份另记内部命令审计，不由模型冒充发送人。
- `committedAt` 为 UTC ISO 8601 时间。`GraphChange` 只包含本批次发生变化的对象完整新快照；不包含私有推理、密钥、原始凭据或执行进程环境。

当前存储端口位于 Core 的 `dispatch-storage.ts`：

```ts
interface DispatchStore {
  read(): Promise<DispatchState>;
  snapshot(identity: GraphIdentity): Promise<GraphSnapshot>;
  delta(identity: GraphIdentity, cursor?: GraphCursor, limit?: number): Promise<GraphDelta>;
  transact<T>(command: DispatchCommand,
    prepare: (state: DispatchState) => Promise<DispatchMutation<T>>): Promise<T>;
  close(): Promise<void>;
}
```

`DispatchCommand` 含 commandId 与规范化请求 fingerprint，`DispatchMutation` 包含成员、Session、图批次、pending 消息和回执。只有调度层生成 mutation；模型或前端不能直接提交它。公开图查询不返回 read() 的全工作区状态。后续 inbox、运行意图与 staged 结果仍需扩展事务类型。

### 原子提交与幂等

一次派发至少需要原子保存：新任务、派发/依赖边、接收方待投递消息和该命令的提交回执。结果返回同样将有效结果记录、请求方待投递消息和图状态变化一起提交，避免出现“图上已派发，但成员永远收不到任务”。模型提交的结果/等待先保存为 staged 内部记录，不发布有效候选；大脑安全结束并复核后才做最终图提交。内部事务没有可见对象变化时不分配 graph seq；不得为了邮箱重试或候选暂存发布空图批次。

提交顺序：

1. 在工作区唯一写入者及串行提交边界中核验图身份。
2. 按图身份与 `commandId` 查找已提交命令；同 ID、同规范化输入摘要与可信发送者返回原回执，不再次投递。同 ID 不同内容返回 `COMMAND_ID_CONFLICT`。这个检查先于预期版本检查，避免正常重试被后来版本错误拒绝。
3. 对未提交的新命令核验对象版本与状态前置条件；节点及边必须引用同一张图，DAG 约束由调度验证并在同一提交快照上成立。
4. 将完整事务记录追加并 `fsync`，可靠保存后才更新内存投影、返回成功并发布增量。
5. 消息投递器消费已提交 outbox。投递失败保留记录重试；不得回滚已经真实发生的任务执行。

事务记录应包含完整 `GraphEventBatch` 和关联的邮箱/执行数据，采用可识别完整提交边界的日志格式。不能先修改图文件、再独立写消息文件。派生快照不是另一份权威状态；快照缺失时必须能从提交日志恢复。

写失败不更新可发布投影，不返回成功；当前写入链停止接受后续相关变更，直到明确恢复。调度调用方收到超时或连接中断时，可以使用原 `commandId` 查回执，不能换 ID 直接重复派发。

### 快照、增量与事件发布

`GraphSnapshot` 包含 `version:1、identity、cursor、root、tasks、edges、agents`，其对象内容必须对应同一个已提交 `cursor.seq`。读取旧游标必须返回完整批次，`limit` 按批次数计数，不按对象数截断；单批次大小由命令入口限制。

增量返回采用 `mode: 'noop' | 'delta' | 'reset'`，完整公开形状见 [Bridge 契约](../../../../bridge/contracts/CONTRACT.md)。无变化时不重复读取和传输全图正文。订阅只发布已落盘批次；消费者掉线或丢包后，用最后成功应用的游标补读。

正常重启从持久化头恢复同一 `streamId` 与最后 `seq`，不回到 0。日志压缩时先可靠生成带游标快照，再建立保留区间。请求游标早于保留区间时返回 `reset` 快照；身份不匹配必须拒绝，不能用 reset 悄悄切换工作区或会话。

### 执行、邮箱与恢复

每个成员的 Session 通道按消息 ID 去重。`ack` 只表示接收方已可靠接收或领取，不能转换成“任务成功”；运行完成、结果提交与业务验收分别记录。

在启动任何可能产生副作用的执行之前，先持久化 `taskId、runId、agentInstanceId` 和启动事实。重启后发现“已开始、缺少确定终态”的执行，进入结果核实流程；不能因 Session 已结束、进程不存在或消息被重新投递就再次执行。

恢复顺序：校验日志与身份 → 重建图和邮箱投影 → 恢复已提交但未确认的消息投递 → 核对活动执行与结果 → 发布恢复后的图状态。只可自动重复投递幂等消息；未知文件写入、命令或外部操作结果不得盲目重放。

父任务等待子任务结果通过等待集合和关联结果消息表达，不生成“子任务 → 父任务”的反向依赖边。任务结果关联使用 `taskId/replyTo/messageId`，与 `runId` 的执行尝试身份分开。

### 错误语义与迁移边界

| 情况 | 行为 |
| --- | --- |
| 工作区或根会话身份不同 | `GRAPH_IDENTITY_MISMATCH`，拒绝读取或提交 |
| 图不存在 | `GRAPH_NOT_FOUND`；读取不能自动创建图 |
| 对象预期版本过期 | `GRAPH_REVISION_CONFLICT`；返回可重新读取的当前版本信息，不自动合并 |
| 同命令 ID 不同内容或发送者 | `COMMAND_ID_CONFLICT`，不产生新批次 |
| 写入失败 | `GRAPH_STORAGE_FAILED`，不发布未提交变化 |
| 日志中间损坏、序号断裂或身份不一致 | `GRAPH_LOG_CORRUPT`，拒绝伪装成空图或完成；仅可忽略明确未提交的崩溃尾部 |
| 未知协议版本 | `GRAPH_VERSION_UNSUPPORTED`，不猜测解析 |
| 未确认的执行结果 | 保留中断/待核实状态，不自动重试副作用 |

现有 `loop` 对话 `taskId`、`RunJournal` 及 `TaskProgress` 保留原意。引入 `rootSessionId` 和图任务 ID 时需要显式适配关联，不能根据名称相同直接等同；旧历史没有派发证据时不补造任务、消息或团队协作过程。
