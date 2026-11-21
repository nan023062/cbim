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
class N_112ed79a73b9["模型配置"] {
  <<module>>
}
click N_112ed79a73b9 href "config.ts"
class N_fe672a44055a["公共入口"] {
  <<module>>
}
click N_fe672a44055a href "index.ts"
class N_697b5eec0445["接口地址"] {
  <<module>>
}
click N_697b5eec0445 href "endpoint.ts"
class N_022c01265cd4["向量模型"] {
  <<module>>
}
click N_022c01265cd4 href "embedding.ts"
class N_dffddb9f5252["连接选择"] {
  <<module>>
}
click N_dffddb9f5252 href "provider-connections.ts"
class N_8c38d1291d75["供应商预设"] {
  <<module>>
}
click N_8c38d1291d75 href "provider-presets.ts"
N_fe672a44055a ..> N_112ed79a73b9 : 依赖
N_fe672a44055a ..> N_022c01265cd4 : 依赖
N_fe672a44055a ..> N_dffddb9f5252 : 依赖
N_fe672a44055a ..> N_8c38d1291d75 : 依赖
N_112ed79a73b9 ..> N_697b5eec0445 : 依赖
N_112ed79a73b9 ..> N_022c01265cd4 : 依赖
N_022c01265cd4 ..> N_697b5eec0445 : 依赖
N_dffddb9f5252 ..> N_112ed79a73b9 : 依赖
N_dffddb9f5252 ..> N_8c38d1291d75 : 依赖
N_8c38d1291d75 ..> N_112ed79a73b9 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
