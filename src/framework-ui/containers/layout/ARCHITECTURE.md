# 布局

## 设计意图

排列三个面板，由调用方保存宽度。

## 主要组成

ThreePaneLayout 计算可用宽度，PaneDivider 通过 panes 上下文提交拖动和键盘调整。

| Module | Role |
| --- | --- |
| [PaneDivider](PaneDivider.tsx) | PaneDivider |
| [panes](panes.ts) | panes |
| [ThreePaneLayout](ThreePaneLayout.tsx) | ThreePaneLayout |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_3746a1e48534["panes"] {
  <<module>>
}
click N_3746a1e48534 href "panes.ts"
class N_aafa3bdfa70b["PaneDivider"] {
  <<component>>
}
click N_aafa3bdfa70b href "PaneDivider.tsx"
class N_c38e7d0fb986["ThreePaneLayout"] {
  <<component>>
}
click N_c38e7d0fb986 href "ThreePaneLayout.tsx"
N_aafa3bdfa70b ..> N_3746a1e48534 : 依赖
N_c38e7d0fb986 ..> N_3746a1e48534 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
