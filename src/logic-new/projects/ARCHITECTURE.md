# 项目列表和各项目的 Office 会话

## 设计意图

负责项目列表和各项目的 Office 会话。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [Catalog](index.ts) | 读取项目列表，按本地目录身份登记工作区。 |
| [Paths](paths.ts) | 解析项目目录身份与用户数据位置。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_1903d6788542["Catalog"]
click N_1903d6788542 href "index.ts"
class N_592911a42b44["Paths"]
click N_592911a42b44 href "paths.ts"
N_1903d6788542 ..> N_592911a42b44 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
