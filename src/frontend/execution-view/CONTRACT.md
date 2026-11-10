# 共享执行展示边界

本目录承接主对话、成员详情和团队履历的真实公共消费者。transcript 只投影公开日志；MarkdownMessage 保留流式修复、受控链接和复制；WorkStatus 与 ToolTimeline 只显示传入运行事实，回合结束不代表业务目标验收。

WorkStatus 接收可选 activityDetails，ToolTimeline 接收按原调用 ID 的 renderControls。任务领域在 tasks/ToolActivity 组合命令核实、影响观察及恢复上下文；共享层不导入任务状态或页面，不查询或启动恢复。主对话负责组合任务域控制，成员履历默认只读轨道，无伪造主来源的核实入口。

QuestionCard、ComposerAttachments 和 MessageQueue 只保持已有展示和显式交互：本地选择不提交，附件预览仅显式读取已保存快照，排队操作由调用方回调执行。原 CSS 类名、事件顺序、身份核对、错误展示和原始回执保留。
