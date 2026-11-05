# Task：单一任务

本说明面向人，帮助了解任务目录；Agent 按需读取专用规范。Task 将一个AI 成员、由它维护的模块集合和一个验收目标组合起来。CBIM AI 助理组织任务，执行者使用宿主默认 loop。

- [构建与维护规范](task-spec.md)：字段语义、维护依据、合并拆分及恢复要求。
- [BaseTask 与执行接口](base-task.md)：结构图、execute(task) 输入输出。
- [Task Loop](task-loop.md)：CBIM AI 助理的任务构建与结果反馈。
- [知识基线与恢复](task-baseline.md)：版本绑定与恢复证据。

本目录保存抽象，具体任务由宿主或本地任务记录承载。
