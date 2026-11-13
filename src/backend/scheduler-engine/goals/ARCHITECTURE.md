# src/backend/scheduler-engine/goals 架构

## 目录定位

目标周期、等待、续执行、恢复与重计划编排。ScopeGoalService 的跨域依赖仍在，目录迁移不冒充职责重构。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [main-command-request.ts](main-command-request.ts) | 共享主调度原命令的指纹构造，从已核实 canonical 参数复原历史请求，包含原子前置增删。 |
| [queued-dependency-addition-service.ts](queued-dependency-addition-service.ts) | 在同一派发事务核实未领取任务及两端后继，为原目标追加一条结果前置。 |
| [queued-dependency-replacement-service.ts](queued-dependency-replacement-service.ts) | 主调度在同一事务核实旧前置、安全替代候选与未启动后继，并原子提交单条依赖替换。 |
| [queued-dependency-revision-service.ts](queued-dependency-revision-service.ts) | 在同一可靠事务中退役和新增未领取目标的多条前置，保存原请求与完整闭包审计。 |
| [queued-task-cancel-service.ts](queued-task-cancel-service.ts) | 主调度在单个派发事务中撤销明确的一组尚未启动任务。 |
| [scope-active-input-evidence.ts](scope-active-input-evidence.ts) | 把目标补充的持久接收记录与原主运行的可信插入日志逐项核对。 |
| [scope-active-input-service.ts](scope-active-input-service.ts) | 在派发事务中登记运行中插入的准备、真实接收和不确定事实。 |
| [scope-continuation-service.ts](scope-continuation-service.ts) | 原子消费安全等待，保存用户原始补充、可选附件快照清单和一次性主运行意图。 |
| [scope-goal-service.ts](scope-goal-service.ts) | 保存目标计划与审阅，核验返工前的原始日志及精确拒绝候选；替代仍须真实新成果，人工项不因业务拒绝而降级。 |
| [scope-human-continuation-service.ts](scope-human-continuation-service.ts) | 将当前等待中的最新人工决定全集转换成一次可信主运行接续意图。 |
| [scope-human-decision-service.ts](scope-human-decision-service.ts) | 核实安全等待中的人工验收项和明确选定文件，保存本机显式决定及不可变依据。 |
| [scope-recovery-service.ts](scope-recovery-service.ts) | 为已关闭周期的异常执行创建独立只读核实周期，持久化用户观察和一次性全新上下文意图。 |
| [scope-replan-service.ts](scope-replan-service.ts) | 在完成的只读核实基础上创建独立业务周期，冻结真实证据、原人工约束和用户明确的新目标。 |

## 架构类图

### main-command-request.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_main_command_request_ts["main-command-request.ts"] {
  <<module>>
  +goalCommand()
  +dispatchCommand()
  +contextualMainCommand()
  +memberResumeCommand()
  +restoreMainCommand()
}
```

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_main_command_request_ts["main-command-request.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_main_command_request_ts_RestoredMainCommand["RestoredMainCommand"] {
  <<interface>>
  +commandId
  +fingerprint
  +input
}
N_src_backend_scheduler_engine_goals_main_command_request_ts ..> N_src_backend_scheduler_engine_goals_main_command_request_ts_RestoredMainCommand : 声明
```

直接依赖：[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../../core/errors.ts](../../../core/errors.ts)、[../../../logic/tasks/rules/graph-types.ts](../../../logic/tasks/rules/graph-types.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/dispatch-commands.ts](../../../logic/tasks/rules/dispatch-commands.ts)、[../../../logic/tasks/rules/scope-goal.ts](../../../logic/tasks/rules/scope-goal.ts)、[../../../logic/tasks/rules/queued-task-cancel.ts](../../../logic/tasks/rules/queued-task-cancel.ts)、[../../../logic/tasks/rules/queued-dependency-replacement.ts](../../../logic/tasks/rules/queued-dependency-replacement.ts)、[../../../logic/tasks/rules/queued-dependency-addition.ts](../../../logic/tasks/rules/queued-dependency-addition.ts)、[../../../logic/tasks/rules/queued-dependency-revision.ts](../../../logic/tasks/rules/queued-dependency-revision.ts)、[../../../logic/tasks/rules/queued-member-resume.ts](../../../logic/tasks/rules/queued-member-resume.ts)、[../../../logic/tasks/rules/checkpoint-handoff.ts](../../../logic/tasks/rules/checkpoint-handoff.ts)、[../../../logic/tasks/rules/command-verification.ts](../../../logic/tasks/rules/command-verification.ts)、[../../../logic/tasks/rules/main-tool-output.ts](../../../logic/tasks/rules/main-tool-output.ts)、[../tools/main-tool-contracts.ts](../tools/main-tool-contracts.ts)。

### queued-dependency-addition-service.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_queued_dependency_addition_service_ts["queued-dependency-addition-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_queued_dependency_addition_service_ts_QueuedDependencyAdditionService["QueuedDependencyAdditionService"] {
  +add()
  -owner
  -store
  -goals
  -owners
}
N_src_backend_scheduler_engine_goals_queued_dependency_addition_service_ts ..> N_src_backend_scheduler_engine_goals_queued_dependency_addition_service_ts_QueuedDependencyAdditionService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[main-command-request.ts](main-command-request.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/graph-types.ts](../../../logic/tasks/rules/graph-types.ts)、[../../../logic/tasks/rules/queued-dependency-addition.ts](../../../logic/tasks/rules/queued-dependency-addition.ts)、[../../../logic/tasks/rules/queued-dependency-addition-rules.ts](../../../logic/tasks/rules/queued-dependency-addition-rules.ts)、[../context/execution-context.ts](../context/execution-context.ts)、[../members/member-state.ts](../members/member-state.ts)、[scope-goal-service.ts](scope-goal-service.ts)、[../dispatch/owner-execution-service.ts](../dispatch/owner-execution-service.ts)、[../../../logic/team/rules/member-execution-binding.ts](../../../logic/team/rules/member-execution-binding.ts)。

### queued-dependency-replacement-service.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_queued_dependency_replacement_service_ts["queued-dependency-replacement-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_queued_dependency_replacement_service_ts_QueuedDependencyReplacementService["QueuedDependencyReplacementService"] {
  +replace()
  -owner
  -store
  -goals
  -owners
}
N_src_backend_scheduler_engine_goals_queued_dependency_replacement_service_ts ..> N_src_backend_scheduler_engine_goals_queued_dependency_replacement_service_ts_QueuedDependencyReplacementService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[main-command-request.ts](main-command-request.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/graph-types.ts](../../../logic/tasks/rules/graph-types.ts)、[../../../logic/tasks/rules/queued-dependency-replacement.ts](../../../logic/tasks/rules/queued-dependency-replacement.ts)、[../../../logic/tasks/rules/queued-dependency-replacement-rules.ts](../../../logic/tasks/rules/queued-dependency-replacement-rules.ts)、[../context/execution-context.ts](../context/execution-context.ts)、[../members/member-state.ts](../members/member-state.ts)、[scope-goal-service.ts](scope-goal-service.ts)、[../dispatch/owner-execution-service.ts](../dispatch/owner-execution-service.ts)、[../../../logic/team/rules/member-execution-binding.ts](../../../logic/team/rules/member-execution-binding.ts)。

### queued-dependency-revision-service.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_queued_dependency_revision_service_ts["queued-dependency-revision-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_queued_dependency_revision_service_ts_QueuedDependencyRevisionService["QueuedDependencyRevisionService"] {
  +revise()
  -owner
  -store
  -goals
  -owners
}
N_src_backend_scheduler_engine_goals_queued_dependency_revision_service_ts ..> N_src_backend_scheduler_engine_goals_queued_dependency_revision_service_ts_QueuedDependencyRevisionService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[main-command-request.ts](main-command-request.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/graph-types.ts](../../../logic/tasks/rules/graph-types.ts)、[../../../logic/tasks/rules/queued-dependency-revision.ts](../../../logic/tasks/rules/queued-dependency-revision.ts)、[../../../logic/tasks/rules/queued-dependency-revision-rules.ts](../../../logic/tasks/rules/queued-dependency-revision-rules.ts)、[../context/execution-context.ts](../context/execution-context.ts)、[../members/member-state.ts](../members/member-state.ts)、[scope-goal-service.ts](scope-goal-service.ts)、[../dispatch/owner-execution-service.ts](../dispatch/owner-execution-service.ts)、[../../../logic/team/rules/member-execution-binding.ts](../../../logic/team/rules/member-execution-binding.ts)。

### queued-task-cancel-service.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_queued_task_cancel_service_ts["queued-task-cancel-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_queued_task_cancel_service_ts_QueuedTaskCancelService["QueuedTaskCancelService"] {
  +cancel()
  -owner
  -store
}
N_src_backend_scheduler_engine_goals_queued_task_cancel_service_ts ..> N_src_backend_scheduler_engine_goals_queued_task_cancel_service_ts_QueuedTaskCancelService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[main-command-request.ts](main-command-request.ts)、[../../../logic/knowledge/rules/ports.ts](../../../logic/knowledge/rules/ports.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/graph-types.ts](../../../logic/tasks/rules/graph-types.ts)、[../../../logic/tasks/rules/queued-task-cancel.ts](../../../logic/tasks/rules/queued-task-cancel.ts)、[../../../logic/tasks/rules/queued-task-cancel-rules.ts](../../../logic/tasks/rules/queued-task-cancel-rules.ts)。

### scope-active-input-evidence.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_active_input_evidence_ts["scope-active-input-evidence.ts"] {
  <<module>>
  +validateScopeActiveInputLog()
}
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../logic/execution/rules/types.ts](../../../logic/execution/rules/types.ts)、[../../../logic/tasks/rules/dispatch-scope.ts](../../../logic/tasks/rules/dispatch-scope.ts)、[../../../logic/tasks/rules/scope-goal.ts](../../../logic/tasks/rules/scope-goal.ts)、[../../../logic/tasks/rules/scope-active-input.ts](../../../logic/tasks/rules/scope-active-input.ts)、[../../../logic/tasks/rules/scope-active-input-rules.ts](../../../logic/tasks/rules/scope-active-input-rules.ts)。

### scope-active-input-service.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_active_input_service_ts["scope-active-input-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_active_input_service_ts_Owner["Owner"] {
  <<type>>

}
N_src_backend_scheduler_engine_goals_scope_active_input_service_ts ..> N_src_backend_scheduler_engine_goals_scope_active_input_service_ts_Owner : 声明
class N_src_backend_scheduler_engine_goals_scope_active_input_service_ts_PreparedActiveInput["PreparedActiveInput"] {
  <<interface>>
  +record
  +token
  +fresh
}
N_src_backend_scheduler_engine_goals_scope_active_input_service_ts ..> N_src_backend_scheduler_engine_goals_scope_active_input_service_ts_PreparedActiveInput : 声明
class N_src_backend_scheduler_engine_goals_scope_active_input_service_ts_ScopeActiveInputService["ScopeActiveInputService"] {
  +inspect()
  +prepare()
  +resolve()
  -owner
  -store
  -scope()
}
N_src_backend_scheduler_engine_goals_scope_active_input_service_ts ..> N_src_backend_scheduler_engine_goals_scope_active_input_service_ts_ScopeActiveInputService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../../logic/knowledge/rules/ports.ts](../../../logic/knowledge/rules/ports.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/dispatch-scope.ts](../../../logic/tasks/rules/dispatch-scope.ts)、[../../../logic/tasks/rules/graph-types.ts](../../../logic/tasks/rules/graph-types.ts)、[../../../logic/tasks/rules/scope-goal.ts](../../../logic/tasks/rules/scope-goal.ts)、[../../../logic/tasks/rules/scope-continuation-record.ts](../../../logic/tasks/rules/scope-continuation-record.ts)、[../../../logic/tasks/rules/scope-active-input.ts](../../../logic/tasks/rules/scope-active-input.ts)、[../../../logic/tasks/rules/scope-active-input-rules.ts](../../../logic/tasks/rules/scope-active-input-rules.ts)。

### scope-continuation-service.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_continuation_service_ts["scope-continuation-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_continuation_service_ts_Owner["Owner"] {
  <<type>>

}
N_src_backend_scheduler_engine_goals_scope_continuation_service_ts ..> N_src_backend_scheduler_engine_goals_scope_continuation_service_ts_Owner : 声明
class N_src_backend_scheduler_engine_goals_scope_continuation_service_ts_AcceptedScopeContinuation["AcceptedScopeContinuation"] {
  <<interface>>
  +scope
  +continuation
  +fresh
}
N_src_backend_scheduler_engine_goals_scope_continuation_service_ts ..> N_src_backend_scheduler_engine_goals_scope_continuation_service_ts_AcceptedScopeContinuation : 声明
class N_src_backend_scheduler_engine_goals_scope_continuation_service_ts_ScopeContinuationService["ScopeContinuationService"] {
  +inspect()
  +accept()
  -owner
  -store
  -budgets
  -memberPauses
  -parse()
  -scope()
}
N_src_backend_scheduler_engine_goals_scope_continuation_service_ts ..> N_src_backend_scheduler_engine_goals_scope_continuation_service_ts_ScopeContinuationService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../logic/execution/ports/identity.ts](../../../logic/execution/ports/identity.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../../logic/knowledge/rules/ports.ts](../../../logic/knowledge/rules/ports.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/dispatch-scope.ts](../../../logic/tasks/rules/dispatch-scope.ts)、[../../../logic/tasks/rules/scope-run-tracking.ts](../../../logic/tasks/rules/scope-run-tracking.ts)、[../../../logic/tasks/rules/scope-goal.ts](../../../logic/tasks/rules/scope-goal.ts)、[../../../logic/tasks/rules/scope-continuation-attachments.ts](../../../logic/tasks/rules/scope-continuation-attachments.ts)、[../../../logic/tasks/rules/scope-continuation.ts](../../../logic/tasks/rules/scope-continuation.ts)、[../budget/scope-budget-service.ts](../budget/scope-budget-service.ts)、[../../../logic/tasks/rules/scope-continuation-record.ts](../../../logic/tasks/rules/scope-continuation-record.ts)、[../../../logic/tasks/rules/scope-active-input.ts](../../../logic/tasks/rules/scope-active-input.ts)、[../members/member-pause-service.ts](../members/member-pause-service.ts)、[../dispatch/owner-execution-service.ts](../dispatch/owner-execution-service.ts)。

### scope-goal-service.ts

成员 1/3（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts["scope-goal-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts_ScopeGoalPorts["ScopeGoalPorts"] {
  <<interface>>
  +inspectMember()
  +inspectMain()
  +normalizeValidationPath()
  +checkValidationFiles()
  +checkManifest()
}
N_src_backend_scheduler_engine_goals_scope_goal_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts_ScopeGoalPorts : 声明
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts_Owner["Owner"] {
  <<type>>

}
N_src_backend_scheduler_engine_goals_scope_goal_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts_Owner : 声明
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts_ScopeGoalService["ScopeGoalService"] {
  +reviewCandidate()
  +inspect()
  +inspectWithGraph()
  +previewClosure()
  +plan()
  +validateDispatch()
  +validateActiveInputs()
  +repairContext()
  +validateMemberCandidate()
  +validateHistoricalMemberCandidate()
  +validateHumanCandidates()
  +validateDependencySource()
  +review()
  +validateCompletion()
  +validateCompletedInspection()
  +validateWaiting()
}
N_src_backend_scheduler_engine_goals_scope_goal_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts_ScopeGoalService : 声明
```

成员 2/3（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts["scope-goal-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts_ScopeGoalService["ScopeGoalService"] {
  +block()
  -owner
  -store
  -ports
  -humanPorts
  -owners
  -memberPauses
  -parse()
  -scope()
  -graph()
  -editable()
  -command()
  -logs()
  -main()
  -receipt()
  -member()
}
N_src_backend_scheduler_engine_goals_scope_goal_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts_ScopeGoalService : 声明
```

成员 3/3（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts["scope-goal-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts_ScopeGoalService["ScopeGoalService"] {
  -memberTerminal()
  -evidence()
  -supersessions()
}
N_src_backend_scheduler_engine_goals_scope_goal_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts_ScopeGoalService : 声明
```

直接依赖：[../context/automatic-context.ts](../context/automatic-context.ts)、[../../../logic/team/rules/automatic-execution.ts](../../../logic/team/rules/automatic-execution.ts)、[../../../logic/tasks/rules/candidate-review.ts](../../../logic/tasks/rules/candidate-review.ts)、[../../../logic/tools/rules/questions.ts](../../../logic/tools/rules/questions.ts)、[../../../logic/tasks/rules/scope-active-input.ts](../../../logic/tasks/rules/scope-active-input.ts)、[scope-active-input-evidence.ts](scope-active-input-evidence.ts)、[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[main-command-request.ts](main-command-request.ts)、[../../../logic/knowledge/rules/ports.ts](../../../logic/knowledge/rules/ports.ts)、[../../../logic/execution/rules/types.ts](../../../logic/execution/rules/types.ts)、[../../../logic/tools/rules/types.ts](../../../logic/tools/rules/types.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/dispatch-execution.ts](../../../logic/tasks/rules/dispatch-execution.ts)、[../../../logic/tasks/rules/dispatch-commands.ts](../../../logic/tasks/rules/dispatch-commands.ts)、[../../../logic/tasks/rules/dispatch-scope.ts](../../../logic/tasks/rules/dispatch-scope.ts)、[../../../logic/tasks/rules/graph-types.ts](../../../logic/tasks/rules/graph-types.ts)、[../../../logic/tasks/rules/scope-goal.ts](../../../logic/tasks/rules/scope-goal.ts)、[../context/dispatch-context.ts](../context/dispatch-context.ts)、[../evidence/execution-report-facts.ts](../evidence/execution-report-facts.ts)、[../members/member-help-state.ts](../members/member-help-state.ts)、[../runtime/member-events.ts](../runtime/member-events.ts)、[../evidence/human-decision-evidence.ts](../evidence/human-decision-evidence.ts)、[../../../logic/tasks/rules/human-decisions.ts](../../../logic/tasks/rules/human-decisions.ts)、[../../../logic/tasks/rules/human-continuation-rules.ts](../../../logic/tasks/rules/human-continuation-rules.ts)、[../members/member-workflow.ts](../members/member-workflow.ts)、[../../../logic/evidence/rules/output-manifest.ts](../../../logic/evidence/rules/output-manifest.ts)、[../../../logic/evidence/rules/artifact-baseline.ts](../../../logic/evidence/rules/artifact-baseline.ts)、[../../../logic/tasks/rules/workflow-selection.ts](../../../logic/tasks/rules/workflow-selection.ts)、[../../../logic/team/rules/member-execution-binding.ts](../../../logic/team/rules/member-execution-binding.ts)、[../dispatch/owner-execution-service.ts](../dispatch/owner-execution-service.ts)、[../../../logic/tasks/rules/checkpoint-handoff-rules.ts](../../../logic/tasks/rules/checkpoint-handoff-rules.ts)、[../members/member-checkpoint-verifier.ts](../members/member-checkpoint-verifier.ts)、[../members/member-pause-service.ts](../members/member-pause-service.ts)、[../../../logic/tasks/rules/coordination-preview.ts](../../../logic/tasks/rules/coordination-preview.ts)、[../../../logic/tasks/rules/queued-task-cancel.ts](../../../logic/tasks/rules/queued-task-cancel.ts)、[../../../logic/team/rules/workspace-member.ts](../../../logic/team/rules/workspace-member.ts)。

### scope-human-continuation-service.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_human_continuation_service_ts["scope-human-continuation-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_human_continuation_service_ts_AcceptedHumanContinuation["AcceptedHumanContinuation"] {
  <<interface>>
  +scope
  +continuation
  +fresh
}
N_src_backend_scheduler_engine_goals_scope_human_continuation_service_ts ..> N_src_backend_scheduler_engine_goals_scope_human_continuation_service_ts_AcceptedHumanContinuation : 声明
class N_src_backend_scheduler_engine_goals_scope_human_continuation_service_ts_ScopeHumanContinuationService["ScopeHumanContinuationService"] {
  +inspect()
  +preflight()
  +accept()
  -owner
  -store
  -goals
  -logs
  -artifacts
  -budgets
  -parse()
  -current()
  -scope()
  -proof()
}
N_src_backend_scheduler_engine_goals_scope_human_continuation_service_ts ..> N_src_backend_scheduler_engine_goals_scope_human_continuation_service_ts_ScopeHumanContinuationService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../../logic/execution/ports/identity.ts](../../../logic/execution/ports/identity.ts)、[../../../logic/knowledge/rules/ports.ts](../../../logic/knowledge/rules/ports.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/dispatch-scope.ts](../../../logic/tasks/rules/dispatch-scope.ts)、[../../../logic/tasks/rules/scope-goal.ts](../../../logic/tasks/rules/scope-goal.ts)、[../../../logic/tasks/rules/scope-run-tracking.ts](../../../logic/tasks/rules/scope-run-tracking.ts)、[../../../logic/tasks/rules/human-continue.ts](../../../logic/tasks/rules/human-continue.ts)、[../../../logic/tasks/rules/scope-continuation-record.ts](../../../logic/tasks/rules/scope-continuation-record.ts)、[../../../logic/tasks/rules/human-continuation-rules.ts](../../../logic/tasks/rules/human-continuation-rules.ts)、[scope-goal-service.ts](scope-goal-service.ts)、[../evidence/human-decision-evidence.ts](../evidence/human-decision-evidence.ts)、[../budget/scope-budget-service.ts](../budget/scope-budget-service.ts)、[../evidence/human-evidence-state.ts](../evidence/human-evidence-state.ts)。

### scope-human-decision-service.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts["scope-human-decision-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts_Owner["Owner"] {
  <<type>>

}
N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts ..> N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts_Owner : 声明
class N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts_ScopeHumanDecisionService["ScopeHumanDecisionService"] {
  +inspect()
  +history()
  +preview()
  +decide()
  -owner
  -store
  -goals
  -logs
  -ports
  -assertCurrent
  -parse()
  -current()
  -scope()
  -receipt()
  -stateStamp()
  -originalVerified()
}
N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts ..> N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts_ScopeHumanDecisionService : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts["scope-human-decision-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts_ScopeHumanDecisionService["ScopeHumanDecisionService"] {
  -reconsider()
  -collect()
  -reading()
  -unavailable()
}
N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts ..> N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts_ScopeHumanDecisionService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../../logic/knowledge/rules/ports.ts](../../../logic/knowledge/rules/ports.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/dispatch-scope.ts](../../../logic/tasks/rules/dispatch-scope.ts)、[../../../logic/tasks/rules/scope-goal.ts](../../../logic/tasks/rules/scope-goal.ts)、[../../../logic/evidence/rules/artifact-baseline.ts](../../../logic/evidence/rules/artifact-baseline.ts)、[../../../logic/evidence/rules/artifact-evidence.ts](../../../logic/evidence/rules/artifact-evidence.ts)、[../../../logic/evidence/rules/complete-output-evidence.ts](../../../logic/evidence/rules/complete-output-evidence.ts)、[../../../logic/evidence/rules/output-manifest.ts](../../../logic/evidence/rules/output-manifest.ts)、[../../../logic/tasks/rules/human-decisions.ts](../../../logic/tasks/rules/human-decisions.ts)、[../../../logic/tasks/rules/human-decision-proof.ts](../../../logic/tasks/rules/human-decision-proof.ts)、[../../../logic/tasks/rules/human-reconsideration.ts](../../../logic/tasks/rules/human-reconsideration.ts)、[scope-goal-service.ts](scope-goal-service.ts)、[../evidence/human-decision-evidence.ts](../evidence/human-decision-evidence.ts)、[../evidence/human-evidence-state.ts](../evidence/human-evidence-state.ts)。

### scope-recovery-service.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_recovery_service_ts["scope-recovery-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_recovery_service_ts_Owner["Owner"] {
  <<type>>

}
N_src_backend_scheduler_engine_goals_scope_recovery_service_ts ..> N_src_backend_scheduler_engine_goals_scope_recovery_service_ts_Owner : 声明
class N_src_backend_scheduler_engine_goals_scope_recovery_service_ts_RecoveryLaunch["RecoveryLaunch"] {
  <<type>>
  +runId
  +nativeSessionId
  +excludedRunIds
  +signal
}
N_src_backend_scheduler_engine_goals_scope_recovery_service_ts ..> N_src_backend_scheduler_engine_goals_scope_recovery_service_ts_RecoveryLaunch : 声明
class N_src_backend_scheduler_engine_goals_scope_recovery_service_ts_AcceptedRecovery["AcceptedRecovery"] {
  <<type>>
  +scope
  +recovery
  +fresh
}
N_src_backend_scheduler_engine_goals_scope_recovery_service_ts ..> N_src_backend_scheduler_engine_goals_scope_recovery_service_ts_AcceptedRecovery : 声明
class N_src_backend_scheduler_engine_goals_scope_recovery_service_ts_ScopeRecoveryService["ScopeRecoveryService"] {
  +inspect()
  +latestContext()
  +priorRunIds()
  +preflight()
  +accept()
  -owner
  -store
  -logs
  -budgets
  -effects
  -parse()
  -identity()
  -found()
  -receipt()
  -sameRequest()
  -workspace()
}
N_src_backend_scheduler_engine_goals_scope_recovery_service_ts ..> N_src_backend_scheduler_engine_goals_scope_recovery_service_ts_ScopeRecoveryService : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_recovery_service_ts["scope-recovery-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_recovery_service_ts_ScopeRecoveryService["ScopeRecoveryService"] {
  -report()
}
N_src_backend_scheduler_engine_goals_scope_recovery_service_ts ..> N_src_backend_scheduler_engine_goals_scope_recovery_service_ts_ScopeRecoveryService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../../logic/knowledge/rules/ports.ts](../../../logic/knowledge/rules/ports.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/dispatch-scope.ts](../../../logic/tasks/rules/dispatch-scope.ts)、[../../../logic/tasks/rules/graph-types.ts](../../../logic/tasks/rules/graph-types.ts)、[../../../logic/tasks/rules/dispatch-commands.ts](../../../logic/tasks/rules/dispatch-commands.ts)、[../../../logic/tasks/rules/scope-recovery.ts](../../../logic/tasks/rules/scope-recovery.ts)、[../../../logic/tasks/rules/scope-goal.ts](../../../logic/tasks/rules/scope-goal.ts)、[../../../logic/tasks/rules/fresh-context.ts](../../../logic/tasks/rules/fresh-context.ts)、[../evidence/execution-report-service.ts](../evidence/execution-report-service.ts)、[scope-goal-service.ts](scope-goal-service.ts)、[../../../logic/tasks/rules/scope-run-tracking.ts](../../../logic/tasks/rules/scope-run-tracking.ts)、[../evidence/effect-observation-service.ts](../evidence/effect-observation-service.ts)、[../evidence/effect-source.ts](../evidence/effect-source.ts)、[../../../logic/tasks/rules/effect-observation.ts](../../../logic/tasks/rules/effect-observation.ts)、[../budget/scope-budget-service.ts](../budget/scope-budget-service.ts)。

### scope-replan-service.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_replan_service_ts["scope-replan-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_replan_service_ts_Owner["Owner"] {
  <<type>>

}
N_src_backend_scheduler_engine_goals_scope_replan_service_ts ..> N_src_backend_scheduler_engine_goals_scope_replan_service_ts_Owner : 声明
class N_src_backend_scheduler_engine_goals_scope_replan_service_ts_ReplanLaunch["ReplanLaunch"] {
  <<type>>
  +runId
  +nativeSessionId
  +excludedRunIds
  +signal
}
N_src_backend_scheduler_engine_goals_scope_replan_service_ts ..> N_src_backend_scheduler_engine_goals_scope_replan_service_ts_ReplanLaunch : 声明
class N_src_backend_scheduler_engine_goals_scope_replan_service_ts_AcceptedReplan["AcceptedReplan"] {
  <<type>>
  +scope
  +replan
  +fresh
}
N_src_backend_scheduler_engine_goals_scope_replan_service_ts ..> N_src_backend_scheduler_engine_goals_scope_replan_service_ts_AcceptedReplan : 声明
class N_src_backend_scheduler_engine_goals_scope_replan_service_ts_ScopeReplanService["ScopeReplanService"] {
  +inspect()
  +preview()
  +preflight()
  +accept()
  -owner
  -store
  -goals
  -logs
  -budgets
  -effects
  -parse()
  -identity()
  -found()
  -receipt()
  -sameRequest()
  -proof()
}
N_src_backend_scheduler_engine_goals_scope_replan_service_ts ..> N_src_backend_scheduler_engine_goals_scope_replan_service_ts_ScopeReplanService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../../logic/knowledge/rules/ports.ts](../../../logic/knowledge/rules/ports.ts)、[../../../logic/dispatch/rules/dispatch-storage.ts](../../../logic/dispatch/rules/dispatch-storage.ts)、[../../../logic/tasks/rules/dispatch-scope.ts](../../../logic/tasks/rules/dispatch-scope.ts)、[../../../logic/tasks/rules/fresh-context.ts](../../../logic/tasks/rules/fresh-context.ts)、[../../../logic/tasks/rules/scope-replan.ts](../../../logic/tasks/rules/scope-replan.ts)、[../../../logic/tasks/rules/scope-goal.ts](../../../logic/tasks/rules/scope-goal.ts)、[scope-goal-service.ts](scope-goal-service.ts)、[../../../logic/tasks/rules/scope-run-tracking.ts](../../../logic/tasks/rules/scope-run-tracking.ts)、[../evidence/execution-report-service.ts](../evidence/execution-report-service.ts)、[../context/dispatch-context.ts](../context/dispatch-context.ts)、[../evidence/effect-observation-service.ts](../evidence/effect-observation-service.ts)、[../evidence/effect-source.ts](../evidence/effect-source.ts)、[../../../logic/tasks/rules/effect-observation.ts](../../../logic/tasks/rules/effect-observation.ts)、[../budget/scope-budget-service.ts](../budget/scope-budget-service.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_queued_dependency_addition_service_ts["queued-dependency-addition-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_main_command_request_ts["main-command-request.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts["scope-goal-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_queued_dependency_replacement_service_ts["queued-dependency-replacement-service.ts"] {
  <<module>>
}
N_src_backend_scheduler_engine_goals_queued_dependency_addition_service_ts ..> N_src_backend_scheduler_engine_goals_main_command_request_ts : 导入依赖
N_src_backend_scheduler_engine_goals_queued_dependency_addition_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts : 导入依赖
N_src_backend_scheduler_engine_goals_queued_dependency_replacement_service_ts ..> N_src_backend_scheduler_engine_goals_main_command_request_ts : 导入依赖
N_src_backend_scheduler_engine_goals_queued_dependency_replacement_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_queued_dependency_revision_service_ts["queued-dependency-revision-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_main_command_request_ts["main-command-request.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts["scope-goal-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_queued_task_cancel_service_ts["queued-task-cancel-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_active_input_evidence_ts["scope-active-input-evidence.ts"] {
  <<module>>
}
N_src_backend_scheduler_engine_goals_queued_dependency_revision_service_ts ..> N_src_backend_scheduler_engine_goals_main_command_request_ts : 导入依赖
N_src_backend_scheduler_engine_goals_queued_dependency_revision_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts : 导入依赖
N_src_backend_scheduler_engine_goals_queued_task_cancel_service_ts ..> N_src_backend_scheduler_engine_goals_main_command_request_ts : 导入依赖
N_src_backend_scheduler_engine_goals_scope_goal_service_ts ..> N_src_backend_scheduler_engine_goals_scope_active_input_evidence_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts["scope-goal-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_main_command_request_ts["main-command-request.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_human_continuation_service_ts["scope-human-continuation-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts["scope-human-decision-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_recovery_service_ts["scope-recovery-service.ts"] {
  <<module>>
}
N_src_backend_scheduler_engine_goals_scope_goal_service_ts ..> N_src_backend_scheduler_engine_goals_main_command_request_ts : 导入依赖
N_src_backend_scheduler_engine_goals_scope_human_continuation_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts : 导入依赖
N_src_backend_scheduler_engine_goals_scope_human_decision_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts : 导入依赖
N_src_backend_scheduler_engine_goals_scope_recovery_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_backend_scheduler_engine_goals_scope_replan_service_ts["scope-replan-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_goals_scope_goal_service_ts["scope-goal-service.ts"] {
  <<module>>
}
N_src_backend_scheduler_engine_goals_scope_replan_service_ts ..> N_src_backend_scheduler_engine_goals_scope_goal_service_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

## 候选批准与最终目标审阅

ScopeGoalService.reviewCandidate 由当前主运行调用，要求活动且已规划目标、无未核实插入、精确任务版本及未审阅候选。复用原运行、工具证据、岗位、知识与产物核实，在同一 DispatchStore 事务内追加 candidateReview；相同命令返回原回执，不重新审阅，不允许改判。磁盘 RunSummary 对尚未结算日志也标 interrupted，所以活性使用调用闭包与当前主身份，可靠事件用于排除已有终态，不能以磁盘 status=running 判断。

accept 仅允许后继使用此结果；reject 的候选不能作为最终目标证据。最终 cbim_goal_review 及 human 决定仍独立。拒绝后应撤销相关未启动后继并新建返工链；不把 rejected/result_ready 当作已有 replace_dependency 所允许的失败来源。追加、替换和修订依赖的新边统一启用 reviewRequired。
