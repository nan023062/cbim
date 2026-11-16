# src/logic/budget/settings 架构

本目录只维护这一份说明。设计与契约直接编辑本文；文件清单、类图和导航由 [架构脚本](../../../../scripts/source-architecture.mjs) 更新，生成区域之外的人工说明会保留。

## 封装意图

保存作用域预算默认值；运行周期在创建时冻结，设置变化不追改活动周期。

## 类与模块的设计意图

下表依据源码声明及文件头说明定位封装。字段表示该实例持有的状态或协作引用，不表示它拥有被引用服务的生命周期；实际资源责任和调用限制见下文契约及源码注释。

| 类／模块 | 实现形式与实例字段 | 封装依据 |
| --- | --- | --- |
| [BudgetSettings](budget-settings.ts) | 实例类；持有 `policy`、`queue`、`filename`、`storage` | 应用只装配一份；read 返回副本，不允许调用方修改已保存策略或已有目标的冻结副本。 |

## 接口设计契约

- [budget-settings.ts](budget-settings.ts)：可靠保存新目标的额度及显式逐请求模式，供调度器创建周期时冻结，缺省模式保留原软限额语义。

## 开闭边界

本目录的职责及允许协作由[封装意图](#封装意图)限定，输入输出、状态与失败语义以[接口设计契约](#接口设计契约)为准。扩展从已有公开入口及实际装配位置进入；没有明确可替换契约的部分按真实影响修改和验证，不预建未使用的基类或插件入口。

<!-- architecture:generated:start -->

## 文件清单

| 文件 | 形式 | 当前职责 |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 说明文档 | 本目录的文件清单、真实声明、依赖与子封装导航。 |
| [budget-settings.ts](budget-settings.ts) | 源码模块 | 可靠保存新目标的额度及显式逐请求模式，供调度器创建周期时冻结，缺省模式保留原软限额语义。 |

## 架构类图

成员标记：`+` 公开、`-` 私有、`#` 受保护、`$` 静态；构造函数单独列出。文档和资源仅在文件清单中导航，不作为代码节点。

### budget-settings.ts

```mermaid
classDiagram
class N_src_logic_budget_settings_budget_settings_ts["budget-settings.ts"] {
  <<module>>
}
class N_src_logic_budget_settings_budget_settings_ts_BudgetSettingsStorage["BudgetSettingsStorage"] {
  <<interface>>
  +Read()
  +Write()
}
N_src_logic_budget_settings_budget_settings_ts ..> N_src_logic_budget_settings_budget_settings_ts_BudgetSettingsStorage : 声明
class N_src_logic_budget_settings_budget_settings_ts_BudgetSettings["BudgetSettings"] {
  +constructor()
  +Init()
  +Read()
  +Configure()
  -filename
  -storage
  -policy
  -queue
  -Serial()
}
N_src_logic_budget_settings_budget_settings_ts ..> N_src_logic_budget_settings_budget_settings_ts_BudgetSettings : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../../core/platform/node/files/index.ts](../../../core/platform/node/files/index.ts)、[../../../core/utility/index.ts](../../../core/utility/index.ts)、[../rules/scope-budget.ts](../rules/scope-budget.ts)。


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

<!-- architecture:generated:end -->
