# 共享运行展示契约

`WorkStatus`、`ToolActivity`、`MarkdownMessage`、`transcript`、`tool-labels` 和 `repairStreamingMarkdown` 由主对话、成员任务与历史页面共用。只消费公开运行快照、原始文本和明确的展示输入，不导入 conversation/tasks/team 的控制器、Hook 或内部类型；逻辑边界检查同时覆盖类型依赖。

- `ToolDetailsSelection` 只包含原 run、toolCallId 和 toolName。外层可用 `renderDetails` / `renderToolDetails` 组合业务面板，共享展示不会取得恢复上下文。单调用筛选只生成对应插槽，inline 行尾状态不生成隐藏业务面板。
- `conversation/RunToolDetails` 校验真实主来源后装配原命令核实与影响观察。主对话和任务根显式传递自己的恢复上下文；成员历史沿用原主身份判定，不伪造恢复权。选择、刷新、停止、核实与恢复仍归原业务控制者。
- 失败、拒绝、未知和原工具回执均按原日志展示；终态用时取日志末尾，结束不等于验收。相同输入共用同一展示实现，无第二份任务状态。
- Markdown 的复制和展开为本地展示状态；用户点击链接仍走固定 `chat.openLink`，由 Main 核实工作区及目标。渲染不读取业务文件、不发送执行命令；它不是完全无交互的纯函数。
- transcript 沿原事件和可信反馈回执投影，私有推理过滤与消息排序不因迁移改变。样式继续使用应用既有全局样式。

旧 conversation 中六个文件已退役，仓库内消费者均改为直接导入本目录；无外部公开包兼容承诺，不保留会重新引入业务依赖的转发层。
