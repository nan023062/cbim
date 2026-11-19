# src/view/resources 架构

<a id="contract"></a>

## 设计意图

展示资源仓库、连接授权与静态包交换，让用户分别选择查看、发布和应用。

`ResourceRepositoryView` 组织资源列表，连接面板保存明确授权命令，`WorkspaceResourceTransfer` 处理工作区发布与导入预览。待确认记录跨卸载核实原请求，页面不实现仓库存储或根据下载完成推断知识已应用。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ResourceRepositoryView](ResourceRepositoryView.tsx) | 三类资源共用的定义列表与编辑器；链接器页附带独立工作区仓库连接，人才包/完整业务架构有明确应用入口。 |
| [RepositoryConnections](RepositoryConnections.tsx) | 在链接器页按明确工作区登记仓库身份、独立授予主 Agent 只读连接并查看真实 HTTP 核验摘要。 |
| [WorkspaceResourceTransfer](WorkspaceResourceTransfer.tsx) | 静态团队能力与完整业务架构在当前工作区和共用仓库之间的发布、下载及应用界面。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_b797aca046dd["ResourceRepositoryView"] {
  <<component>>
}
click N_b797aca046dd href "ResourceRepositoryView.tsx"
class N_2af600758a68["WorkspaceResourceTransfer"] {
  <<component>>
}
click N_2af600758a68 href "WorkspaceResourceTransfer.tsx"
class N_8c9735b973da["RepositoryConnections"] {
  <<component>>
}
click N_8c9735b973da href "RepositoryConnections.tsx"
N_b797aca046dd ..> N_2af600758a68 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
