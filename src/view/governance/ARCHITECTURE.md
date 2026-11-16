# src/view/governance 架构

<a id="contract"></a>

## 设计意图

把模块知识治理组织为可审阅的界面。面板组合来源、差异和反馈展示，人工决定与正式实施分别操作，命令未知时核对原回执。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ModuleGovernancePanel](ModuleGovernancePanel.tsx) | 业务架构节点的模块知识治理面板，展示真实观察、精确提案与反馈来源、独立人工决定及实施结果。 |
| [GovernanceFeedback](GovernanceFeedback.tsx) | 展示治理意见与修订方案的精确关系，提供本机显式补证、异议和回应评价表单。 |
| [GovernanceOrigin](GovernanceOrigin.tsx) | 治理历史中呈现观察和提案的可信来源，区分本机明确提交、主 Agent 运行与未记录来源的旧数据。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_3deff9b7e3d4["ModuleGovernancePanel"] {
  <<component>>
}
click N_3deff9b7e3d4 href "ModuleGovernancePanel.tsx"
class N_676dfc7a4661["GovernanceFeedback"] {
  <<component>>
}
click N_676dfc7a4661 href "GovernanceFeedback.tsx"
class N_9217c06c7798["GovernanceOrigin"] {
  <<component>>
}
click N_9217c06c7798 href "GovernanceOrigin.tsx"
N_3deff9b7e3d4 ..> N_676dfc7a4661 : 依赖
N_3deff9b7e3d4 ..> N_9217c06c7798 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
