# src/frontend/automation 架构

## 目录定位

工作区内部自动化展示；定时触发尚未实现。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [AutomationView.tsx](AutomationView.tsx) | 当前工作区的 Workflow 定义浏览。 |

## 架构类图

### AutomationView.tsx

```mermaid
classDiagram
class N_src_frontend_automation_AutomationView_tsx["AutomationView.tsx"] {
  <<component>>
  +AutomationView()
}
```
直接依赖：[../../bridge/contracts/workspace.ts](../../bridge/contracts/workspace.ts)。


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
