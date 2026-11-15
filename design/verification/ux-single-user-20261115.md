# 单人工具范围与全量验证

日期：2026-11-15；工单：[Issue #87](https://github.com/nan023062/cbim/issues/87)。

用户明确取消独立账号和协作服务，并要求移除多人邀请与人员在线状态入口、保留本地 Agent 交接、运行完整测试。本次基于整合提交 `6e67c07c`，不改动无关工单 #65。

用户进一步澄清定位为“本地／多端的 AI Native 工作流工具”；工程业务的团队协作未来通过插件和链接器接入 P4、Git、飞书等外部工具实现。同步两份 UX 设计及原型文案，不把多端定位错误限定为仅本机，也不把未来插件能力写成已经上线。

## 实际改动与边界

- 检索产品 `src/view`：不存在多人邀请或人员在线状态入口。Agent 执行状态、供应商连接、资源核验和软件更新状态不是人员在线状态，均保留。
- 评审原型撤回 `people` 真人协作页面，改为 `handoff` 本地 Agent 交接；移除真人身份、评论输入与跨人消息提案。保持 42 页目录，其中 34 个原操作面、7 个聚合/扩展设计及 1 个规范页。原型仍明确标为模拟，不能代表已接通业务。
- 本地交接演示保留任务、产物版本、验证依据、接续、退回、阻塞、冲突及原回执核实。产品实际交接沿用原有 Logic 任务与调度流程，没有新增账号、消息服务器或多人权限体系。
- 运行管理把“人员活动”明确为“本地 Agent 活动”。同步 `RuntimeOverview.tsx` 文件头、runtime 的 `CONTRACT.md` 与生成的 `ARCHITECTURE.md`；不改变 IPC、状态归属、派发或恢复语义。
- `design/check-complete-ux.mjs` 防止旧真人入口回归；`design/check-single-user-ux.mjs` 是隔离浏览器原型检查，不加载真实应用或项目。

## 已完成检查

| 命令 | 结果 |
| --- | --- |
| `node design/check-complete-ux.mjs` | 42 页、71 图标、自包含与脚本语法通过；旧真人入口不存在 |
| `node design/check-single-user-ux.mjs` | 1440/320px × 明暗主题 4 组通过；接续、退回、阻塞/冲突/未知状态、无横向溢出；页面异常 0 |
| `pnpm typecheck` | 通过 |
| `pnpm check:architecture` | 134 目录、819 代码/样式文件无差异，依赖无环、边界违规 0 |
| `pnpm check:test-modules` | 530 文件；unit 170、contract 160、integration 200 |
| `pnpm exec vite build --config vite.renderer.config.ts --outDir test-results/single-user-renderer` | 通过；最大 JS chunk 380.62 kB，无默认大包警告 |

原型测试 JSON 和截图位于隔离 worktree 的 `test-results/single-user-prototype.json`、`single-user-handoff-{width}-{theme}.png`，已人工查看 320px 深色截图。原型动作只改变演示状态；这些结果不替代真实桌面逐页验收。

仓库内保留 [窄屏深色截图](ux-single-user-20261115/handoff-mobile-dark.png) 与 [桌面浅色截图](ux-single-user-20261115/handoff-desktop-light.png)。新增浏览器检查脚本后另运行 `pnpm check:dependencies`：1629 文件、7712 依赖，循环与违规均为 0。

## 全量自动化测试

用户明确要求全量回归，因此运行完整 Vitest 集合而非按此次两行文案缩小测试范围。保留仓库默认串行、隔离和超时配置。

```text
pnpm exec vitest run --reporter=default --reporter=json --outputFile=test-results/single-user-full-suite.json
```

完整运行耗时 1767.88 秒：530 个测试文件中 528 通过、1 失败、1 整文件条件跳过；3558 个用例中 3555 通过、1 失败、2 条件跳过。

唯一失败来自 `tests/conversation-waiting.test.ts` 的旧 HTML 断言，要求“继续队列”按钮内容只能是文字。统一图标加入后按钮仍正确禁用，但旧正则不匹配。修正为先按去除标签后的按钮文字精确定位，再检查 `disabled`，同时增强编辑/删除仍可用的断言；没有修改产品的队列行为或删除原有语义覆盖。

定向复验选择等待状态、消息队列与对话控件三个直接相关消费者：

```text
pnpm exec vitest run tests/conversation-waiting.test.ts tests/message-queue.test.ts tests/chat-chrome.test.ts --reporter=default --reporter=json --outputFile=test-results/single-user-recheck.json
```

复验 3 文件、9 用例全部通过。全量执行与定向复验合并后的唯一用例结果为 **3556 通过、2 条件跳过，没有未解决失败**；不是“首次全量运行全绿”，没有重复执行其余未受影响用例。

两项跳过由原测试的历史 EXE 存在性条件触发：

- `knowledge-source-lifecycle-application.test.ts`：固定 pre-source EXE 的真实历史记录迁移。
- `owner-execution-legacy.test.ts`：pre-owner EXE 的真实 queued/running/checkpoint 历史记录恢复。

本次未提供这两个固定历史 EXE，未放宽跳过条件，也没有用当前版本生成数据冒充历史制品。跳过不等于通过。

原始控制台日志：`test-results/single-user-full-suite.log`。完整 CI、真实桌面逐页检查、安装升级和新版本发布是独立验收范围，本记录不提前认定通过。真实桌面此前受前台激活问题阻断，见 [原记录](ux-desktop-20261115.md)。
