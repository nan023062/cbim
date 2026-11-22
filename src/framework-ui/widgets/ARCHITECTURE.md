# 基础控件

## 设计意图

封装原生交互和展示，调用方提供数据与动作。

## 主要组成

Button、Toggle、StateButton 与 ListItem 共用按钮语义；ViewList 提供虚拟列表，Tooltip 展示提示。

| Module | Role |
| --- | --- |
| [Button](Button.tsx) | Button |
| [ListItem](ListItem.tsx) | ListItem |
| [StateButton](StateButton.tsx) | StateButton |
| [Toggle](Toggle.tsx) | Toggle |
| [Tooltip](Tooltip.tsx) | Tooltip |
| [ViewList](ViewList.tsx) | ViewList |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_72401930af6e["Button"] {
  <<component>>
}
click N_72401930af6e href "Button.tsx"
class N_95f561daa8f0["ListItem"] {
  <<component>>
}
click N_95f561daa8f0 href "ListItem.tsx"
class N_dbf558f355d5["StateButton"] {
  <<component>>
}
click N_dbf558f355d5 href "StateButton.tsx"
class N_cfbbe42d9877["Toggle"] {
  <<component>>
}
click N_cfbbe42d9877 href "Toggle.tsx"
class N_d271d8227088["Tooltip"] {
  <<component>>
}
click N_d271d8227088 href "Tooltip.tsx"
class N_d2f30baea027["ViewList"] {
  <<component>>
}
click N_d2f30baea027 href "ViewList.tsx"
N_95f561daa8f0 ..> N_72401930af6e : 依赖
N_dbf558f355d5 ..> N_72401930af6e : 依赖
N_cfbbe42d9877 ..> N_72401930af6e : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
