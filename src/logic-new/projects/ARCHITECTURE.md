# 项目列表和各项目的 Office 会话

## 设计意图

负责项目列表和各项目的 Office 会话。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [Project](project.ts) | 持有项目资源和该项目独立的运行时。 |
| [ProjectList](project.ts) | 按登记身份加载项目，聚合 Office 监控事件。 |
| [GitWorktrees](git-worktrees.ts) | Opens a separate Git worktree for each Office and repository. |
| [Catalog](index.ts) | 读取项目列表，按本地目录身份登记工作区。 |
| [Paths](paths.ts) | 解析项目目录身份与用户数据位置。 |
| [ProjectOffices](offices.ts) | 将登记项目的持久会话绑定到运行时 Office。 |

<!-- architecture:generated:start -->

## 架构关系

### 关系组 1：ProjectList

```mermaid
classDiagram
class N_74869bf51bc8["ProjectList"]
click N_74869bf51bc8 href "project.ts"
class N_1903d6788542["Catalog"]
click N_1903d6788542 href "index.ts"
class N_a266fe79ead9["Project"]
click N_a266fe79ead9 href "project.ts"
class N_e27b38931286["GitWorktrees"]
click N_e27b38931286 href "git-worktrees.ts"
class N_592911a42b44["Paths"]
click N_592911a42b44 href "paths.ts"
class N_0fcbdf6bb4be["ProjectOffices"]
click N_0fcbdf6bb4be href "offices.ts"
N_a266fe79ead9 ..> N_e27b38931286 : 依赖
N_1903d6788542 <|-- N_74869bf51bc8
N_74869bf51bc8 ..> N_a266fe79ead9 : 依赖
N_74869bf51bc8 ..> N_e27b38931286 : 依赖
N_74869bf51bc8 ..> N_592911a42b44 : 依赖
N_1903d6788542 ..> N_592911a42b44 : 依赖
N_0fcbdf6bb4be ..> N_74869bf51bc8 : 依赖
N_0fcbdf6bb4be ..> N_1903d6788542 : 依赖
N_0fcbdf6bb4be ..> N_592911a42b44 : 依赖
```

### 关系组 2：WorkspaceInstanceFactory

```mermaid
classDiagram
class N_c26b7944d23b["WorkspaceInstanceFactory"] {
  <<boundary>>
}
click N_c26b7944d23b href "../../framework/business/workspace-instance.ts"
```

### 跨图协作

按引用方归并目标，保留全部跨图关系；分图只用于阅读，不表示新增模块或依赖边界。

| 引用方 | 关系 | 目标 |
| --- | --- | --- |
| [GitWorktrees](git-worktrees.ts)（图 1） | 实现 | [WorkspaceInstanceFactory](../../framework/business/workspace-instance.ts)（图 2） |

外部继承／实现边界：[WorkspaceInstanceFactory](../../framework/business/workspace-instance.ts)。

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
