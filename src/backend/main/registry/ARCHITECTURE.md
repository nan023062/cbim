# src/backend/main/registry 架构

## 目录定位

岗位、来源与责任登记的应用服务；协调知识、文件实现和 Core 的规则，不拥有正式运行准入。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [knowledge-sources.ts](knowledge-sources.ts) | 将原知识事务的来源屏障与岗位/责任的明确来源采纳接到唯一 DispatchStore。 |
| [main-module-ownership-tools.ts](main-module-ownership-tools.ts) | 把工作区责任服务绑定真实主运行及当前协作周期，提供四项模型窄端口。 |
| [main-workspace-member-tools.ts](main-workspace-member-tools.ts) | 把岗位服务装配到真实主运行；工作区、actor 和命令身份由闭包持有。 |
| [module-ownerships.ts](module-ownerships.ts) | 桌面与真实主工具共用的模块负责人服务，关系和岗位在唯一 DispatchStore 内裁决。 |
| [workspace-members.ts](workspace-members.ts) | 将桌面岗位登记、采纳与当前差异查询接到工作区唯一 DispatchStore，公开模型配置由 Main 注入。 |

## 架构类图

### knowledge-sources.ts

```mermaid
classDiagram
class N_src_backend_main_registry_knowledge_sources_ts["knowledge-sources.ts"] {
  <<module>>
  +sourceObservations()
}
```

```mermaid
classDiagram
class N_src_backend_main_registry_knowledge_sources_ts["knowledge-sources.ts"] {
  <<module>>
}
class N_src_backend_main_registry_knowledge_sources_ts_KnowledgeSourceWorkspace["KnowledgeSourceWorkspace"] {
  <<interface>>
  +sources
  +withSourceSnapshot()
}
N_src_backend_main_registry_knowledge_sources_ts ..> N_src_backend_main_registry_knowledge_sources_ts_KnowledgeSourceWorkspace : 声明
class N_src_backend_main_registry_knowledge_sources_ts_external_KnowledgeWorkspace["KnowledgeWorkspace (外部契约)"] {
  <<external>>
}
N_src_backend_main_registry_knowledge_sources_ts_external_KnowledgeWorkspace <|-- N_src_backend_main_registry_knowledge_sources_ts_KnowledgeSourceWorkspace
class N_src_backend_main_registry_knowledge_sources_ts_KnowledgeSources["KnowledgeSources"] {
  +workspaceId
  +build()
  +prepare()
  +settle()
  +verify()
  +pending()
  +transitions()
  +assertAvailable()
  +selection()
  +capture()
  +status()
  -store
}
N_src_backend_main_registry_knowledge_sources_ts ..> N_src_backend_main_registry_knowledge_sources_ts_KnowledgeSources : 声明
class N_src_backend_main_registry_knowledge_sources_ts_external_KnowledgeSourceAuthority["KnowledgeSourceAuthority (外部契约)"] {
  <<external>>
}
N_src_backend_main_registry_knowledge_sources_ts_external_KnowledgeSourceAuthority <|.. N_src_backend_main_registry_knowledge_sources_ts_KnowledgeSources
```

直接依赖：[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../core/foundation/json.ts](../../core/foundation/json.ts)、[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/dispatch/dispatch-storage.ts](../../core/dispatch/dispatch-storage.ts)、[../../core/knowledge/types.ts](../../core/knowledge/types.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../../core/knowledge/planned-commit.ts](../../core/knowledge/planned-commit.ts)、[../../core/workspace/knowledge-source.ts](../../core/workspace/knowledge-source.ts)、[../../core/workspace/knowledge-source-rules.ts](../../core/workspace/knowledge-source-rules.ts)、[../knowledge/source-journal.ts](../knowledge/source-journal.ts)。

### main-module-ownership-tools.ts

```mermaid
classDiagram
class N_src_backend_main_registry_main_module_ownership_tools_ts["main-module-ownership-tools.ts"] {
  <<module>>
  +mainModuleOwnershipTools()
}
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/execution/conversation-binding.ts](../../core/execution/conversation-binding.ts)、[../../core/tasks/types.ts](../../core/tasks/types.ts)、[../../core/workspace/module-ownership.ts](../../core/workspace/module-ownership.ts)、[../../core/workspace/module-ownership-rules.ts](../../core/workspace/module-ownership-rules.ts)、[../../core/workspace/module-ownership-tools.ts](../../core/workspace/module-ownership-tools.ts)、[../../scheduler-engine/dispatch/auto-collaboration.ts](../../scheduler-engine/dispatch/auto-collaboration.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[module-ownerships.ts](module-ownerships.ts)、[workspace-members.ts](workspace-members.ts)、[../../scheduler-engine/dispatch/owner-execution-service.ts](../../scheduler-engine/dispatch/owner-execution-service.ts)。

### main-workspace-member-tools.ts

```mermaid
classDiagram
class N_src_backend_main_registry_main_workspace_member_tools_ts["main-workspace-member-tools.ts"] {
  <<module>>
  +mainWorkspaceMemberTools()
}
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/execution/conversation-binding.ts](../../core/execution/conversation-binding.ts)、[../../../logic/models/index.ts](../../../logic/models/index.ts)、[../../core/knowledge/read-models/index.ts](../../core/knowledge/read-models/index.ts)、[../../core/knowledge/ports.ts](../../core/knowledge/ports.ts)、[../../core/tasks/types.ts](../../core/tasks/types.ts)、[../../core/team/workspace-member-rules.ts](../../core/team/workspace-member-rules.ts)、[../../core/team/workspace-member.ts](../../core/team/workspace-member.ts)、[../../core/team/workspace-member-tools.ts](../../core/team/workspace-member-tools.ts)、[../../scheduler-engine/dispatch/auto-collaboration.ts](../../scheduler-engine/dispatch/auto-collaboration.ts)、[workspace-members.ts](workspace-members.ts)。

### module-ownerships.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_main_registry_module_ownerships_ts["module-ownerships.ts"] {
  <<module>>
}
class N_src_backend_main_registry_module_ownerships_ts_Knowledge["Knowledge"] {
  <<type>>
  +snapshot
  +visible
  +issue
}
N_src_backend_main_registry_module_ownerships_ts ..> N_src_backend_main_registry_module_ownerships_ts_Knowledge : 声明
class N_src_backend_main_registry_module_ownerships_ts_ModuleOwnerships["ModuleOwnerships"] {
  +list()
  +byMember()
  +inspectModules()
  +get()
  +preview()
  +receipt()
  +commit()
  -owner
  -store
  -isCurrent
  -identity()
  -assert()
  -workspace()
  -cursor()
  -basis()
  -knowledge()
}
N_src_backend_main_registry_module_ownerships_ts ..> N_src_backend_main_registry_module_ownerships_ts_ModuleOwnerships : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_main_registry_module_ownerships_ts["module-ownerships.ts"] {
  <<module>>
}
class N_src_backend_main_registry_module_ownerships_ts_ModuleOwnerships["ModuleOwnerships"] {
  -observed()
  -view()
  -page()
  -verifyKnowledge()
  -verifyRead()
  -prepare()
  -checkedReceipt()
}
N_src_backend_main_registry_module_ownerships_ts ..> N_src_backend_main_registry_module_ownerships_ts_ModuleOwnerships : 声明
```

直接依赖：[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/foundation/serialization.ts](../../core/foundation/serialization.ts)、[../../core/knowledge/types.ts](../../core/knowledge/types.ts)、[../../core/knowledge/read-models/index.ts](../../core/knowledge/read-models/index.ts)、[../../core/dispatch/dispatch-storage.ts](../../core/dispatch/dispatch-storage.ts)、[../../core/team/workspace-member.ts](../../core/team/workspace-member.ts)、[../../core/workspace/module-ownership.ts](../../core/workspace/module-ownership.ts)、[../../core/workspace/module-ownership-rules.ts](../../core/workspace/module-ownership-rules.ts)、[../../core/tasks/module-ownership-invariants.ts](../../core/tasks/module-ownership-invariants.ts)、[knowledge-sources.ts](knowledge-sources.ts)、[../../core/workspace/knowledge-source-rules.ts](../../core/workspace/knowledge-source-rules.ts)。

### workspace-members.ts

成员 1/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_main_registry_workspace_members_ts["workspace-members.ts"] {
  <<module>>
}
class N_src_backend_main_registry_workspace_members_ts_WorkspaceMemberModels["WorkspaceMemberModels"] {
  <<interface>>
  +configuration()
}
N_src_backend_main_registry_workspace_members_ts ..> N_src_backend_main_registry_workspace_members_ts_WorkspaceMemberModels : 声明
class N_src_backend_main_registry_workspace_members_ts_PreparedMember["PreparedMember"] {
  <<interface>>
  +preview
  +knowledgeRevision
  +model
}
N_src_backend_main_registry_workspace_members_ts ..> N_src_backend_main_registry_workspace_members_ts_PreparedMember : 声明
class N_src_backend_main_registry_workspace_members_ts_WorkspaceMembers["WorkspaceMembers"] {
  +list()
  +get()
  +preview()
  +receipt()
  +mainReceipt()
  +commit()
  -owner
  -store
  -models
  -isCurrent
  -assert()
  -identity()
  -sameWorkspace()
  -cursor()
  -member()
  -checkedReceipt()
}
N_src_backend_main_registry_workspace_members_ts ..> N_src_backend_main_registry_workspace_members_ts_WorkspaceMembers : 声明
```

成员 2/2（同名节点为同一声明，跨图合并阅读）。

```mermaid
classDiagram
class N_src_backend_main_registry_workspace_members_ts["workspace-members.ts"] {
  <<module>>
}
class N_src_backend_main_registry_workspace_members_ts_WorkspaceMembers["WorkspaceMembers"] {
  -capability()
  -policy()
  -prepare()
  -verifySources()
  -selectedCapability()
  -builtinStatus()
  -selectedPolicy()
  -diff()
}
N_src_backend_main_registry_workspace_members_ts ..> N_src_backend_main_registry_workspace_members_ts_WorkspaceMembers : 声明
```

直接依赖：[../../core/knowledge/read-models/index.ts](../../core/knowledge/read-models/index.ts)、[../../../logic/models/index.ts](../../../logic/models/index.ts)、[../../core/foundation/errors.ts](../../core/foundation/errors.ts)、[../../core/dispatch/dispatch-storage.ts](../../core/dispatch/dispatch-storage.ts)、[../../core/team/workspace-member.ts](../../core/team/workspace-member.ts)、[../../core/team/workspace-member-rules.ts](../../core/team/workspace-member-rules.ts)、[../../scheduler-engine/context/dispatch-context.ts](../../scheduler-engine/context/dispatch-context.ts)、[../../core/knowledge/types.ts](../../core/knowledge/types.ts)、[../../core/workspace/knowledge-source-rules.ts](../../core/workspace/knowledge-source-rules.ts)、[../../core/workspace/knowledge-source.ts](../../core/workspace/knowledge-source.ts)、[knowledge-sources.ts](knowledge-sources.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_backend_main_registry_main_module_ownership_tools_ts["main-module-ownership-tools.ts"] {
  <<module>>
}
class N_src_backend_main_registry_module_ownerships_ts["module-ownerships.ts"] {
  <<module>>
}
class N_src_backend_main_registry_workspace_members_ts["workspace-members.ts"] {
  <<module>>
}
class N_src_backend_main_registry_main_workspace_member_tools_ts["main-workspace-member-tools.ts"] {
  <<module>>
}
class N_src_backend_main_registry_knowledge_sources_ts["knowledge-sources.ts"] {
  <<module>>
}
N_src_backend_main_registry_main_module_ownership_tools_ts ..> N_src_backend_main_registry_module_ownerships_ts : 导入依赖
N_src_backend_main_registry_main_module_ownership_tools_ts ..> N_src_backend_main_registry_workspace_members_ts : 导入依赖
N_src_backend_main_registry_main_workspace_member_tools_ts ..> N_src_backend_main_registry_workspace_members_ts : 导入依赖
N_src_backend_main_registry_module_ownerships_ts ..> N_src_backend_main_registry_knowledge_sources_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_backend_main_registry_workspace_members_ts["workspace-members.ts"] {
  <<module>>
}
class N_src_backend_main_registry_knowledge_sources_ts["knowledge-sources.ts"] {
  <<module>>
}
N_src_backend_main_registry_workspace_members_ts ..> N_src_backend_main_registry_knowledge_sources_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
