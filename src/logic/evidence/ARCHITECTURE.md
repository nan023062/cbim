# src/logic/evidence 架构

<a id="contract"></a>

## 设计意图

保存引擎事件与产物证明的序列化协议及确定性核验。回执与模型描述不能替代真实采集，也不代表 Office 业务验收通过。

## 主要组成

本层只划分子模块；规则与运行边界沿下方子模块阅读。

<!-- architecture:generated:start -->

## 架构关系

标注为 `virtual` 的节点是直接子模块的虚拟类封装；内部设计沿下方入口阅读。

```mermaid
classDiagram
class N_07e0b37c6427["rules"] {
  <<virtual>>
}
click N_07e0b37c6427 href "rules/ARCHITECTURE.md"
```

## 子模块

| 虚拟封装 | 整体职责 |
| --- | --- |
| [rules](rules/ARCHITECTURE.md) | 保存引擎事件与产物证明的序列化协议及确定性核验。回执与模型描述不能替代真实采集，也不代表 Office 业务验收通过。 |

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
