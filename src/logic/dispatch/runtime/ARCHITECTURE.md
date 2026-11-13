# src/logic/dispatch/runtime 架构

## 目录定位

派发编排：任务状态、领取、图依赖与应用命令通过 logic/dispatch/rules 的派发端口写入；共享 Store 尚未拆分。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [auto-collaboration.ts](auto-collaboration.ts) | 管理用户任务周期，串接主调度、成员回传、重启后可靠成果接收及最多三轮验收返工；同角色等待不阻断其它角色，未知事实或额度耗尽停止，可靠关闭后释放执行实例。 |
| [automatic-return-service.ts](automatic-return-service.ts) | 持久保存主轮待回传批次，重启时核实可自动接收的已完成成员结果。 |
| [dispatch-service.ts](dispatch-service.ts) | 工作区的成员注册、主对话实例绑定、主会话派发及任务图查询；主/子逻辑对话随登记可靠保存且跨周期保留，重启仅保留通过完整核实的待回传周期，其余中断封存。 |
| [goal-repair.ts](goal-repair.ts) | 调度层最终验收返工的分类、限次与系统反馈，复用原目标及主运行入口。 |
| [member-failure-limit.ts](member-failure-limit.ts) | 从同一目标的持久任务终态判断是否停止自动接续，供实时协调和重启核实共用。 |
| [owner-execution-service.ts](owner-execution-service.ts) | 在既有知识、模型和派发存储之间核实岗位执行绑定，为计划、派发、领取和依赖维护提供同一入口。 |

## 架构类图

### auto-collaboration.ts

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_auto_collaboration_ts["auto-collaboration.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_auto_collaboration_ts_MainToolContext["MainToolContext"] {
  <<interface>>
  +binding
  +assertCurrent()
  +track()
}
N_src_logic_dispatch_runtime_auto_collaboration_ts ..> N_src_logic_dispatch_runtime_auto_collaboration_ts_MainToolContext : 声明
class N_src_logic_dispatch_runtime_auto_collaboration_ts_Options["Options"] {
  <<type>>
  +engine
  +collaborationMode
  +provider
  +model
  +profileId
  +permission
  +allowNativeExecution
  +turnTimeoutMs
}
N_src_logic_dispatch_runtime_auto_collaboration_ts ..> N_src_logic_dispatch_runtime_auto_collaboration_ts_Options : 声明
class N_src_logic_dispatch_runtime_auto_collaboration_ts_Cycle["Cycle"] {
  <<type>>
  +collaborationMode
  +task
  +scopeId
  +tasks
  +operations
  +mainRuns
  +workRequested
  +stopped
  +readOnly
  +cancelRequested
  +ending
  +closing
  +completionSummary
  +options
  +repairs
}
N_src_logic_dispatch_runtime_auto_collaboration_ts ..> N_src_logic_dispatch_runtime_auto_collaboration_ts_Cycle : 声明
class N_src_logic_dispatch_runtime_auto_collaboration_ts_Batch["Batch"] {
  <<type>>
  +cycle
  +task
  +runId
  +options
  +tasks
  +calls
  +settled
  +stopped
  +failures
  +watched
  +admissions
  +recorded
  +restored
  +repair
}
N_src_logic_dispatch_runtime_auto_collaboration_ts ..> N_src_logic_dispatch_runtime_auto_collaboration_ts_Batch : 声明
```

成员 1/3（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_auto_collaboration_ts["auto-collaboration.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_auto_collaboration_ts_AutoCollaboration["AutoCollaboration"] {
  +initialize()
  +mainToolContext()
  +prepareAssignment()
  +tools()
  +busy()
  +stop()
  +close()
  -owner
  -dispatch
  -members
  -execution
  -reportIssue
  -batches
  -preparedTasks
  -cycles
  -waitingSlots
}
N_src_logic_dispatch_runtime_auto_collaboration_ts ..> N_src_logic_dispatch_runtime_auto_collaboration_ts_AutoCollaboration : 声明
```

成员 2/3（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_auto_collaboration_ts["auto-collaboration.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_auto_collaboration_ts_AutoCollaboration["AutoCollaboration"] {
  -resuming
  -closed
  -pending
  -scheduled
  -releaseListener
  -insertActiveInput()
  -humanContinuationPreflight()
  -acceptHumanContinuation()
  -replanPreflight()
  -acceptReplan()
  -recoveryPreflight()
  -acceptRecovery()
  -continuationCheckpoint()
  -acceptContinuation()
  -starting()
  -startFailed()
}
N_src_logic_dispatch_runtime_auto_collaboration_ts ..> N_src_logic_dispatch_runtime_auto_collaboration_ts_AutoCollaboration : 声明
```

成员 3/3（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_auto_collaboration_ts["auto-collaboration.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_auto_collaboration_ts_AutoCollaboration["AutoCollaboration"] {
  -track()
  -identity()
  -toolBinding()
  -admissionWait()
  -withdrawAdmissions()
  -retireBatch()
  -assertLive()
  -assign()
  -settled()
  -schedule()
  -ready()
  -budgetBlocked()
  -memberFailuresBlocked()
  -advance()
  -finishCycle()
}
N_src_logic_dispatch_runtime_auto_collaboration_ts ..> N_src_logic_dispatch_runtime_auto_collaboration_ts_AutoCollaboration : 声明
```

直接依赖：[../../tasks/rules/scope-goal.ts](../../tasks/rules/scope-goal.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../tasks/rules/member-checkpoint-chain.ts](../../tasks/rules/member-checkpoint-chain.ts)、[../../tasks/rules/member-checkpoint.ts](../../tasks/rules/member-checkpoint.ts)、[../../../core/errors.ts](../../../core/errors.ts)、[../../execution/rules/types.ts](../../execution/rules/types.ts)、[../../tasks/rules/dispatch-scope.ts](../../tasks/rules/dispatch-scope.ts)、[../../tasks/rules/scope-continuation.ts](../../tasks/rules/scope-continuation.ts)、[../../tasks/rules/scope-continuation-attachments.ts](../../tasks/rules/scope-continuation-attachments.ts)、[../../tasks/rules/scope-active-input.ts](../../tasks/rules/scope-active-input.ts)、[../../tasks/rules/human-continue.ts](../../tasks/rules/human-continue.ts)、[../../tasks/rules/scope-recovery.ts](../../tasks/rules/scope-recovery.ts)、[../../tasks/rules/scope-replan.ts](../../tasks/rules/scope-replan.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../tasks/rules/dispatch-commands.ts](../../tasks/rules/dispatch-commands.ts)、[../../tasks/rules/graph-types.ts](../../tasks/rules/graph-types.ts)、[../../tools/runtime/dispatch-tools.ts](../../tools/runtime/dispatch-tools.ts)、[../../tools/runtime/goal-tools.ts](../../tools/runtime/goal-tools.ts)、[../../tools/runtime/candidate-review-tools.ts](../../tools/runtime/candidate-review-tools.ts)、[../../team/runtime/member-state.ts](../../team/runtime/member-state.ts)、[../../tools/runtime/main-tool-contracts.ts](../../tools/runtime/main-tool-contracts.ts)、[../../tasks/rules/main-tool-output.ts](../../tasks/rules/main-tool-output.ts)、[dispatch-service.ts](dispatch-service.ts)、[../../team/runtime/member-execution.ts](../../team/runtime/member-execution.ts)、[../../conversation/runtime/execution-manager.ts](../../conversation/runtime/execution-manager.ts)、[../../execution/assembly/loop-engine.ts](../../execution/assembly/loop-engine.ts)、[../../execution/admission/workspace-lease.ts](../../execution/admission/workspace-lease.ts)、[../../execution/admission/admission-wait.ts](../../execution/admission/admission-wait.ts)、[../../tasks/rules/checkpoint-handoff.ts](../../tasks/rules/checkpoint-handoff.ts)、[../../execution/rules/input-source.ts](../../execution/rules/input-source.ts)、[goal-repair.ts](goal-repair.ts)、[member-failure-limit.ts](member-failure-limit.ts)、[../../models/index.ts](../../models/index.ts)。

### automatic-return-service.ts

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_automatic_return_service_ts["automatic-return-service.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_automatic_return_service_ts_AutomaticReturnService["AutomaticReturnService"] {
  +record()
  +inspect()
  +scopes()
  -owner
  -store
  -goals
  -logs
  -models
  -modelHash()
}
N_src_logic_dispatch_runtime_automatic_return_service_ts ..> N_src_logic_dispatch_runtime_automatic_return_service_ts_AutomaticReturnService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../tasks/rules/automatic-return.ts](../../tasks/rules/automatic-return.ts)、[../../tasks/rules/scope-goal.ts](../../tasks/rules/scope-goal.ts)、[../rules/dispatch-storage.ts](../rules/dispatch-storage.ts)、[../../tasks/rules/graph-types.ts](../../tasks/rules/graph-types.ts)、[../../tasks/rules/dispatch-scope.ts](../../tasks/rules/dispatch-scope.ts)、[../../execution/rules/types.ts](../../execution/rules/types.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../tasks/runtime/scope-goal-service.ts](../../tasks/runtime/scope-goal-service.ts)、[../../team/rules/workspace-member-rules.ts](../../team/rules/workspace-member-rules.ts)、[owner-execution-service.ts](owner-execution-service.ts)、[member-failure-limit.ts](member-failure-limit.ts)。

### dispatch-service.ts

成员 1/4（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_dispatch_service_ts["dispatch-service.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_dispatch_service_ts_DispatchWorkspace["DispatchWorkspace"] {
  <<type>>

}
N_src_logic_dispatch_runtime_dispatch_service_ts ..> N_src_logic_dispatch_runtime_dispatch_service_ts_DispatchWorkspace : 声明
class N_src_logic_dispatch_runtime_dispatch_service_ts_WorkspaceDispatchService["WorkspaceDispatchService"] {
  +goals
  +automaticReturns
  +owners
  +continuations
  +activeInputs
  +recoveries
  +replans
  +effects
  +humanDecisions
  +humanContinuations
  +usage
  +budgets
  +memberPauses
  +ownerInspect()
  +commandReport()
  +cancelQueued()
}
N_src_logic_dispatch_runtime_dispatch_service_ts ..> N_src_logic_dispatch_runtime_dispatch_service_ts_WorkspaceDispatchService : 声明
```

成员 2/4（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_dispatch_service_ts["dispatch-service.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_dispatch_service_ts_WorkspaceDispatchService["WorkspaceDispatchService"] {
  +replaceQueuedDependency()
  +addQueuedDependency()
  +reviseQueuedDependencies()
  +abandonCheckpoint()
  +checkpointAbandonmentReceipt()
  +initialize()
  +openScope()
  +registerMainRun()
  +closeScope()
  +parkScope()
  +waitingScopes()
  +recoverScopes()
  +openGraph()
  +conversationBinding()
  +createMember()
  +dispatchTask()
}
N_src_logic_dispatch_runtime_dispatch_service_ts ..> N_src_logic_dispatch_runtime_dispatch_service_ts_WorkspaceDispatchService : 声明
```

成员 3/4（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_dispatch_service_ts["dispatch-service.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_dispatch_service_ts_WorkspaceDispatchService["WorkspaceDispatchService"] {
  +snapshot()
  +delta()
  +sessionRead()
  +close()
  -owner
  -store
  -closed
  -queuedCancellation
  -queuedDependencyReplacement
  -queuedDependencyAddition
  -queuedDependencyRevision
  -checkpointAbandonment
  -commandVerification
  -check()
  -parse()
  -graph()
}
N_src_logic_dispatch_runtime_dispatch_service_ts ..> N_src_logic_dispatch_runtime_dispatch_service_ts_WorkspaceDispatchService : 声明
```

成员 4/4（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_dispatch_service_ts["dispatch-service.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_dispatch_service_ts_WorkspaceDispatchService["WorkspaceDispatchService"] {
  -command()
  -batch()
  -cursor()
  -recheck()
}
N_src_logic_dispatch_runtime_dispatch_service_ts ..> N_src_logic_dispatch_runtime_dispatch_service_ts_WorkspaceDispatchService : 声明
```

直接依赖：[../../execution/context/automatic-context.ts](../../execution/context/automatic-context.ts)、[../../tasks/rules/candidate-review.ts](../../tasks/rules/candidate-review.ts)、[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../tasks/runtime/main-command-request.ts](../../tasks/runtime/main-command-request.ts)、[../../evidence/runtime/command-verification-service.ts](../../evidence/runtime/command-verification-service.ts)、[../../evidence/runtime/effect-observation-service.ts](../../evidence/runtime/effect-observation-service.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../knowledge/rules/types.ts](../../knowledge/rules/types.ts)、[../../execution/rules/conversation-binding.ts](../../execution/rules/conversation-binding.ts)、[../rules/dispatch-storage.ts](../rules/dispatch-storage.ts)、[../../tasks/rules/dispatch-scope.ts](../../tasks/rules/dispatch-scope.ts)、[../../team/rules/agent-types.ts](../../team/rules/agent-types.ts)、[../../tasks/rules/types.ts](../../tasks/rules/types.ts)、[../../execution/rules/types.ts](../../execution/rules/types.ts)、[../../tasks/runtime/scope-goal-service.ts](../../tasks/runtime/scope-goal-service.ts)、[../../tasks/runtime/scope-continuation-service.ts](../../tasks/runtime/scope-continuation-service.ts)、[../../tasks/runtime/scope-active-input-service.ts](../../tasks/runtime/scope-active-input-service.ts)、[../../tasks/runtime/scope-recovery-service.ts](../../tasks/runtime/scope-recovery-service.ts)、[../../tasks/runtime/scope-replan-service.ts](../../tasks/runtime/scope-replan-service.ts)、[../../tasks/runtime/scope-human-decision-service.ts](../../tasks/runtime/scope-human-decision-service.ts)、[../../tasks/runtime/scope-human-continuation-service.ts](../../tasks/runtime/scope-human-continuation-service.ts)、[../../tasks/runtime/queued-task-cancel-service.ts](../../tasks/runtime/queued-task-cancel-service.ts)、[../../tasks/runtime/queued-dependency-replacement-service.ts](../../tasks/runtime/queued-dependency-replacement-service.ts)、[../../tasks/runtime/queued-dependency-addition-service.ts](../../tasks/runtime/queued-dependency-addition-service.ts)、[../../tasks/runtime/queued-dependency-revision-service.ts](../../tasks/runtime/queued-dependency-revision-service.ts)、[../../tasks/rules/queued-dependency-revision.ts](../../tasks/rules/queued-dependency-revision.ts)、[../../team/runtime/checkpoint-abandonment-service.ts](../../team/runtime/checkpoint-abandonment-service.ts)、[../../team/runtime/member-checkpoint-verifier.ts](../../team/runtime/member-checkpoint-verifier.ts)、[../../team/runtime/member-pause-service.ts](../../team/runtime/member-pause-service.ts)、[../../tasks/rules/checkpoint-handoff.ts](../../tasks/rules/checkpoint-handoff.ts)、[../../tasks/rules/queued-dependency-addition.ts](../../tasks/rules/queued-dependency-addition.ts)、[../../tasks/rules/queued-dependency-replacement.ts](../../tasks/rules/queued-dependency-replacement.ts)、[../../tasks/rules/member-checkpoint.ts](../../tasks/rules/member-checkpoint.ts)、[../../budget/runtime/scope-usage-service.ts](../../budget/runtime/scope-usage-service.ts)、[../../budget/runtime/scope-budget-service.ts](../../budget/runtime/scope-budget-service.ts)、[../../budget/rules/scope-budget.ts](../../budget/rules/scope-budget.ts)、[../../tasks/rules/queued-task-cancel.ts](../../tasks/rules/queued-task-cancel.ts)、[../../tasks/rules/dispatch-commands.ts](../../tasks/rules/dispatch-commands.ts)、[../../tasks/rules/graph-types.ts](../../tasks/rules/graph-types.ts)、[../../execution/context/dispatch-context.ts](../../execution/context/dispatch-context.ts)、[../../team/runtime/agent-manager.ts](../../team/runtime/agent-manager.ts)、[../../tasks/rules/scope-view.ts](../../tasks/rules/scope-view.ts)、[../../tasks/rules/scope-run-tracking.ts](../../tasks/rules/scope-run-tracking.ts)、[owner-execution-service.ts](owner-execution-service.ts)、[automatic-return-service.ts](automatic-return-service.ts)。

### goal-repair.ts

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_goal_repair_ts["goal-repair.ts"] {
  <<module>>
  +goalRepairFeedback()
}
```

直接依赖：[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../execution/rules/input-source.ts](../../execution/rules/input-source.ts)、[../../tasks/rules/dispatch-scope.ts](../../tasks/rules/dispatch-scope.ts)、[../../tasks/rules/graph-types.ts](../../tasks/rules/graph-types.ts)。

### member-failure-limit.ts

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_member_failure_limit_ts["member-failure-limit.ts"] {
  <<module>>
  +memberFailureStopReason()
}
```

直接依赖：[../../tasks/rules/graph-types.ts](../../tasks/rules/graph-types.ts)。

### owner-execution-service.ts

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_owner_execution_service_ts["owner-execution-service.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_owner_execution_service_ts_OwnerExecutionWorkspace["OwnerExecutionWorkspace"] {
  <<type>>

}
N_src_logic_dispatch_runtime_owner_execution_service_ts ..> N_src_logic_dispatch_runtime_owner_execution_service_ts_OwnerExecutionWorkspace : 声明
class N_src_logic_dispatch_runtime_owner_execution_service_ts_OwnerExecutionModelPorts["OwnerExecutionModelPorts"] {
  <<interface>>
  +configuration()
  +withConfigurations()
}
N_src_logic_dispatch_runtime_owner_execution_service_ts ..> N_src_logic_dispatch_runtime_owner_execution_service_ts_OwnerExecutionModelPorts : 声明
class N_src_logic_dispatch_runtime_owner_execution_service_ts_ExecutionSelection["ExecutionSelection"] {
  <<type>>

}
N_src_logic_dispatch_runtime_owner_execution_service_ts ..> N_src_logic_dispatch_runtime_owner_execution_service_ts_ExecutionSelection : 声明
class N_src_logic_dispatch_runtime_owner_execution_service_ts_OwnerExecutionContext["OwnerExecutionContext"] {
  <<interface>>
  +snapshot
  +profiles
}
N_src_logic_dispatch_runtime_owner_execution_service_ts ..> N_src_logic_dispatch_runtime_owner_execution_service_ts_OwnerExecutionContext : 声明
```

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_owner_execution_service_ts["owner-execution-service.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_owner_execution_service_ts_OwnerExecutionService["OwnerExecutionService"] {
  +replay()
  +withSnapshot()
  +withContext()
  +resolve()
  +policy()
  +selection()
  +resolveExecution()
  +verifyTask()
  +selections()
  +recheck()
  +discover()
  +inspectTask()
  -owner
  -store
  -models
}
N_src_logic_dispatch_runtime_owner_execution_service_ts ..> N_src_logic_dispatch_runtime_owner_execution_service_ts_OwnerExecutionService : 声明
```

直接依赖：[../../team/rules/automatic-execution.ts](../../team/rules/automatic-execution.ts)、[../../../core/errors.ts](../../../core/errors.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../knowledge/rules/types.ts](../../knowledge/rules/types.ts)、[../rules/dispatch-storage.ts](../rules/dispatch-storage.ts)、[../../tasks/rules/graph-types.ts](../../tasks/rules/graph-types.ts)、[../../team/rules/workspace-member.ts](../../team/rules/workspace-member.ts)、[../../team/rules/workspace-member-rules.ts](../../team/rules/workspace-member-rules.ts)、[../../team/rules/member-execution-binding.ts](../../team/rules/member-execution-binding.ts)、[../../team/rules/member-execution-rules.ts](../../team/rules/member-execution-rules.ts)、[../../team/rules/owner-execution-discovery.ts](../../team/rules/owner-execution-discovery.ts)、[../../team/rules/implicit-module-owner.ts](../../team/rules/implicit-module-owner.ts)、[../../workspace/rules/knowledge-source-rules.ts](../../workspace/rules/knowledge-source-rules.ts)、[../../execution/context/dispatch-context.ts](../../execution/context/dispatch-context.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_auto_collaboration_ts["auto-collaboration.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_dispatch_service_ts["dispatch-service.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_goal_repair_ts["goal-repair.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_member_failure_limit_ts["member-failure-limit.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_automatic_return_service_ts["automatic-return-service.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_owner_execution_service_ts["owner-execution-service.ts"] {
  <<module>>
}
N_src_logic_dispatch_runtime_auto_collaboration_ts ..> N_src_logic_dispatch_runtime_dispatch_service_ts : 导入依赖
N_src_logic_dispatch_runtime_auto_collaboration_ts ..> N_src_logic_dispatch_runtime_goal_repair_ts : 导入依赖
N_src_logic_dispatch_runtime_auto_collaboration_ts ..> N_src_logic_dispatch_runtime_member_failure_limit_ts : 导入依赖
N_src_logic_dispatch_runtime_automatic_return_service_ts ..> N_src_logic_dispatch_runtime_owner_execution_service_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_logic_dispatch_runtime_automatic_return_service_ts["automatic-return-service.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_member_failure_limit_ts["member-failure-limit.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_dispatch_service_ts["dispatch-service.ts"] {
  <<module>>
}
class N_src_logic_dispatch_runtime_owner_execution_service_ts["owner-execution-service.ts"] {
  <<module>>
}
N_src_logic_dispatch_runtime_automatic_return_service_ts ..> N_src_logic_dispatch_runtime_member_failure_limit_ts : 导入依赖
N_src_logic_dispatch_runtime_dispatch_service_ts ..> N_src_logic_dispatch_runtime_owner_execution_service_ts : 导入依赖
N_src_logic_dispatch_runtime_dispatch_service_ts ..> N_src_logic_dispatch_runtime_automatic_return_service_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

## 主会话办公室登记

普通排队启动以管理器传入的持久队列 ID 打开新话题；主动首轮仍生成新身份，结果回注与明确补充沿原周期。前端不能通过运行 options 指定任意周期，原 openScope 幂等/关闭门禁继续校验。

`openGraph`、`conversationBinding`、`createMember` 和 `dispatchTask` 把 `prepareMember` 给出的长期 `teamSession` 与原登记事务一同提交。每个办公室的同一 Agent 跨任务和周期复用逻辑对话，任务执行实例与原生通道仍按原任务保存；周期关闭只处理执行事实，不删除逻辑对话。原命令重放返回原回执，不创建第二个逻辑身份。

自动协调器遇 `TEAM_SESSION_BUSY` 保留该任务并继续尝试其它角色；本批仍有此类等待时不提前汇总为执行结果。完成/停止仍依赖原成员的可靠结算与占用释放事件。

## 分阶段候选审阅

新派发依赖要求主 Agent 显式接受前置候选；未批准时不启动后继。AutoCollaboration 与成员领取共享 dependenciesReady，当前可执行成员结束后即回注主运行，不等尚被审阅关口阻塞的后继。member-results 主轮从同周期任务图保留尚未启动的 queued/waiting 任务，批准并结束该主轮后继续原待办，不创建替代任务或重放原派发。回注包含 candidateReview 以及显式审阅指引。

候选接受本身是可靠持久事实；主轮失败不会触发后继自动执行。停止、容量、权限、知识和文件门禁保持。重启自动回传仍只支持既有的全部成员可靠交付条件，含未启动后继的周期不因新审阅字段获得自动重启许可；旧日志和活动用户数据不迁移。

主轮正常结束后，若当前目标审阅由同一 runId 保存为 blocked 或 awaiting_user，先退役批次并进入统一关闭/停泊门禁，不再启动继承待办或创建结果回注。启动前拒绝没有成员运行可计入异常额度，这条显式决定仍必须终止自动尝试。旧 runId 的审阅不拦截用户明确恢复的新主轮；等待合法性、原检查点清单与完整日志仍由 parkScope 验证，阻塞不伪装成功。异步读取后重核周期活性，取消优先。

## 异常执行后的自动接续上限

`memberFailureStopReason` 是协调层纯策略：同一 scope 累计 3 个已启动且可靠结算为 failed/interrupted 的成员任务后，停止自动接续。不是按任务名称、负责人、原生实例或错误文案分组，也不是连续失败计数；另派任务、成功交付其它任务和文本/工具进展均不清除已发生异常。采用整个目标的保守额度，代价是三项独立异常也会要求用户核实。用户取消、求助、检查点、未启动待办和正常候选不计入异常。阈值当前固定，模型不能调整。

权威状态仍是持久任务图，失败/中断任务不能重新执行、改成其它终态或删除；不新增第二份计数与恢复文件。AutoCollaboration 在启动下一成员、回注结果及验收返工前检查，同样约束没有待回传成员的主轮收尾。触发后先退役批次、撤销容量等待，再将明确理由持久保存到 goal.blocked 并暂停用户队列；既有在途成员沿原停止、关闭、结算及资源排空流程收尾，未确认结果保持原事实，不生成成功候选。各任务原 waitReason 继续展示具体中断原因，目标卡展示自动接续停止原因。

AutomaticReturnService 在恢复取证中使用同一策略，覆盖第三次异常已经落盘但尚未写入 blocked 的退出窗口。已持久 blocked 或关闭的周期本来就不能自动恢复；等待与重规划仍须用户显式操作。旧任务历史不迁移，失败计数不会跨到用户明确创建的新目标。原有每目标 32 次主调度上限、最终验收最多 3 次返工/同指纹最多 2 次以及逐工具重复失败保护继续生效。

变化仅在协调层组合纯策略；运行计时、引擎适配、任务终态和存储协议保持。无进展计时器只在当前运行内续期，到期后的迟到事件不能重新激活；它不负责跨任务重试额度。未来调整异常分类或次数从 member-failure-limit 修改，实时与重启两个消费者共同验证；变化频率尚无统计依据，不预设通用重试框架。
