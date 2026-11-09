# 模块知识治理反馈闭环验证（2026-11-07）

对应计划：[模块治理反馈、修订与人工回应评价](../task/module-governance-feedback.md)。

## 验证结论与范围

本轮验证了真实主 Agent 治理提案、人工补证或异议、同一主会话新运行读取意见、重新观察并提交有实际正文变化的修订方案，以及人工逐项评价、批准和独立实施。原意见被后续决定替代时，已保存的提案、评价和批准保留为历史；新的批准和实施被拒绝。

模型供应商是隔离本机 SSE 确定性服务，Pi、Electron、治理工具、知识存储和 journal 都走实际实现。验证的是执行链、身份、版本与权限边界；不代表在线模型理解能力、人工专业资质或业务成果验收。正文差异来自真实工具读取的观察基线，并通过实际提案保存，没有伪造成功回执或直接写入治理 ledger。

## 构建与回归

- Windows 最终包：`build/20261107-143946/CBIM Assistant-win32-x64/CBIM.exe`，`stage=package`，完成时间 `2026-11-07T06:40:13.672Z`，打包退出码 0。
- 最终相关回归：16 个文件，111/111 项通过；边界检查：2 个文件，13/13 项通过。本轮采用相关回归，没有另报一次全仓测试。
- `pnpm typecheck` 通过；新桌面脚本单独严格 TypeScript 检查通过。
- 架构检查通过：50 个目录、358 个源码/样式文件、622 个维护文件、2,795 条含类型引用依赖、0 循环；同步 10 份 `ARCHITECTURE.md`。源码与 CONTRACT 由所属实现模块同步维护，本验证未修改生产源码。

## 真实 Pi 集成

执行文件：[module-governance-feedback-pi.test.ts](../../tests/module-governance-feedback-pi.test.ts)。独立报告：[三场景结果](../../test-results/module-governance-feedback-pi.json)。三项全部通过，且已包含在最终相关回归中。

| 场景 | 实际请求 | 验证结果 |
| --- | --- | --- |
| `defer` 补证 | 主 14，成员 0 | 人工暂缓附具体补证要求；用户明确续聊后，新运行读取真实意见、重新观察、保存有实质正文差异的提案；显式评价后批准，独立 apply 提交知识 |
| `reject` 异议 | 主 14，成员 0 | 人工驳回附具体异议；新提案引用该原意见，冻结原提案、basis 与决定版本；人工评价、批准与实施分别发生 |
| `superseded` | 主 14，成员 0 | 修订方案批准后，原意见被新的决定替代；新批准与沿用旧批准的 apply 均拒绝 `GOVERNANCE_FEEDBACK_STALE`，正式知识、journal 与旧记录不变 |

每项都验证：同一主会话、同一个主实例和逻辑 session，新 `runId`；新观察与新提案独立；没有派生成员执行。保存意见、评价或批准不会自动启动模型，不会自动实施。批准前后的正式知识与 journal 均逐项比较；成功 apply 的同命令重试返回原回执。关闭并重新打开 Application 后，任务状态、治理历史、正式知识与原日志字节保持一致，没有新增模型请求。

## 同一最终 EXE 的真实点击

脚本：[module-governance-feedback-ui-smoke.mts](../../scripts/module-governance-feedback-ui-smoke.mts)。两模式串行运行，均首次退出码 0，没有产品失败或定位重跑。

```text
pnpm exec tsx scripts/module-governance-feedback-ui-smoke.mts
pnpm exec tsx scripts/module-governance-feedback-ui-smoke.mts --stale
```

| 模式 | 主 / 成员请求 | 页面 / 意外对话框 / HTTP 错误 | 重开新增请求 |
| --- | --- | --- | --- |
| complete | 14 / 0 | 0 / 0 / 0 | 0 |
| stale | 14 / 0 | 0 / 0 / 0 | 0 |

共同点击流程：发送初始目标 → 业务架构选择实际模块和原提案 → 勾选反馈并填写关注点、期望回应及具体意见 → 暂缓并要求补证 → 关闭治理面板，在原主会话明确发送修订目标 → 打开新提案 → 核对原意见引用及正文差异 → 从“未评价”明确选择“已回应”并填写说明 → 最后勾选审阅 → 保存批准。

complete 再单独点击“实施已批准的知识变更”，查看真实提交回执。stale 在批准后重新选择旧提案，明确保存替代原意见的新异议，再选择修订方案。界面显示“来源已被替代”，历史评价和批准仍可读；即使重新勾选审阅，批准按钮仍不可用，实施按钮不可用。脚本另行调用真实 IPC 验证旧批准不能绕过门禁，得到 `GOVERNANCE_FEEDBACK_STALE`；未把禁用按钮描述为实际点击。

两模式均保留主对话草稿和第二会话草稿；重开后原记录、图、文件与日志字节不变，未重放模型或知识实施。

### 最终回执与截图

- [complete 回执](../../test-results/module-governance-feedback-complete-ui-smoke.json)：原意见 `51257420-5c2f-4d3b-8b3e-6c33f73c0572`，修订提案 `8e58b2b4-2c7b-56f5-9d1a-c3407c6dc2e9`，批准 `1bad38c8-cd1a-4c27-996f-0adba4f19dab`。
- [stale 回执](../../test-results/module-governance-feedback-stale-ui-smoke.json)：原意见 `614f500f-75c7-4d9a-a6ee-a343b0daac10`，修订提案 `ec6aa552-1e17-5c83-a4d3-4185ed9b07f0`，替代决定 `457f3443-48a6-4e8a-81bd-e5b3e4b2f2cc`。
- [原反馈](../../test-results/module-governance-feedback-complete-feedback.png)、[修订引用与未决定状态](../../test-results/module-governance-feedback-complete-revision.png)、[明确人工回应评价](../../test-results/module-governance-feedback-complete-assessed.png)、[独立实施回执](../../test-results/module-governance-feedback-complete-applied.png)。
- [来源被替代](../../test-results/module-governance-feedback-stale-stale.png)、[重开后的过期来源与历史评价](../../test-results/module-governance-feedback-stale-restored.png)、[complete 重开记录](../../test-results/module-governance-feedback-complete-restored.png)。

已实际查看关键截图：来源有效/被替代说明、原意见与决定标识、人工评价的非认证提示、独立实施真实回执均可读。截图只呈现当前滚动位置，精确前后全文与按钮禁用状态同时由桌面脚本读取和断言。

## 限制与清理

- 本轮没有新增业务执行或权限提升，也没有根据模型解释自动推断“已回应”。测试中的评价是脚本操作真实桌面控件后保存的本机明确选择。
- 多意见集合、缺评价兼容、串行竞争、已提交后来源变化不回滚等边界由 Core/Main 的相关测试覆盖；不宣称两次桌面场景遍历了所有组合。
- 本轮没有故障注入。旧来源替代是真实保存的新人工决定，过期拒绝是真实服务结果。
- 两个隔离测试窗口已正常关闭。复核本构建 `CBIM.exe` 剩余进程为 0，`cbim-governance-feedback-ui-*` 自有临时目录为 0；未操作用户工作区、在线账号或历史受保护临时目录。
