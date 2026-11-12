# src/backend/core/execution/runtime 架构

## 目录定位

执行模块内部运行机制：回合驱动、事件、工具协调、输出验证与计量。继续依赖领域规则与能力，迁移不拆分运行状态所有权；依赖过密仍是独立治理项。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [runtime.ts](runtime.ts) | LoopRuntime 持有任务租约、工具授权与终态；显式续聊由会话选择器核实原生恢复或无交互失败重试。 |

## 架构类图

### runtime.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_core_execution_runtime_runtime_ts["runtime.ts"] {
  <<module>>
}
class N_src_backend_core_execution_runtime_runtime_ts_RuntimeOptions["RuntimeOptions"] {
  <<interface>>
  +storage
  +directory
  +conversationBinding
  +artifacts
  +manifests
  +validations
  +codeChecks
  +controlledFiles
  +scopedExecution
  +artifactTransitions
  +workflowContracts
  +describeTool()
  +assertMemberResume()
  +memberCheckpointAllowance
  +assertMemberResumeInputs()
  +acquireLease()
}
N_src_backend_core_execution_runtime_runtime_ts ..> N_src_backend_core_execution_runtime_runtime_ts_RuntimeOptions : 声明
class N_src_backend_core_execution_runtime_runtime_ts_RunStartControl["RunStartControl"] {
  <<interface>>
  +signal
  +beforeRun()
}
N_src_backend_core_execution_runtime_runtime_ts ..> N_src_backend_core_execution_runtime_runtime_ts_RunStartControl : 声明
class N_src_backend_core_execution_runtime_runtime_ts_RunSteerControl["RunSteerControl"] {
  <<interface>>
  +expectedRunId
  +signal
  +activeInput
}
N_src_backend_core_execution_runtime_runtime_ts ..> N_src_backend_core_execution_runtime_runtime_ts_RunSteerControl : 声明
class N_src_backend_core_execution_runtime_runtime_ts_FreshMainStartControl["FreshMainStartControl"] {
  <<interface>>
  +signal
  +knownRunIds()
  +beforeRun()
}
N_src_backend_core_execution_runtime_runtime_ts ..> N_src_backend_core_execution_runtime_runtime_ts_FreshMainStartControl : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_core_execution_runtime_runtime_ts["runtime.ts"] {
  <<module>>
}
class N_src_backend_core_execution_runtime_runtime_ts_RuntimeOptions["RuntimeOptions"] {
  <<interface>>
  +createEngine()
  +toolPolicy()
  +onEngineReady()
  +onEvent()
}
N_src_backend_core_execution_runtime_runtime_ts ..> N_src_backend_core_execution_runtime_runtime_ts_RuntimeOptions : 声明
```

```mermaid
classDiagram
class N_src_backend_core_execution_runtime_runtime_ts["runtime.ts"] {
  <<module>>
}
class N_src_backend_core_execution_runtime_runtime_ts_LoopRuntime["LoopRuntime"] {
  +start()
  +startMember()
  +resumeMember()
  +startFreshMain()
  +inspect()
  +stop()
  +steer()
  +close()
  -options
  -active
  -injections
  -starting
  -closing
  -startInternal()
}
N_src_backend_core_execution_runtime_runtime_ts ..> N_src_backend_core_execution_runtime_runtime_ts_LoopRuntime : 声明
```

直接依赖：[../engine-session.ts](../engine-session.ts)、[../../foundation/identity.ts](../../foundation/identity.ts)、[../storage.ts](../storage.ts)、[../../tools/receipts.ts](../../tools/receipts.ts)、[../../evidence/progress-tools.ts](../../evidence/progress-tools.ts)、[../../tasks/member-help-tools.ts](../../tasks/member-help-tools.ts)、[../../evidence/artifact-tools.ts](../../evidence/artifact-tools.ts)、[../../tasks/member-checkpoint-tools.ts](../../tasks/member-checkpoint-tools.ts)、[../capabilities/member-checkpoint.ts](../capabilities/member-checkpoint.ts)、[../../tasks/member-checkpoint.ts](../../tasks/member-checkpoint.ts)、[../../tasks/member-checkpoint-evidence.ts](../../tasks/member-checkpoint-evidence.ts)、[../../foundation/serialization.ts](../../foundation/serialization.ts)、[../capabilities/artifact-capture.ts](../capabilities/artifact-capture.ts)、[../capabilities/run-code-check.ts](../capabilities/run-code-check.ts)、[../../evidence/code-check.ts](../../evidence/code-check.ts)、[../capabilities/output-manifest-capture.ts](../capabilities/output-manifest-capture.ts)、[../../workspace/artifact-scope.ts](../../workspace/artifact-scope.ts)、[../../evidence/output-manifest.ts](../../evidence/output-manifest.ts)、[../../evidence/complete-output-evidence.ts](../../evidence/complete-output-evidence.ts)、[../capabilities/run-validation.ts](../capabilities/run-validation.ts)、[../capabilities/member-tool-capabilities.ts](../capabilities/member-tool-capabilities.ts)、[../capabilities/run-scoped-execution.ts](../capabilities/run-scoped-execution.ts)、[../../workspace/execution-scope.ts](../../workspace/execution-scope.ts)、[../../file-operations/scoped-execution.ts](../../file-operations/scoped-execution.ts)、[../repeated-tool-failures.ts](../repeated-tool-failures.ts)、[../../tools/outcome.ts](../../tools/outcome.ts)、[../../tools/native-tools.ts](../../tools/native-tools.ts)、[../capabilities/run-controlled-file.ts](../capabilities/run-controlled-file.ts)、[../../file-operations/controlled-file-operation.ts](../../file-operations/controlled-file-operation.ts)、[../capabilities/run-artifact-transition.ts](../capabilities/run-artifact-transition.ts)、[../../file-operations/artifact-transition.ts](../../file-operations/artifact-transition.ts)、[../../evidence/validation.ts](../../evidence/validation.ts)、[../member-run.ts](../member-run.ts)、[../input-source.ts](../input-source.ts)、[../conversation-binding.ts](../conversation-binding.ts)、[../types.ts](../types.ts)、[../../tools/policy/tool-policy.ts](../../tools/policy/tool-policy.ts)、[../../tasks/execution-context.ts](../../tasks/execution-context.ts)、[../../evidence/workflow-evidence.ts](../../evidence/workflow-evidence.ts)、[../../foundation/errors.ts](../../foundation/errors.ts)、[../../tasks/scope-active-input.ts](../../tasks/scope-active-input.ts)、[../../tasks/scope-active-input-rules.ts](../../tasks/scope-active-input-rules.ts)、[../../tools/types.ts](../../tools/types.ts)。


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
