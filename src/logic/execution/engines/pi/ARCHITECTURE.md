# src/logic/execution/engines/pi 架构

<a id="contract"></a>

## 设计意图

把 Pi 运行包接入统一执行协议。引擎适配协调会话、模型和工具，RPC 对象隔离进程协议，业务权限与预算通过注入端口约束。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [PiEngine](engine.ts) | Pi 引擎适配器，负责隔离配置、原生会话校验及事件转换；成员回传、人工决定和目标返工均走可信系统输入。 |
| [PiRpc](rpc.ts) | 大脑 执行层：PiRpc：JSONL 拆包、命令关联、超时与进程结束处理。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_35364cc05e43["PiEngine"]
click N_35364cc05e43 href "engine.ts"
class N_24230b67b640["PiRpc"]
click N_24230b67b640 href "rpc.ts"
class N_649b8a6ac172["AgentEngine"] {
  <<boundary>>
}
click N_649b8a6ac172 href "../../rules/types.ts"
N_35364cc05e43 ..> N_24230b67b640 : 依赖
N_649b8a6ac172 <|.. N_35364cc05e43
```

外部继承／实现边界：[AgentEngine](../../rules/types.ts)。

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
