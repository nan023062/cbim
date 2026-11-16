# src/logic/execution/assembly 架构

## 目录定位

引擎装配：loop-engine 将实际 Pi/Claude/Codex、模型预算及工具能力接入 logic/execution/rules/runtime 运行循环。这里有意认识具体实现；高密度装配依赖仍需独立评审。 主/成员运行按可信端口准备 E，并用 pinRuntimeEngine 固定历史兼容边界；可执行路径不来自公开运行选项。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [agent-call-scheduler.ts](agent-call-scheduler.ts) | execution 内的递归调用协调，拥有父子关联、深度限制、业务结果核验、用户意见的两阶段保存、反馈与后代取消。 |
| [engine-adapters.ts](engine-adapters.ts) | 当前源码/旧包的官方适配器装配表，所有实现均通过同一版本协议取得工厂。 |
| [engine-package-loader.ts](engine-package-loader.ts) | 从冷宿主已验证的不可变包路径加载统一引擎工厂。 |
| [loop-engine.ts](loop-engine.ts) | 将工作区知识、权限和工具注入 LoopRuntime；业务 Agent 同时取得冻结 Workflow 指引及产物验证能力，主 Agent 的人工评审沿原工具门禁。 |
| [packaged-engine-adapters.ts](packaged-engine-adapters.ts) | 正式 R 构建替换源码兼容表，禁止回退到内嵌具体引擎。 |

## 架构类图

### agent-call-scheduler.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_execution_assembly_agent_call_scheduler_ts["agent-call-scheduler.ts"] {
  <<module>>
}
class N_src_logic_execution_assembly_agent_call_scheduler_ts_AgentSchedulerPorts["AgentSchedulerPorts"] {
  <<interface>>
  +capacity()
  +list()
  +requestReview()
  +prepare()
}
N_src_logic_execution_assembly_agent_call_scheduler_ts ..> N_src_logic_execution_assembly_agent_call_scheduler_ts_AgentSchedulerPorts : 声明
class N_src_logic_execution_assembly_agent_call_scheduler_ts_AgentCallScheduler["AgentCallScheduler"] {
  +bind()
  +close()
  -limits
  -ports
  -attempts
  -activeCalls
  -stranded
  -replyHistory
  -checks
  -reviewProofs
  -reviewControllers
  -reviews
  -humanBlocked
  -closed
  -execute()
  -review()
}
N_src_logic_execution_assembly_agent_call_scheduler_ts ..> N_src_logic_execution_assembly_agent_call_scheduler_ts_AgentCallScheduler : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_execution_assembly_agent_call_scheduler_ts["agent-call-scheduler.ts"] {
  <<module>>
}
class N_src_logic_execution_assembly_agent_call_scheduler_ts_AgentCallScheduler["AgentCallScheduler"] {
  -capacity()
  -message()
  -drain()
}
N_src_logic_execution_assembly_agent_call_scheduler_ts ..> N_src_logic_execution_assembly_agent_call_scheduler_ts_AgentCallScheduler : 声明
```

直接依赖：[../../agents/agent.ts](../../agents/agent.ts)、[../../agents/exchange.ts](../../agents/exchange.ts)、[../../tools/rules/questions.ts](../../tools/rules/questions.ts)、[../rules/member-run.ts](../rules/member-run.ts)、[../rules/runtime/runtime.ts](../rules/runtime/runtime.ts)、[../rules/types.ts](../rules/types.ts)、[../../agents/contracts.ts](../../agents/contracts.ts)、[../../tools/rules/outcome.ts](../../tools/rules/outcome.ts)、[../../tools/rules/results.ts](../../tools/rules/results.ts)。

### engine-adapters.ts

```mermaid
classDiagram
class N_src_logic_execution_assembly_engine_adapters_ts["engine-adapters.ts"] {
  <<module>>
  +sourceEngineAdapter()
}
```

直接依赖：[../engines/pi/package.ts](../engines/pi/package.ts)、[../engines/claude/package.ts](../engines/claude/package.ts)、[../engines/codex/package.ts](../engines/codex/package.ts)、[../engines/memory/package.ts](../engines/memory/package.ts)、[../rules/engine-adapter.ts](../rules/engine-adapter.ts)。

### engine-package-loader.ts

```mermaid
classDiagram
class N_src_logic_execution_assembly_engine_package_loader_ts["engine-package-loader.ts"] {
  <<module>>
  +packagedEngineAdapter()
}
```

直接依赖：[../rules/engine-adapter.ts](../rules/engine-adapter.ts)、[../rules/engine-runtime.ts](../rules/engine-runtime.ts)、[../../engines/index.ts](../../engines/index.ts)。

### loop-engine.ts

```mermaid
classDiagram
class N_src_logic_execution_assembly_loop_engine_ts["loop-engine.ts"] {
  <<module>>
  +createWorkspaceLoop()
}
```

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_execution_assembly_loop_engine_ts["loop-engine.ts"] {
  <<module>>
}
class N_src_logic_execution_assembly_loop_engine_ts_WorkspaceLoopOptions["WorkspaceLoopOptions"] {
  <<interface>>
  +engineRuntimes
  +mode
  +collaborationMode
  +attachmentIds
  +images
  +engine
  +modelRoles
  +provider
  +model
  +profileId
  +allowNativeExecution
  +permission
  +requestQuestion()
  +requestApproval()
  +process
  +turnTimeoutMs
}
N_src_logic_execution_assembly_loop_engine_ts ..> N_src_logic_execution_assembly_loop_engine_ts_WorkspaceLoopOptions : 声明
class N_src_logic_execution_assembly_loop_engine_ts_ExecutionServices["ExecutionServices"] {
  <<interface>>
  +agentLifecycle
  +agent
  +rootAgent
  +officeHistory
  +agentTools()
  +agentCall()
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
}
N_src_logic_execution_assembly_loop_engine_ts ..> N_src_logic_execution_assembly_loop_engine_ts_ExecutionServices : 声明
class N_src_logic_execution_assembly_loop_engine_ts_WorkspaceLoop["WorkspaceLoop"] {
  <<interface>>
  +runtime
  +workspace
  +agentHome
  +agent
  +unifiedAgentTools
  +agentLifecycle
  +newTask()
}
N_src_logic_execution_assembly_loop_engine_ts ..> N_src_logic_execution_assembly_loop_engine_ts_WorkspaceLoop : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_execution_assembly_loop_engine_ts["loop-engine.ts"] {
  <<module>>
}
class N_src_logic_execution_assembly_loop_engine_ts_WorkspaceLoopOptions["WorkspaceLoopOptions"] {
  <<interface>>
  +onEvent()
  +llm
}
N_src_logic_execution_assembly_loop_engine_ts ..> N_src_logic_execution_assembly_loop_engine_ts_WorkspaceLoopOptions : 声明
class N_src_logic_execution_assembly_loop_engine_ts_ExecutionServices["ExecutionServices"] {
  <<interface>>
  +dispatchTools()
  +member
  +artifacts
  +manifests
  +validations
  +controlledFiles
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
N_src_logic_execution_assembly_loop_engine_ts ..> N_src_logic_execution_assembly_loop_engine_ts_ExecutionServices : 声明
```

直接依赖：[../../tools/runtime/office-history-tools.ts](../../tools/runtime/office-history-tools.ts)、[../../tools/runtime/question-tools.ts](../../tools/runtime/question-tools.ts)、[../../tools/runtime/web-tools.ts](../../tools/runtime/web-tools.ts)、[../../web/index.ts](../../web/index.ts)、[../../workspace/ports/paths.ts](../../workspace/ports/paths.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../tools/runtime/knowledge-tools.ts](../../tools/runtime/knowledge-tools.ts)、[../context/team-workflow.ts](../context/team-workflow.ts)、[../../../core/errors.ts](../../../core/errors.ts)、[../../conversation/runtime/main-agent.ts](../../conversation/runtime/main-agent.ts)、[../../agents/index.ts](../../agents/index.ts)、[../rules/types.ts](../rules/types.ts)、[../../engines/index.ts](../../engines/index.ts)、[../rules/index.ts](../rules/index.ts)、[../rules/engine-adapter.ts](../rules/engine-adapter.ts)、[engine-package-loader.ts](engine-package-loader.ts)、[engine-adapters.ts](engine-adapters.ts)、[../../tools/rules/policy/tool-policy.ts](../../tools/rules/policy/tool-policy.ts)、[../../evidence/rules/progress-tools.ts](../../evidence/rules/progress-tools.ts)、[../engines/runtime-binding.ts](../engines/runtime-binding.ts)、[../../tasks/rules/member-help-tools.ts](../../tasks/rules/member-help-tools.ts)、[../../evidence/rules/artifact-tools.ts](../../evidence/rules/artifact-tools.ts)、[../rules/capabilities/artifact-capture.ts](../rules/capabilities/artifact-capture.ts)、[../rules/capabilities/output-manifest-capture.ts](../rules/capabilities/output-manifest-capture.ts)、[../../evidence/rules/output-manifest-tools.ts](../../evidence/rules/output-manifest-tools.ts)、[../rules/capabilities/run-controlled-file.ts](../rules/capabilities/run-controlled-file.ts)、[../../file-operations/rules/controlled-file-operation.ts](../../file-operations/rules/controlled-file-operation.ts)、[../rules/capabilities/run-artifact-transition.ts](../rules/capabilities/run-artifact-transition.ts)、[../../file-operations/rules/artifact-transition.ts](../../file-operations/rules/artifact-transition.ts)、[../rules/capabilities/run-validation.ts](../rules/capabilities/run-validation.ts)、[../../evidence/rules/validation-tools.ts](../../evidence/rules/validation-tools.ts)、[../../tasks/rules/member-checkpoint-tools.ts](../../tasks/rules/member-checkpoint-tools.ts)、[../../tools/runtime/dispatch-tools.ts](../../tools/runtime/dispatch-tools.ts)、[../rules/capabilities/run-scoped-execution.ts](../rules/capabilities/run-scoped-execution.ts)、[../../file-operations/rules/scoped-execution.ts](../../file-operations/rules/scoped-execution.ts)、[../../workspace/rules/execution-scope.ts](../../workspace/rules/execution-scope.ts)、[../../workspace/rules/workflow-contract.ts](../../workspace/rules/workflow-contract.ts)、[../../tools/rules/native-tools.ts](../../tools/rules/native-tools.ts)、[../../tasks/rules/execution-context.ts](../../tasks/rules/execution-context.ts)、[../../connectors/rules/repository-tools.ts](../../connectors/rules/repository-tools.ts)、[../../tools/runtime/feedback-tools.ts](../../tools/runtime/feedback-tools.ts)、[../../tools/runtime/feedback-status-tool.ts](../../tools/runtime/feedback-status-tool.ts)、[../../feedback/index.ts](../../feedback/index.ts)、[../../tools/runtime/repository-tools.ts](../../tools/runtime/repository-tools.ts)、[../../governance/rules/module-governance-tools.ts](../../governance/rules/module-governance-tools.ts)、[../../tools/runtime/governance-tools.ts](../../tools/runtime/governance-tools.ts)、[../../tools/runtime/coordination-tools.ts](../../tools/runtime/coordination-tools.ts)、[../../tools/runtime/workspace-member-tools.ts](../../tools/runtime/workspace-member-tools.ts)、[../../team/rules/workspace-member-tools.ts](../../team/rules/workspace-member-tools.ts)、[../../tools/runtime/module-ownership-tools.ts](../../tools/runtime/module-ownership-tools.ts)、[../../workspace/rules/module-ownership-tools.ts](../../workspace/rules/module-ownership-tools.ts)、[../../budget/rules/request-budget.ts](../../budget/rules/request-budget.ts)、[../rules/engine-runtime.ts](../rules/engine-runtime.ts)、[../../agents/contracts.ts](../../agents/contracts.ts)、[../../evidence/rules/code-check.ts](../../evidence/rules/code-check.ts)、[../rules/storage.ts](../rules/storage.ts)。

### packaged-engine-adapters.ts

```mermaid
classDiagram
class N_src_logic_execution_assembly_packaged_engine_adapters_ts["packaged-engine-adapters.ts"] {
  <<module>>
  +sourceEngineAdapter()
}
```

直接依赖：[../rules/engine-adapter.ts](../rules/engine-adapter.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_logic_execution_assembly_loop_engine_ts["loop-engine.ts"] {
  <<module>>
}
class N_src_logic_execution_assembly_engine_package_loader_ts["engine-package-loader.ts"] {
  <<module>>
}
class N_src_logic_execution_assembly_engine_adapters_ts["engine-adapters.ts"] {
  <<module>>
}
N_src_logic_execution_assembly_loop_engine_ts ..> N_src_logic_execution_assembly_engine_package_loader_ts : 导入依赖
N_src_logic_execution_assembly_loop_engine_ts ..> N_src_logic_execution_assembly_engine_adapters_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

## 知识参数默认值装配

新 Agent 工具装配经 ExecutionServices.agentTools 明确提供；仅此路径使用统一主／执行指令并不装配旧派发工具。根 Agent 对象保留主会话已有可用知识、网页和反馈授权，子对象只获得冻结指令、同权限工具与递归能力。`WorkspaceLoop.agent` 给主执行管理器和子调度使用同一 LoopRuntime 运行机制。旧未装配入口保留原运行协议，不能仅依据角色名开启递归。

统一 Agent 工具列表不套用旧 Team 的业务工具过滤；工具可见性不提供授权，执行仍通过 Runtime 的本轮权限、审批和原服务写入检查。

loop-engine 仅对 KnowledgeTools.has 命中的当前注册知识工具提供 normalizeToolInput；通过 normalizeInput 校验绑定实例和实际 Schema，在 Runtime 记录请求前补齐身份与默认值。派发、岗位、原生及其它工具保持原输入和独立校验。执行服务仍重新核对同一实例与写权限，不借规范化提升授权。

## 冻结引擎与启动预检

createWorkspaceLoop 将模型与引擎配置核实后确定的 engine 作为 RuntimeOptions.engineKind 注入，主与成员装配均不能遗漏。该声明只用于运行受理前核实历史可转交性；实际适配器和周期工具仍在 beforeRun 之后创建。Runtime 会复核实际 kind 与声明一致，不能在预检后静默改换引擎。

## 递归求助端口

loop-engine 将 cbim_agent_reply 登记为读效果工具，实际答复权仍由调度器校验。子 Agent 的 cbim_ask_user_question 指令与注入端口只面向直接调用方，主 Agent 保留用户问题端口；工具名称共用不代表交互对象相同。
### 执行选项中的模型角色

WorkspaceLoopOptions.modelRoles 仅表达 Agent 附加模型引用；实际入口在启动前通过 EngineModelProfiles 校验并冻结。当前代码引擎仅消费 primary，记忆引擎另需 embedding；未声明角色不能穿透选型校验。

### 统一工厂切片

loop-engine 不直接选择具体构造器，也不解析 Pi SDK 路径；通过 engine-adapters 的源码兼容表取得已核协议的工厂。Pi 进程准备移到其 package.ts，SDK 版本核对保留。源码兼容表仅供开发运行；正式构建改用已验证 E，安装选择与独立更新管理另由包生命周期服务承担。

### 正式 E 加载

生产 build 通过 packagedEngineBuild 将源码兼容表替换为拒绝回退的入口；loop-engine 对受管包只调用 engine-package-loader，按冷宿主给出的不可变根、适配器入口、版本和协议核对，并比较 E 编译声明与 R 静态模型/历史约束。旧 E 缺声明或不匹配时明确要求匹配版本，不启动、下载或重试。该动态加载登记实际源码依赖，不作为外部依赖豁免。开发直接运行源码时才使用兼容表。

引擎原生目录来自 R 静态声明的 storageDirectory，历史 Claude 目录保持 claude。装配不按引擎名称追加依赖；管理服务返回固定闭包，具体包选择自己声明的依赖。


## 递归调用协调

agent-call-scheduler.ts 持有父子调用关联、深度、去重、暂停答复与取消树，直接调用已准备 Runtime.start 并等待 done；finally 经 Runtime.close 确认排空后才释放已有全局准入许可。关闭失败保留原句柄，只重试排空，不重放任务。并发来自 execution/admission，预算来自根请求账本；协调器不另存 reserved 或本根额度，capacity 仅显示权威快照。Agent 对象继续归 agents，不迁入具体引擎。

### 显式业务调用与当前结果核验

AgentCallScheduler.prepare 可以返回可信 launch 及只读 verify。带 launch 调用同一个 LoopRuntime.startMember，beforeRun 仍将真实子 task/run 关联父工具；普通调用沿 start。只有 canonical 验证和当前字节复核通过，业务调用才返回 completed + verification。模型结束但验证失败返回工具错误。错误 details 保留工具 outcome，避免适配层把业务错误码二次封装丢失。

cbim_agent_result_check 仅接受当前父运行已经完成的原 callId；从闭包取得原身份与验证器，模型不能提交路径或证明。外部文件变化返回 WORKFLOW_VALIDATION_STALE；不能据此重放子运行。调用图深度、全局准入、预算、停止及排空逻辑不变。业务 Agent 暴露原产物证据工具及递归求助，旧终止交接/检查点工具仅保留给旧运行。

### 人工意见也是原调用上的工具

只有深度 0 且具备真实宿主问题队列的 Agent 公开 cbim_agent_result_review。参数只有原 callId，模型不能提交决定、文件证明或“用户已批准”。工具重新核实原交付，无法复核时只提供 reject/request_evidence；accept 在用户回答后再次检查当前字节，失败不保存接受记录。

humanDecision 通过原父运行的 tool.updated 可靠追加，绑定 callerTaskId/callerRunId/callId/reviewToolCallId、原始证明、当前核验和用户实际回答。保存后在同工具中等待第二张“继续处理意见”问题卡，此时模型不会收到返回值，子运行不会重启。明确继续仅授权处理意见；负面决定或“只保存”使本运行的新 cbim_agent_call 返回 AGENT_HUMAN_DECISION_REQUIRED。原 callId 的幂等读取仍返回原结果，不重放。新的用户执行指令进入下一运行后重新核实，不复用本轮授权。

同一评审工具 ID 只消费一次，重复身份更换 callId 拒绝；子 Agent 和跨调用者的候选不能请求直接人工评审。停止会取消等待，已可靠保存的意见保留在 canonical，重启仅展示日志，不自动恢复问题卡/模型/旧调用。新协议不使用旧 scope-goal 的 humanContinue：继续在当前普通工具内完成；中断后的新指令由主对话原入口受理，不伪造历史目标等待。


### 统一主会话归档

officeHistory 是可信主装配可选的只读归档工具，与统一 Agent 工具并存；目录、参数描述及实际调用使用同一实例。未装配时不可调用，子循环不继承。


接受意见保存后的继续仍须按原 callId 重新核验当前交付。复核失败保留原 humanDecision，仅追加 decision_released（continued=false、verification_failed）并返回原核验错误，同时禁止本轮自动创建子调用；不能把此前接受当作当前文件的证明，不恢复旧运行。

## 业务登记与异步释放

准备结果的 beforeRun 在真实父工具引用保存后执行；登记失败禁止进入子模型主体。release 可异步执行，必须等待原 Runtime.close 与业务登记封存；任何一步失败都保留 stranded 句柄和占用。close 只重试原关闭链，不重新 prepare 或执行模型。

## 递归 Workflow 能力预检

createWorkspaceLoop 在解析受管引擎包前，按当前引擎/权限的 nativeToolNames 与实际范围/验证端口调用 assertWorkflowCapabilities。显式业务调用准备阶段即拒绝缺能力，尚未登记子运行或发模型请求；审批仍留在后续每个工具执行。该纯规则与旧成员领取共用，不再只在旧派工入口保护 Workflow。

## 人工决定与直接工具一致
humanBlocked 同时约束新子调用与原运行的直接工具。guardEffects 从同一 runId 集合读取，只允许明确只读与预览；不能通过原生 write、命令或未分类工具绕开“只保存意见”、否定意见或复核失败后的限制。普通工具回执记录拒绝，不生成新的 Agent 层级，也不重放已完成调用。
