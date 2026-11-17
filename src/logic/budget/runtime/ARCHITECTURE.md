# src/logic/budget/runtime 架构

<a id="contract"></a>

## 设计意图

协调周期准入、逐请求预留与结算，并提供有真实日志依据的消耗查询。

`ScopeBudgetService` 在调度事务内核实周期额度，`ModelRequestBudgetService` 通过专用端口维护请求阶段，`ScopeUsageService` 只读汇总登记过的运行。账本事务与网络 I/O 分开；报告缺失不折算为零，查询服务不具备派发或补写历史的权限。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ModelRequestBudgetService](model-request-budget-service.ts) | 通过专用预算端口保存每个真实主/成员请求的预留、发送意图和终态，不读取或改写其它调度领域。 |
| [ScopeBudgetService](scope-budget-service.ts) | 在调度事务内核实周期额度，并将许可证明或拒绝事实交给同一事务保存；逐请求模式读取独立请求账本。 |
| [ScopeUsageService](scope-usage-service.ts) | 按持久主运行清单、旧成员绑定与新递归父工具关系，读取 canonical 日志并生成只读消耗报告。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_e26175468e25["ScopeBudgetService"]
click N_e26175468e25 href "scope-budget-service.ts"
class N_8402036636f9["ScopeUsageService"]
click N_8402036636f9 href "scope-usage-service.ts"
class N_24787696b186["ModelRequestBudgetService"]
click N_24787696b186 href "model-request-budget-service.ts"
N_e26175468e25 ..> N_8402036636f9 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
