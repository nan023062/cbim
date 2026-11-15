# src/view/diagnostics 架构

## 目录定位

只读展示工作区运行状态和知识校验问题，不把工作区就绪视为知识校验通过。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [diagnostics.css](diagnostics.css) | 工作区运行状态与知识校验详情的扩展面板样式。 |
| [WorkspaceDiagnostics.tsx](WorkspaceDiagnostics.tsx) | 只读展示工作区内部运行状态和知识校验问题。 |

## 架构类图

### diagnostics.css

```mermaid
classDiagram
class N_src_view_diagnostics_diagnostics_css["diagnostics.css"] {
  <<stylesheet>>
}
```

### WorkspaceDiagnostics.tsx

```mermaid
classDiagram
class N_src_view_diagnostics_WorkspaceDiagnostics_tsx["WorkspaceDiagnostics.tsx"] {
  <<component>>
  +WorkspaceDiagnostics()
}
```

```mermaid
classDiagram
class N_src_view_diagnostics_WorkspaceDiagnostics_tsx["WorkspaceDiagnostics.tsx"] {
  <<component>>
}
class N_src_view_diagnostics_WorkspaceDiagnostics_tsx_WorkspaceDiagnosticsProps["WorkspaceDiagnosticsProps"] {
  <<interface>>
  +workspace
  +snapshot
  +refreshKnowledge
}
N_src_view_diagnostics_WorkspaceDiagnostics_tsx ..> N_src_view_diagnostics_WorkspaceDiagnostics_tsx_WorkspaceDiagnosticsProps : 声明
```

直接依赖：[../components/Icon.tsx](../components/Icon.tsx)、[../../bridge/contracts/workspace.ts](../../bridge/contracts/workspace.ts)、[diagnostics.css](diagnostics.css)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_view_diagnostics_WorkspaceDiagnostics_tsx["WorkspaceDiagnostics.tsx"] {
  <<component>>
}
class N_src_view_diagnostics_diagnostics_css["diagnostics.css"] {
  <<stylesheet>>
}
N_src_view_diagnostics_WorkspaceDiagnostics_tsx ..> N_src_view_diagnostics_diagnostics_css : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

# 工作区诊断

WorkspaceDiagnostics 显示工作区身份、目录、实例和知识修订。只有 workspaceId 与 instanceId 都匹配的 Snapshot 才用于知识结果；其它快照不展示为已通过。运行未就绪时明确不能重新检查。结构检查无问题不代表业务语义或任务验收通过。只读刷新不修复或启动项目。
