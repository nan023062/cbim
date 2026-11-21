# src/logic/team 架构

<a id="contract"></a>

## 设计意图

保存引擎调用所需的成员快照、自动执行与工具名称规则。当前组织目录与 Agent 设置由 projects 管理，不运行旧成员服务。

## 主要组成

本层只划分子模块；规则与运行边界沿下方子模块阅读。

<!-- architecture:generated:start -->

## 架构关系

标注为 `virtual` 的节点是直接子模块的虚拟类封装；内部设计沿下方入口阅读。

```mermaid
classDiagram
class N_9b6f782505bc["rules"] {
  <<virtual>>
}
click N_9b6f782505bc href "rules/ARCHITECTURE.md"
```

## 子模块

| 虚拟封装 | 整体职责 |
| --- | --- |
| [rules](rules/ARCHITECTURE.md) | 保存引擎调用所需的成员快照、自动执行与工具名称规则。当前组织目录与 Agent 设置由 projects 管理，不运行旧成员服务。 |

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
