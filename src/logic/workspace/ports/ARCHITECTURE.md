# src/logic/workspace/ports 架构

<a id="contract"></a>

## 设计意图

工作区存储路径的结构化端口，规则不依赖宿主 Paths 实现。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [paths](paths.ts) | 工作区身份与受控路径解析端口。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_d2d775cf9af7["paths"] {
  <<module>>
}
click N_d2d775cf9af7 href "paths.ts"
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
