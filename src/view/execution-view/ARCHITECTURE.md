# src/view/execution-view 架构

<a id="contract"></a>

## 设计意图

为主对话、成员任务和履历复用同一套执行正文与工具过程展示，保持表现与业务处置分离。

事件投影生成消息与工具事实，`ToolTimeline`、`MarkdownMessage`、`WorkStatus` 和 `QuestionCard` 分别展示过程、正文、状态和问题；Agent 调用详情按真实引用逐层读取。处置由调用页面注入，展开记录不意味着重新执行。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [MarkdownMessage](MarkdownMessage.tsx) | 将 Agent 消息渲染成排版后的正文、列表、表格与可复制代码块。 |
| [ToolTimeline](ToolTimeline.tsx) | 把工具申请、授权、运行、输出及完成记录合并成可展开的执行时间线。 |
| [WorkStatus](WorkStatus.tsx) | 移植 Cindy WorkGroupBlock 的用时和结果；主对话只显示行尾状态，成员详情仍可折叠查看执行轨道。 |
| [QuestionCard](QuestionCard.tsx) | 展示 Agent 的结构化问题，以选项卡及最后一项其它输入收集答案。 |
| [transcript](transcript.ts) | 将持久化执行事件投影为对话消息、工具证据与运行错误，目标返工反馈明确显示为系统消息。 |
| [AgentCallDetails](AgentCallDetails.tsx) | 按真实调用引用读取执行 Agent 对话，沿相同工具轨道逐层展开。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_55fd79899bee["AgentCallDetails"] {
  <<component>>
}
click N_55fd79899bee href "AgentCallDetails.tsx"
class N_1dca04f0120e["MarkdownMessage"] {
  <<component>>
}
click N_1dca04f0120e href "MarkdownMessage.tsx"
class N_024d4d4e5bf8["ToolTimeline"] {
  <<component>>
}
click N_024d4d4e5bf8 href "ToolTimeline.tsx"
class N_8cfe1bc3fd78["transcript"] {
  <<module>>
}
click N_8cfe1bc3fd78 href "transcript.ts"
class N_2ac64a3ad96a["WorkStatus"] {
  <<component>>
}
click N_2ac64a3ad96a href "WorkStatus.tsx"
class N_daa155c19dfb["QuestionCard"] {
  <<component>>
}
click N_daa155c19dfb href "QuestionCard.tsx"
N_2ac64a3ad96a ..> N_024d4d4e5bf8 : 依赖
N_55fd79899bee ..> N_1dca04f0120e : 依赖
N_55fd79899bee ..> N_024d4d4e5bf8 : 依赖
N_55fd79899bee ..> N_8cfe1bc3fd78 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
