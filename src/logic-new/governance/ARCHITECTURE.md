# src/logic-new/governance 架构

<a id="contract"></a>

## 设计意图

保存引擎工具所需的治理声明与纯规则。组织架构的实时修改和通知由 projects 模块负责，旧治理服务不再保留。

## 主要组成

本层只划分子模块；规则与运行边界沿下方子模块阅读。

<!-- architecture:generated:start -->

## 架构关系

标注为 `virtual` 的节点是直接子模块的虚拟类封装；内部设计沿下方入口阅读。

```mermaid
classDiagram
class N_57a460e2b1cb["rules"] {
  <<virtual>>
}
click N_57a460e2b1cb href "rules/ARCHITECTURE.md"
```

## 子模块

| 虚拟封装 | 整体职责 |
| --- | --- |
| [rules](rules/ARCHITECTURE.md) | 保存引擎工具所需的治理声明与纯规则。组织架构的实时修改和通知由 projects 模块负责，旧治理服务不再保留。 |

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
