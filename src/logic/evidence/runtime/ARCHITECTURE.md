# src/logic/evidence/runtime 架构

## 目录定位

证据编排：收集、核实和提交产物/输出/效果/人工证据，消费 Core 的证据规则及存储端口。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [artifact-report-service.ts](artifact-report-service.ts) | 按指定成员运行列出可信文件基线，并在明确选定后对实际文件作独立只读复核。 |
| [command-verification-service.ts](command-verification-service.ts) | 把原主运行的 canonical 调用与同一 Store 已提交命令只读关联，供桌面和主工具共用。 |
| [effect-controlled-file.ts](effect-controlled-file.ts) | 在影响观察中核对已有受控文件报告与原成员完整绑定、参数和字节摘要。 |
| [effect-observation-service.ts](effect-observation-service.ts) | 组合原调用授权、已提交控制面、原知识事务、原治理/责任记录、受控文件阶段与当前选定文件，保存本机明确处置并派生新周期关联。 |
| [effect-source.ts](effect-source.ts) | 从唯一任务存储与 canonical 日志核实原成员/主运行，供影响观察和新核实来源共用。 |
| [execution-report-facts.ts](execution-report-facts.ts) | 从已核对身份的成员运行日志提取工具授权与回执事实。 |
| [execution-report-service.ts](execution-report-service.ts) | 以持久派发状态和指定成员运行日志生成异常核实报告。 |
| [human-decision-evidence.ts](human-decision-evidence.ts) | 复核已消费人工接受的精确候选和选定文件，供显式接续、目标审阅及最终完成共用。 |
| [human-evidence-state.ts](human-evidence-state.ts) | 为人工验收和按意见继续提供同一主周期的证据状态指纹。 |
| [output-manifest-report-service.ts](output-manifest-report-service.ts) | 对指定成员运行列出原完整清单，并在用户明确选定后重新观察全部冻结范围。 |

## 架构类图

### artifact-report-service.ts

```mermaid
classDiagram
class N_src_logic_evidence_runtime_artifact_report_service_ts["artifact-report-service.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_artifact_report_service_ts_ArtifactReportPorts["ArtifactReportPorts"] {
  <<interface>>
  +inspect()
  +normalizePath()
  +checkFiles()
  +acquireRead()
}
N_src_logic_evidence_runtime_artifact_report_service_ts ..> N_src_logic_evidence_runtime_artifact_report_service_ts_ArtifactReportPorts : 声明
class N_src_logic_evidence_runtime_artifact_report_service_ts_ArtifactReportService["ArtifactReportService"] {
  +read()
  -owner
  -store
  -ports
  -facts()
  -stamp()
}
N_src_logic_evidence_runtime_artifact_report_service_ts ..> N_src_logic_evidence_runtime_artifact_report_service_ts_ArtifactReportService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../rules/artifact-baseline.ts](../rules/artifact-baseline.ts)、[../rules/artifact-evidence.ts](../rules/artifact-evidence.ts)、[../../dispatch/rules/dispatch-storage.ts](../../dispatch/rules/dispatch-storage.ts)、[../../tasks/rules/dispatch-execution.ts](../../tasks/rules/dispatch-execution.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../execution/rules/types.ts](../../execution/rules/types.ts)、[../../runtime/monitoring/member-events.ts](../../runtime/monitoring/member-events.ts)。

### command-verification-service.ts

```mermaid
classDiagram
class N_src_logic_evidence_runtime_command_verification_service_ts["command-verification-service.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_command_verification_service_ts_Source["Source"] {
  <<type>>

}
N_src_logic_evidence_runtime_command_verification_service_ts ..> N_src_logic_evidence_runtime_command_verification_service_ts_Source : 声明
class N_src_logic_evidence_runtime_command_verification_service_ts_VerifiedMainCallSource["VerifiedMainCallSource"] {
  <<type>>
  +summary
  +source
  +stamp
  +raw
  +logPrefixHash
  +throughSeq
}
N_src_logic_evidence_runtime_command_verification_service_ts ..> N_src_logic_evidence_runtime_command_verification_service_ts_VerifiedMainCallSource : 声明
class N_src_logic_evidence_runtime_command_verification_service_ts_ReadLog["ReadLog"] {
  <<type>>

}
N_src_logic_evidence_runtime_command_verification_service_ts ..> N_src_logic_evidence_runtime_command_verification_service_ts_ReadLog : 声明
class N_src_logic_evidence_runtime_command_verification_service_ts_CommandVerificationPorts["CommandVerificationPorts"] {
  <<interface>>
  +inspectMain()
}
N_src_logic_evidence_runtime_command_verification_service_ts ..> N_src_logic_evidence_runtime_command_verification_service_ts_CommandVerificationPorts : 声明
```

```mermaid
classDiagram
class N_src_logic_evidence_runtime_command_verification_service_ts["command-verification-service.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_command_verification_service_ts_CommandVerificationService["CommandVerificationService"] {
  +inspectSource()
  +read()
  -owner
  -store
  -ports
  -state()
  -scope()
  -stamp()
  -log()
}
N_src_logic_evidence_runtime_command_verification_service_ts ..> N_src_logic_evidence_runtime_command_verification_service_ts_CommandVerificationService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../execution/rules/types.ts](../../execution/rules/types.ts)、[../../execution/rules/conversation-binding.ts](../../execution/rules/conversation-binding.ts)、[../../dispatch/rules/dispatch-storage.ts](../../dispatch/rules/dispatch-storage.ts)、[../../tasks/rules/dispatch-scope.ts](../../tasks/rules/dispatch-scope.ts)、[../../tasks/rules/scope-goal.ts](../../tasks/rules/scope-goal.ts)、[../../tasks/rules/command-verification.ts](../../tasks/rules/command-verification.ts)、[../../tasks/rules/command-verification-output.ts](../../tasks/rules/command-verification-output.ts)、[execution-report-facts.ts](execution-report-facts.ts)、[../../tasks/runtime/main-command-request.ts](../../tasks/runtime/main-command-request.ts)。

### effect-controlled-file.ts

```mermaid
classDiagram
class N_src_logic_evidence_runtime_effect_controlled_file_ts["effect-controlled-file.ts"] {
  <<module>>
  +observeControlledEffect()
}
```

```mermaid
classDiagram
class N_src_logic_evidence_runtime_effect_controlled_file_ts["effect-controlled-file.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_effect_controlled_file_ts_ControlledEffectReference["ControlledEffectReference"] {
  <<interface>>
  +identity
  +scopeId
  +binding
  +input
}
N_src_logic_evidence_runtime_effect_controlled_file_ts ..> N_src_logic_evidence_runtime_effect_controlled_file_ts_ControlledEffectReference : 声明
```

直接依赖：[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../../core/errors.ts](../../../core/errors.ts)、[../../file-operations/rules/controlled-file-operation.ts](../../file-operations/rules/controlled-file-operation.ts)、[../../file-operations/rules/controlled-file-rules.ts](../../file-operations/rules/controlled-file-rules.ts)。

### effect-observation-service.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_evidence_runtime_effect_observation_service_ts["effect-observation-service.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_effect_observation_service_ts_EffectObservationPorts["EffectObservationPorts"] {
  <<interface>>
  +normalizePath()
  +observeFiles()
  +acquireRead()
  +acquireMainRead()
  +observeKnowledge()
  +observePersistent()
  +observeControlled()
  +assertCurrent()
}
N_src_logic_evidence_runtime_effect_observation_service_ts ..> N_src_logic_evidence_runtime_effect_observation_service_ts_EffectObservationPorts : 声明
class N_src_logic_evidence_runtime_effect_observation_service_ts_external_EffectSourcePorts["EffectSourcePorts (外部契约)"] {
  <<external>>
}
N_src_logic_evidence_runtime_effect_observation_service_ts_external_EffectSourcePorts <|-- N_src_logic_evidence_runtime_effect_observation_service_ts_EffectObservationPorts
class N_src_logic_evidence_runtime_effect_observation_service_ts_Owner["Owner"] {
  <<type>>

}
N_src_logic_evidence_runtime_effect_observation_service_ts ..> N_src_logic_evidence_runtime_effect_observation_service_ts_Owner : 声明
class N_src_logic_evidence_runtime_effect_observation_service_ts_EffectObservationService["EffectObservationService"] {
  +observe()
  +observeFromMain()
  +list()
  +receipt()
  +record()
  +relations()
  -owner
  -store
  -commands
  -ports
  -parse()
  -output()
  -alive()
  -prepare()
  -knowledge()
  -persistent()
}
N_src_logic_evidence_runtime_effect_observation_service_ts ..> N_src_logic_evidence_runtime_effect_observation_service_ts_EffectObservationService : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_logic_evidence_runtime_effect_observation_service_ts["effect-observation-service.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_effect_observation_service_ts_EffectObservationService["EffectObservationService"] {
  -baselines()
  -recordReady()
}
N_src_logic_evidence_runtime_effect_observation_service_ts ..> N_src_logic_evidence_runtime_effect_observation_service_ts_EffectObservationService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../dispatch/rules/dispatch-storage.ts](../../dispatch/rules/dispatch-storage.ts)、[../../tasks/rules/effect-observation.ts](../../tasks/rules/effect-observation.ts)、[../../tasks/rules/effect-observation-rules.ts](../../tasks/rules/effect-observation-rules.ts)、[../../tasks/rules/command-verification.ts](../../tasks/rules/command-verification.ts)、[../rules/artifact-evidence.ts](../rules/artifact-evidence.ts)、[../rules/artifact-baseline.ts](../rules/artifact-baseline.ts)、[command-verification-service.ts](command-verification-service.ts)、[effect-source.ts](effect-source.ts)、[../../knowledge/rules/knowledge-write-observation.ts](../../knowledge/rules/knowledge-write-observation.ts)、[../../knowledge/rules/knowledge-write-input.ts](../../knowledge/rules/knowledge-write-input.ts)、[../../tasks/rules/persistent-write-observation.ts](../../tasks/rules/persistent-write-observation.ts)、[../../tasks/rules/persistent-write-input.ts](../../tasks/rules/persistent-write-input.ts)、[../../file-operations/rules/controlled-file-operation.ts](../../file-operations/rules/controlled-file-operation.ts)、[effect-controlled-file.ts](effect-controlled-file.ts)。

### effect-source.ts

```mermaid
classDiagram
class N_src_logic_evidence_runtime_effect_source_ts["effect-source.ts"] {
  <<module>>
  +effectStateStamp()
  +readEffectSource()
}
```

```mermaid
classDiagram
class N_src_logic_evidence_runtime_effect_source_ts["effect-source.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_effect_source_ts_EffectSourcePorts["EffectSourcePorts"] {
  <<interface>>
  +inspectMember()
}
N_src_logic_evidence_runtime_effect_source_ts ..> N_src_logic_evidence_runtime_effect_source_ts_EffectSourcePorts : 声明
class N_src_logic_evidence_runtime_effect_source_ts_EffectSourceRead["EffectSourceRead"] {
  <<type>>
  +source
  +summary
  +run
  +stamp
  +facts
}
N_src_logic_evidence_runtime_effect_source_ts ..> N_src_logic_evidence_runtime_effect_source_ts_EffectSourceRead : 声明
```

直接依赖：[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../execution/rules/types.ts](../../execution/rules/types.ts)、[../../dispatch/rules/dispatch-storage.ts](../../dispatch/rules/dispatch-storage.ts)、[../../tasks/rules/dispatch-execution.ts](../../tasks/rules/dispatch-execution.ts)、[../../tasks/rules/effect-observation.ts](../../tasks/rules/effect-observation.ts)、[../../tasks/rules/scope-goal.ts](../../tasks/rules/scope-goal.ts)、[../../runtime/monitoring/member-events.ts](../../runtime/monitoring/member-events.ts)、[execution-report-facts.ts](execution-report-facts.ts)、[command-verification-service.ts](command-verification-service.ts)。

### execution-report-facts.ts

```mermaid
classDiagram
class N_src_logic_evidence_runtime_execution_report_facts_ts["execution-report-facts.ts"] {
  <<module>>
  +executionToolFacts()
}
```

```mermaid
classDiagram
class N_src_logic_evidence_runtime_execution_report_facts_ts["execution-report-facts.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_execution_report_facts_ts_Item["Item"] {
  <<type>>

}
N_src_logic_evidence_runtime_execution_report_facts_ts ..> N_src_logic_evidence_runtime_execution_report_facts_ts_Item : 声明
```

直接依赖：[../../tasks/rules/execution-report.ts](../../tasks/rules/execution-report.ts)、[../../execution/rules/types.ts](../../execution/rules/types.ts)、[../../tasks/rules/dispatch-execution.ts](../../tasks/rules/dispatch-execution.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)。

### execution-report-service.ts

```mermaid
classDiagram
class N_src_logic_evidence_runtime_execution_report_service_ts["execution-report-service.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_execution_report_service_ts_ExecutionReportService["ExecutionReportService"] {
  +read()
  -owner
  -store
  -inspect
  -facts()
  -cancelledWithoutRun()
  -stamp()
  -bound()
  -matches()
}
N_src_logic_evidence_runtime_execution_report_service_ts ..> N_src_logic_evidence_runtime_execution_report_service_ts_ExecutionReportService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../tasks/rules/execution-report.ts](../../tasks/rules/execution-report.ts)、[../../dispatch/rules/dispatch-storage.ts](../../dispatch/rules/dispatch-storage.ts)、[../../tasks/rules/dispatch-execution.ts](../../tasks/rules/dispatch-execution.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../execution/rules/types.ts](../../execution/rules/types.ts)、[execution-report-facts.ts](execution-report-facts.ts)、[../../tasks/rules/queued-task-cancel.ts](../../tasks/rules/queued-task-cancel.ts)。

### human-decision-evidence.ts

```mermaid
classDiagram
class N_src_logic_evidence_runtime_human_decision_evidence_ts["human-decision-evidence.ts"] {
  <<module>>
  +consumedHumanDecision()
  +assertHumanSubject()
  +validateHumanAcceptances()
}
```

```mermaid
classDiagram
class N_src_logic_evidence_runtime_human_decision_evidence_ts["human-decision-evidence.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_human_decision_evidence_ts_HumanDecisionPorts["HumanDecisionPorts"] {
  <<interface>>
  +normalizePath()
  +checkFiles()
  +checkManifest()
  +acquireRead()
  +acquireMainRead()
  +assertCurrent()
}
N_src_logic_evidence_runtime_human_decision_evidence_ts ..> N_src_logic_evidence_runtime_human_decision_evidence_ts_HumanDecisionPorts : 声明
class N_src_logic_evidence_runtime_human_decision_evidence_ts_HumanEvidenceLogs["HumanEvidenceLogs"] {
  <<interface>>
  +inspectMember()
  +inspectMain()
}
N_src_logic_evidence_runtime_human_decision_evidence_ts ..> N_src_logic_evidence_runtime_human_decision_evidence_ts_HumanEvidenceLogs : 声明
class N_src_logic_evidence_runtime_human_decision_evidence_ts_HumanCandidateValidator["HumanCandidateValidator"] {
  <<type>>

}
N_src_logic_evidence_runtime_human_decision_evidence_ts ..> N_src_logic_evidence_runtime_human_decision_evidence_ts_HumanCandidateValidator : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../execution/rules/types.ts](../../execution/rules/types.ts)、[../../dispatch/rules/dispatch-storage.ts](../../dispatch/rules/dispatch-storage.ts)、[../../tasks/rules/dispatch-scope.ts](../../tasks/rules/dispatch-scope.ts)、[../../tasks/rules/dispatch-execution.ts](../../tasks/rules/dispatch-execution.ts)、[../../tasks/rules/graph-types.ts](../../tasks/rules/graph-types.ts)、[../../tasks/rules/human-decisions.ts](../../tasks/rules/human-decisions.ts)、[../../tasks/rules/human-continue.ts](../../tasks/rules/human-continue.ts)、[../../tasks/rules/human-continuation-rules.ts](../../tasks/rules/human-continuation-rules.ts)、[../../tasks/rules/scope-goal.ts](../../tasks/rules/scope-goal.ts)、[../rules/artifact-baseline.ts](../rules/artifact-baseline.ts)、[../rules/artifact-evidence.ts](../rules/artifact-evidence.ts)、[../../team/runtime/member-workflow.ts](../../team/runtime/member-workflow.ts)、[../rules/output-manifest.ts](../rules/output-manifest.ts)、[../rules/complete-output-evidence.ts](../rules/complete-output-evidence.ts)。

### human-evidence-state.ts

```mermaid
classDiagram
class N_src_logic_evidence_runtime_human_evidence_state_ts["human-evidence-state.ts"] {
  <<module>>
  +humanEvidenceStateStamp()
}
```

直接依赖：[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../dispatch/rules/dispatch-storage.ts](../../dispatch/rules/dispatch-storage.ts)。

### output-manifest-report-service.ts

```mermaid
classDiagram
class N_src_logic_evidence_runtime_output_manifest_report_service_ts["output-manifest-report-service.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_output_manifest_report_service_ts_OutputManifestReportPorts["OutputManifestReportPorts"] {
  <<interface>>
  +inspect()
  +check()
  +acquireRead()
}
N_src_logic_evidence_runtime_output_manifest_report_service_ts ..> N_src_logic_evidence_runtime_output_manifest_report_service_ts_OutputManifestReportPorts : 声明
class N_src_logic_evidence_runtime_output_manifest_report_service_ts_OutputManifestReportService["OutputManifestReportService"] {
  +read()
  -owner
  -store
  -ports
  -facts()
  -stamp()
}
N_src_logic_evidence_runtime_output_manifest_report_service_ts ..> N_src_logic_evidence_runtime_output_manifest_report_service_ts_OutputManifestReportService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../rules/output-manifest.ts](../rules/output-manifest.ts)、[../rules/output-manifest-evidence.ts](../rules/output-manifest-evidence.ts)、[../../tasks/rules/execution-context.ts](../../tasks/rules/execution-context.ts)、[../../workspace/rules/artifact-scope.ts](../../workspace/rules/artifact-scope.ts)、[../../dispatch/rules/dispatch-storage.ts](../../dispatch/rules/dispatch-storage.ts)、[../../tasks/rules/dispatch-execution.ts](../../tasks/rules/dispatch-execution.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../execution/rules/types.ts](../../execution/rules/types.ts)、[../../runtime/monitoring/member-events.ts](../../runtime/monitoring/member-events.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_logic_evidence_runtime_command_verification_service_ts["command-verification-service.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_execution_report_facts_ts["execution-report-facts.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_effect_observation_service_ts["effect-observation-service.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_effect_source_ts["effect-source.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_effect_controlled_file_ts["effect-controlled-file.ts"] {
  <<module>>
}
N_src_logic_evidence_runtime_command_verification_service_ts ..> N_src_logic_evidence_runtime_execution_report_facts_ts : 导入依赖
N_src_logic_evidence_runtime_effect_observation_service_ts ..> N_src_logic_evidence_runtime_command_verification_service_ts : 导入依赖
N_src_logic_evidence_runtime_effect_observation_service_ts ..> N_src_logic_evidence_runtime_effect_source_ts : 导入依赖
N_src_logic_evidence_runtime_effect_observation_service_ts ..> N_src_logic_evidence_runtime_effect_controlled_file_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_logic_evidence_runtime_effect_source_ts["effect-source.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_execution_report_facts_ts["execution-report-facts.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_command_verification_service_ts["command-verification-service.ts"] {
  <<module>>
}
class N_src_logic_evidence_runtime_execution_report_service_ts["execution-report-service.ts"] {
  <<module>>
}
N_src_logic_evidence_runtime_effect_source_ts ..> N_src_logic_evidence_runtime_execution_report_facts_ts : 导入依赖
N_src_logic_evidence_runtime_effect_source_ts ..> N_src_logic_evidence_runtime_command_verification_service_ts : 导入依赖
N_src_logic_evidence_runtime_execution_report_service_ts ..> N_src_logic_evidence_runtime_execution_report_facts_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
