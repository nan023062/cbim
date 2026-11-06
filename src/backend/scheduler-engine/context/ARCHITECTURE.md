# src/backend/scheduler-engine/context 架构

## 目录定位

准备并冻结明确选择的 Agent、模块、Skill 和 Workflow。直接调用领域查询，不经模型工具协议。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [team-workflow.ts](team-workflow.ts) | 调度引擎：将明确选择的模块、叶子 Agent 和本模块 Workflow 装配为执行任务。 |

## 架构类图

### team-workflow.ts

```mermaid
classDiagram
class N_src_backend_scheduler_engine_context_team_workflow_ts["team-workflow.ts"] {
  <<module>>
}
class N_src_backend_scheduler_engine_context_team_workflow_ts_TeamTaskInput["TeamTaskInput"] {
  <<type>>

}
N_src_backend_scheduler_engine_context_team_workflow_ts ..> N_src_backend_scheduler_engine_context_team_workflow_ts_TeamTaskInput : 声明
```

直接依赖：[../../core/knowledge/knowledge-queries.ts](../../core/knowledge/knowledge-queries.ts)、[../../core/knowledge/builtins.ts](../../core/knowledge/builtins.ts)、[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../../core/brain/index.ts](../../core/brain/index.ts)。


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
