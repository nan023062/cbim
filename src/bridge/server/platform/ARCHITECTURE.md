# src/bridge/server/platform 架构

## 设计意图

Electron utility 文件传输和子进程入口；处理可信私有协议，业务文件规则与 Win32 实现归 Logic。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [UtilityControlledFiles](controlled-file-transport.ts) | 管理文件工人的活动会话与关闭过程，将平台传输提供给业务文件服务。 |
| [UtilityFileSession](controlled-file-transport.ts) | 封装单个真实子进程的消息关联、唯一 apply 与退出等待。 |
| [controlled-file-child](controlled-file-child.ts) | 独立 Electron utility 文件工人入口，只接收固定私有消息，不启动 Application 或模型。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_3fe3ea2fbc3b["UtilityFileSession"]
click N_3fe3ea2fbc3b href "controlled-file-transport.ts"
class N_b36c5ff7b288["UtilityControlledFiles"]
click N_b36c5ff7b288 href "controlled-file-transport.ts"
class N_2e7db51b08ec["ExclusiveControlledFile"] {
  <<boundary>>
}
click N_2e7db51b08ec href "../../../logic/file-operations/platform/files/controlled-file-protocol.ts"
class N_abab7c04cc45["ExclusiveControlledTransition"] {
  <<boundary>>
}
click N_abab7c04cc45 href "../../../logic/file-operations/platform/files/controlled-file-protocol.ts"
class N_c26bee20225b["ControlledFileTransport"] {
  <<boundary>>
}
click N_c26bee20225b href "../../../logic/file-operations/platform/files/controlled-file-protocol.ts"
class N_adf0246a3eb1["controlled-file-child"] {
  <<module>>
}
click N_adf0246a3eb1 href "controlled-file-child.ts"
N_b36c5ff7b288 ..> N_3fe3ea2fbc3b : 依赖
N_c26bee20225b <|.. N_b36c5ff7b288
N_2e7db51b08ec <|.. N_3fe3ea2fbc3b
N_abab7c04cc45 <|.. N_3fe3ea2fbc3b
```

外部继承／实现边界：[ControlledFileTransport](../../../logic/file-operations/platform/files/controlled-file-protocol.ts)、[ExclusiveControlledFile](../../../logic/file-operations/platform/files/controlled-file-protocol.ts)、[ExclusiveControlledTransition](../../../logic/file-operations/platform/files/controlled-file-protocol.ts)。

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
