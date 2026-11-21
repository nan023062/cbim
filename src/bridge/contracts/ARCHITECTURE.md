# src/bridge/contracts 架构

<a id="contract"></a>

## 设计意图

声明当前桌面与页面之间的数据协议，避免页面加载业务服务、凭据和平台实现。旧 IPC 兼容协议已随旧宿主移除。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [desktop-engines](desktop-engines.ts) | 引擎安装和目录展示契约。 |
| [desktop-models](desktop-models.ts) | 模型配置与选型契约。 |
| [desktop-updates](desktop-updates.ts) | 桌面更新状态契约。 |
| [discovery](discovery.ts) | 当前客户端发现与连接契约。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_4806989b28c3["desktop-engines"] {
  <<module>>
}
click N_4806989b28c3 href "desktop-engines.ts"
class N_0da9030ea371["desktop-models"] {
  <<module>>
}
click N_0da9030ea371 href "desktop-models.ts"
class N_890fa2a78c07["discovery"] {
  <<module>>
}
click N_890fa2a78c07 href "discovery.ts"
class N_b4364224c42f["desktop-updates"] {
  <<module>>
}
click N_b4364224c42f href "desktop-updates.ts"
N_4806989b28c3 ..> N_0da9030ea371 : 依赖
N_890fa2a78c07 ..> N_4806989b28c3 : 依赖
N_890fa2a78c07 ..> N_0da9030ea371 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
