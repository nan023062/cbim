# src/frontend/shell 架构

## 目录定位

工作区侧栏、会话选择、用户栏与右侧扩展页签；会话区与项目级视图区分开。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [App.tsx](App.tsx) | 桌面外壳：工作区下展示对话，中间固定主 Agent 会话（对话/任务视图），右侧独立扩展区承载架构/流程等视图；可调整宽度的侧边栏、工作区选择、页签、轮询、全局页面和未提交修改提示。 |
| [ExtensionArea.tsx](ExtensionArea.tsx) | 工作区右侧扩展页签，独立于中央对话管理浏览器、命令终端、架构与内部运行诊断视图。 |
| [extensions.css](extensions.css) | 中央对话与右侧扩展区的分栏、空页签及各扩展面板布局。 |
| [shell.css](shell.css) | 工作区外壳、侧栏、页签、菜单和主题布局样式。 |
| [state-labels.ts](state-labels.ts) | 界面工作区与工具任务状态的中文标签。 |
| [tabs.ts](tabs.ts) | 页签种类、默认布局、排序与本机布局恢复。 |
| [UserMenu.tsx](UserMenu.tsx) | 本地用户栏菜单、主题切换与设置入口。 |
| [useSidebarWidth.ts](useSidebarWidth.ts) | 管理侧边栏宽度、拖动与键盘调整，并在本地保留布局。 |
| [workspace-list.css](workspace-list.css) | 工作区树、项目行操作与内嵌编辑菜单的布局。 |
| [WorkspaceList.tsx](WorkspaceList.tsx) | 左侧工作区树及其对话列表，承载新对话、项目重命名和移除入口。 |

## 架构类图

### App.tsx

```mermaid
classDiagram
class N_src_frontend_shell_App_tsx["App.tsx"] {
  <<component>>
  +App()
}
```
直接依赖：[../../bridge/contracts/workspace.ts](../../bridge/contracts/workspace.ts)、[../resources/ResourceRepositoryView.tsx](../resources/ResourceRepositoryView.tsx)、[../settings/SettingsView.tsx](../settings/SettingsView.tsx)、[WorkspaceList.tsx](WorkspaceList.tsx)、[ExtensionArea.tsx](ExtensionArea.tsx)、[../../bridge/contracts/resources.ts](../../bridge/contracts/resources.ts)、[tabs.ts](tabs.ts)、[../components/Icon.tsx](../components/Icon.tsx)、[../components/Empty.tsx](../components/Empty.tsx)、[../conversation/Conversation.tsx](../conversation/Conversation.tsx)、[UserMenu.tsx](UserMenu.tsx)、[useSidebarWidth.ts](useSidebarWidth.ts)、[state-labels.ts](state-labels.ts)。

### ExtensionArea.tsx

```mermaid
classDiagram
class N_src_frontend_shell_ExtensionArea_tsx["ExtensionArea.tsx"] {
  <<component>>
}
class N_src_frontend_shell_ExtensionArea_tsx_Kind["Kind"] {
  <<type>>

}
N_src_frontend_shell_ExtensionArea_tsx ..> N_src_frontend_shell_ExtensionArea_tsx_Kind : 声明
class N_src_frontend_shell_ExtensionArea_tsx_Panel["Panel"] {
  <<type>>

}
N_src_frontend_shell_ExtensionArea_tsx ..> N_src_frontend_shell_ExtensionArea_tsx_Panel : 声明
```

直接依赖：[../../bridge/contracts/workspace.ts](../../bridge/contracts/workspace.ts)、[../team/TeamView.tsx](../team/TeamView.tsx)、[../workspace/WorkspaceView.tsx](../workspace/WorkspaceView.tsx)、[../automation/AutomationView.tsx](../automation/AutomationView.tsx)、[../diagnostics/WorkspaceDiagnostics.tsx](../diagnostics/WorkspaceDiagnostics.tsx)、[../components/Icon.tsx](../components/Icon.tsx)、[extensions.css](extensions.css)。

### extensions.css

```mermaid
classDiagram
class N_src_frontend_shell_extensions_css["extensions.css"] {
  <<stylesheet>>
}
```

### shell.css

```mermaid
classDiagram
class N_src_frontend_shell_shell_css["shell.css"] {
  <<stylesheet>>
}
```

### state-labels.ts

```mermaid
classDiagram
class N_src_frontend_shell_state_labels_ts["state-labels.ts"] {
  <<module>>
}
```

### tabs.ts

```mermaid
classDiagram
class N_src_frontend_shell_tabs_ts["tabs.ts"] {
  <<module>>
}
class N_src_frontend_shell_tabs_ts_TabKind["TabKind"] {
  <<type>>

}
N_src_frontend_shell_tabs_ts ..> N_src_frontend_shell_tabs_ts_TabKind : 声明
class N_src_frontend_shell_tabs_ts_ViewTab["ViewTab"] {
  <<interface>>
  +id
  +kind
  +title
  +draft
  +taskId
  +attachments
}
N_src_frontend_shell_tabs_ts ..> N_src_frontend_shell_tabs_ts_ViewTab : 声明
class N_src_frontend_shell_tabs_ts_TabLayout["TabLayout"] {
  <<interface>>
  +tabs
  +active
}
N_src_frontend_shell_tabs_ts ..> N_src_frontend_shell_tabs_ts_TabLayout : 声明
class N_src_frontend_shell_tabs_ts_Layouts["Layouts"] {
  <<type>>

}
N_src_frontend_shell_tabs_ts ..> N_src_frontend_shell_tabs_ts_Layouts : 声明
```

直接依赖：[../../bridge/contracts/chat.ts](../../bridge/contracts/chat.ts)。

### UserMenu.tsx

```mermaid
classDiagram
class N_src_frontend_shell_UserMenu_tsx["UserMenu.tsx"] {
  <<component>>
  +UserMenu()
}
```
直接依赖：[../components/Icon.tsx](../components/Icon.tsx)。

### useSidebarWidth.ts

```mermaid
classDiagram
class N_src_frontend_shell_useSidebarWidth_ts["useSidebarWidth.ts"] {
  <<module>>
  +useSidebarWidth()
}
```

### workspace-list.css

```mermaid
classDiagram
class N_src_frontend_shell_workspace_list_css["workspace-list.css"] {
  <<stylesheet>>
}
```

### WorkspaceList.tsx

```mermaid
classDiagram
class N_src_frontend_shell_WorkspaceList_tsx["WorkspaceList.tsx"] {
  <<component>>
  +WorkspaceList()
}
```
直接依赖：[../../bridge/contracts/workspace.ts](../../bridge/contracts/workspace.ts)、[tabs.ts](tabs.ts)、[../components/Icon.tsx](../components/Icon.tsx)、[state-labels.ts](state-labels.ts)、[workspace-list.css](workspace-list.css)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_frontend_shell_App_tsx["App.tsx"] {
  <<component>>
}
class N_src_frontend_shell_WorkspaceList_tsx["WorkspaceList.tsx"] {
  <<component>>
}
class N_src_frontend_shell_ExtensionArea_tsx["ExtensionArea.tsx"] {
  <<component>>
}
class N_src_frontend_shell_tabs_ts["tabs.ts"] {
  <<module>>
}
class N_src_frontend_shell_UserMenu_tsx["UserMenu.tsx"] {
  <<component>>
}
N_src_frontend_shell_App_tsx ..> N_src_frontend_shell_WorkspaceList_tsx : 导入依赖
N_src_frontend_shell_App_tsx ..> N_src_frontend_shell_ExtensionArea_tsx : 导入依赖
N_src_frontend_shell_App_tsx ..> N_src_frontend_shell_tabs_ts : 导入依赖
N_src_frontend_shell_App_tsx ..> N_src_frontend_shell_UserMenu_tsx : 导入依赖
```

```mermaid
classDiagram
class N_src_frontend_shell_App_tsx["App.tsx"] {
  <<component>>
}
class N_src_frontend_shell_useSidebarWidth_ts["useSidebarWidth.ts"] {
  <<module>>
}
class N_src_frontend_shell_state_labels_ts["state-labels.ts"] {
  <<module>>
}
class N_src_frontend_shell_ExtensionArea_tsx["ExtensionArea.tsx"] {
  <<component>>
}
class N_src_frontend_shell_extensions_css["extensions.css"] {
  <<stylesheet>>
}
class N_src_frontend_shell_WorkspaceList_tsx["WorkspaceList.tsx"] {
  <<component>>
}
class N_src_frontend_shell_tabs_ts["tabs.ts"] {
  <<module>>
}
N_src_frontend_shell_App_tsx ..> N_src_frontend_shell_useSidebarWidth_ts : 导入依赖
N_src_frontend_shell_App_tsx ..> N_src_frontend_shell_state_labels_ts : 导入依赖
N_src_frontend_shell_ExtensionArea_tsx ..> N_src_frontend_shell_extensions_css : 导入依赖
N_src_frontend_shell_WorkspaceList_tsx ..> N_src_frontend_shell_tabs_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_frontend_shell_WorkspaceList_tsx["WorkspaceList.tsx"] {
  <<component>>
}
class N_src_frontend_shell_state_labels_ts["state-labels.ts"] {
  <<module>>
}
class N_src_frontend_shell_workspace_list_css["workspace-list.css"] {
  <<stylesheet>>
}
N_src_frontend_shell_WorkspaceList_tsx ..> N_src_frontend_shell_state_labels_ts : 导入依赖
N_src_frontend_shell_WorkspaceList_tsx ..> N_src_frontend_shell_workspace_list_css : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
