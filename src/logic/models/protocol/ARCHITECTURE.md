# 大模型

## 设计意图

维护模型配置结构、供应商连接选择、模型目录解析及生成与嵌入快照。凭据存取和设置持久化由 Logic 装配。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [catalog](catalog.ts) | 解析供应商模型目录的能力资料，供新增模型和显式同步容量使用。 |
| [config](config.ts) | 定义自定义供应商的生成与向量模型目录，保持旧生成配置字节与字段缺省。 |
| [provider-connections](provider-connections.ts) | 供应商到协议需求的纯接口选择规则，供界面筛选、岗位采纳和实际启动共同使用。 |
| [snapshot](snapshot.ts) | 生成模型公开运行快照的纯校验，供引擎角色绑定与岗位历史共同使用。 |
| [embedding](embedding.ts) | 向量模型的独立配置与公开快照，不套用生成输出预算字段。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_00feb78dd8d0["config"] {
  <<module>>
}
click N_00feb78dd8d0 href "config.ts"
class N_caa48b695f75["embedding"] {
  <<module>>
}
click N_caa48b695f75 href "embedding.ts"
class N_aeea1ae2e01f["provider-connections"] {
  <<module>>
}
click N_aeea1ae2e01f href "provider-connections.ts"
class N_919ba2c6c18d["catalog"] {
  <<module>>
}
click N_919ba2c6c18d href "catalog.ts"
class N_480c3ed222b4["snapshot"] {
  <<module>>
}
click N_480c3ed222b4 href "snapshot.ts"
N_00feb78dd8d0 ..> N_caa48b695f75 : 依赖
N_aeea1ae2e01f ..> N_00feb78dd8d0 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
