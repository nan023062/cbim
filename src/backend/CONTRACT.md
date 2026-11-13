# 后端模块与源码导航

本图描述源码依赖；箭头从使用方指向被使用方。目录是定位入口，只有明确的职责、公开契约和依赖限制才构成模块边界。`runtime/`、`capabilities/` 等子目录是所属模块内部的职责分区，不据此宣称已经独立解耦。

```mermaid
flowchart TB
  Main[main · 应用与平台装配] --> Scheduler[src/logic · 业务编排]
  Main --> Core[src/logic · 领域规则与执行契约]
  Main --> Updater[updater · 独立更新]
  Main --> Foundations[src/core · 独立技术机制]
  Core --> Foundations
  Main --> Shared[src/core shared utilities]
  Core --> Shared
  Engines --> Shared
  Scheduler --> Shared
  Updater --> Shared
  Scheduler --> Core
  Assembly[logic/assembly · 引擎装配] --> Engines[src/logic/execution/engines · 具体引擎适配]
  Assembly --> Core
  Engines --> Core
```

`Assembly` 是 `Scheduler` 的内部目录。普通编排目录和 Main 不直接引用具体引擎，Main 通过调度装配接入运行能力。Main 和 Updater 还消费 `bridge/contracts`；Bridge 只公开 Core 的契约/纯函数，前端不直接引用后端。

Updater 对共享 Core 的依赖限于 utility 通用公开入口，用于已获准响应的有界字节消费；更新源、GET/跳转、期限、签名和安装状态仍由更新子系统决定，不引入 Main 凭据或服务，也不能使用旧 files/web。

Engines 同样只消费 utility 通用入口：Pi/Codex 组合 LF 拆帧，Codex 组合在途集合。协议、授权、超时、取消与真实进程退出仍由适配器拥有；不能借此依赖其他基础方案或应用服务。

共享 src/core 的 utility、文件、网页、错误与 JSON 适配已经独立。旧 backend/core 已迁至 src/logic 各业务规则与端口；本目录暂留宿主服务和更新启动；编排与引擎已迁入 Logic，各域保留原状态和失败语义。

## 按职责定位

| 修改对象 | 规则／契约 | 编排 | 本机实现 |
| --- | --- | --- | --- |
| 模型执行 | [执行规则](../logic/execution/rules/ARCHITECTURE.md)、[预算规则](../logic/budget/rules/ARCHITECTURE.md) | [assembly](../logic/execution/assembly/ARCHITECTURE.md)、[conversation](../logic/conversation/runtime/ARCHITECTURE.md)、[members](../logic/team/runtime/ARCHITECTURE.md) | [engines](../logic/execution/engines/ARCHITECTURE.md)、[run-storage](main/run-storage/ARCHITECTURE.md) |
| 任务与目标 | [tasks](../logic/tasks/rules/ARCHITECTURE.md)、[dispatch](../logic/dispatch/rules/ARCHITECTURE.md) | [dispatch](../logic/dispatch/runtime/ARCHITECTURE.md)、[goals](../logic/tasks/runtime/ARCHITECTURE.md) | [dispatch-storage](main/dispatch-storage/ARCHITECTURE.md) |
| 证据与预算 | [evidence](../logic/evidence/rules/ARCHITECTURE.md)、[budget](../logic/budget/rules/ARCHITECTURE.md) | [evidence](../logic/evidence/runtime/ARCHITECTURE.md)、[budget](../logic/budget/runtime/ARCHITECTURE.md) | [evidence](main/evidence/ARCHITECTURE.md)、[预算存储适配](main/dispatch-storage/request-budget-store.ts) |
| 知识与岗位 | [knowledge](../logic/knowledge/rules/ARCHITECTURE.md)、[team](../logic/team/rules/ARCHITECTURE.md)、[workspace](../logic/workspace/rules/ARCHITECTURE.md) | [context](../logic/execution/context/ARCHITECTURE.md) | [knowledge](main/knowledge/ARCHITECTURE.md)、[registry](main/registry/ARCHITECTURE.md) |
| 文件与隔离执行 | [file-operations](../logic/file-operations/rules/ARCHITECTURE.md) | 由成员能力与应用服务调用 | [file-operations](main/file-operations/ARCHITECTURE.md)、[platform/files](main/platform/files/ARCHITECTURE.md)、[platform/isolation](main/platform/isolation/ARCHITECTURE.md) |
| 履历与资料 | [team 履历契约](../logic/team/rules/ARCHITECTURE.md) | [history](../logic/history/runtime/ARCHITECTURE.md) | [history](main/history/ARCHITECTURE.md)、[materials](main/materials/ARCHITECTURE.md) |

状态归属没有因目录迁移变化：派发事务仍由 FileDispatchStore 原子提交，运行日志仍由 RunStorage 管理，知识写入仍经原文件事务和端口。运行数据位置、IPC 名称与打包输出名保留兼容。

## 维护与限制

先读修改对象的契约和规则，再沿编排读到实际存储或平台副作用。新增引擎主要进入 `engines/<engine>` 与 `logic/assembly/loop-engine.ts`；公共引擎契约确需改变时，仍须明确消费者与兼容影响，不能声称增加引擎绝不修改核心。

Logic 规则已禁止依赖具体引擎。LoopRuntime、loop-engine、ScopeGoalService 的依赖密度和共享 DispatchStore 的宽接口仍在；当前聚合目录不等于已完成这些职责拆分。没有足够变更历史证明稳定性的模块仍作为稳定候选，不能以文件位置证明稳定。

源码与依赖图由现有检查器提取；未来 review 先看 Git diff 和受影响模块，再按需要扩大阅读。目录定位与设计理由在契约/生成器中维护，不在每次 review 重新生成全仓源码快照。
