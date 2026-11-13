# src/backend/scheduler-engine/assembly 架构

## 目录定位

引擎装配：loop-engine 将实际 Pi/Claude/Codex、模型预算及工具能力接入 Core 运行循环。这里有意认识具体实现；高密度装配依赖仍需独立评审。 主/成员运行按可信端口准备 E，并用 pinRuntimeEngine 固定历史兼容边界；可执行路径不来自公开运行选项。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [loop-engine.ts](loop-engine.ts) | 调度引擎：将工作区内部知识服务、内核锁与前置策略注入独立 LoopRuntime。 |

## 架构类图

### loop-engine.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_assembly_loop_engine_ts["loop-engine.ts"] {
  <<module>>
  +createWorkspaceLoop()
}
```

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_assembly_loop_engine_ts["loop-engine.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_assembly_loop_engine_ts_WorkspaceLoopOptions["WorkspaceLoopOptions"] {
  <<interface>>
  +engineRuntimes
  +mode
  +collaborationMode
  +attachmentIds
  +images
  +engine
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
}
N_src_backend_scheduler_engine_assembly_loop_engine_ts ..> N_src_backend_scheduler_engine_assembly_loop_engine_ts_WorkspaceLoopOptions : 声明
class N_src_backend_scheduler_engine_assembly_loop_engine_ts_ExecutionServices["ExecutionServices"] {
  <<interface>>
  +codeChecks
  +requestBudget()
  +conversationBinding
  +repositoryTools
  +webTools
  +feedbackTools()
  +feedbackStatus()
  +governanceTools()
  +memberTools()
  +ownershipTools()
  +dispatchTools()
  +member
  +artifacts
  +manifests
  +validations
  +controlledFiles
}
N_src_backend_scheduler_engine_assembly_loop_engine_ts ..> N_src_backend_scheduler_engine_assembly_loop_engine_ts_ExecutionServices : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_scheduler_engine_assembly_loop_engine_ts["loop-engine.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_assembly_loop_engine_ts_WorkspaceLoopOptions["WorkspaceLoopOptions"] {
  <<interface>>
  +llm
}
N_src_backend_scheduler_engine_assembly_loop_engine_ts ..> N_src_backend_scheduler_engine_assembly_loop_engine_ts_WorkspaceLoopOptions : 声明
class N_src_backend_scheduler_engine_assembly_loop_engine_ts_ExecutionServices["ExecutionServices"] {
  <<interface>>
  +scopedExecution
  +artifactTransitions
  +assertMemberResume()
  +memberCheckpointAllowance
  +assertMemberResumeInputs()
  +onEngineReady()
  +storage
  +acquireLease()
  +authorizeNative()
}
N_src_backend_scheduler_engine_assembly_loop_engine_ts ..> N_src_backend_scheduler_engine_assembly_loop_engine_ts_ExecutionServices : 声明
```

直接依赖：[../tools/question-tools.ts](../tools/question-tools.ts)、[../tools/web-tools.ts](../tools/web-tools.ts)、[../../../logic/web/index.ts](../../../logic/web/index.ts)、[../../../logic/workspace/ports/paths.ts](../../../logic/workspace/ports/paths.ts)、[../../../logic/knowledge/rules/ports.ts](../../../logic/knowledge/rules/ports.ts)、[../tools/knowledge-tools.ts](../tools/knowledge-tools.ts)、[../context/team-workflow.ts](../context/team-workflow.ts)、[../../../core/errors.ts](../../../core/errors.ts)、[../conversation/main-agent.ts](../conversation/main-agent.ts)、[../../../logic/execution/rules/types.ts](../../../logic/execution/rules/types.ts)、[../../engines/claude/engine.ts](../../engines/claude/engine.ts)、[../../engines/codex/engine.ts](../../engines/codex/engine.ts)、[../../../logic/models/index.ts](../../../logic/models/index.ts)、[../../../logic/execution/rules/index.ts](../../../logic/execution/rules/index.ts)、[../../engines/pi/engine.ts](../../engines/pi/engine.ts)、[../../engines/pi/rpc.ts](../../engines/pi/rpc.ts)、[../../../logic/tools/rules/policy/tool-policy.ts](../../../logic/tools/rules/policy/tool-policy.ts)、[../../../logic/evidence/rules/progress-tools.ts](../../../logic/evidence/rules/progress-tools.ts)、[../../engines/runtime-binding.ts](../../engines/runtime-binding.ts)、[../../../logic/tasks/rules/member-help-tools.ts](../../../logic/tasks/rules/member-help-tools.ts)、[../../../logic/evidence/rules/artifact-tools.ts](../../../logic/evidence/rules/artifact-tools.ts)、[../../../logic/execution/rules/capabilities/artifact-capture.ts](../../../logic/execution/rules/capabilities/artifact-capture.ts)、[../../../logic/execution/rules/capabilities/output-manifest-capture.ts](../../../logic/execution/rules/capabilities/output-manifest-capture.ts)、[../../../logic/evidence/rules/output-manifest-tools.ts](../../../logic/evidence/rules/output-manifest-tools.ts)、[../../../logic/execution/rules/capabilities/run-controlled-file.ts](../../../logic/execution/rules/capabilities/run-controlled-file.ts)、[../../../logic/file-operations/rules/controlled-file-operation.ts](../../../logic/file-operations/rules/controlled-file-operation.ts)、[../../../logic/execution/rules/capabilities/run-artifact-transition.ts](../../../logic/execution/rules/capabilities/run-artifact-transition.ts)、[../../../logic/file-operations/rules/artifact-transition.ts](../../../logic/file-operations/rules/artifact-transition.ts)、[../../../logic/execution/rules/capabilities/run-validation.ts](../../../logic/execution/rules/capabilities/run-validation.ts)、[../../../logic/evidence/rules/validation-tools.ts](../../../logic/evidence/rules/validation-tools.ts)、[../../../logic/tasks/rules/member-checkpoint-tools.ts](../../../logic/tasks/rules/member-checkpoint-tools.ts)、[../tools/dispatch-tools.ts](../tools/dispatch-tools.ts)、[../../../logic/execution/rules/capabilities/run-scoped-execution.ts](../../../logic/execution/rules/capabilities/run-scoped-execution.ts)、[../../../logic/file-operations/rules/scoped-execution.ts](../../../logic/file-operations/rules/scoped-execution.ts)、[../../../logic/workspace/rules/execution-scope.ts](../../../logic/workspace/rules/execution-scope.ts)、[../../../logic/tools/rules/native-tools.ts](../../../logic/tools/rules/native-tools.ts)、[../../../logic/tasks/rules/execution-context.ts](../../../logic/tasks/rules/execution-context.ts)、[../../../logic/connectors/rules/repository-tools.ts](../../../logic/connectors/rules/repository-tools.ts)、[../tools/feedback-tools.ts](../tools/feedback-tools.ts)、[../tools/feedback-status-tool.ts](../tools/feedback-status-tool.ts)、[../../../logic/feedback/index.ts](../../../logic/feedback/index.ts)、[../tools/repository-tools.ts](../tools/repository-tools.ts)、[../../../logic/governance/rules/module-governance-tools.ts](../../../logic/governance/rules/module-governance-tools.ts)、[../tools/governance-tools.ts](../tools/governance-tools.ts)、[../tools/coordination-tools.ts](../tools/coordination-tools.ts)、[../tools/workspace-member-tools.ts](../tools/workspace-member-tools.ts)、[../../../logic/team/rules/workspace-member-tools.ts](../../../logic/team/rules/workspace-member-tools.ts)、[../tools/module-ownership-tools.ts](../tools/module-ownership-tools.ts)、[../../../logic/workspace/rules/module-ownership-tools.ts](../../../logic/workspace/rules/module-ownership-tools.ts)、[../../../logic/budget/rules/request-budget.ts](../../../logic/budget/rules/request-budget.ts)、[../../../logic/execution/rules/engine-runtime.ts](../../../logic/execution/rules/engine-runtime.ts)、[../../../logic/evidence/rules/code-check.ts](../../../logic/evidence/rules/code-check.ts)、[../../../logic/execution/rules/storage.ts](../../../logic/execution/rules/storage.ts)。


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

## 知识参数默认值装配

loop-engine 仅对 KnowledgeTools.has 命中的当前注册知识工具提供 normalizeToolInput；通过 normalizeInput 校验绑定实例和实际 Schema，在 Runtime 记录请求前补齐身份与默认值。派发、岗位、原生及其它工具保持原输入和独立校验。执行服务仍重新核对同一实例与写权限，不借规范化提升授权。
