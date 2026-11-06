# src/frontend/team 架构

## 目录定位

当前工作区团队架构及能力详情展示。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [TeamView.tsx](TeamView.tsx) | 根据知识快照展示团队层级、Agent 及有效 Skill。 |

## 架构类图

### TeamView.tsx

```mermaid
classDiagram
class N_src_frontend_team_TeamView_tsx["TeamView.tsx"] {
  <<component>>
  +TeamView()
}
```
直接依赖：[../../bridge/contracts/workspace.ts](../../bridge/contracts/workspace.ts)、[../components/Icon.tsx](../components/Icon.tsx)、[../components/Empty.tsx](../components/Empty.tsx)。


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
