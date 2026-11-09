# Issue #12：在主对话直接查看执行进展

本项在 #9、#11、#10 各自完成独立提交、测试及 GitHub 回填之后实施，基线为 `8ab9da0`。本次只改展示和验证脚本，没有新建后端执行、恢复或授权路径。

## 可见行为与维护入口

对话正文增加主 Agent 的执行进展：目标计划与模块分工、派发、当前成员状态、前置候选接收、交付摘要／证据数量／限制，以及审阅、失败和等待原因。最近六个节点默认可见，早期节点和长说明可展开。成员公开卡片直接展示当前步骤和候选，不必先展开工具日志。

`Conversation → ConversationProgress → conversationProgress` 复用 `useSessionGraph` 已核实的同一完整读取屏障，不增加轮询。投影核本工作区、会话、目标及版本，保留原图顺序，以稳定身份更新条目。它是持久事实的分组视图，不创造本机时间戳或将旧计划改写为新的审计事件；完整过程仍在原工具记录。重开从原记录还原；历史选择明确标注。滚动复用已有 ResizeObserver，用户上翻时不抢位置。

`MemberRunTranscript → MemberProgressSummary` 只排版原公开 `taskProgress`；当前工作步骤优先可见，其他步骤可展开。工具名称由 `toolLabel` 供 WorkStatus 和 ToolActivity 共用，失败／拒绝在折叠外可见。未接触私有推理、日志筛选或成员增量订阅。

候选始终标为尚未验收，步骤 `reported_done` 显示“已报告”；“完成申请待复核”和“目标已完成”继续由原 `scopeGoalView` 的可靠关闭条件区分。依赖接收取实际边中固定的 resultId，不从“来源任务看似完成”推断已消费。

同步了变更源码注释、conversation／tasks 的 CONTRACT 和目录架构、frontend 上层导航，以及[成员执行说明](../../docs/member-execution.md#主对话与任务流程图)。常规展示调整集中在前端纯投影和组件，后端权限、事务、事件及验收继续稳定复用。

## 实际验证

- 类型检查通过；架构检查通过：53 目录、578 个代码／样式文件，1136 个维护文件、5936 条含类型依赖、0 环。`git diff --check` 通过。
- 10 文件 **65/65** 通过，涵盖逐阶段投影、跨会话与版本隔离、候选／完成边界、成员步骤、失败可见、原目标与成员增量、持久等待、会话身份、分层与依赖。报告 `test-results/issue12-targeted.json`。
- `node scripts/issue12-ui-smoke.mjs`：真实 React App、确定性公开 IPC 场景 **8 组通过**，页面错误／业务写入 0。覆盖实际 Hook 轮询连续推进、依赖后继、等待与失败、可靠关闭、展开早期节点、重开还原、保持用户上翻位置、明暗主题及收起侧栏后的 320px 进展排版。报告 `test-results/issue12-ui-report.json`，截图 `issue12-light.png`、`issue12-dark.png`、`issue12-narrow.png`。
- `pnpm package` 成功，Windows x64 构建 **20261109-142131**。EXE、app.asar 及本次源码指纹在 `test-results/issue12-build-evidence.json`。
- `pnpm exec tsx scripts/owner-execution-ui-smoke.mts --progress`：真实打包 EXE／preload／IPC／派发存储／Pi 子进程，以 localhost 确定性供应商驱动真实调用。在 UI 明确选择 Team 后保存目标与两项任务，暂停实际模型响应观察派发及真实成员执行，释放后核实两份候选、证据与可靠完成。主模型请求 9 次、两个岗位各 5 次，独立岗位模型与草稿保持；关闭重开后进展还原，没有新增请求、任务或日志字节变化。页面／传输／供应商错误均 0，临时应用与服务已关闭并清理。报告 `test-results/conversation-progress-complete-ui-smoke.json`，同名前缀截图保存计划、运行、候选与重开画面。

## 验证中发现的问题

首次类型检查发现求助原因的字段层级错误；修正为已有可信求助投影的 `input.reason` 后通过。首次浏览器重开场景遗漏重新打开项目／原会话，脚本已补齐；第二次窄屏场景误用不存在的侧栏选择器，改为真实“收起侧栏”操作后通过。未改变产品恢复、滚动或侧栏行为迁就测试；初始说明和失败 JSON／截图保留于 `test-results/issue12-ui-initial-failure.txt`、`issue12-ui-failure-*`。

本项未运行全仓测试或在线模型自主分工验收；未发布正式安装包或改动用户真实项目。按本 Issue 单独提交并回填，公开客户端 0.1.1 仍待后续版本交付。
