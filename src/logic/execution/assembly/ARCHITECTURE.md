# src/logic/execution/assembly 架构

<a id="contract"></a>

## 设计意图

执行域的具体装配点：把 Agent 调用、运行循环、引擎适配和工具能力连接起来。调度器协调父子调用，装配函数选择真实实现；规则层不反向认识这些选择。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [AgentCallScheduler](agent-call-scheduler.ts) | execution 内的递归调用协调，拥有父子关联、深度限制、业务结果核验、用户意见的两阶段保存、反馈与后代取消。 |
| [loop-engine](loop-engine.ts) | 将工作区知识、权限和工具注入 LoopRuntime；业务 Agent 同时取得冻结 Workflow 指引及产物验证能力，主 Agent 的人工评审沿原工具门禁。 |
| [engine-package-loader](engine-package-loader.ts) | 从冷宿主已验证的不可变包路径加载统一引擎工厂。 |
| [engine-adapters](engine-adapters.ts) | 当前源码/旧包的官方适配器装配表，所有实现均通过同一版本协议取得工厂。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_4d977a120960["engine-adapters"] {
  <<module>>
}
click N_4d977a120960 href "engine-adapters.ts"
class N_f02cc0daa5c9["loop-engine"] {
  <<module>>
}
click N_f02cc0daa5c9 href "loop-engine.ts"
class N_722ebd7665c8["engine-package-loader"] {
  <<module>>
}
click N_722ebd7665c8 href "engine-package-loader.ts"
class N_4ef4a90a9387["AgentCallScheduler"]
click N_4ef4a90a9387 href "agent-call-scheduler.ts"
N_f02cc0daa5c9 ..> N_722ebd7665c8 : 依赖
N_f02cc0daa5c9 ..> N_4d977a120960 : 依赖
N_722ebd7665c8 ..> N_4d977a120960 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
