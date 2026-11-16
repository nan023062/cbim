# src/logic/automation/rules 架构

<a id="contract"></a>

## 设计意图

自动化定义、运行与执行/存储端口及纯时区日程计算，不依赖调度和桌面实现。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [contracts](contracts.ts) | 工作区自动化的定义、计划、持久启动记录及端口契约。 |
| [schedule](schedule.ts) | 计算下一个自动化触发时刻，不触发执行或读写时钟。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_11f9e1d4d89b["contracts"] {
  <<module>>
}
click N_11f9e1d4d89b href "contracts.ts"
class N_22d59f303adf["schedule"] {
  <<module>>
}
click N_22d59f303adf href "schedule.ts"
N_22d59f303adf ..> N_11f9e1d4d89b : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
