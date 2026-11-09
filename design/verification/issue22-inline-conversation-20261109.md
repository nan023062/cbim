# Issue #22：流式正文与工具内联

日期：2026-11-09。范围：主对话展示与原事件关联，不发布新版。工单：[GitHub #22](https://github.com/nan023062/cbim/issues/22)。

## 实现与边界

- 移除独立的“主 Agent 执行进展”和底部成员列表。正文、真实调用和后续正文穿插显示，同一调用只展示一条更新中的轨道，参数、原回执、拒绝/失败及显式核实保留。
- 成功派发旁展示原成员的等待、执行、候选及前置接收。先验证主运行/主实例、运行回执、派发输出和图游标；旧日志缺少证明时不猜关联，全部真实任务仍可从任务视图进入。候选不等于验收，前置接收只认原依赖边的 resultId。
- 成员过程默认折叠，展开才读取公开日志，折叠清理观察。系统交接明确显示成员到主 Agent 的来源，不伪造工具调用或用户消息。目标补充与审阅控制保持。
- 真实 Pi 的工具门禁经 HTTP、文字经 stdout，两者可交错落盘。完整公开 message 现在仅附带其原 toolCallIds，界面只修正同一段正文与相关调用的因果顺序；不改 canonical 日志，不保存思维/参数，不重排前一段或猜测旧历史。交错工具事件不再切断同一条流式消息的最终替换。

## 实际验证

- `pnpm typecheck`、`pnpm check:architecture` 通过：53 个目录、585 个代码/样式文件，依赖无循环。
- 分批定向验证去重后 **20 文件 / 138 项**通过。包含内联顺序/重读、跨身份/流/未追齐回执拒绝、候选和依赖、反馈静默、成员帮助/撤销/检查点、主工具输出、层级/依赖及真实 Pi 的长度中断、插入停止/未知回包。回执：`issue22-targeted.json`、`issue22-contracts.json`、`issue22-dependencies.json`、`issue22-order-regression.json`。
- `node scripts/issue22-inline-conversation-smoke.mjs`：实际 React App、持久形状的模拟 IPC，**8 组**通过。流式最终替换、文字/工具顺序、懒读取与折叠停止、系统交接、等待控件/阅读位置、重载、防误判完成、深浅色与 320px 均覆盖；页面错误 0，执行写入 0。
- `node scripts/issue20-input-performance-smoke.mjs after`：100 轮、400 条 Markdown、4 倍 CPU 降速，**5 组**输入/光标/组合输入/持久化/失败保留/新流式输出回归通过。因果顺序修复后的最终复验输入到下一帧中位数 **38.6 ms**、p95 **126.8 ms**，三类历史计算均为 0；仅作同机样本，不保证其他设备时延。初次 35 ms / 127 ms 报告保留为 `issue22-input-performance-initial.json`，最终为 `issue22-input-performance.json`。
- `pnpm package`：最终便携构建 **`20261109-223513`**。`pnpm exec tsx scripts/collaboration-ui-smoke.mts --inline-conversation --scope-goals` 使用真实 Electron、IPC、Pi 和独立项目/用户目录；只有模型响应是本地 SSE。真实登记负责人、保存计划、派发、读取文件证据、成员流式输出、内联详情导航、系统回传、候选/审阅、用户草稿、独立续聊与排队目标、完整应用重启均通过。主模型 8 次、成员 5 次请求，页面/传输错误均为 0，重启不重放，原文件保持。实际验证完整 message 持有原调用 ID，且说明位于派发之前。
- 桌面回执：`test-results/issue22-collaboration-scope-goals-ui-smoke.json`；界面回执：`issue22-ui-report.json`；截图保留浅色、深色、窄屏及真实桌面流式/回传/重启状态。

## 发现并修正的失败

1. 删除旧进展组件后，初次类型检查仍引用旧测试入口；迁移为内联测试后通过。
2. 最初直接导出主工具输出模块，将后端 `node:crypto` 带入浏览器而未能加载。提取纯 `dispatch-receipt`，主工具继续保留完整业务核实，浏览器与构建均通过。
3. UI 计数选择器同时数到了工具轨道与内部核实面板；限定为 `.chat-tool[data-tool-call-id]` 后验证单轨道，不删除核实入口。两次浏览器原失败保留为 `issue22-ui-failure-*.json/png`。
4. 旧桌面夹具假定默认 Team 且未登记负责岗位；第一次在 Auto 的工具清单断言处失败。明确选择团队模式并通过真实服务登记负责岗位及模型。`issue22-collaboration-initial-failure.*` 保留。
5. 第一版便携构建 `20261109-222615` 暴露跨通道落盘顺序错误；通过原 message 的调用 ID 关联修复，旧失败保留为 `issue22-collaboration-order-failure.*`，最终构建通过。
6. 旧 `member-ui-smoke` 夹具直接 IPC 派发而没有主调度周期，被 `DISPATCH_SCOPE_REQUIRED` 正确拒绝。旧入口现转入真实主工具协作验收；`issue12-ui-smoke` 同样转入替代后的内联界面验收，避免保留已退役面板的失效断言。原失败记录保留，未降低产品门禁。

## 维护交接

变化集中在会话呈现层：`transcript` 负责消息与调用关联，`ConversationToolCall` 组合原工具与按需成员过程，`inline-task-state` 只做真实归属投影。工具组件不反向依赖成员组件，避免 MemberRunTranscript → WorkStatus → ToolActivity 的循环。稳定的调度、授权、回执和任务存储保持原规则；Core 只提取共用纯 DTO，Pi 只追加公开关联元数据。

修改同类呈现时先读 conversation 的 CONTRACT，再改投影/组合组件；不要按名称或当前选中周期猜任务，也不要移除完整恢复依赖来优化渲染。调用关系变更需同时验证因果顺序、错误/未知证据、旧日志和 #20 输入性能。

已同步相关源码注释、五处 CONTRACT、六份 ARCHITECTURE（Pi、Core tasks、Bridge contracts、frontend、conversation、frontend tasks）及成员执行说明。没有操作真实安装版、线上模型服务或发布渠道；安装升级仍按独立发布流程执行。
