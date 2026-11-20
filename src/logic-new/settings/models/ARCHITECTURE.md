# 模型设置

## 设计意图

为新桌面的供应商配置表单与主 Agent 模型选择提供统一的配置校验和连接选择规则。

## 主要组成

| 文件 | 职责 |
| --- | --- |
| [公共入口](index.ts) | 导出桌面配置类型和兼容性查询。 |
| [模型配置](config.ts) | 校验生成模型和供应商设置。 |
| [接口地址](endpoint.ts) | 校验模型服务地址。 |
| [向量模型](embedding.ts) | 定义向量模型和连接配置。 |
| [连接选择](provider-connections.ts) | 按模型和引擎要求选择连接。 |
| [供应商预设](provider-presets.ts) | 按服务地址识别预设。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_044a0c4b1b4e["模型配置"] {
  <<module>>
}
click N_044a0c4b1b4e href "config.ts"
class N_7da95519db84["公共入口"] {
  <<module>>
}
click N_7da95519db84 href "index.ts"
class N_e5f447a8d76a["接口地址"] {
  <<module>>
}
click N_e5f447a8d76a href "endpoint.ts"
class N_104008726beb["向量模型"] {
  <<module>>
}
click N_104008726beb href "embedding.ts"
class N_ddc969daaf2f["连接选择"] {
  <<module>>
}
click N_ddc969daaf2f href "provider-connections.ts"
class N_8dd188e8cb38["供应商预设"] {
  <<module>>
}
click N_8dd188e8cb38 href "provider-presets.ts"
N_7da95519db84 ..> N_044a0c4b1b4e : 依赖
N_7da95519db84 ..> N_104008726beb : 依赖
N_7da95519db84 ..> N_ddc969daaf2f : 依赖
N_7da95519db84 ..> N_8dd188e8cb38 : 依赖
N_044a0c4b1b4e ..> N_e5f447a8d76a : 依赖
N_044a0c4b1b4e ..> N_104008726beb : 依赖
N_104008726beb ..> N_e5f447a8d76a : 依赖
N_ddc969daaf2f ..> N_044a0c4b1b4e : 依赖
N_ddc969daaf2f ..> N_8dd188e8cb38 : 依赖
N_8dd188e8cb38 ..> N_044a0c4b1b4e : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
