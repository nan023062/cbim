# src/backend/scheduler-engine 架构

## 目录定位

工作区调度。装配团队上下文与模型工具，协调会话、运行、用户问题和队列；只依赖自身及 Core。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

本层无直接代码文件。

## 架构类图

```mermaid
classDiagram
class N_src_backend_scheduler_engine_context["context/"] {
  <<directory>>
}
class N_src_backend_scheduler_engine_conversation["conversation/"] {
  <<directory>>
}
class N_src_backend_scheduler_engine_execution["execution/"] {
  <<directory>>
}
class N_src_backend_scheduler_engine_runtime["runtime/"] {
  <<directory>>
}
class N_src_backend_scheduler_engine_tools["tools/"] {
  <<directory>>
}
N_src_backend_scheduler_engine_context ..> N_src_backend_scheduler_engine_conversation : 导入依赖
N_src_backend_scheduler_engine_execution ..> N_src_backend_scheduler_engine_tools : 导入依赖
N_src_backend_scheduler_engine_execution ..> N_src_backend_scheduler_engine_context : 导入依赖
N_src_backend_scheduler_engine_execution ..> N_src_backend_scheduler_engine_conversation : 导入依赖
N_src_backend_scheduler_engine_runtime ..> N_src_backend_scheduler_engine_execution : 导入依赖
N_src_backend_scheduler_engine_tools ..> N_src_backend_scheduler_engine_context : 导入依赖
```

各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：

- `context` → `conversation`：导入。
- `execution` → `tools`：导入。
- `execution` → `context`：导入。
- `execution` → `conversation`：导入。
- `runtime` → `execution`：导入。
- `tools` → `context`：导入。

## 子目录导航

- [context/](context/ARCHITECTURE.md)：内置主角色诊断和治理知识，执行者冻结角色/Skill、模块/维护关系、Workflow 与规范。前置替换重验待办并保留原实例；配置过期不能借重新准备刷新旧任务，主角色仍不执行业务。
- [conversation/](conversation/ARCHITECTURE.md)：主 Agent 的规划、审阅与团队管理指引，以及提问、审批和队列。主调度可安排求助补做，再显式替换未启动前置或撤销待办；旧失败不改写，普通消息不替代人工决定或恢复。
- [execution/](execution/ARCHITECTURE.md)：主实例与图根共享身份。文件报告核实 canonical 基线，显式选定才观察文件，查询不执行或修复。主调度换边核实候选与未启动闭包；停止/重开不自动续接，软限额在登记/领取时核实。
- [runtime/](runtime/ARCHITECTURE.md)：监管、履历与全局并发准入职责分离。监管消费真实用量；准入同步协调名额和本地租约，稳定票据 FIFO 等待，降额不逐出活动运行；履历不签发执行权。进程票据不从历史恢复模型。
- [tools/](tools/ARCHITECTURE.md)：把知识 CRUD、目标计划/审阅和主调度命令注册为 cbim_ 工具。未启动撤销/前置替换仅真实端口可用时公开，严格拒绝模型夹带身份；维护回执不算业务证据，执行者不获得调度权。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
