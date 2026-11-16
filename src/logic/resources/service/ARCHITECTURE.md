# src/logic/resources/service 架构

<a id="contract"></a>

## 设计意图

本地/HTTP 资源仓库、版本与身份校验、共享代际与取消；宿主仅提供目录边界，不持有应用或 Bridge。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [RemoteRepository](resource-http.ts) | RemoteRepository 与 serveRepository：HTTP 客户端和本机仓库共享服务。 |
| [ResourceRepositories](resource-repository.ts) | ResourceRepositories：统一三类资源的仓库选择、账号占位与共享生命周期。 |
| [LocalRepository](resource-store.ts) | RepositoryStore 与 LocalRepository：本地资源仓库校验、版本检查及原子更新。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_2468445e4d64["LocalRepository"]
click N_2468445e4d64 href "resource-store.ts"
class N_275fa11139b3["ResourceRepositories"]
click N_275fa11139b3 href "resource-repository.ts"
class N_bd13d8f8b85b["RepositoryStore"] {
  <<boundary>>
}
click N_bd13d8f8b85b href "resource-store.ts"
class N_ac7b9d1f862e["RemoteRepository"]
click N_ac7b9d1f862e href "resource-http.ts"
N_bd13d8f8b85b <|.. N_ac7b9d1f862e
N_275fa11139b3 ..> N_2468445e4d64 : 依赖
N_275fa11139b3 ..> N_ac7b9d1f862e : 依赖
N_bd13d8f8b85b <|.. N_2468445e4d64
```

外部继承／实现边界：[RepositoryStore](resource-store.ts)。

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
