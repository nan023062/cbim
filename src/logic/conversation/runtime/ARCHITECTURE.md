# src/logic/conversation/runtime 架构

<a id="contract"></a>

## 设计意图

组织主会话执行、消息排队及交互等待，确保多次输入和系统接续保持真实来源与运行归属。

`WorkspaceExecutionManager` 协调主轮和可信接续，`MessageQueue` 保存待执行输入及发送时快照，`ApprovalQueue` 与 `QuestionQueue` 分别持有批准和待答状态。停止屏障与接续去重由执行管理器协调，队列回包不等于业务验收或成员任务完成。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ApprovalQueue](approvals.ts) | 任务内操作确认及本次运行全部放行的生命周期。 |
| [WorkspaceExecutionManager](execution-manager.ts) | 管理工作区主对话、可信结果与目标返工接续、多轮历史及队列；系统接续共用去重与停止屏障，业务成员经岗位派发领取。 |
| [MessageQueue](message-queue.ts) | 保存工作区各对话的待执行消息与发送时的模型/权限快照。 |
| [QuestionQueue](questions.ts) | 管理工作区内等待用户回答的结构化问题，供 Loop 工具与对话界面共享。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_6762d81e6aaa["WorkspaceExecutionManager"]
click N_6762d81e6aaa href "execution-manager.ts"
class N_13c29266c145["MessageQueue"]
click N_13c29266c145 href "message-queue.ts"
class N_949c2d8edde5["QuestionQueue"]
click N_949c2d8edde5 href "questions.ts"
class N_50d3bd28ff37["ApprovalQueue"]
click N_50d3bd28ff37 href "approvals.ts"
N_6762d81e6aaa ..> N_13c29266c145 : 依赖
N_6762d81e6aaa ..> N_949c2d8edde5 : 依赖
N_6762d81e6aaa ..> N_50d3bd28ff37 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
