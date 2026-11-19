# 应用生命周期

## 设计意图

负责应用生命周期。

## 主要组成

| ?? | ?? |
| --- | --- |
| [Application](index.ts) | Application 持有资源仓库和运行时实例。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_0ac1b515da0c["Application"]
click N_0ac1b515da0c href "index.ts"
class N_8d88ffcf5033["ApplicationEntry"] {
  <<boundary>>
}
click N_8d88ffcf5033 href "index.ts"
N_8d88ffcf5033 <|.. N_0ac1b515da0c
```

外部继承／实现边界：[ApplicationEntry](index.ts)。

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
