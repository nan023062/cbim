### 图片附件预览

ComposerAttachments 对已保存图片读取 chat.preview，卡片显示40px缩略图，弹窗展示原图、来源和采集说明；移除仅改变待发送选择，不删除源文件。图片使用固定MIME的data URI，不加载原路径/外部URL，字节不写入草稿持久化。异步预览在卸载或换工作区后失效；坏快照显示失败，不伪造图片。

# 共享执行展示边界

公开助手正文包含反馈提交后的最终答复，不再被成功工具回执隐藏；空完整消息不能擦除已流出的文字。completionFeedback 供主对话只读兜底：本轮无结束正文时显示当前轮交付声明及限制，否则明确未记录最终反馈、操作数量与核实建议；不复用旧轮 taskProgress，不改日志、不追加模型调用或将结束视为验收。

本目录承接主对话、成员详情和团队履历的真实公共消费者。transcript 只投影公开日志；MarkdownMessage 保留流式修复、受控链接和复制；WorkStatus 与 ToolTimeline 只显示传入运行事实，回合结束不代表业务目标验收。

WorkStatus 接收可选 activityDetails，ToolTimeline 接收按原调用 ID 的 renderControls。任务领域在 tasks/ToolActivity 组合命令核实、影响观察及恢复上下文；共享层不导入任务状态或页面，不查询或启动恢复。主对话负责组合任务域控制，成员履历默认只读轨道，无伪造主来源的核实入口。

QuestionCard、ComposerAttachments 和 MessageQueue 只保持已有展示和显式交互：本地选择不提交，附件预览仅显式读取已保存快照，排队操作由调用方回调执行。原 CSS 类名、事件顺序、身份核对、错误展示和原始回执保留。

## 知识操作状态

knowledge-tool-view 仅接受原 finished 调用的完整、同工作区知识输出。预览的 structural:false 展示为警告，并逐项保留 validation.issues；提交的 committed 回执展示事务与知识版本，不能推导业务验收。缺失、异常、跨工作区和混杂文本均不推断成功。ToolTimeline 给控制插槽提供 attention；失败、中断或返回丢失突出核实入口，成功操作默认折叠。

### 失败与熔断显示

ToolTimeline 在失败或未确认调用旁展示运行记录中的 nextStep；engine.status 的 label 缺省时使用 message/state，显示真实熔断原因。仅展示文本，不生成自动重试/核实动作，不改变原运行或业务验收状态。


## 明确拒绝与旧参数错误

ToolTimeline 按同一调用事件确认 tool.denied 且没有 tool.allowed/started/updated 时，只读渲染拒绝原因，并不调用核实控制插槽。tool-failure-view 兼容旧 message 内嵌的校验数组及当前 TOOL_INPUT_INVALID，展示缺失字段、格式说明与默认参数语义，不展示原始校验 JSON；原日志未修改。已放行或仅正文自称 rejected 的失败保持原核实入口，不能通过伪造正文隐藏可能发生的副作用。
### 团队逻辑对话投影

`team-conversations.ts` 供侧栏、成员文字页和办公室共用，不依赖任一业务页面。只接受同工作区/主根的正式 TeamSession；角色的不同执行实例统一到同一人物/导航项，公开任务引用保留原身份，正文仍按原 task/run 读取。`teamConversationKey` 以工作区实例隔离本机动态缓存。该模块只投影，不创建会话或修改执行。
