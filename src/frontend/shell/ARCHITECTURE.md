# src/frontend/shell 架构

## 目录定位

工作区侧栏、会话选择、用户栏与右侧扩展页签；会话区与项目级视图区分开。向会话传递活动页签状态，隐藏页签保留草稿/节点选择并降低成员与任务图同步频率。 账号菜单和新版提醒打开独立更新弹窗，当前页面及草稿保持挂载，不隐式下载或重启。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [App.tsx](App.tsx) | 桌面外壳：工作区下展示对话，中间固定主 Agent 会话（对话/任务视图），右侧独立扩展区承载架构/流程等视图；可调整宽度的侧边栏、工作区选择、页签、轮询、全局页面和未提交修改提示。 |
| [ExtensionArea.tsx](ExtensionArea.tsx) | 工作区右侧扩展页签，独立于中央对话管理浏览器、命令终端、架构与内部运行诊断视图。 |
| [extensions.css](extensions.css) | 中央对话与右侧扩展区的分栏、空页签及各扩展面板布局。 |
| [runtime-navigation.ts](runtime-navigation.ts) | 把全局运行页的定位目标核对为现有主会话，并只更新本机页签与任务图选择。 |
| [shell.css](shell.css) | 工作区外壳、侧栏、页签、菜单和主题布局样式。 |
| [state-labels.ts](state-labels.ts) | 界面工作区与工具任务状态的中文标签。 |
| [tabs.ts](tabs.ts) | 页签种类、默认布局、排序与本机布局恢复。 |
| [UserMenu.tsx](UserMenu.tsx) | 本地账号菜单、主题与设置入口，以及当前版本、检查更新和最近一次更新入口。 |
| [useSidebarWidth.ts](useSidebarWidth.ts) | 管理侧边栏宽度、拖动与键盘调整，并在本地保留布局。 |
| [workspace-list.css](workspace-list.css) | 工作区树、名称旁的折叠按钮及点击位置浮动菜单。 |
| [WorkspaceList.tsx](WorkspaceList.tsx) | 工作区树、对话条目管理与工作区浮动操作菜单。 |

## 架构类图

### App.tsx

```mermaid
classDiagram
class N_src_frontend_shell_App_tsx["App.tsx"] {
  <<component>>
  +App()
}
```

直接依赖：[../../bridge/contracts/workspace.ts](../../bridge/contracts/workspace.ts)、[../resources/ResourceRepositoryView.tsx](../resources/ResourceRepositoryView.tsx)、[../settings/SettingsView.tsx](../settings/SettingsView.tsx)、[../updates/SoftwareUpdates.tsx](../updates/SoftwareUpdates.tsx)、[../updates/useSoftwareUpdates.ts](../updates/useSoftwareUpdates.ts)、[../conversation/conversation-activity.ts](../conversation/conversation-activity.ts)、[WorkspaceList.tsx](WorkspaceList.tsx)、[ExtensionArea.tsx](ExtensionArea.tsx)、[../../bridge/contracts/resources.ts](../../bridge/contracts/resources.ts)、[tabs.ts](tabs.ts)、[../components/Icon.tsx](../components/Icon.tsx)、[../components/BrandMark.tsx](../components/BrandMark.tsx)、[../components/Empty.tsx](../components/Empty.tsx)、[../conversation/Conversation.tsx](../conversation/Conversation.tsx)、[UserMenu.tsx](UserMenu.tsx)、[useSidebarWidth.ts](useSidebarWidth.ts)、[state-labels.ts](state-labels.ts)、[../runtime/RuntimeOverview.tsx](../runtime/RuntimeOverview.tsx)、[../runtime/runtime-view-state.ts](../runtime/runtime-view-state.ts)、[runtime-navigation.ts](runtime-navigation.ts)。

### ExtensionArea.tsx

```mermaid
classDiagram
class N_src_frontend_shell_ExtensionArea_tsx["ExtensionArea.tsx"] {
  <<component>>
  +ExtensionArea()
}
```

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
  +id
  +kind
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

### runtime-navigation.ts

```mermaid
classDiagram
class N_src_frontend_shell_runtime_navigation_ts["runtime-navigation.ts"] {
  <<module>>
  +bindRuntimeConversation()
  +runtimeTaskSelection()
}
```

```mermaid
classDiagram
class N_src_frontend_shell_runtime_navigation_ts["runtime-navigation.ts"] {
  <<module>>
}
class N_src_frontend_shell_runtime_navigation_ts_RuntimeNavigationRequest["RuntimeNavigationRequest"] {
  <<interface>>
  +requestId
  +instanceId
}
N_src_frontend_shell_runtime_navigation_ts ..> N_src_frontend_shell_runtime_navigation_ts_RuntimeNavigationRequest : 声明
class N_src_frontend_shell_runtime_navigation_ts_external_RuntimeNavigationTarget["RuntimeNavigationTarget (外部契约)"] {
  <<external>>
}
N_src_frontend_shell_runtime_navigation_ts_external_RuntimeNavigationTarget <|-- N_src_frontend_shell_runtime_navigation_ts_RuntimeNavigationRequest
class N_src_frontend_shell_runtime_navigation_ts_VerifiedRuntimeNavigation["VerifiedRuntimeNavigation"] {
  <<interface>>
  +target
  +workspace
  +conversation
}
N_src_frontend_shell_runtime_navigation_ts ..> N_src_frontend_shell_runtime_navigation_ts_VerifiedRuntimeNavigation : 声明
class N_src_frontend_shell_runtime_navigation_ts_NavigationReader["NavigationReader"] {
  <<type>>

}
N_src_frontend_shell_runtime_navigation_ts ..> N_src_frontend_shell_runtime_navigation_ts_NavigationReader : 声明
class N_src_frontend_shell_runtime_navigation_ts_NavigationGraph["NavigationGraph"] {
  <<type>>
  +identity
  +root
  +tasks
}
N_src_frontend_shell_runtime_navigation_ts ..> N_src_frontend_shell_runtime_navigation_ts_NavigationGraph : 声明
```

```mermaid
classDiagram
class N_src_frontend_shell_runtime_navigation_ts["runtime-navigation.ts"] {
  <<module>>
}
class N_src_frontend_shell_runtime_navigation_ts_RuntimeNavigationResolver["RuntimeNavigationResolver"] {
  +cancel()
  +resolve()
  -read
  -generation
}
N_src_frontend_shell_runtime_navigation_ts ..> N_src_frontend_shell_runtime_navigation_ts_RuntimeNavigationResolver : 声明
```

直接依赖：[../../bridge/contracts/workspace.ts](../../bridge/contracts/workspace.ts)、[../../bridge/contracts/dispatch.ts](../../bridge/contracts/dispatch.ts)、[../runtime/runtime-view-state.ts](../runtime/runtime-view-state.ts)、[tabs.ts](tabs.ts)。

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
  +newTab()
  +initialLayout()
  +moveTab()
  +readLayouts()
  +mergeConversations()
  +renameConversation()
  +removeConversation()
}
```

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
  +customTitle
  +draft
  +taskId
  +attachments
}
N_src_frontend_shell_tabs_ts ..> N_src_frontend_shell_tabs_ts_ViewTab : 声明
class N_src_frontend_shell_tabs_ts_TabLayout["TabLayout"] {
  <<interface>>
  +tabs
  +active
  +hiddenTaskIds
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

直接依赖：[../components/Icon.tsx](../components/Icon.tsx)、[../../bridge/contracts/desktop-updates.ts](../../bridge/contracts/desktop-updates.ts)。

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

直接依赖：[../../bridge/contracts/workspace.ts](../../bridge/contracts/workspace.ts)、[tabs.ts](tabs.ts)、[../components/Icon.tsx](../components/Icon.tsx)、[../conversation/ConversationEntries.tsx](../conversation/ConversationEntries.tsx)、[state-labels.ts](state-labels.ts)、[workspace-list.css](workspace-list.css)。

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
class N_src_frontend_shell_runtime_navigation_ts["runtime-navigation.ts"] {
  <<module>>
}
class N_src_frontend_shell_ExtensionArea_tsx["ExtensionArea.tsx"] {
  <<component>>
}
class N_src_frontend_shell_extensions_css["extensions.css"] {
  <<stylesheet>>
}
N_src_frontend_shell_App_tsx ..> N_src_frontend_shell_useSidebarWidth_ts : 导入依赖
N_src_frontend_shell_App_tsx ..> N_src_frontend_shell_state_labels_ts : 导入依赖
N_src_frontend_shell_App_tsx ..> N_src_frontend_shell_runtime_navigation_ts : 导入依赖
N_src_frontend_shell_ExtensionArea_tsx ..> N_src_frontend_shell_extensions_css : 导入依赖
```

```mermaid
classDiagram
class N_src_frontend_shell_runtime_navigation_ts["runtime-navigation.ts"] {
  <<module>>
}
class N_src_frontend_shell_tabs_ts["tabs.ts"] {
  <<module>>
}
class N_src_frontend_shell_WorkspaceList_tsx["WorkspaceList.tsx"] {
  <<component>>
}
class N_src_frontend_shell_state_labels_ts["state-labels.ts"] {
  <<module>>
}
class N_src_frontend_shell_workspace_list_css["workspace-list.css"] {
  <<stylesheet>>
}
N_src_frontend_shell_runtime_navigation_ts ..> N_src_frontend_shell_tabs_ts : 导入依赖
N_src_frontend_shell_WorkspaceList_tsx ..> N_src_frontend_shell_tabs_ts : 导入依赖
N_src_frontend_shell_WorkspaceList_tsx ..> N_src_frontend_shell_state_labels_ts : 导入依赖
N_src_frontend_shell_WorkspaceList_tsx ..> N_src_frontend_shell_workspace_list_css : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

# 工作区外壳与原会话定位

对话列表与会话历史菜单共用 `ConversationEntries` 和本机 `TabLayout`：自定义标题不覆盖原任务目标，移除条目保存工作区隔离的 `hiddenTaskIds`，轮询和重开不复活；删除最后一项创建空对话，不停止后台运行或删除日志。运行总览的显式定位可以恢复被移除条目。红色运行灯取 `runtime.snapshot` 的 ready 工作区及实际主／成员 running 记录，排队、历史状态和持久等待不点亮，读取失败清除观察。工作区菜单使用 portal 以点击坐标锚定左上角，视口边缘避让，支持键盘与焦点返回；折叠按钮紧邻项目名。

`ExtensionArea` 向业务架构传递完整的 `WorkspaceView` 与共享快照，使负责人入口复用项目岗位登记时仍核实真实运行状态和实例。登记、返回原模块及选择状态由业务视图持有；外壳不生成岗位或执行责任写入。

`App` 保存工作区页签、草稿与附件，界面选择不代表后端运行。全局“运行管理”挂载独立只读 `RuntimeOverview`；离开该页卸载其读取，不创建或恢复任务。

侧栏使用大写简称 CBIM 和 `components/BrandMark`，欢迎页展示完整名称 CBIM Assistant。BrandMark 直接引用品牌 SVG，外壳样式只约束尺寸和排版；用户头像与产品标识保持各自语义，不改变账号或工作区状态。

账号菜单展示当前版本、检查／查看更新与“最近一次更新”，未登录也可使用。`App` 挂载唯一 `useSoftwareUpdates`，把同一快照交给 `UserMenu`、新版提醒与 `SoftwareUpdates` 弹窗；菜单不读取或修改更新服务。查看日志和点击提醒只打开原生模态框，不切换 screen，不触发离页检查或卸载原会话／设置表单；Escape／关闭回到原按钮。明确“检查更新”才请求检查，已有新版直接展示，下载与重启安装各自需要点击。

更新呈现独立归入 [updates](../updates/ARCHITECTURE.md)，通过固定 IPC 依赖公开更新契约，不将账号登录、菜单展示或弹窗状态放进 backend/updater。菜单位置是本次已确认的变化点；检查、下载与排空安装的规则保持原后端归属，变化频率没有统计结论。

```mermaid
classDiagram
class App { <<component>> }
class UserMenu { <<component>> }
class SoftwareUpdates { <<external component>> }
class useSoftwareUpdates { <<external module>> }
class BrandMark { <<external component>> }
App ..> BrandMark : 侧栏与欢迎页共用产品标识
App ..> UserMenu : 提供版本与入口回调
App ..> useSoftwareUpdates : 持有窗口级状态
App ..> SoftwareUpdates : 叠加弹窗，保留原页面
note for SoftwareUpdates "../updates/SoftwareUpdates.tsx：只消费更新状态与显式操作"
```

运行页的 `onOpen` 只携带 `workspaceId/rootSessionId` 与可选 `scopeId/taskId`。`RuntimeNavigationResolver` 依次读取工作区清单、该工作区的 `loop.list`、再次读取清单，要求同一实例始终为 running，且原根存在真实 chat 记录并属于该工作区。缺失、不可读或身份冲突明确失败，不调用 open、chat、resume、dispatch 或重试接口。

导航只复用已绑定该根的聊天页签；本机没有页签时，新增绑定真实历史的页签，不挪用未发送草稿页签，不改原标题、草稿或附件。两次点击不会建立重复绑定。切屏、新导航和卸载使旧请求失效，迟到失败也不覆盖新页面。工作区实例变化重新挂载会话投影，原本机草稿保持。

一次性 `RuntimeNavigationRequest` 交给 `Conversation`；任务图与周期加载完成后再次核对原身份并消费。选中旧周期仅影响展示，不改变实际开放目标。消费后请求清除，后续轮询或返回对话不会重复重置用户选择；不存在节点和周期不回退为最新目标。
