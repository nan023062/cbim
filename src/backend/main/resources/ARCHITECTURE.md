# src/backend/main/resources 架构

## 目录定位

链接器、人才和完整业务模板共用的本地/远端资源仓库。静态发布与导入同时核对源仓库和目标知识版本，显式提交复用知识事务；资源定义不等于可执行工具。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [resource-http.ts](resource-http.ts) | RemoteRepository 与 serveRepository：HTTP 客户端和本机仓库共享服务。 |
| [resource-repository.ts](resource-repository.ts) | ResourceRepositories：统一三类资源的仓库选择、账号占位与共享生命周期。 |
| [resource-store.ts](resource-store.ts) | RepositoryStore 与 LocalRepository：本地资源仓库校验、版本检查及原子更新。 |
| [workspace-packages.ts](workspace-packages.ts) | 把当前工作区的静态团队/业务架构发布到统一资源仓库，并提供持久化导入预览与显式提交。 |

## 架构类图

### resource-http.ts

```mermaid
classDiagram
class N_src_backend_main_resources_resource_http_ts["resource-http.ts"] {
  <<module>>
  +repositoryUrl()
  +serveRepository()
}
```

```mermaid
classDiagram
class N_src_backend_main_resources_resource_http_ts["resource-http.ts"] {
  <<module>>
}
class N_src_backend_main_resources_resource_http_ts_RemoteRepository["RemoteRepository"] {
  +url
  +expectedId
  +read()
  +save()
  +remove()
  -token
  -request()
}
N_src_backend_main_resources_resource_http_ts ..> N_src_backend_main_resources_resource_http_ts_RemoteRepository : 声明
class N_src_backend_main_resources_resource_http_ts_external_RepositoryStore["RepositoryStore (外部契约)"] {
  <<external>>
}
N_src_backend_main_resources_resource_http_ts_external_RepositoryStore <|.. N_src_backend_main_resources_resource_http_ts_RemoteRepository
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[resource-store.ts](resource-store.ts)。

### resource-repository.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_main_resources_resource_repository_ts["resource-repository.ts"] {
  <<module>>
}
class N_src_backend_main_resources_resource_repository_ts_Config["Config"] {
  <<type>>

}
N_src_backend_main_resources_resource_repository_ts ..> N_src_backend_main_resources_resource_repository_ts_Config : 声明
class N_src_backend_main_resources_resource_repository_ts_ResourceRepositories["ResourceRepositories"] {
  +init()
  +status()
  +configure()
  +setAccountSession()
  +read()
  +save()
  +remove()
  +startSharing()
  +connection()
  +stopSharing()
  +close()
  -paths
  -session
  -localConfig
  -config
  -configError
}
N_src_backend_main_resources_resource_repository_ts ..> N_src_backend_main_resources_resource_repository_ts_ResourceRepositories : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_main_resources_resource_repository_ts["resource-repository.ts"] {
  <<module>>
}
class N_src_backend_main_resources_resource_repository_ts_ResourceRepositories["ResourceRepositories"] {
  -sharing
  -shareToken
  -queue
  -settingsFile
  -serial()
  -store()
  -identity()
  -applyConfig()
}
N_src_backend_main_resources_resource_repository_ts ..> N_src_backend_main_resources_resource_repository_ts_ResourceRepositories : 声明
```

直接依赖：[../platform/paths.ts](../platform/paths.ts)、[../../core/foundation/files.ts](../../core/foundation/files.ts)、[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[resource-store.ts](resource-store.ts)、[resource-http.ts](resource-http.ts)、[../../../bridge/contracts/resources.ts](../../../bridge/contracts/resources.ts)。

### resource-store.ts

```mermaid
classDiagram
class N_src_backend_main_resources_resource_store_ts["resource-store.ts"] {
  <<module>>
}
class N_src_backend_main_resources_resource_store_ts_RepositoryStore["RepositoryStore"] {
  <<interface>>
  +read()
  +save()
  +remove()
}
N_src_backend_main_resources_resource_store_ts ..> N_src_backend_main_resources_resource_store_ts_RepositoryStore : 声明
class N_src_backend_main_resources_resource_store_ts_LocalRepository["LocalRepository"] {
  +root
  +initialize()
  +read()
  +save()
  +remove()
  -file
  -lock()
  -checkFile()
  -update()
}
N_src_backend_main_resources_resource_store_ts ..> N_src_backend_main_resources_resource_store_ts_LocalRepository : 声明
N_src_backend_main_resources_resource_store_ts_RepositoryStore <|.. N_src_backend_main_resources_resource_store_ts_LocalRepository
```

直接依赖：[../platform/locking.ts](../platform/locking.ts)、[../../core/foundation/files.ts](../../core/foundation/files.ts)、[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../../bridge/contracts/resources.ts](../../../bridge/contracts/resources.ts)。

### workspace-packages.ts

```mermaid
classDiagram
class N_src_backend_main_resources_workspace_packages_ts["workspace-packages.ts"] {
  <<module>>
}
class N_src_backend_main_resources_workspace_packages_ts_ImportPlan["ImportPlan"] {
  <<interface>>
  +version
  +request
  +source
  +createdRoots
  +deletedRoots
  +fingerprint
  +committed
  +reindexRequest
  +result
}
N_src_backend_main_resources_workspace_packages_ts ..> N_src_backend_main_resources_workspace_packages_ts_ImportPlan : 声明
class N_src_backend_main_resources_workspace_packages_ts_WorkspacePackages["WorkspacePackages"] {
  +publish()
  +preview()
  +commit()
  -workspace
  -repositories
  -source()
  -planPath()
  -savePlan()
  -readPlan()
  -commitPlan()
}
N_src_backend_main_resources_workspace_packages_ts ..> N_src_backend_main_resources_workspace_packages_ts_WorkspacePackages : 声明
```

直接依赖：[../../core/foundation/files.ts](../../core/foundation/files.ts)、[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/knowledge/portable-package.ts](../../core/knowledge/portable-package.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../../core/knowledge/types.ts](../../core/knowledge/types.ts)、[../../../bridge/contracts/resources.ts](../../../bridge/contracts/resources.ts)、[resource-repository.ts](resource-repository.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_backend_main_resources_resource_http_ts["resource-http.ts"] {
  <<module>>
}
class N_src_backend_main_resources_resource_store_ts["resource-store.ts"] {
  <<module>>
}
class N_src_backend_main_resources_resource_repository_ts["resource-repository.ts"] {
  <<module>>
}
class N_src_backend_main_resources_workspace_packages_ts["workspace-packages.ts"] {
  <<module>>
}
N_src_backend_main_resources_resource_http_ts ..> N_src_backend_main_resources_resource_store_ts : 导入依赖
N_src_backend_main_resources_resource_repository_ts ..> N_src_backend_main_resources_resource_store_ts : 导入依赖
N_src_backend_main_resources_resource_repository_ts ..> N_src_backend_main_resources_resource_http_ts : 导入依赖
N_src_backend_main_resources_workspace_packages_ts ..> N_src_backend_main_resources_resource_repository_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

# 资源仓库与工作区架构传输

链接器、人才市场和业务模板共用 `ResourceRepositories` 的当前仓库。未登录使用本机目录；已连接服务器仓库沿用现有账号会话抽象。界面尚未实现的账户服务不会被本模块冒充为云上传。仓库快照绑定 `repositoryId` 与 `revision`，资源整体 JSON 最多 8 MiB、单项正文最多 2 MiB。

`WorkspacePackages` 只处理静态架构定义。`publish` 从工作区校验快照构建完整包，在用户明确发布操作后保存到当前仓库；源工作区、仓库身份或版本改变则拒绝。相同类型、名称、摘要和完整正文已存在时返回原资源，避免丢失回执后重复发布；不会按名称覆盖其他定义。

`preview` 同时固定工作区实例/版本与源仓库版本/资源哈希，调用原知识校验并将计划保存到工作区的应用缓存 `resource-imports`。预览只显示增删改清单、完整校验和清除绑定提示，不写正式知识。旧普通文本资源、单模块与单 Workflow 资源可继续浏览，不能作为整包应用。

`commit` 必须显式提供同工作区实例的 `planId`。首次写入前复核两端版本、源内容、目标目录冲突及未知资源；正式写入复用 `KnowledgeWorkspace.commit` 的事务、索引和请求幂等日志。跨 IPC 创建的多个门面共用按工作区排队的提交队列。同一计划成功后返回持久化回执；如果正式知识已写入但缓存回执失败，重试只能查询原请求的已提交回执，不能以新版本重放包内容。

整体替换后仅清理已经空的目录，不递归删除任何文件。旧小组物理目录清理后再次通过独立知识事务刷新派生索引；主提交回执和索引请求分别持久化。若并发治理导致索引版本冲突，主包不再执行，显式重试只重新准备索引。未知事务失败保留现场并沿用原恢复要求，不自动重放副作用。实例重启后旧计划不能复用，用户须基于当前知识重新预览。

主知识提交成功后的目录、索引或回执失败以 `RESOURCE_IMPORT_APPLIED` 明确报告“静态定义已应用，后续整理未完成”，附同一个计划 ID；不把部分完成描述成尚未写入或完全成功。完整 Team 替换在预览前按最终定义核对保留花名册的小组引用，不依赖仍在磁盘的旧空目录放行。

共享内容不绑定主会话：一个工作区的静态 Team/业务架构与多个主会话分别拥有的成员调度任务图相互独立。导入不启动 Agent、不派任务、不连接工具、不恢复会话、不继承来源项目的人员或维护授权。
