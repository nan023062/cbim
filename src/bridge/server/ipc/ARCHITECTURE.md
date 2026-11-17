# src/bridge/server/ipc 架构

<a id="contract"></a>

## 设计意图

将已接入的桌面操作解析并分派到对应业务服务，保持传输路由与领域决策分离。

`request` 先校验 action、输入及退出阶段的受理条件，`dispatch` 组合各领域处理器，`services` 描述处理器所需能力。处理器取得具体工作区和服务后委托调用，不缓存另一份业务状态；旧 `loop.start` 入口明确拒绝，不能绕过当前负责人派发。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [dispatch](dispatch.ts) | 将经过主进程接入的 action 路由到明确的工作区和应用服务；主 Agent 两处设置入口共用同一配置服务。 |
| [request](request.ts) | 主进程 IPC 的运行时请求解析与受理前拒绝；源浏览在退出期间停止接单且畸形参数返回可读提示，保留旧队列插入的失效运行错误码。 |
| [services](services.ts) | 定义 IPC 路由需要的执行审批、静态角色履历、岗位与模块责任、全局监管、配额、桌面资源导入、模块治理和工作区生命周期入口。 |
| [chat-handlers](chat-handlers.ts) | 把对话、输入和队列操作委托当前工作区的会话服务。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_d5a6e7c2069b["dispatch"] {
  <<module>>
}
click N_d5a6e7c2069b href "dispatch.ts"
class N_0d537f00c314["request"] {
  <<module>>
}
click N_0d537f00c314 href "request.ts"
class N_05abcf994192["services"] {
  <<module>>
}
click N_05abcf994192 href "services.ts"
class N_064fb5fa2b9b["chat-handlers"] {
  <<module>>
}
click N_064fb5fa2b9b href "chat-handlers.ts"
N_d5a6e7c2069b ..> N_0d537f00c314 : 依赖
N_d5a6e7c2069b ..> N_05abcf994192 : 依赖
N_d5a6e7c2069b ..> N_064fb5fa2b9b : 依赖
N_064fb5fa2b9b ..> N_05abcf994192 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
