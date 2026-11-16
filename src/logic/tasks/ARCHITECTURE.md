# src/logic/tasks 架构

## 设计意图

封装任务依赖、目标周期与人工处置的业务语义。规则描述可接受的状态变化，运行服务协调续执行、恢复与重规划，派发存储通过契约协作。

## 主要组成

本层由下列子模块组合，每个子模块作为独立的虚拟类封装参与本层协作。

<!-- architecture:generated:start -->

## 架构关系

标注为 `virtual` 的节点是直接子模块的虚拟类封装；内部设计沿下方入口阅读。

```mermaid
classDiagram
class N_f6b0dbd6483a["rules"] {
  <<virtual>>
}
click N_f6b0dbd6483a href "rules/ARCHITECTURE.md"
class N_10d1c2fa0514["runtime"] {
  <<virtual>>
}
click N_10d1c2fa0514 href "runtime/ARCHITECTURE.md"
N_10d1c2fa0514 ..> N_f6b0dbd6483a : 依赖
```

## 子模块

| 虚拟封装 | 整体职责 |
| --- | --- |
| [rules](rules/ARCHITECTURE.md) | 定义任务图、目标、等待与人工决定的纯规则。按业务事实和状态变化组织协议，工具类将检查点与求助接到可信端口；不直接启动运行或修改文件。 |
| [runtime](runtime/ARCHITECTURE.md) | 围绕目标周期协调补充、依赖调整、人工决定、续执行与恢复。服务按命令责任分开，通过派发、证据和执行端口协作；ScopeGoalService 仍承担跨域目标编排。 |

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
