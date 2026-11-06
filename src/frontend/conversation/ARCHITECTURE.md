# src/frontend/conversation 架构

## 目录定位

中央主对话、输入、附件、队列及工具状态。执行成员卡片与主对话分离，结果回注显示系统来源，不伪造用户气泡；增量同步且切换保留草稿。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [AttachmentMenu.tsx](AttachmentMenu.tsx) | Cindy 风格的加号上下文菜单，接入 CBIM 原生选择器与附件快照服务。 |
| [brain-status.ts](brain-status.ts) | 将公开运行事件投影为输入框左上角的大脑状态。 |
| [ComposerAttachments.tsx](ComposerAttachments.tsx) | 按 Cindy ThumbnailStrip 的 56px 卡片、类型标识和角落移除按钮展示草稿附件。 |
| [ComposerCard.tsx](ComposerCard.tsx) | 从 Cindy ComposerCard 移植的统一输入卡片与内容间距。 |
| [ComposerPicker.tsx](ComposerPicker.tsx) | Cindy 风格的权限和模型 chip，向上展开可搜索、键盘可操作的选择面板。 |
| [conversation.css](conversation.css) | 对齐 Cindy 的消息列、工作记录折叠行及一体式底部输入框。 |
| [Conversation.tsx](Conversation.tsx) | 会话双页签入口（对话/本会话任务），默认主 Agent 普通对话、启动与继续大脑、展示流式 Markdown 正文和按生命周期合并的工具证据，移植 Cindy 输入组件并适配上下文附件、权限审批及本次运行全部通过、结构化选项提问、持久化消息队列及任务用时、生成速度、价值和上下文计量。 |
| [MarkdownMessage.tsx](MarkdownMessage.tsx) | 将 Agent 消息渲染成排版后的正文、列表、表格与可复制代码块。 |
| [message-queue.css](message-queue.css) | 与输入框一体的紧凑队列，匹配参考图的单行消息、拖柄及悬停圆形操作。 |
| [MessageCard.tsx](MessageCard.tsx) | 复用 Cindy ChatBubble 的用户气泡/助手裸正文布局，承载消息时间和复制操作。 |
| [MessageQueue.tsx](MessageQueue.tsx) | 展示主进程持久化的待执行消息，提供插队、排序、移除及继续操作。 |
| [QuestionCard.tsx](QuestionCard.tsx) | 展示 Agent 的结构化问题，以选项卡及最后一项其它输入收集答案。 |
| [questions.css](questions.css) | 结构化问题卡片的主题、选中态和输入排版。 |
| [queue-sync.ts](queue-sync.ts) | 把主进程队列增量合并为稳定的消息数组，供轮询与操作后刷新共同使用。 |
| [repairStreamingMarkdown.ts](repairStreamingMarkdown.ts) | 显示正在流入的 Markdown 时临时补齐未闭合语法。 |
| [SendButton.tsx](SendButton.tsx) | 从 Cindy SendButton 移植发送/停止的固定 28px 按钮和按下动作身份保护。 |
| [session-tabs.css](session-tabs.css) | 会话中央区域的对话/任务双页签与任务记录排版。 |
| [ToolActivity.tsx](ToolActivity.tsx) | 把工具申请、授权、运行、输出及完成记录合并成可展开的执行时间线。 |
| [transcript.ts](transcript.ts) | 将持久化执行事件投影为对话消息、工具证据与运行错误。 |
| [usage.css](usage.css) | 输入框旁计量条、上下文环与明细弹层的排版。 |
| [usage.ts](usage.ts) | 保留对话界面的用量统计入口，经桥接契约使用 Core 的纯计量函数。 |
| [UsageStatus.tsx](UsageStatus.tsx) | Cindy 风格的输入框上方时间/速度与底部任务价值、上下文占用显示。 |
| [useMessageQueue.ts](useMessageQueue.ts) | 会话队列的独立增量刷新入口，覆盖轮询和用户操作后的即时同步。 |
| [WorkStatus.tsx](WorkStatus.tsx) | 移植 Cindy WorkGroupBlock 的折叠标题、运行旋转图标、实时活动预览和执行轨道。 |

## 架构类图

### AttachmentMenu.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_AttachmentMenu_tsx["AttachmentMenu.tsx"] {
  <<component>>
  +AttachmentMenu()
}
```

直接依赖：[../components/Icon.tsx](../components/Icon.tsx)、[../../bridge/contracts/chat.ts](../../bridge/contracts/chat.ts)。

### brain-status.ts

```mermaid
classDiagram
class N_src_frontend_conversation_brain_status_ts["brain-status.ts"] {
  <<module>>
  +brainStatus()
}
```

直接依赖：[../../bridge/contracts/execution.ts](../../bridge/contracts/execution.ts)。

### ComposerAttachments.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_ComposerAttachments_tsx["ComposerAttachments.tsx"] {
  <<component>>
  +ComposerAttachments()
}
```

直接依赖：[../../bridge/contracts/chat.ts](../../bridge/contracts/chat.ts)、[../components/Icon.tsx](../components/Icon.tsx)。

### ComposerCard.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_ComposerCard_tsx["ComposerCard.tsx"] {
  <<component>>
  +ComposerCard()
}
```


### ComposerPicker.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_ComposerPicker_tsx["ComposerPicker.tsx"] {
  <<component>>
  +ComposerPicker()
}
```

```mermaid
classDiagram
class N_src_frontend_conversation_ComposerPicker_tsx["ComposerPicker.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_ComposerPicker_tsx_ComposerOption["ComposerOption"] {
  <<interface>>
  +value
  +label
  +description
  +group
  +icon
}
N_src_frontend_conversation_ComposerPicker_tsx ..> N_src_frontend_conversation_ComposerPicker_tsx_ComposerOption : 声明
```

直接依赖：[../components/Icon.tsx](../components/Icon.tsx)。

### conversation.css

```mermaid
classDiagram
class N_src_frontend_conversation_conversation_css["conversation.css"] {
  <<stylesheet>>
}
```

### Conversation.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_Conversation_tsx["Conversation.tsx"] {
  <<component>>
  +Conversation()
}
```

```mermaid
classDiagram
class N_src_frontend_conversation_Conversation_tsx["Conversation.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_Conversation_tsx_HistoryItem["HistoryItem"] {
  <<interface>>
  +task
  +runId
  +status
  +error
}
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_Conversation_tsx_HistoryItem : 声明
```

直接依赖：[../../bridge/contracts/workspace.ts](../../bridge/contracts/workspace.ts)、[../../bridge/contracts/execution.ts](../../bridge/contracts/execution.ts)、[../../bridge/contracts/models.ts](../../bridge/contracts/models.ts)、[../shell/tabs.ts](../shell/tabs.ts)、[transcript.ts](transcript.ts)、[MarkdownMessage.tsx](MarkdownMessage.tsx)、[WorkStatus.tsx](WorkStatus.tsx)、[../tasks/SessionTaskView.tsx](../tasks/SessionTaskView.tsx)、[../tasks/useSessionGraph.ts](../tasks/useSessionGraph.ts)、[../tasks/MemberActivity.tsx](../tasks/MemberActivity.tsx)、[session-tabs.css](session-tabs.css)、[MessageQueue.tsx](MessageQueue.tsx)、[useMessageQueue.ts](useMessageQueue.ts)、[QuestionCard.tsx](QuestionCard.tsx)、[UsageStatus.tsx](UsageStatus.tsx)、[MessageCard.tsx](MessageCard.tsx)、[../components/Icon.tsx](../components/Icon.tsx)、[conversation.css](conversation.css)、[ComposerCard.tsx](ComposerCard.tsx)、[SendButton.tsx](SendButton.tsx)、[AttachmentMenu.tsx](AttachmentMenu.tsx)、[ComposerPicker.tsx](ComposerPicker.tsx)、[ComposerAttachments.tsx](ComposerAttachments.tsx)、[../../bridge/contracts/chat.ts](../../bridge/contracts/chat.ts)。

### MarkdownMessage.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_MarkdownMessage_tsx["MarkdownMessage.tsx"] {
  <<component>>
  +MarkdownMessage()
}
```

直接依赖：[repairStreamingMarkdown.ts](repairStreamingMarkdown.ts)。

### message-queue.css

```mermaid
classDiagram
class N_src_frontend_conversation_message_queue_css["message-queue.css"] {
  <<stylesheet>>
}
```

### MessageCard.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_MessageCard_tsx["MessageCard.tsx"] {
  <<component>>
  +MessageCard()
}
```


### MessageQueue.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_MessageQueue_tsx["MessageQueue.tsx"] {
  <<component>>
  +MessageQueue()
}
```

直接依赖：[../../bridge/contracts/execution.ts](../../bridge/contracts/execution.ts)、[message-queue.css](message-queue.css)。

### QuestionCard.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_QuestionCard_tsx["QuestionCard.tsx"] {
  <<component>>
  +QuestionCard()
}
```

直接依赖：[../../bridge/contracts/execution.ts](../../bridge/contracts/execution.ts)、[questions.css](questions.css)。

### questions.css

```mermaid
classDiagram
class N_src_frontend_conversation_questions_css["questions.css"] {
  <<stylesheet>>
}
```

### queue-sync.ts

```mermaid
classDiagram
class N_src_frontend_conversation_queue_sync_ts["queue-sync.ts"] {
  <<module>>
}
class N_src_frontend_conversation_queue_sync_ts_QueueProjection["QueueProjection"] {
  +cursor
  +items
  +apply()
}
N_src_frontend_conversation_queue_sync_ts ..> N_src_frontend_conversation_queue_sync_ts_QueueProjection : 声明
```

直接依赖：[../../bridge/contracts/execution.ts](../../bridge/contracts/execution.ts)。

### repairStreamingMarkdown.ts

```mermaid
classDiagram
class N_src_frontend_conversation_repairStreamingMarkdown_ts["repairStreamingMarkdown.ts"] {
  <<module>>
  +repairStreamingMarkdown()
}
```


### SendButton.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_SendButton_tsx["SendButton.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_SendButton_tsx_SendButtonProps["SendButtonProps"] {
  <<interface>>
  +disabled
  +onClick
  +isStreaming
  +queued
}
N_src_frontend_conversation_SendButton_tsx ..> N_src_frontend_conversation_SendButton_tsx_SendButtonProps : 声明
```


### session-tabs.css

```mermaid
classDiagram
class N_src_frontend_conversation_session_tabs_css["session-tabs.css"] {
  <<stylesheet>>
}
```

### ToolActivity.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_ToolActivity_tsx["ToolActivity.tsx"] {
  <<component>>
  +ToolActivity()
}
```

直接依赖：[../../bridge/contracts/execution.ts](../../bridge/contracts/execution.ts)。

### transcript.ts

```mermaid
classDiagram
class N_src_frontend_conversation_transcript_ts["transcript.ts"] {
  <<module>>
  +transcript()
}
```

```mermaid
classDiagram
class N_src_frontend_conversation_transcript_ts["transcript.ts"] {
  <<module>>
}
class N_src_frontend_conversation_transcript_ts_ChatItem["ChatItem"] {
  <<interface>>
  +id
  +kind
  +text
  +pending
  +attachments
}
N_src_frontend_conversation_transcript_ts ..> N_src_frontend_conversation_transcript_ts_ChatItem : 声明
```

直接依赖：[../../bridge/contracts/execution.ts](../../bridge/contracts/execution.ts)、[../../bridge/contracts/models.ts](../../bridge/contracts/models.ts)。

### usage.css

```mermaid
classDiagram
class N_src_frontend_conversation_usage_css["usage.css"] {
  <<stylesheet>>
}
```

### usage.ts

```mermaid
classDiagram
class N_src_frontend_conversation_usage_ts["usage.ts"] {
  <<module>>
}
```
直接依赖：[../../bridge/contracts/usage.ts](../../bridge/contracts/usage.ts)。

### UsageStatus.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_UsageStatus_tsx["UsageStatus.tsx"] {
  <<component>>
  +UsageStatus()
}
```

直接依赖：[../../bridge/contracts/execution.ts](../../bridge/contracts/execution.ts)、[brain-status.ts](brain-status.ts)、[../components/Icon.tsx](../components/Icon.tsx)、[usage.ts](usage.ts)、[usage.css](usage.css)。

### useMessageQueue.ts

```mermaid
classDiagram
class N_src_frontend_conversation_useMessageQueue_ts["useMessageQueue.ts"] {
  <<module>>
  +useMessageQueue()
}
```

直接依赖：[queue-sync.ts](queue-sync.ts)、[../../bridge/contracts/execution.ts](../../bridge/contracts/execution.ts)。

### WorkStatus.tsx

```mermaid
classDiagram
class N_src_frontend_conversation_WorkStatus_tsx["WorkStatus.tsx"] {
  <<component>>
  +WorkStatus()
}
```

直接依赖：[../../bridge/contracts/execution.ts](../../bridge/contracts/execution.ts)、[../components/Icon.tsx](../components/Icon.tsx)、[ToolActivity.tsx](ToolActivity.tsx)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_frontend_conversation_Conversation_tsx["Conversation.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_transcript_ts["transcript.ts"] {
  <<module>>
}
class N_src_frontend_conversation_MarkdownMessage_tsx["MarkdownMessage.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_WorkStatus_tsx["WorkStatus.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_session_tabs_css["session-tabs.css"] {
  <<stylesheet>>
}
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_transcript_ts : 导入依赖
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_MarkdownMessage_tsx : 导入依赖
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_WorkStatus_tsx : 导入依赖
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_session_tabs_css : 导入依赖
```

```mermaid
classDiagram
class N_src_frontend_conversation_Conversation_tsx["Conversation.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_MessageQueue_tsx["MessageQueue.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_useMessageQueue_ts["useMessageQueue.ts"] {
  <<module>>
}
class N_src_frontend_conversation_QuestionCard_tsx["QuestionCard.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_UsageStatus_tsx["UsageStatus.tsx"] {
  <<component>>
}
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_MessageQueue_tsx : 导入依赖
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_useMessageQueue_ts : 导入依赖
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_QuestionCard_tsx : 导入依赖
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_UsageStatus_tsx : 导入依赖
```

```mermaid
classDiagram
class N_src_frontend_conversation_Conversation_tsx["Conversation.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_MessageCard_tsx["MessageCard.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_conversation_css["conversation.css"] {
  <<stylesheet>>
}
class N_src_frontend_conversation_ComposerCard_tsx["ComposerCard.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_SendButton_tsx["SendButton.tsx"] {
  <<component>>
}
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_MessageCard_tsx : 导入依赖
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_conversation_css : 导入依赖
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_ComposerCard_tsx : 导入依赖
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_SendButton_tsx : 导入依赖
```

```mermaid
classDiagram
class N_src_frontend_conversation_Conversation_tsx["Conversation.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_AttachmentMenu_tsx["AttachmentMenu.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_ComposerPicker_tsx["ComposerPicker.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_ComposerAttachments_tsx["ComposerAttachments.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_MarkdownMessage_tsx["MarkdownMessage.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_repairStreamingMarkdown_ts["repairStreamingMarkdown.ts"] {
  <<module>>
}
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_AttachmentMenu_tsx : 导入依赖
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_ComposerPicker_tsx : 导入依赖
N_src_frontend_conversation_Conversation_tsx ..> N_src_frontend_conversation_ComposerAttachments_tsx : 导入依赖
N_src_frontend_conversation_MarkdownMessage_tsx ..> N_src_frontend_conversation_repairStreamingMarkdown_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_frontend_conversation_MessageQueue_tsx["MessageQueue.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_message_queue_css["message-queue.css"] {
  <<stylesheet>>
}
class N_src_frontend_conversation_QuestionCard_tsx["QuestionCard.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_questions_css["questions.css"] {
  <<stylesheet>>
}
class N_src_frontend_conversation_UsageStatus_tsx["UsageStatus.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_brain_status_ts["brain-status.ts"] {
  <<module>>
}
class N_src_frontend_conversation_usage_ts["usage.ts"] {
  <<module>>
}
N_src_frontend_conversation_MessageQueue_tsx ..> N_src_frontend_conversation_message_queue_css : 导入依赖
N_src_frontend_conversation_QuestionCard_tsx ..> N_src_frontend_conversation_questions_css : 导入依赖
N_src_frontend_conversation_UsageStatus_tsx ..> N_src_frontend_conversation_brain_status_ts : 导入依赖
N_src_frontend_conversation_UsageStatus_tsx ..> N_src_frontend_conversation_usage_ts : 导入依赖
```

```mermaid
classDiagram
class N_src_frontend_conversation_UsageStatus_tsx["UsageStatus.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_usage_css["usage.css"] {
  <<stylesheet>>
}
class N_src_frontend_conversation_useMessageQueue_ts["useMessageQueue.ts"] {
  <<module>>
}
class N_src_frontend_conversation_queue_sync_ts["queue-sync.ts"] {
  <<module>>
}
class N_src_frontend_conversation_WorkStatus_tsx["WorkStatus.tsx"] {
  <<component>>
}
class N_src_frontend_conversation_ToolActivity_tsx["ToolActivity.tsx"] {
  <<component>>
}
N_src_frontend_conversation_UsageStatus_tsx ..> N_src_frontend_conversation_usage_css : 导入依赖
N_src_frontend_conversation_useMessageQueue_ts ..> N_src_frontend_conversation_queue_sync_ts : 导入依赖
N_src_frontend_conversation_WorkStatus_tsx ..> N_src_frontend_conversation_ToolActivity_tsx : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
