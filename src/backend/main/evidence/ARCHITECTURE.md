# src/backend/main/evidence 架构

## 目录定位

真实工程效果读取适配：在明确范围和版本下采集观察供证据服务使用。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [knowledge-effect-reader.ts](knowledge-effect-reader.ts) | 在已打开工作区内只读核实原知识工具请求和事务，向调度影响观察提供有界摘要。 |
| [persistent-effect-reader.ts](persistent-effect-reader.ts) | 只读原治理命令与责任审计，向影响观察投影有界的“原记录已保存”证据。 |

## 架构类图

### knowledge-effect-reader.ts

```mermaid
classDiagram
class N_src_backend_main_evidence_knowledge_effect_reader_ts["knowledge-effect-reader.ts"] {
  <<module>>
  +observeKnowledgeTransaction()
}
```

```mermaid
classDiagram
class N_src_backend_main_evidence_knowledge_effect_reader_ts["knowledge-effect-reader.ts"] {
  <<module>>
}
class N_src_backend_main_evidence_knowledge_effect_reader_ts_KnowledgeEffectOwner["KnowledgeEffectOwner"] {
  <<interface>>
  +entry
  +paths
  +assert()
  +governed()
}
N_src_backend_main_evidence_knowledge_effect_reader_ts ..> N_src_backend_main_evidence_knowledge_effect_reader_ts_KnowledgeEffectOwner : 声明
```

直接依赖：[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/foundation/paths.ts](../../core/foundation/paths.ts)、[../../core/knowledge/types.ts](../../core/knowledge/types.ts)、[../../core/knowledge/knowledge-write-observation.ts](../../core/knowledge/knowledge-write-observation.ts)、[../../core/knowledge/knowledge-write-input.ts](../../core/knowledge/knowledge-write-input.ts)、[../knowledge/governance-port.ts](../knowledge/governance-port.ts)、[../knowledge/planned-commit.ts](../knowledge/planned-commit.ts)。

### persistent-effect-reader.ts

```mermaid
classDiagram
class N_src_backend_main_evidence_persistent_effect_reader_ts["persistent-effect-reader.ts"] {
  <<module>>
  +observePersistentWrite()
}
```

```mermaid
classDiagram
class N_src_backend_main_evidence_persistent_effect_reader_ts["persistent-effect-reader.ts"] {
  <<module>>
}
class N_src_backend_main_evidence_persistent_effect_reader_ts_PersistentEffectOwner["PersistentEffectOwner"] {
  <<interface>>
  +entry
  +assert()
  +dispatchStore
  +governance
  +governed()
}
N_src_backend_main_evidence_persistent_effect_reader_ts ..> N_src_backend_main_evidence_persistent_effect_reader_ts_PersistentEffectOwner : 声明
```

直接依赖：[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/tasks/persistent-write-observation.ts](../../core/tasks/persistent-write-observation.ts)、[../../core/tasks/persistent-write-input.ts](../../core/tasks/persistent-write-input.ts)、[../../core/governance/module-governance.ts](../../core/governance/module-governance.ts)、[../../core/workspace/module-ownership.ts](../../core/workspace/module-ownership.ts)、[../../core/workspace/module-ownership-rules.ts](../../core/workspace/module-ownership-rules.ts)、[../../core/dispatch/dispatch-storage.ts](../../core/dispatch/dispatch-storage.ts)、[../governance/storage/module-governance-store.ts](../governance/storage/module-governance-store.ts)。


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
