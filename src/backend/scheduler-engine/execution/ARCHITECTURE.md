# src/backend/scheduler-engine/execution 架构

## 目录定位

主实例与图根共享身份，沿计划派工并核验目标；安全等待和显式补充保留周期。执行核实读取指定运行日志、回执与派发事实，报告变动或未知；不启动模型、不确认信封、不自动重放。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [agent-manager.ts](agent-manager.ts) | 根据已核实角色配置注册持久化成员，按主会话分配独立逻辑 Session。 |
| [auto-collaboration.ts](auto-collaboration.ts) | 管理一次用户任务的调度周期，串接主 Agent 调度、执行成员和结果回传，周期结束后释放执行实例。 |
| [dispatch-service.ts](dispatch-service.ts) | 工作区的成员注册、主对话实例绑定、主会话派发及任务图增量查询服务。 |
| [execution-manager.ts](execution-manager.ts) | 调度引擎：工作区执行管理，负责主 Agent 普通对话、团队任务执行与多轮历史读取，拒绝旧轮次分叉，挂起并处理逐次工具审批与结构化用户问题，持久化消息队列并在成功结束后串行续接；本次全部通过仅在当前执行期间有效。 |
| [execution-report-facts.ts](execution-report-facts.ts) | 从已核对身份的成员运行日志提取工具授权与回执事实。 |
| [execution-report-service.ts](execution-report-service.ts) | 以持久派发状态和指定成员运行日志生成异常核实报告。 |
| [loop-engine.ts](loop-engine.ts) | 调度引擎：将工作区内部知识服务、内核锁与前置策略注入独立 LoopRuntime。 |
| [member-events.ts](member-events.ts) | 将成员运行日志投影为可公开的连续事件流，并按 run 缓存首次恢复及后续已落盘增量。 |
| [member-execution.ts](member-execution.ts) | 让已派发任务在独立成员会话中执行，提交领取、启动、结果及中断事实。 |
| [member-state.ts](member-state.ts) | 成员执行事务的图增量、占用和交付候选投影辅助函数。 |
| [public-run-events.ts](public-run-events.ts) | 把主会话和成员运行事件转换为可展示的公开消息、工具状态、计划与证据摘要。 |
| [scope-continuation-service.ts](scope-continuation-service.ts) | 在既有派发日志中可靠消费安全等待，并保存用户显式补充与一次性主运行启动意图。 |
| [scope-goal-service.ts](scope-goal-service.ts) | 在派发事务中保存本轮目标计划与结构化审阅，并核验真实日志、角色和模块基线。 |
| [workspace-lease.ts](workspace-lease.ts) | 同一已打开工作区内，主会话与独立成员共享的执行占用协调器。 |

## 架构类图

### agent-manager.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_agent_manager_ts["agent-manager.ts"] {
  <<module>>
  +prepareMember()
}
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/team/agent-types.ts](../../core/team/agent-types.ts)、[../../core/tasks/dispatch-storage.ts](../../core/tasks/dispatch-storage.ts)、[../../core/tasks/graph-types.ts](../../core/tasks/graph-types.ts)。

### auto-collaboration.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_auto_collaboration_ts["auto-collaboration.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_auto_collaboration_ts_Options["Options"] {
  <<type>>
  +provider
  +model
  +profileId
  +permission
  +allowNativeExecution
  +turnTimeoutMs
}
N_src_backend_scheduler_engine_execution_auto_collaboration_ts ..> N_src_backend_scheduler_engine_execution_auto_collaboration_ts_Options : 声明
class N_src_backend_scheduler_engine_execution_auto_collaboration_ts_Cycle["Cycle"] {
  <<type>>
  +task
  +scopeId
  +tasks
  +operations
  +mainRuns
  +workRequested
  +stopped
  +cancelRequested
  +ending
  +closing
  +completionSummary
}
N_src_backend_scheduler_engine_execution_auto_collaboration_ts ..> N_src_backend_scheduler_engine_execution_auto_collaboration_ts_Cycle : 声明
class N_src_backend_scheduler_engine_execution_auto_collaboration_ts_Batch["Batch"] {
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
}
N_src_backend_scheduler_engine_execution_auto_collaboration_ts ..> N_src_backend_scheduler_engine_execution_auto_collaboration_ts_Batch : 声明
class N_src_backend_scheduler_engine_execution_auto_collaboration_ts_AutoCollaboration["AutoCollaboration"] {
  +initialize()
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
  -cycles
  -waitingSlots
  -resuming
  -closed
  -pending
}
N_src_backend_scheduler_engine_execution_auto_collaboration_ts ..> N_src_backend_scheduler_engine_execution_auto_collaboration_ts_AutoCollaboration : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_auto_collaboration_ts["auto-collaboration.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_auto_collaboration_ts_AutoCollaboration["AutoCollaboration"] {
  -scheduled
  -releaseListener
  -continuationCheckpoint()
  -acceptContinuation()
  -starting()
  -startFailed()
  -track()
  -identity()
  -assertLive()
  -assign()
  -settled()
  -schedule()
  -ready()
  -advance()
  -finishCycle()
}
N_src_backend_scheduler_engine_execution_auto_collaboration_ts ..> N_src_backend_scheduler_engine_execution_auto_collaboration_ts_AutoCollaboration : 声明
```

直接依赖：[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/brain/types.ts](../../core/brain/types.ts)、[../../core/tasks/dispatch-scope.ts](../../core/tasks/dispatch-scope.ts)、[../../core/tasks/scope-continuation.ts](../../core/tasks/scope-continuation.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../../core/tasks/dispatch-commands.ts](../../core/tasks/dispatch-commands.ts)、[../../core/tasks/graph-types.ts](../../core/tasks/graph-types.ts)、[../tools/dispatch-tools.ts](../tools/dispatch-tools.ts)、[../tools/goal-tools.ts](../tools/goal-tools.ts)、[dispatch-service.ts](dispatch-service.ts)、[member-execution.ts](member-execution.ts)、[execution-manager.ts](execution-manager.ts)、[loop-engine.ts](loop-engine.ts)、[workspace-lease.ts](workspace-lease.ts)。

### dispatch-service.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_dispatch_service_ts["dispatch-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_dispatch_service_ts_DispatchWorkspace["DispatchWorkspace"] {
  <<type>>

}
N_src_backend_scheduler_engine_execution_dispatch_service_ts ..> N_src_backend_scheduler_engine_execution_dispatch_service_ts_DispatchWorkspace : 声明
class N_src_backend_scheduler_engine_execution_dispatch_service_ts_WorkspaceDispatchService["WorkspaceDispatchService"] {
  +goals
  +continuations
  +initialize()
  +openScope()
  +closeScope()
  +parkScope()
  +waitingScopes()
  +recoverScopes()
  +openGraph()
  +conversationBinding()
  +createMember()
  +dispatchTask()
  +snapshot()
  +delta()
  +sessionRead()
  +close()
}
N_src_backend_scheduler_engine_execution_dispatch_service_ts ..> N_src_backend_scheduler_engine_execution_dispatch_service_ts_WorkspaceDispatchService : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_dispatch_service_ts["dispatch-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_dispatch_service_ts_WorkspaceDispatchService["WorkspaceDispatchService"] {
  -owner
  -store
  -closed
  -check()
  -parse()
  -graph()
  -command()
  -batch()
  -cursor()
  -recheck()
}
N_src_backend_scheduler_engine_execution_dispatch_service_ts ..> N_src_backend_scheduler_engine_execution_dispatch_service_ts_WorkspaceDispatchService : 声明
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../../core/knowledge/types.ts](../../core/knowledge/types.ts)、[../../core/brain/conversation-binding.ts](../../core/brain/conversation-binding.ts)、[../../core/tasks/dispatch-storage.ts](../../core/tasks/dispatch-storage.ts)、[../../core/tasks/dispatch-scope.ts](../../core/tasks/dispatch-scope.ts)、[../../core/team/agent-types.ts](../../core/team/agent-types.ts)、[../../core/tasks/types.ts](../../core/tasks/types.ts)、[../../core/brain/types.ts](../../core/brain/types.ts)、[scope-goal-service.ts](scope-goal-service.ts)、[scope-continuation-service.ts](scope-continuation-service.ts)、[../../core/tasks/dispatch-commands.ts](../../core/tasks/dispatch-commands.ts)、[../../core/tasks/graph-types.ts](../../core/tasks/graph-types.ts)、[../context/dispatch-context.ts](../context/dispatch-context.ts)、[agent-manager.ts](agent-manager.ts)、[../../core/tasks/scope-view.ts](../../core/tasks/scope-view.ts)。

### execution-manager.ts

成员 1/4（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_execution_manager_ts["execution-manager.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_execution_manager_ts_Options["Options"] {
  <<type>>

}
N_src_backend_scheduler_engine_execution_execution_manager_ts ..> N_src_backend_scheduler_engine_execution_execution_manager_ts_Options : 声明
class N_src_backend_scheduler_engine_execution_execution_manager_ts_ExecutionCollaboration["ExecutionCollaboration"] {
  <<interface>>
  +continuationReceipt()
  +continuationCheckpoint()
  +acceptContinuation()
  +starting()
  +startFailed()
  +busy()
  +waiting()
  +settled()
  +stop()
}
N_src_backend_scheduler_engine_execution_execution_manager_ts ..> N_src_backend_scheduler_engine_execution_execution_manager_ts_ExecutionCollaboration : 声明
class N_src_backend_scheduler_engine_execution_execution_manager_ts_WorkspaceExecutionManager["WorkspaceExecutionManager"] {
  +workspace
  +cancelPendingLaunches()
  +attachCollaboration()
  +observeQueue()
  +initializeQueueMonitoring()
  +queued()
  +queueDelta()
  +enqueue()
  +changeQueued()
  +editQueued()
  +moveQueued()
  +insertQueued()
  +continueQueue()
  +pendingQuestions()
  +answerQuestion()
  +pendingApprovals()
}
N_src_backend_scheduler_engine_execution_execution_manager_ts ..> N_src_backend_scheduler_engine_execution_execution_manager_ts_WorkspaceExecutionManager : 声明
```

成员 2/4（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_execution_manager_ts["execution-manager.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_execution_manager_ts_WorkspaceExecutionManager["WorkspaceExecutionManager"] {
  +answerApproval()
  +subscribe()
  +prepare()
  +choices()
  +thread()
  +start()
  +chat()
  +continueGoal()
  +resume()
  +continueFromResults()
  +collaborationReady()
  +pauseCollaboration()
  +stop()
  +inspect()
  +list()
  +close()
}
N_src_backend_scheduler_engine_execution_execution_manager_ts ..> N_src_backend_scheduler_engine_execution_execution_manager_ts_WorkspaceExecutionManager : 声明
```

成员 3/4（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_execution_manager_ts["execution-manager.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_execution_manager_ts_WorkspaceExecutionManager["WorkspaceExecutionManager"] {
  -storage
  -factory
  -inputImages
  -collaboration
  -resultContinuationStopped
  -stopVersions
  -pendingLaunches
  -messageQueue
  -queueSubscriptions
  -queueSource()
  -queue()
  -pump()
  -active
  -pending
  -closing
  -listeners
}
N_src_backend_scheduler_engine_execution_execution_manager_ts ..> N_src_backend_scheduler_engine_execution_execution_manager_ts_WorkspaceExecutionManager : 声明
```

成员 4/4（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_execution_manager_ts["execution-manager.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_execution_manager_ts_WorkspaceExecutionManager["WorkspaceExecutionManager"] {
  -questions
  -approvalQueue
  -cancelApprovals()
  -serial()
  -launch()
  -directory()
}
N_src_backend_scheduler_engine_execution_execution_manager_ts ..> N_src_backend_scheduler_engine_execution_execution_manager_ts_WorkspaceExecutionManager : 声明
```

直接依赖：[../conversation/message-queue.ts](../conversation/message-queue.ts)、[../conversation/approvals.ts](../conversation/approvals.ts)、[../conversation/questions.ts](../conversation/questions.ts)、[../conversation/main-agent.ts](../conversation/main-agent.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/foundation/identity.ts](../../core/foundation/identity.ts)、[../../core/brain/storage.ts](../../core/brain/storage.ts)、[../../core/brain/index.ts](../../core/brain/index.ts)、[../../core/brain/types.ts](../../core/brain/types.ts)、[../../core/brain/input-source.ts](../../core/brain/input-source.ts)、[loop-engine.ts](loop-engine.ts)、[../context/team-workflow.ts](../context/team-workflow.ts)、[../../core/team/model.ts](../../core/team/model.ts)、[../../core/workspace/model.ts](../../core/workspace/model.ts)、[../../core/tasks/scope-continuation.ts](../../core/tasks/scope-continuation.ts)、[../../core/tasks/dispatch-scope.ts](../../core/tasks/dispatch-scope.ts)、[../../core/tasks/scope-goal.ts](../../core/tasks/scope-goal.ts)。

### execution-report-facts.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_execution_report_facts_ts["execution-report-facts.ts"] {
  <<module>>
  +executionToolFacts()
}
```

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_execution_report_facts_ts["execution-report-facts.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_execution_report_facts_ts_Item["Item"] {
  <<type>>

}
N_src_backend_scheduler_engine_execution_execution_report_facts_ts ..> N_src_backend_scheduler_engine_execution_execution_report_facts_ts_Item : 声明
```

直接依赖：[../../core/tasks/execution-report.ts](../../core/tasks/execution-report.ts)、[../../core/brain/types.ts](../../core/brain/types.ts)、[../../core/tasks/dispatch-execution.ts](../../core/tasks/dispatch-execution.ts)、[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)。

### execution-report-service.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_execution_report_service_ts["execution-report-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_execution_report_service_ts_ExecutionReportService["ExecutionReportService"] {
  +read()
  -owner
  -store
  -inspect
  -facts()
  -stamp()
  -bound()
  -matches()
}
N_src_backend_scheduler_engine_execution_execution_report_service_ts ..> N_src_backend_scheduler_engine_execution_execution_report_service_ts_ExecutionReportService : 声明
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../core/tasks/execution-report.ts](../../core/tasks/execution-report.ts)、[../../core/tasks/dispatch-storage.ts](../../core/tasks/dispatch-storage.ts)、[../../core/tasks/dispatch-execution.ts](../../core/tasks/dispatch-execution.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../../core/brain/types.ts](../../core/brain/types.ts)、[execution-report-facts.ts](execution-report-facts.ts)。

### loop-engine.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_loop_engine_ts["loop-engine.ts"] {
  <<module>>
  +createWorkspaceLoop()
}
```

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_loop_engine_ts["loop-engine.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_loop_engine_ts_WorkspaceLoopOptions["WorkspaceLoopOptions"] {
  <<interface>>
  +mode
  +attachmentIds
  +images
  +provider
  +model
  +profileId
  +allowNativeExecution
  +permission
  +requestQuestion()
  +requestApproval()
  +process
  +turnTimeoutMs
  +onEvent()
  +llm
}
N_src_backend_scheduler_engine_execution_loop_engine_ts ..> N_src_backend_scheduler_engine_execution_loop_engine_ts_WorkspaceLoopOptions : 声明
class N_src_backend_scheduler_engine_execution_loop_engine_ts_ExecutionServices["ExecutionServices"] {
  <<interface>>
  +conversationBinding
  +dispatchTools()
  +member
  +onEngineReady()
  +storage
  +acquireLease()
  +authorizeNative()
}
N_src_backend_scheduler_engine_execution_loop_engine_ts ..> N_src_backend_scheduler_engine_execution_loop_engine_ts_ExecutionServices : 声明
```

直接依赖：[../conversation/questions.ts](../conversation/questions.ts)、[../../core/foundation/paths.ts](../../core/foundation/paths.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../tools/knowledge-tools.ts](../tools/knowledge-tools.ts)、[../context/team-workflow.ts](../context/team-workflow.ts)、[../conversation/main-agent.ts](../conversation/main-agent.ts)、[../../core/brain/types.ts](../../core/brain/types.ts)、[../../core/brain/index.ts](../../core/brain/index.ts)、[../../core/brain/pi/rpc.ts](../../core/brain/pi/rpc.ts)、[../../core/brain/llm/ports.ts](../../core/brain/llm/ports.ts)、[../../core/policy/tool-policy.ts](../../core/policy/tool-policy.ts)、[../../core/tools/questions.ts](../../core/tools/questions.ts)、[../../core/tasks/progress-tools.ts](../../core/tasks/progress-tools.ts)、[../tools/dispatch-tools.ts](../tools/dispatch-tools.ts)、[../../core/brain/storage.ts](../../core/brain/storage.ts)。

### member-events.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_member_events_ts["member-events.ts"] {
  <<module>>
  +memberPublicTask()
}
```

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_member_events_ts["member-events.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_member_events_ts_Stream["Stream"] {
  <<interface>>
  +run
  +task
  +live
  +load
  +failure
  +ordered
  +pending
  +unresolved
  +progress
}
N_src_backend_scheduler_engine_execution_member_events_ts ..> N_src_backend_scheduler_engine_execution_member_events_ts_Stream : 声明
class N_src_backend_scheduler_engine_execution_member_events_ts_MemberEventStreams["MemberEventStreams"] {
  +begin()
  +append()
  +read()
  +clear()
  -inspect
  -streams
  -stream()
  -accept()
  -restore()
}
N_src_backend_scheduler_engine_execution_member_events_ts ..> N_src_backend_scheduler_engine_execution_member_events_ts_MemberEventStreams : 声明
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/brain/types.ts](../../core/brain/types.ts)、[../../core/tasks/dispatch-execution.ts](../../core/tasks/dispatch-execution.ts)、[../../core/tasks/graph-types.ts](../../core/tasks/graph-types.ts)、[../../core/tasks/progress.ts](../../core/tasks/progress.ts)、[../../core/tasks/member-events.ts](../../core/tasks/member-events.ts)、[public-run-events.ts](public-run-events.ts)。

### member-execution.ts

成员 1/3（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_member_execution_ts["member-execution.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_member_execution_ts_MemberExecutionPorts["MemberExecutionPorts"] {
  <<interface>>
  +acquire()
  +prepare()
  +inspect()
}
N_src_backend_scheduler_engine_execution_member_execution_ts ..> N_src_backend_scheduler_engine_execution_member_execution_ts_MemberExecutionPorts : 声明
class N_src_backend_scheduler_engine_execution_member_execution_ts_PreparedEngine["PreparedEngine"] {
  <<type>>

}
N_src_backend_scheduler_engine_execution_member_execution_ts ..> N_src_backend_scheduler_engine_execution_member_execution_ts_PreparedEngine : 声明
class N_src_backend_scheduler_engine_execution_member_execution_ts_Handle["Handle"] {
  <<type>>
  +runtime
  +stopping
  +done
}
N_src_backend_scheduler_engine_execution_member_execution_ts ..> N_src_backend_scheduler_engine_execution_member_execution_ts_Handle : 声明
class N_src_backend_scheduler_engine_execution_member_execution_ts_MemberExecutionManager["MemberExecutionManager"] {
  +report()
  +subscribe()
  +initialize()
  +start()
  +stop()
  +waitForSettlement()
  +inspect()
  +events()
  +messages()
  +acknowledge()
  +pendingApprovals()
  +answerApproval()
  +pendingQuestions()
  +answerQuestion()
  +close()
  -owner
}
N_src_backend_scheduler_engine_execution_member_execution_ts ..> N_src_backend_scheduler_engine_execution_member_execution_ts_MemberExecutionManager : 声明
```

成员 2/3（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_member_execution_ts["member-execution.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_member_execution_ts_MemberExecutionManager["MemberExecutionManager"] {
  -store
  -ports
  -closing
  -initialized
  -handles
  -launches
  -listeners
  -approvals
  -questions
  -eventStreams
  -check()
  -parse()
  -command()
  -emit()
  -startInternal()
  -execute()
}
N_src_backend_scheduler_engine_execution_member_execution_ts ..> N_src_backend_scheduler_engine_execution_member_execution_ts_MemberExecutionManager : 声明
```

成员 3/3（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_member_execution_ts["member-execution.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_member_execution_ts_MemberExecutionManager["MemberExecutionManager"] {
  -ready()
  -currentRun()
  -settle()
  -assertRecipient()
  -interaction()
}
N_src_backend_scheduler_engine_execution_member_execution_ts ..> N_src_backend_scheduler_engine_execution_member_execution_ts_MemberExecutionManager : 声明
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../../core/brain/runtime.ts](../../core/brain/runtime.ts)、[../../core/brain/llm/ports.ts](../../core/brain/llm/ports.ts)、[../../core/brain/types.ts](../../core/brain/types.ts)、[../../core/tasks/dispatch-execution.ts](../../core/tasks/dispatch-execution.ts)、[../../core/tasks/dispatch-storage.ts](../../core/tasks/dispatch-storage.ts)、[../../core/tasks/graph-types.ts](../../core/tasks/graph-types.ts)、[../../core/tasks/member-commands.ts](../../core/tasks/member-commands.ts)、[../context/execution-context.ts](../context/execution-context.ts)、[../conversation/approvals.ts](../conversation/approvals.ts)、[../conversation/questions.ts](../conversation/questions.ts)、[member-state.ts](member-state.ts)、[../../core/tasks/member-events.ts](../../core/tasks/member-events.ts)、[member-events.ts](member-events.ts)、[execution-report-service.ts](execution-report-service.ts)、[../../core/tasks/execution-report.ts](../../core/tasks/execution-report.ts)。

### member-state.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_member_state_ts["member-state.ts"] {
  <<module>>
  +memberTask()
  +memberBatch()
  +memberView()
  +dependenciesReady()
  +memberCandidate()
}
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/brain/types.ts](../../core/brain/types.ts)、[../../core/tasks/dispatch-storage.ts](../../core/tasks/dispatch-storage.ts)、[../../core/tasks/graph-types.ts](../../core/tasks/graph-types.ts)、[../../core/team/agent-types.ts](../../core/team/agent-types.ts)。

### public-run-events.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_public_run_events_ts["public-run-events.ts"] {
  <<module>>
  +projectRunEvent()
}
```

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_public_run_events_ts["public-run-events.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_public_run_events_ts_PublicRunIdentity["PublicRunIdentity"] {
  <<interface>>
  +workspaceId
  +taskId
  +runId
}
N_src_backend_scheduler_engine_execution_public_run_events_ts ..> N_src_backend_scheduler_engine_execution_public_run_events_ts_PublicRunIdentity : 声明
```

直接依赖：[../../core/brain/types.ts](../../core/brain/types.ts)、[../../core/tasks/progress.ts](../../core/tasks/progress.ts)、[../../core/tools/types.ts](../../core/tools/types.ts)。

### scope-continuation-service.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_scope_continuation_service_ts["scope-continuation-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_scope_continuation_service_ts_Owner["Owner"] {
  <<type>>

}
N_src_backend_scheduler_engine_execution_scope_continuation_service_ts ..> N_src_backend_scheduler_engine_execution_scope_continuation_service_ts_Owner : 声明
class N_src_backend_scheduler_engine_execution_scope_continuation_service_ts_AcceptedScopeContinuation["AcceptedScopeContinuation"] {
  <<interface>>
  +scope
  +continuation
  +fresh
}
N_src_backend_scheduler_engine_execution_scope_continuation_service_ts ..> N_src_backend_scheduler_engine_execution_scope_continuation_service_ts_AcceptedScopeContinuation : 声明
class N_src_backend_scheduler_engine_execution_scope_continuation_service_ts_ScopeContinuationService["ScopeContinuationService"] {
  +inspect()
  +accept()
  -owner
  -store
  -parse()
  -scope()
}
N_src_backend_scheduler_engine_execution_scope_continuation_service_ts ..> N_src_backend_scheduler_engine_execution_scope_continuation_service_ts_ScopeContinuationService : 声明
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/foundation/identity.ts](../../core/foundation/identity.ts)、[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../../core/tasks/dispatch-storage.ts](../../core/tasks/dispatch-storage.ts)、[../../core/tasks/dispatch-scope.ts](../../core/tasks/dispatch-scope.ts)、[../../core/tasks/scope-goal.ts](../../core/tasks/scope-goal.ts)、[../../core/tasks/scope-continuation.ts](../../core/tasks/scope-continuation.ts)。

### scope-goal-service.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_scope_goal_service_ts["scope-goal-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_scope_goal_service_ts_ScopeGoalPorts["ScopeGoalPorts"] {
  <<interface>>
  +inspectMember()
  +inspectMain()
}
N_src_backend_scheduler_engine_execution_scope_goal_service_ts ..> N_src_backend_scheduler_engine_execution_scope_goal_service_ts_ScopeGoalPorts : 声明
class N_src_backend_scheduler_engine_execution_scope_goal_service_ts_Owner["Owner"] {
  <<type>>

}
N_src_backend_scheduler_engine_execution_scope_goal_service_ts ..> N_src_backend_scheduler_engine_execution_scope_goal_service_ts_Owner : 声明
class N_src_backend_scheduler_engine_execution_scope_goal_service_ts_ScopeGoalService["ScopeGoalService"] {
  +inspect()
  +plan()
  +validateDispatch()
  +review()
  +validateCompletion()
  +validateWaiting()
  +block()
  -owner
  -store
  -ports
  -parse()
  -scope()
  -graph()
  -editable()
  -command()
  -logs()
}
N_src_backend_scheduler_engine_execution_scope_goal_service_ts ..> N_src_backend_scheduler_engine_execution_scope_goal_service_ts_ScopeGoalService : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_scope_goal_service_ts["scope-goal-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_scope_goal_service_ts_ScopeGoalService["ScopeGoalService"] {
  -main()
  -receipt()
  -member()
  -evidence()
  -supersessions()
}
N_src_backend_scheduler_engine_execution_scope_goal_service_ts ..> N_src_backend_scheduler_engine_execution_scope_goal_service_ts_ScopeGoalService : 声明
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../../core/brain/types.ts](../../core/brain/types.ts)、[../../core/tools/types.ts](../../core/tools/types.ts)、[../../core/tasks/dispatch-storage.ts](../../core/tasks/dispatch-storage.ts)、[../../core/tasks/dispatch-execution.ts](../../core/tasks/dispatch-execution.ts)、[../../core/tasks/dispatch-commands.ts](../../core/tasks/dispatch-commands.ts)、[../../core/tasks/dispatch-scope.ts](../../core/tasks/dispatch-scope.ts)、[../../core/tasks/graph-types.ts](../../core/tasks/graph-types.ts)、[../../core/tasks/scope-goal.ts](../../core/tasks/scope-goal.ts)、[../context/dispatch-context.ts](../context/dispatch-context.ts)。

### workspace-lease.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_workspace_lease_ts["workspace-lease.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_workspace_lease_ts_WorkspaceExecutionLease["WorkspaceExecutionLease"] {
  +observeRelease()
  +acquire()
  -listeners
  -leases
}
N_src_backend_scheduler_engine_execution_workspace_lease_ts ..> N_src_backend_scheduler_engine_execution_workspace_lease_ts_WorkspaceExecutionLease : 声明
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/policy/types.ts](../../core/policy/types.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_auto_collaboration_ts["auto-collaboration.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_dispatch_service_ts["dispatch-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_member_execution_ts["member-execution.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_execution_manager_ts["execution-manager.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_loop_engine_ts["loop-engine.ts"] {
  <<module>>
}
N_src_backend_scheduler_engine_execution_auto_collaboration_ts ..> N_src_backend_scheduler_engine_execution_dispatch_service_ts : 导入依赖
N_src_backend_scheduler_engine_execution_auto_collaboration_ts ..> N_src_backend_scheduler_engine_execution_member_execution_ts : 导入依赖
N_src_backend_scheduler_engine_execution_auto_collaboration_ts ..> N_src_backend_scheduler_engine_execution_execution_manager_ts : 导入依赖
N_src_backend_scheduler_engine_execution_auto_collaboration_ts ..> N_src_backend_scheduler_engine_execution_loop_engine_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_auto_collaboration_ts["auto-collaboration.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_workspace_lease_ts["workspace-lease.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_dispatch_service_ts["dispatch-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_scope_goal_service_ts["scope-goal-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_scope_continuation_service_ts["scope-continuation-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_agent_manager_ts["agent-manager.ts"] {
  <<module>>
}
N_src_backend_scheduler_engine_execution_auto_collaboration_ts ..> N_src_backend_scheduler_engine_execution_workspace_lease_ts : 导入依赖
N_src_backend_scheduler_engine_execution_dispatch_service_ts ..> N_src_backend_scheduler_engine_execution_scope_goal_service_ts : 导入依赖
N_src_backend_scheduler_engine_execution_dispatch_service_ts ..> N_src_backend_scheduler_engine_execution_scope_continuation_service_ts : 导入依赖
N_src_backend_scheduler_engine_execution_dispatch_service_ts ..> N_src_backend_scheduler_engine_execution_agent_manager_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_execution_manager_ts["execution-manager.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_loop_engine_ts["loop-engine.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_execution_report_service_ts["execution-report-service.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_execution_report_facts_ts["execution-report-facts.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_member_events_ts["member-events.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_public_run_events_ts["public-run-events.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_member_execution_ts["member-execution.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_member_state_ts["member-state.ts"] {
  <<module>>
}
N_src_backend_scheduler_engine_execution_execution_manager_ts ..> N_src_backend_scheduler_engine_execution_loop_engine_ts : 导入依赖
N_src_backend_scheduler_engine_execution_execution_report_service_ts ..> N_src_backend_scheduler_engine_execution_execution_report_facts_ts : 导入依赖
N_src_backend_scheduler_engine_execution_member_events_ts ..> N_src_backend_scheduler_engine_execution_public_run_events_ts : 导入依赖
N_src_backend_scheduler_engine_execution_member_execution_ts ..> N_src_backend_scheduler_engine_execution_member_state_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_backend_scheduler_engine_execution_member_execution_ts["member-execution.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_member_events_ts["member-events.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_execution_execution_report_service_ts["execution-report-service.ts"] {
  <<module>>
}
N_src_backend_scheduler_engine_execution_member_execution_ts ..> N_src_backend_scheduler_engine_execution_member_events_ts : 导入依赖
N_src_backend_scheduler_engine_execution_member_execution_ts ..> N_src_backend_scheduler_engine_execution_execution_report_service_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

### 成员派发与执行调度契约

已实现可信桌面入口和主会话模型工具的成员执行闭环：`prepareMember` 注册稳定成员/独立逻辑通道，`WorkspaceDispatchService` 核实成员、多模块关系并原子派发，`MemberExecutionManager` 领取信封后使用同一 `LoopRuntime + PiEngine` 执行、提交候选和返回结果信封。`AutoCollaboration` 在主轮结束并释放占用后推进本轮派发，再把可靠结果回注原主会话。支持 Snapshot/Delta、命令幂等与持久化记录恢复；执行者可恢复求助/等待和重启自动续跑仍未开放。节点规则见 [core/tasks](../../core/tasks/CONTRACT.md)，成员身份见 [core/team](../../core/team/CONTRACT.md)。

### 当前成员执行边界

主 session 默认通过 `conversationBinding(task)` 可靠登记图根和主实例，`mainRootSessionId` 将新主实例固定到所属根；主实例负责调度与团队/业务知识管理，不执行业务任务。`conversation` 承载普通聊天，图根原通道承载结果邮箱；正式业务任务使用独立执行实例。没有自定义执行角色时使用内置静态 `cbim:executor`，禁止把 `cbim:main` 派为执行者。旧共享根保留历史引用，新根不复用遗留共享实例。知识结构错误不阻断内置主对话身份登记，但不放宽正式任务的配置/模块/维护关系校验。

`createWorkspaceLoop` 为主 Agent 保留内部知识查询、预览、对象 CRUD 与知识提交工具，以及派发工具。知识写入走同一日志门禁和用户 `read / ask / execute` 权限：read 拒绝；ask 等待本轮批准；execute 允许进入知识服务的实例、版本和事务校验。`knowledge-write` 不等于业务执行权，主 Agent 的任何 `business-write / command` 描述在审批前独立拒绝，包括未来内部工具；原生 `write / edit / bash` 不注册，即使收到幻觉调用或用户选择完全访问也不放行。知识服务只在 gate 通过后接收运行装配提供的写入能力，不接受模型自行授予权限；`.cbim` 内容仍禁止经原生文件工具直接修改。

- `start` 接收 `workspaceId/rootSessionId/taskId/commandId/expectedRevision/options`。options 只含公开模型标识、read/ask/execute 权限和毫秒超时，默认 read；不能指定成员身份、会话路径、提示词或状态。返回的是已持久化领取回执，不承诺此时已开始生成；相同命令返回原回执，不重复解析模型或执行。
- 领取前拒绝主 Agent、released 执行实例和已关闭调度周期；同主会话有 waiting 周期时返回 GOAL_WAITING，包括旧无 scope 的任务入口，不能通过历史成员运行绕过等待。然后核实依赖、成员占用及工作区写占用，冻结角色/Skill、模块/Workflow、规范全文、前置候选和公开模型参数。密钥仅在主进程闭包中。领取事务同时写 starting、成员 communicating、task queued+activeRunId、assignment claimed。
- `startMember` 使用预分配 runId、固定执行实例通道，日志位于 `dispatch/runs/tasks/`，不混入聊天列表。当前调度周期内每个 task 创建新执行实例和通道，不复用前一 task 的历史；旧无 scope 的显式接口保留原通道兼容行为。前次非 completed、工具结果未知或日志绑定不符的旧通道拒绝盲目续接；尚无异常通道人工对账/重试入口。
- 模型生成前，onEngineReady 提交 running、原生文件绑定、成员 working；回调失败关闭引擎并中断。任务拥有独立审批/问题队列，不继承其他运行的“本次全部通过”。
- `WorkspaceExecutionLease` 为主会话与成员共享。主会话只持有业务文件读取占用，知识写入由知识服务独立串行事务和版本核对保护，不因管理知识而取得业务写权限。正式执行成员同一实例串行，不同成员只读可并行，ask/execute 保守独占工作区业务执行。没有文件范围写锁；角色知识字段不是可执行权限策略。冲突立即返回 busy，不在事务内等待。
- completed 只结束大脑回合。仅同轮结构化计划保持原目标/验收、全部步骤有有效工具证据且调用 cbim_delivery_prepare，才进入 result_ready 并返回候选信封。普通文本、改写目标或知识基线变化得到 blocked；候选 acceptance 始终为 not_evaluated。
- messages 只读取同图指定收件人的 pending 信封；acknowledge 仅消费 result，不新增运行或图反向边。依赖在实际启动时复核并锁定 resultId。自动协调只推进当前进程主轮工具登记的任务，不能把任意历史 pending 信封解释为自动执行授权。
- stop 请求活动运行停止，等真实收尾后提交终态；取消不代表回滚。inspect 不返回密钥、完整知识或原生路径。审批与问题有独立接口，读取详情不会授予权限。
- `events` 核验工作区、主会话、业务任务和 run 归属后，读取白名单投影事件：排除原生会话与冻结知识字段；工具仅公开身份、状态、工作区内且非 `.cbim` 的业务路径和可信回执，原始参数/输出及内部错误不透传。公开对话、任务目标及计划/交付文本保留，仅按字段限长，不做通用密钥或隐私识别。`MemberEventStreams` 首次成功恢复日志后，与实时持久化观察按序号去重合并；后续仅内存增量/noop，工作区关闭时释放缓存。首次读取失败会释放该加载承诺供重试，并发旧失败不清除新加载；已记录的流损坏仍明确失败。首次查询发生在新执行创建日志之前时可返回空前缀，历史损坏不得伪装为空。
- 初始化将 starting/running 收口为 interrupted，保留领取记录、增加 leaseEpoch，不重放模型或未知副作用。初始化失败在当前实例保持失败，重建工作区后再核实。关闭先等待已接收的启动、停止与结算尝试，再关 DispatchStore；close 不重抛收尾错误，结算失败的持久化活动记录留待重开恢复核实，不能把正常返回视为所有任务均已成功结算。

### 主会话协作接续边界

`openScope(identity, scopeId, input?)` 的可信第三参数保存本轮实际 `{message, attachmentIds?}`，创建前复制为 `goal:{revision:1,input:{message,attachmentIds}}`，缺省附件为 []，正文不 trim。相同 scope 重发必须保持正文和附件；稳定命令键的 fingerprint 包含初始输入，事务内及回执后的当前状态再次核验原始 input，不能通过已保存回执改绑输入。计划/审阅推进 goal.revision 后，同原始输入重发仍幂等。无 goal 的旧调用/记录保持兼容且不补造；关闭保留最后 goal 快照。

### 周期目标规划、审阅与结束门禁

`ScopeGoalService(owner, store, ports?)` 与派发复用串行事务；`ScopeGoalPorts.inspectMember(run)` 和 `inspectMain(rootSessionId, runId)` 仅按可信绑定读取 canonical 日志。`inspect` 不读日志；`plan` 解析真实静态角色、有效维护模块、当前知识基线并保存责任映射；无日志端口时仍可规划，但 review / validateCompletion / validateWaiting 明确拒绝。主角色仅治理且 moduleIds=[] 时不要求业务知识通过结构校验，保留修复损坏知识的入口。

- `plan(identity, scopeId, runId, commandId, draft)` 和 `review(...)` 都接受 expectedRevision，幂等命令包含完整草案指纹。身份由主轮闭包注入，模型不能指定 scope、run 或存储路径。最多 64 次决策；不通过重规划删改既有人工作业验收项。
- `validateDispatch(state, scope, task, knowledgeRevision)` 在派发事务中核实存在当前计划、没有阻塞/未清除的审阅、当前知识版本一致，角色与模块集合匹配责任分配。审阅后再派工必须显式 replan。旧无 goal 记录不补造计划。
- 成员证据必须来自本 scope 真实 result_ready 候选，完整绑定 task/run/实例/通道/planRevision；canonical 日志须 completed、无未决工具、结构化交付与候选一致。引用的成功工具回执须有匹配授权、结果正文哈希和最后副作用之后的有效代次。执行知识基线必须等于审阅基线，不能对旧候选仅重盖当前版本。
- 主治理证据只接受当前审阅 run 中 `cbim_knowledge_commit / cbim_object_commit` 的真实成功知识写回执，且结果正文证明同实例、当前知识版本和非空 `.cbim/` 变更。主对话通道从已登记 conversation Session 验证，与图根必须同实例，但不混用图根的任务/邮箱通道。模型正文、任务记录、派发和目标审阅回执均不能自证成功。
- `review complete` 只保存申请，工具执行期间不要求主运行已经 settled。`validateCompletion` 在父级关闭事务内调用且不重入 store：同一主 run 必须实际 completed、无未决工具，计划/审阅当前，图和知识版本未变，审阅后没有新副作用；全部 scope 工作均已终态。缺证据、未满足项或 human 项阻止完成。
- 失败/阻塞/取消/中断任务必须以显式 superseded 关系被本 scope 后续实际成功任务替代，替代模块并集覆盖原范围；知识基线已过期的旧候选同样必须明确替代。关系用线性有色 DFS 拒绝环，不能由模型构造稠密图阻塞主线程。替代本身不删除历史任务或回滚副作用。
- `block` 仅可信协调器调用，保存失败原因并冻结后续决策，不发布虚假任务图事件，也不直接释放实例。普通无 plan、无派工且无业务治理动作的问答保持轻量；一旦有业务计划/派工/知识写入，不能把缺失审阅当作普通结束。

本步核验的是可追溯执行与审阅事实，不是跨知识/派发存储的原子事务或外部产物指纹证明。人工批准、替换原目标与外部文件变更失效仍是后续能力；安全等待后的纯文本显式补充由下述一次性接收协议提供。

### 安全持久等待检查点

`WorkspaceDispatchService.parkScope(identity, scopeId, summary, mainRunIds)` 仅供可信协调器在主运行实际收尾并释放资源后调用。它在派发串行事务内调用 `ScopeGoalService.validateWaiting`：当前 awaiting_user 审阅属于同一主运行，主运行的传入摘要与 canonical 日志均为 completed 且无未决/未知工具；图游标、知识版本、副作用界限未变；本周期任务与成员均已结算，同主会话不存在 starting/running，包括旧无 scope 的运行。所有本周期成员运行再读 canonical 日志核验身份和工具终态；明确 failed/cancelled 可等待，interrupted 或未知副作用拒绝。已有证据仍按原审阅规则复核，不将等待或用户排队文字当成人工验收。

成功后只在现有事务日志写 status=waiting 与 `DispatchScopeWait`，原目标和审阅不改写、graph cursor 不推进，也不新增存储。可信主轮清单立即复制，1–32 个唯一 runId 且包含当前主运行；用于保留已消耗预算，不自动恢复任何运行。等待幂等键包含周期和真实主 runId，同周期后续再等待创建独立检查点；事务后再次核实当前状态，旧成功回执不能掩盖已取消。waiting 占据该根唯一未关闭槽，拒绝新周期、计划、审阅、派工或成员启动；close(cancelled/failed/interrupted) 保留检查点并释放执行实例，close(completed) 拒绝。`recoverScopes` 只收束遗留 active；`waitingScopes` 内部只读枚举 waiting，无 IPC 自动恢复能力。

`AutoCollaboration.initialize` 只重建 waiting 根占位并暂停相应用户队列，不读取/启动模型、不恢复成员租约。busy 同时覆盖正在调度和已安全等待的周期。停泊后移出活动循环；应用 shutdown 保留 waiting；用户 stop 与停泊提交竞争时，仍会在提交完成后查找并取消等待周期。queue enqueue 和普通 resume 在 waiting 时只保存为 paused；继续队列返回 GOAL_WAITING，不能把“同意”等排队文字解释为继续原目标或人工批准。显式补充走独立入口，不解冻 closed 或 goal.blocked。

### 显式补充的单次消费

`dispatch.continuations` 由独立 `ScopeContinuationService` 承担，复用派发事务和日志。`inspect({workspaceId,rootSessionId,scopeId,commandId})` 只读已保存意图；返回绑定三层身份的 `{workspaceId,rootSessionId,scopeId,scopeStatus,continuation}` 或 undefined，不启动模型，也不授予换 ID 重发的权限。active/closed 历史仍可查到原记录。

`accept(request, trustedRunId)` 仅由运行时完成租约和历史预检后的可信 beforeRun 调用；工作区/周期/等待/预期目标与输入版本、预算均核对后，同事务消费等待、增加输入版本并保存意图。指纹包含完整规范请求但不含随机 trustedRunId。相同 commandId 改正文、配置或预期版本返回 COMMAND_ID_CONFLICT；重复相同请求返回原记录，换命令再消费同 wait 拒绝。返回的 fresh 只在本次新事务内存产生，不存入 durable receipt；只有 fresh 才可尝试本次启动，调用方仍须复核停止信号和 scope 当前状态。

提交前失败不消费检查点；提交后运行日志尚未建立、真实 Pi 会话校验失败或启动结果不明，都保留意图，不恢复 waiting 或自动重放。恢复流程将遗留 active 收口 interrupted。补充后旧 plan 保留以保护 human 项，但 inputRevision 不一致；plan 服务按当前输入盖版本，review/派发/完成/再次等待均拒绝过期计划。已有真实候选可在新计划下重新审阅，不伪造证据，也不将用户补充视为人工验收。

### 主会话协作接续边界（续）

`AutoCollaboration` 按工作区装配，只向使用已保存模型配置的主聊天轮次提供 `cbim_dispatch_task / inspect`；正式任务不获得递归工具。主 Agent 不执行业务；`cbim_dispatch_task.agentId` 缺省使用 `cbim:executor`。普通问答不用登记业务节点。模型仅传角色、模块、目标、验收和前置，工作区/会话/runId、scopeId 与实际 toolCallId 由运行绑定提供；稳定调用键映射到持久化命令，同次重发返回原回执。单轮最多登记 100 个不同派发调用，不能在工具 Promise 中等待执行。

一次用户任务对应一个持久化 `DispatchScope`，可以跨多个主模型轮次、多个成员执行和结果回传。`starting` 在模型工厂准备后、模型启动前调用 `openScope`；可信结果回注沿用原周期，不能新建周期。每个模型轮仍保留独立 batch，以准确记录本轮派发和回注来源。普通聊天在最新主轮正常结束且没有规划、派工或知识写入后关闭生命周期；正式工作必须由主 Agent 提交 complete 审阅申请，并在主运行结算后通过真实证据、版本和全周期状态复核，才允许以 completed 关闭。awaiting_user 则须通过独立安全检查后持久等待；其他不满足要求的情况继续分析、重规划或明确记录阻塞，不能把空回复或底层 run.completed 当作成功；首个主轮派发完成不关闭。失败、停止、启动失败和应用退出都会尝试收束活动周期：等待在途派发/启动完成，停止成员并等待真实结算，再调用 `closeScope` 释放执行实例；已安全 waiting 在应用退出时保留。历史任务和运行日志保留，关闭失败继续报告诊断并保留真实状态，不伪装为已释放。

用户队列在周期关闭事务完成前保持 busy，成功关闭后才由 `collaborationReady` 开始下一条 pending 用户消息的新周期；已暂停项不自动恢复。用户停止和启动工厂等待之间用停止版本核验，防止异步返回覆盖较新的停止请求。重开时先 `MemberExecutionManager.initialize` 将遗留运行结算为 interrupted，再 `recoverScopes` 关闭遗留 active 周期、`AutoCollaboration.initialize` 保留安全 waiting 占位；不自动启动任何成员或投递历史结果。

协调器保存主轮选择的公开 profileId/model/permission，不保存密钥或复制 allowAll。主轮安全完成、释放租约后才启动就绪成员；真实租约释放与可靠成员结算触发后续推进，不轮询磁盘。成员启动时重新解析该模型配置并冻结执行知识，同一成员串行，写冲突交给共享租约。未满足外部前置、启动失败或 blocked 如实回传，不伪造候选。

结果先作为 `member-results` 可信来源登记到主会话运行日志，并经 Pi custom 消息送入原生上下文，然后才确认结果信封。来源登记或启动失败保留未处理信封；登记成功但确认失败不重复运行。待处理批次仅存在于当前进程，重启只恢复任务、信封和来源事实，不自动恢复协调执行。

`WorkspaceExecutionManager.attachCollaboration` 由可信装配层调用一次，接收 `starting / startFailed / busy / settled / stop`，不通过公开 IPC 设置回调。`startFailed` 清理已打开的周期，结果回注遇到暂时租约冲突时保留原周期等待。`settled` 仅在运行收尾、工作区占用释放和 active 删除后同步通知协调器；回调登记下一步而不等待成员整轮执行。无法核实收尾时传入 undefined，不把失败当作主会话正常完成。

`continueFromResults` 在会话串行边界中核验最新 chat 运行已 completed、无未决工具且原生会话存在，携带 `RunInputSource` 调用大脑续跑。来源包含稳定的 continuationId、结果 messageIds 和涉及的 taskIds，不允许通过用户 resume 参数注入。失败或 blocked 成员可以没有结果信封，但仍必须有任务集合和接续身份。相同 continuationId、同批来源及相同正文返回已经保存的运行回执；改变集合、正文或改用新标识重复消费 messageId 会拒绝。该去重从运行日志恢复，不靠内存标记；回执只代表可靠启动，候选和收件仍不等于验收。

协作 busy 期间，用户 resume 保存为原用户队列项并返回 queued:true；原文字与发送配置不改变，也不会抢占成员租约。带未决工具核实参数的 resume 拒绝排队，避免静默丢弃核实语义。`collaborationReady` 只尝试队列中已经 pending 的消息，不解除暂停。自动结果单独进入来源明确的续跑，不加入可编辑、删除的用户队列。

无法确认成员结算或续跑的异常会记录到应用运行监管，`pauseCollaboration` 立即建立停止屏障后串行保存队列暂停；不能因清除 busy 而抢跑用户消息。成员结算失败保留真实租约与活动记录，留待核实；不能声称已释放。停止成员失败可观察并向调用方报告，不静默忽略。

用户 stop 先建立本会话的自动续跑停止屏障，再调用协调器停止，最后暂停用户队列并停止主运行；协调器停止不在管理器串行边界内等待，避免反向查询管理器时死锁。停止期间即使协调器已解除 busy，自动队列和迟到结果也不能重启模型；工厂等待后仍复核屏障。显式新用户轮次或继续队列才清除停止屏障。应用重启不自动投递历史结果；已保存的来源用于核实与去重。

```mermaid
classDiagram
class WorkspaceExecutionManager {
  +attachCollaboration(hooks)
  +continueFromResults(taskId, message, options, source)
  +collaborationReady(taskId)
  +pauseCollaboration(taskId, reason)
  +resume(taskId, runId, message, options)
  +stop(taskId)
}
class ExecutionCollaboration {
  <<interface>>
  +starting(task, options, source)
  +startFailed(task, source, error)
  +busy(taskId)
  +settled(task, options, summary)
  +stop(taskId)
}
class RunInputSource {
  <<core contract>>
  +continuationId
  +messageIds
  +taskIds
}
WorkspaceExecutionManager ..> ExecutionCollaboration : 释放占用后通知
WorkspaceExecutionManager ..> RunInputSource : 核验来源并按日志去重
class AutoCollaboration {
  +tools(task, runId, options)
  +busy(taskId)
  +stop(taskId)
  +close()
}
AutoCollaboration ..> WorkspaceExecutionManager : 来源续跑与队列协调
```

当前执行接口与关键调用关系（完整方法以代码为准）：

```mermaid
classDiagram
class MemberExecutionManager {
  +initialize()
  +start(raw)
  +waitForSettlement(raw)
  +stop(raw)
  +inspect(raw)
  +events(raw)
  +messages(raw)
  +acknowledge(raw)
  +pendingApprovals(raw)
  +answerApproval(raw, id, allow, allowAll)
  +pendingQuestions(raw)
  +answerQuestion(raw, id, answers)
  +subscribe(listener)
  +close()
}
class MemberExecutionPorts {
  <<interface>>
  +acquire(key, permission, agentInstanceId)
  +prepare(options)
  +inspect(run)
}
class DispatchStore {
  <<interface>>
  +transact(command, prepare)
  +read()
}
class LoopRuntime {
  <<core>>
  +startMember(task, message, launch)
  +stop(taskId)
  +close()
}
MemberExecutionManager ..> MemberExecutionPorts : 注入模型和工作区占用
MemberExecutionManager ..> DispatchStore : 原子领取与结算
MemberExecutionManager ..> LoopRuntime : 独立成员运行
class MemberEventStreams {
  +begin(run, task)
  +append(run, task, event)
  +read(run, task, cursor, limit)
  +clear()
}
MemberExecutionManager ..> MemberEventStreams : 公开执行增量
```

以下保留进一步调度能力的目标契约；等待/唤醒、任务取消和自动恢复执行仍属后续设计。仅主 Agent 拥有调度职责，执行 Agent 自主理解环境并执行目标模块，协作缺口返回主 Agent 处理，不开放成员递归派发。

#### 职责和端口

调度器接收主 Agent 分析后的任务请求，核验成员、多模块维护关系、依赖与权限，再持久化派发。主 Agent 模型提出分工，也可按本轮权限通过内部知识服务维护团队和业务定义，程序负责边界与事实；执行 Agent 自主探索真实团队与目标模块、选择实现和验证方法，再返回事实或缺口。组织的父子关系不授予派发权；主实例不直接执行业务，没有可选自定义角色时由独立默认执行者承担业务。

`dispatch-service.ts` 负责建图、注册、派发及读取；`agent-manager.ts` 分配身份；`member-execution.ts` 管理领取、执行、结果和恢复，`member-state.ts` 核实交付并组装图事实，`workspace-lease.ts` 管理跨运行占用。存储端口在 Core `dispatch-storage.ts`。下面 `AgentDispatchService` 是后续模型命令契约，不是当前同名实现。

派发服务方法为 `initialize / openGraph / conversationBinding / openScope / closeScope / recoverScopes / createMember / dispatchTask / snapshot / delta / close`，拒绝任意 requester、parentTaskId 或运行状态，请求人固定来自主会话根。`openScope` 开启用户任务级周期；`closeScope` 在在途运行结算后原子释放执行实例并保留历史；`recoverScopes` 将重启前 active 周期结算为 interrupted，保留安全 waiting 且不重放执行。执行管理器另提供 `start / stop / inspect / messages / acknowledge` 与审批/问题接口；启动时冻结正文并复核基线，不符合则拒绝运行。

应用级动态索引位于相邻的 `runtime/`：main 注入已提交派发观察和 Loop 事件订阅，WorkspaceExecutionManager 另提供 `observeQueue / initializeQueueMonitoring` 报告保存后的队列负载。业务服务不反向依赖全局管理器；全局索引不接管知识或执行权限。

```ts
// 以下为服务边界示意；GraphIdentity / ModuleBinding 等复用 Core 契约。
type DispatchCaller = {
  identity: GraphIdentity;
  agent: AgentRef;
  taskId?: string; runId?: string;
  leaseEpoch: number; // 进程接管代际，不替代稳定的 agentInstanceId
  permissionSnapshotId: string;
};
type TaskDraft = {
  assigneeAgentId: string;
  moduleIds: string[];
  goal: string;
  acceptance: { id: string; text: string }[];
  prerequisites: { taskId: string; expectedPlanRevision: number }[];
};
type DispatchRequest = {
  commandId: string;
  parentTaskId?: string;
  expectedParentRevision: number;
  task: TaskDraft;
};
type DispatchReceipt = {
  commandId: string; taskId: string; messageId: string;
  cursor: GraphCursor;
  disposition: 'queued' | 'waiting'; // 已可靠派发，不是执行完成
};
type TurnSubmissionReceipt = {
  submissionId: string; taskId: string; runId: string; planRevision: number;
  kind: 'result' | 'wait'; status: 'staged';
};
interface AgentDispatchService {
  dispatch(caller: DispatchCaller, request: DispatchRequest): Promise<DispatchReceipt>;
  waitForChildren(caller: DispatchCaller, request: {
    commandId: string; taskId: string; expectedRevision: number;
    children: { taskId: string; planRevision: number }[]; reason: string;
  }): Promise<TurnSubmissionReceipt>;
  submitResult(caller: DispatchCaller, request: {
    commandId: string; taskId: string; expectedRevision: number;
    planRevision: number; summary: string;
    evidenceRefs: string[]; limitations: string[];
  }): Promise<TurnSubmissionReceipt>;
}
```

`caller` 完全由可信运行绑定注入，不作为模型参数。只有主 Agent 调度阶段可调用派发，当前派发使用根节点 revision；未来的 parentTaskId 仅表达主调度追加任务的前序关系，不授予执行成员派发权。派发时解析接收实例及正确 agentSessionId，冻结 `ModuleBinding[]`，不接收模型伪造的维护关系或版本。一个请求创建一个节点；并行工作拆成多次请求。

同 `commandId` 的同参重试返回原回执；异参返回冲突。重试去重先于乐观版本检查；新请求版本过期须重读，不能自动覆盖。工具调用层用可信调用 ID 关联 commandId，网络重发与模型再次主动派工不是同一回事。读取/投递确认不替代 `result_ready`。

`submitResult` 仅接受当前 assignee 的活动 run，必须匹配 planRevision；证据引用在该任务运行的可信回执集合中核验。`submitResult / waitForChildren` 先可靠保存 staged 提交，不立即发布 result_ready / waiting；大脑在安全片段边界完成收尾并确认无在途副作用后，调度器再核验版本、提交节点状态和 outbox。提交后的新增写入或失败使 staged 候选失效，不能让下游先消费仍在变化的成果。如果子任务仍未解决，应等待或明确修订范围，不能默默把未完成工作计为完成。候选验收始终为 `not_evaluated`。

#### 一次派发的顺序

1. 核对工作区、根会话、主调度实例/租约、当前运行和授权；执行 Agent 不能调用派发入口。
2. 通过 Context 查询成员及全部模块，冻结角色配置、维护关系、Workflow 和权限基线。定位不完整时返回可处理的缺口，不伪造正式任务节点。
3. 在同一提交版本中校验父关系、前置版本及全部启用边的 DAG；持久化新任务、派发边/依赖边、outbox 消息、命令回执与图事件。
4. 持久化成功后才发布图批次并投递邮箱；接收方持久化 inbox 后确认。派发方不持有接收方 Session 的写权限。
5. 依赖未满足则节点为 waiting；可执行时 queued。取得成员执行槽、会话租约及写冲突资源后，先记录 runId 和执行意图，再启动大脑，实际启动事实推进 running。
6. 工具回执和终态由大脑事实接入。交付候选可靠保存后，以结果消息唤醒等待方；等待方核实结果版本后继续自己的任务。

图批次、邮箱与幂等索引必须在同一调度事务中提交。`DispatchGraphStore` 等存储端口契约放 Core 的无实现契约文件，main 实现并注入；调度器不得导入 main 的文件存储或 Electron。

#### 消息、等待与防死锁

内部消息协议放在 Core 的独立契约文件，由调度实现投递；形状如下，AgentRef 来自可信绑定，正文与结果证据单独保存，不进入公开图增量：

```ts
type AgentMessage = {
  messageId: string; commandId: string; identity: GraphIdentity;
  from: AgentRef; to: AgentRef; taskId: string; createdAt: string;
} & (
  | { kind: 'assignment'; planRevision: number }
  | { kind: 'result'; replyTo: string; resultId: string;
      runId: string; planRevision: number }
  | { kind: 'question'; contentRef: string }
  | { kind: 'answer'; replyTo: string; contentRef: string }
);
```

replyTo 引用原始 assignment/question 的 messageId；接收方核对原发送方、taskId、图归属与当前基线。通道需要时将 question/answer 映射为带来源的 followup 执行输入，不冒充新 assignment。

消息由可靠 outbox/inbox 投递，`messageId` 去重后只入队一次；领取、处理完成与业务结果分别记录。通信状态只在真实交付/消费期间出现，不能用动画或网络轮询推断。

主调度等待已经派发的任务时，目标方案用 `awaitedChildren` 持久化 taskId + planRevision，不添加返回方向的执行边。等待必须在安全片段边界让出大脑槽和工作区占用，收到有效结果后再排队。执行 Agent 若遇到协作缺口则返回主调度，不自行派生子任务或持槽等待未提供的工具。公平排队与可恢复等待仍待实现。

前置依赖只连接任务节点；结果必须来自指定 planRevision 的有效候选。失败/取消的依赖不会因收到一条回复而满足。结果变旧时阻塞尚未执行的依赖任务；已经执行的下游进入基线复核，不自动重放。除了可视化 DAG，调度器还检查实际等待图：当前任务 → 未满足的前置任务，以及父任务 → awaitedChildren。任一新增派发、等待或修订使其成环均拒绝，防止“A 派 B，B 以 A 的结果为前置，A 又等 B”。问答消息本身不添加执行依赖，也不自动挂起整个任务；如需等待必须登记可检查的任务关系。

#### 并发、权限与恢复

- 首版同成员实例串行，不同成员可并行；独立 agentSessionId 与租约保护原生上下文。正常重启保持 agentInstanceId，用 leaseEpoch 拒绝旧进程的迟到回调。
- 模块写作用域重叠的任务串行；命令实际作用域未知按工作区写冲突处理。等待时释放资源，恢复时重新校验文件及知识基线。这不是操作系统沙箱，也不能阻止用户或外部工具编辑。
- 派发授权与接收成员工具操作授权分别校验；不得复制“本次任务全部通过”给新任务。新任务权限不超过工作区策略、发起任务允许范围与接收成员策略的交集，批准由可信入口负责。
- 停止区分请求与实际停止事实；取消自身/子树必须明确 scope。未启动任务可直接取消已排队工作；正在执行的任务等待工具和大脑终态，未知结果为 interrupted。停止不代表回滚。
- 收到 completed 运行事实只结束执行片段；业务任务没有明确交付候选或等待动作时进入 blocked 并给出原因，不由模型回合结束推断业务成功。普通 conversation 运行可以正常结束，不要求创建 TaskNode 或交付候选。
- 崩溃恢复先重建事务与邮箱，再核对在途 run。只重投幂等消息，不自动重放未知副作用。重试沿用 taskId、生成新 runId，并保留失败证据；晚到旧 run 不覆盖新状态。

#### 目标结构类图（待实现）

```mermaid
classDiagram
class DispatchService {
  <<planned>>
  +dispatch(caller, request)
  +waitForChildren(caller, request)
  +submitResult(caller, request)
}
class AgentManager { <<planned>> }
class MemberMailbox { <<planned>> }
class TaskContextResolver { <<port>> }
class DispatchGraphStore { <<port>> }
class AgentRunPort { <<port>> }
DispatchService ..> TaskContextResolver : 核实并冻结
DispatchService ..> DispatchGraphStore : 原子事务
DispatchService ..> AgentManager : 申请成员执行
AgentManager ..> MemberMailbox : 领取与恢复
AgentManager ..> AgentRunPort : 执行独立通道
MemberMailbox ..> DispatchGraphStore : 去重和投递事实
```

后续调度验收至少覆盖：主调度派给多个执行者并按返回结果追加后续任务、默认执行者可用、主实例禁止执行业务、执行者不得派工、周期结束释放执行实例、跨图拒绝、依赖成环、重复派发和迟到回调、实例串行/上下文隔离、权限不扩张、写冲突和未知结果不重放。现有任务图渲染只展示实际已接通行为。

### 主会话目标的只读展示端口

`WorkspaceDispatchService.sessionRead` 严格解析主会话身份、graph/scope 两条独立游标与选中详情 stamp，再调用存储的单屏障读取。服务不组合多次独立 read，也不为了展示创建图或周期。它返回生命周期和计划/审阅事实，由界面区分完成申请、等待成员、阻塞与最终结束；不以主模型的 completed 覆盖 scope 状态。原图 snapshot/delta 继续提供兼容读取。

### 成员异常的只读核实

`MemberExecutionManager.report` 委托 `ExecutionReportService`，只调用派发存储 read 与指定 run 的 canonical inspect，不调用 initialize、模型准备、租约申请、结算、收件确认或日志修复。派发状态在日志读取前后各读一次；相关事实改变时整份结果标记为未知。日志与派发存储不是同一个原子事务，`stable` 只表示这两个派发屏障一致，不证明外部产物没有变化。

`execution-report-facts.ts` 根据 proposed、allowed/denied、finished 及可信 receipt 核实工具链、身份和参数/结果摘要；Pi 的 started 可早于权限门禁，只是工具尝试，不作授权证据。重复授权/结束、缺失回执、未知结果与损坏字段保守记为未知；合法 denied 后的原生失败结束仍保持 denied。工具失败可能已有改动，成功仅为成功回执，均不等于验收通过。活动运行尚未收到终态时可以显示 in_flight；终态后的未决操作、截断日志或身份不符不能显示 settled。

报告按稳定基线分页，基线变化重置当前第一页，不缓存或新增持久报告存储。关闭周期仅提供“核实后在新周期处理”的建议，不复活旧实例或自动重放。主目标的审阅、完成和安全等待也拒绝已知 partialTail 日志前缀；旧内存摘要未提供此元数据时不凭空标为截断。显式重试/改派与人工事实确认留待后续步骤，本入口没有这些写操作。
只读日志错误兼容：成员流仅在可信本进程新运行仍为 starting、尚无 startedAt/原生文件、且初始流为空时，将 `RUN_LOG_EMPTY` 视作等待首条事件；已开始或历史空日志不豁免。核实报告始终将该码呈现为 incomplete/unknown，不据 UI 流的等待窗口推断“未执行”。
