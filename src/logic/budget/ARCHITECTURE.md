# src/logic/budget 架构

## 目录定位

模型请求额度与作用域预算规则；服务与规则分开归属，实际依赖通过明确入口验证。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

本层无直接代码文件。

## 架构类图

```mermaid
classDiagram
class N_src_logic_budget_rules["rules/"] {
  <<directory>>
}
class N_src_logic_budget_runtime["runtime/"] {
  <<directory>>
}
class N_src_logic_budget_settings["settings/"] {
  <<directory>>
}
N_src_logic_budget_runtime ..> N_src_logic_budget_rules : 导入依赖
N_src_logic_budget_settings ..> N_src_logic_budget_rules : 导入依赖
```

各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：

- `runtime` → `rules`：导入。
- `settings` → `rules`：导入。

## 子目录导航

- [rules/](rules/ARCHITECTURE.md)：预算领域：Scope 使用量、预占/结算、模型请求规则和存储端口。规则不访问应用文件与具体传输，业务服务在 scheduler-engine/budget。
- [runtime/](runtime/ARCHITECTURE.md)：预算应用服务：协调请求和目标预算预占/结算，通过明确存储端口保存结果；不直接访问共享派发 Store。
- [settings/](settings/ARCHITECTURE.md)：保存作用域预算默认值；运行周期在创建时冻结，设置变化不追改活动周期。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
