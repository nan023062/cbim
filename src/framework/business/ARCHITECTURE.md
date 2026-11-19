# 业务架构

## 设计意图

业务与能力是对偶视图：能力树组织团队和角色，业务树以 Project 为根，其余节点均为 Workspace。每个 Workspace 在拥有子工作区的同时，承载自身业务描述及来源。Logic 从已校验的正式知识快照读取这棵树。

工作区通过 Project.ResolveWorkflows 沿实际父子关系读取本节点和逐级祖先声明的 Workflow，保留原始定义节点。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [WorkflowScope](workflow.ts) | 按工作区的组织关系解析可用 Workflow 和各项来源。 |
| [Project](project.ts) | 业务树唯一根，提供直属工作区与按身份查询。 |
| [WorkspaceInstance](workspace-instance.ts) | 私有持有 Git worktree 使用权，解析实际业务目录，并在关闭或打开失败时释放使用权。 |
| [WorkspaceInstanceFactory](workspace-instance.ts) | 按办公室和仓库打开 worktree 使用权。 |
| [Workspace](workspace.ts) | 内部节点和叶子均承载业务；children 指向下级工作区。 |
| [WorkspaceTree](workspace.ts) | 项目直属模块与按身份索引的模块节点。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_ee8d75ac0790["Project"]
click N_ee8d75ac0790 href "project.ts"
class N_6f43b8a6a14d["WorkspaceTree"] {
  <<interface>>
}
click N_6f43b8a6a14d href "workspace.ts"
class N_85e77893bfd9["Workspace"] {
  <<interface>>
}
click N_85e77893bfd9 href "workspace.ts"
class N_958990e17266["WorkflowScope"]
click N_958990e17266 href "workflow.ts"
class N_c26b7944d23b["WorkspaceInstanceFactory"] {
  <<interface>>
}
click N_c26b7944d23b href "workspace-instance.ts"
class N_ae8ab1ec117e["WorkspaceInstance"]
click N_ae8ab1ec117e href "workspace-instance.ts"
N_958990e17266 ..> N_6f43b8a6a14d : 依赖
N_ee8d75ac0790 ..> N_6f43b8a6a14d : 依赖
N_ee8d75ac0790 ..> N_85e77893bfd9 : 依赖
N_ee8d75ac0790 ..> N_958990e17266 : 依赖
N_ee8d75ac0790 ..> N_c26b7944d23b : 依赖
N_ee8d75ac0790 ..> N_ae8ab1ec117e : 依赖
N_ae8ab1ec117e ..> N_85e77893bfd9 : 依赖
N_ae8ab1ec117e ..> N_c26b7944d23b : 依赖
N_6f43b8a6a14d ..> N_85e77893bfd9 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
