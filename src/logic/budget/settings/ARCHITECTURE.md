# src/logic/budget/settings 架构

## 设计意图

保存作用域预算默认值；运行周期在创建时冻结，设置变化不追改活动周期。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [BudgetSettings](budget-settings.ts) | 可靠保存新目标的额度及显式逐请求模式，供调度器创建周期时冻结，缺省模式保留原软限额语义。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_89f88c1d5183["BudgetSettings"]
click N_89f88c1d5183 href "budget-settings.ts"
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
