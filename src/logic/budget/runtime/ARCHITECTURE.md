# src/logic/budget/runtime 架构

## 目录定位

预算应用服务：协调请求和目标预算预占/结算，通过明确存储端口保存结果；不直接访问共享派发 Store。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [model-request-budget-service.ts](model-request-budget-service.ts) | 通过专用预算端口保存每个真实主/成员请求的预留、发送意图和终态，不读取或改写其它调度领域。 |
| [scope-budget-service.ts](scope-budget-service.ts) | 在调度事务内核实周期额度，并将许可证明或拒绝事实交给同一事务保存；逐请求模式读取独立请求账本。 |
| [scope-usage-service.ts](scope-usage-service.ts) | 按指定目标周期的持久主运行清单与成员绑定，读取 canonical 日志并生成只读消耗报告。 |

## 架构类图

### model-request-budget-service.ts

```mermaid
classDiagram
class N_src_logic_budget_runtime_model_request_budget_service_ts["model-request-budget-service.ts"] {
  <<module>>
}
class N_src_logic_budget_runtime_model_request_budget_service_ts_Owner["Owner"] {
  <<type>>
  +entry
  +instanceId
  +assert()
}
N_src_logic_budget_runtime_model_request_budget_service_ts ..> N_src_logic_budget_runtime_model_request_budget_service_ts_Owner : 声明
class N_src_logic_budget_runtime_model_request_budget_service_ts_ModelRequestBudgetService["ModelRequestBudgetService"] {
  +preflight()
  +forRun()
  +report()
  -owner
  -store
  -budgets
  -stoppedScopes
  -summary()
  -assertLive()
  -ticket()
}
N_src_logic_budget_runtime_model_request_budget_service_ts ..> N_src_logic_budget_runtime_model_request_budget_service_ts_ModelRequestBudgetService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../rules/model-request-budget-storage.ts](../rules/model-request-budget-storage.ts)、[../rules/model-request-budget.ts](../rules/model-request-budget.ts)、[../rules/model-request-budget-rules.ts](../rules/model-request-budget-rules.ts)、[../../models/index.ts](../../models/index.ts)、[../rules/request-budget.ts](../rules/request-budget.ts)、[../../team/rules/workspace-member-rules.ts](../../team/rules/workspace-member-rules.ts)。

### scope-budget-service.ts

```mermaid
classDiagram
class N_src_logic_budget_runtime_scope_budget_service_ts["scope-budget-service.ts"] {
  <<module>>
  +rejectBudget()
}
```

```mermaid
classDiagram
class N_src_logic_budget_runtime_scope_budget_service_ts["scope-budget-service.ts"] {
  <<module>>
}
class N_src_logic_budget_runtime_scope_budget_service_ts_BudgetCandidate["BudgetCandidate"] {
  <<type>>
  +runId
  +kind
  +taskId
  +model
}
N_src_logic_budget_runtime_scope_budget_service_ts ..> N_src_logic_budget_runtime_scope_budget_service_ts_BudgetCandidate : 声明
class N_src_logic_budget_runtime_scope_budget_service_ts_ScopeBudgetRejected["ScopeBudgetRejected"] {
  <<type>>
  +budgetRejected
}
N_src_logic_budget_runtime_scope_budget_service_ts ..> N_src_logic_budget_runtime_scope_budget_service_ts_ScopeBudgetRejected : 声明
class N_src_logic_budget_runtime_scope_budget_service_ts_ScopeBudgetService["ScopeBudgetService"] {
  +holdMain()
  +isMainLive()
  +initialize()
  +admit()
  +preflightRequest()
  -usage
  -policy
  -liveMain
  -requestObservation()
  -legacyObservation()
}
N_src_logic_budget_runtime_scope_budget_service_ts ..> N_src_logic_budget_runtime_scope_budget_service_ts_ScopeBudgetService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../execution/rules/scope-usage.ts](../../execution/rules/scope-usage.ts)、[../rules/scope-budget.ts](../rules/scope-budget.ts)、[../../tasks/rules/dispatch-scope.ts](../../tasks/rules/dispatch-scope.ts)、[../../dispatch/rules/dispatch-storage.ts](../../dispatch/rules/dispatch-storage.ts)、[scope-usage-service.ts](scope-usage-service.ts)、[../rules/model-request-budget-rules.ts](../rules/model-request-budget-rules.ts)、[../rules/model-request-budget.ts](../rules/model-request-budget.ts)、[../rules/model-request-budget-storage.ts](../rules/model-request-budget-storage.ts)。

### scope-usage-service.ts

```mermaid
classDiagram
class N_src_logic_budget_runtime_scope_usage_service_ts["scope-usage-service.ts"] {
  <<module>>
}
class N_src_logic_budget_runtime_scope_usage_service_ts_Owner["Owner"] {
  <<type>>

}
N_src_logic_budget_runtime_scope_usage_service_ts ..> N_src_logic_budget_runtime_scope_usage_service_ts_Owner : 声明
class N_src_logic_budget_runtime_scope_usage_service_ts_Source["Source"] {
  <<type>>
  +kind
  +taskId
  +runId
  +task
  +run
  +invalid
}
N_src_logic_budget_runtime_scope_usage_service_ts ..> N_src_logic_budget_runtime_scope_usage_service_ts_Source : 声明
class N_src_logic_budget_runtime_scope_usage_service_ts_ScopeUsageService["ScopeUsageService"] {
  +collect()
  +read()
  -owner
  -store
  -logs
  -facts()
  -sources()
  -bound()
}
N_src_logic_budget_runtime_scope_usage_service_ts ..> N_src_logic_budget_runtime_scope_usage_service_ts_ScopeUsageService : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/serialization.ts](../../../core/platform/node/serialization.ts)、[../../knowledge/rules/ports.ts](../../knowledge/rules/ports.ts)、[../../execution/rules/types.ts](../../execution/rules/types.ts)、[../../execution/rules/scope-usage.ts](../../execution/rules/scope-usage.ts)、[../../dispatch/rules/dispatch-storage.ts](../../dispatch/rules/dispatch-storage.ts)、[../../tasks/rules/dispatch-execution.ts](../../tasks/rules/dispatch-execution.ts)、[../../tasks/rules/graph-types.ts](../../tasks/rules/graph-types.ts)、[../rules/scope-usage.ts](../rules/scope-usage.ts)、[../../tasks/runtime/scope-goal-service.ts](../../tasks/runtime/scope-goal-service.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_logic_budget_runtime_scope_budget_service_ts["scope-budget-service.ts"] {
  <<module>>
}
class N_src_logic_budget_runtime_scope_usage_service_ts["scope-usage-service.ts"] {
  <<module>>
}
N_src_logic_budget_runtime_scope_budget_service_ts ..> N_src_logic_budget_runtime_scope_usage_service_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
