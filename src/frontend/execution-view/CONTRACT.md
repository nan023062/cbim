# 共享执行展示边界

公开助手正文包含反馈提交后的最终答复，不再被成功工具回执隐藏；空完整消息不能擦除已流出的文字。completionFeedback 供主对话只读兜底：本轮无结束正文时显示当前轮交付声明及限制，否则明确未记录最终反馈、操作数量与核实建议；不复用旧轮 taskProgress，不改日志、不追加模型调用或将结束视为验收。

本目录承接主对话、成员详情和团队履历的真实公共消费者。transcript 只投影公开日志；MarkdownMessage 保留流式修复、受控链接和复制；WorkStatus 与 ToolTimeline 只显示传入运行事实，回合结束不代表业务目标验收。

WorkStatus 接收可选 activityDetails，ToolTimeline 接收按原调用 ID 的 renderControls。任务领域在 tasks/ToolActivity 组合命令核实、影响观察及恢复上下文；共享层不导入任务状态或页面，不查询或启动恢复。主对话负责组合任务域控制，成员履历默认只读轨道，无伪造主来源的核实入口。

QuestionCard、ComposerAttachments 和 MessageQueue 只保持已有展示和显式交互：本地选择不提交，附件预览仅显式读取已保存快照，排队操作由调用方回调执行。原 CSS 类名、事件顺序、身份核对、错误展示和原始回执保留。

## 知识操作状态

knowledge-tool-view 仅接受原 finished 调用的完整、同工作区知识输出。预览的 structural:false 展示为警告，并逐项保留 validation.issues；提交的 committed 回执展示事务与知识版本，不能推导业务验收。缺失、异常、跨工作区和混杂文本均不推断成功。ToolTimeline 给控制插槽提供 attention；失败、中断或返回丢失突出核实入口，成功操作默认折叠。

### 失败与熔断显示

ToolTimeline 在失败或未确认调用旁展示运行记录中的 nextStep；engine.status 的 label 缺省时使用 message/state，显示真实熔断原因。仅展示文本，不生成自动重试/核实动作，不改变原运行或业务验收状态。
