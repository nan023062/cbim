# src/logic/execution/storage 架构

<a id="contract"></a>

## 设计意图

保存运行的可靠事件、摘要和业务关联，为实时执行与重启读取提供同一事实来源。

`RunJournal` 顺序追加并同步事件，`FileRunStorage` 将目录与日志组合成运行存储端口，`AgentBusinessRuns` 将递归启动意图和排空事实接入工作区事务。日志存在、登记受理与真正完成是不同阶段，读取不能补造缺失成功或恢复许可。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [AgentBusinessRuns](business-runs.ts) | 将递归业务的启动意图和实际排空提交到已有工作区事务日志。 |
| [RunJournal](run-journal.ts) | 本机事件日志顺序追加并 fsync，按真实可选的原生路径重建摘要和未确认工具。 |
| [FileRunStorage](run-storage.ts) | 将本机运行目录和 RunJournal 装配为大脑及调度共享的存储端口。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_d3a95e7d48a8["FileRunStorage"]
click N_d3a95e7d48a8 href "run-storage.ts"
class N_066774d3d245["RunJournal"]
click N_066774d3d245 href "run-journal.ts"
class N_4e95cf7ee4b2["RunStorage"] {
  <<boundary>>
}
click N_4e95cf7ee4b2 href "../rules/storage.ts"
class N_abf36ef91600["AgentBusinessRuns"]
click N_abf36ef91600 href "business-runs.ts"
N_d3a95e7d48a8 ..> N_066774d3d245 : 依赖
N_4e95cf7ee4b2 <|.. N_d3a95e7d48a8
```

外部继承／实现边界：[RunStorage](../rules/storage.ts)。

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
