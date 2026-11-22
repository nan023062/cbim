# 基础控件

## 设计意图

封装原生交互和展示，调用方提供数据与动作。

## 主要组成

Button、Toggle、StateButton 与 ListItem 共用按钮语义；ViewList 提供虚拟列表，Tooltip 展示提示。

| Module | Role |
| --- | --- |
| [IconButton](IconButton.tsx) | 带操作名称、焦点和禁用提示的工具栏按钮。 |
| [Button](Button.tsx) | Button |
| [ListItem](ListItem.tsx) | ListItem |
| [StateButton](StateButton.tsx) | StateButton |
| [Toggle](Toggle.tsx) | Toggle |
| [Tooltip](Tooltip.tsx) | Tooltip |
| [ViewList](ViewList.tsx) | ViewList |
| [Fields](Fields.tsx) | 原生表单、输入、选项、进度和折叠控件；页面提供值与回调。 |

<!-- architecture:generated:start -->

## 架构关系

### 关系组 1：Button

```mermaid
classDiagram
class N_72401930af6e["Button"] {
  <<component>>
}
click N_72401930af6e href "Button.tsx"
class N_f3253f5d5aee["IconButton"] {
  <<component>>
}
click N_f3253f5d5aee href "IconButton.tsx"
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
N_f3253f5d5aee ..> N_72401930af6e : 依赖
N_f3253f5d5aee ..> N_d271d8227088 : 依赖
N_95f561daa8f0 ..> N_72401930af6e : 依赖
N_dbf558f355d5 ..> N_f3253f5d5aee : 依赖
N_dbf558f355d5 ..> N_72401930af6e : 依赖
N_cfbbe42d9877 ..> N_72401930af6e : 依赖
```

### 关系组 2：Fields

```mermaid
classDiagram
class N_f5e9570bf7f4["Fields"] {
  <<component>>
}
click N_f5e9570bf7f4 href "Fields.tsx"
class N_d2f30baea027["ViewList"] {
  <<component>>
}
click N_d2f30baea027 href "ViewList.tsx"
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
