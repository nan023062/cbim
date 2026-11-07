# 结构化提问严格回包与证据边界验收

对应 [Step25 计划](../task/question-tool-contract.md)，承接 `9a03ebe`。测试使用独立临时工作区、实际 Application/Pi 和本机确定性 SSE 供应商，不读取用户密钥或业务项目；确定性工具序列不证明在线模型判断质量。

## 真实 Pi / Application

`tests/question-tool-contract-pi.test.ts` 首轮 **4/4 通过**，记录 `test-results/question-tool-contract-pi-initial.json`。

| 场景 | 主 / 成员请求 | 实际结果 |
| --- | --- | --- |
| 正常选择、补充与其他输入 | 8 / 7 | 主问题组有两题，先验证跨任务回答和未答全拒绝，再一次提交选项+补充及其他文本；成员按自己的任务回答。原题、答案、补充与真实工具回包精确匹配，重复回答拒绝。 |
| 取消域等待 | 8 / 7 | 测试直接调用真实 `QuestionQueue.cancel`，成员实际得到 `{cancelled:true}`；随后仍须真实读文件才能交付。此项不是用户点击停止，不将测试端口调用宣称为界面行为。 |
| 答案已消费后损坏返回 | 8 / 7 | 测试 spy 先等待真实 Queue 消费成员答案，再只替换返回中的原题文字；包装器产生 `TOOL_OUTPUT_INVALID` 和失败回执。原回答不回滚，不重新排队，不自动重问，后续真实读文件仍可完成。 |
| 明确停止整个目标 | 4 / 1 | 成员正在等待回答时调用真实 `loop.stop`；原目标和成员运行 cancelled，没有交付候选，没有后续主回注或成员请求。 |

前三组均先尝试把提问工具引用作为步骤证据，实际失败；随后 `read` 读取本工作区的 `question-input.txt`，步骤和交付候选只保留该轮真实读取引用。主审阅再次尝试混入提问引用，实际 `GOAL_EVIDENCE_INVALID`，改为真实成员读取证据后才完成。取消和失败问答不会被清洗成业务成功，也不会使同轮后续合法证据永久失效。

每组完整关闭并重新创建 Application 后核对原 graph、scope、主 thread、成员 canonical 摘要及请求计数保持；没有遗留问题或自动重放。故障 spy 在 `finally` 恢复，不增加产品测试入口。

新 fixture 初次类型检查发现 `DispatchRun` 导入错误叶子模块、canonical 摘要误用公开详情类型与 spy 类型过窄；均只修正测试引用。首轮真实行为测试为 4/4，不将类型检查失败误写为产品执行失败。修正后 `pnpm typecheck` 和新桌面脚本严格独立 TypeScript 检查已通过。

## 最终 Windows EXE

最终同一 Windows EXE `build/20261107-182341/CBIM Assistant-win32-x64/CBIM.exe`，`pnpm make` exit 0 / manifest `stage=make`。`scripts/question-tool-contract-ui-smoke.mts` 正常、`--stop`、`--unknown` 三模式均 **首轮 exit 0**，没有修改产品或重建包。

| 桌面场景 | 主 / 成员模型请求 | 实际回答 IPC 次数 | 终态与重开 |
| --- | --- | --- | --- |
| 正常 | 8 / 7 | 主1、成员1 | 本轮真实读取后完成；原图、周期、主 thread、成员日志字节及普通草稿不变。 |
| 停止 | 4 / 1 | 主1、成员0 | 成员等待时真正点击主对话“停止执行”，目标与成员 cancelled，无交付候选；重开未恢复问题或模型。 |
| 成功消费后丢回复 | 8 / 7 | 主1、成员1 | 真实成员答案已消费后仅丢弃一次 IPC 回复；界面显示错误且原问题消失，后续读取和审阅正常完成；重开没有重新询问或补发答案。 |

三场页面错误和模型传输错误均 **0**，普通主对话草稿跨提问、提交/停止、目标结算和完整退出重开保持。没有新增第二成员运行，也没有将主问题和成员问题串到其他任务。

脚本使用既有真实 `QuestionCard`：本地选择不发送，全部问题答完后一次点击“提交并继续”；成员问题在原任务节点详情内提交。普通主对话草稿保持独立。`--unknown` 只在真实 `dispatch.answerQuestion` 成功之后丢弃一次 IPC 返回，模型继续处理实际答案；不伪造服务端状态、不自动重发。该场真实成员问题 `0877c633-a308-4e18-be1c-d9db33c497f8` 的原调用记录为成功，成员运行 `d73ec738-3888-4b1b-bb95-ea54983fb44d` 的提问工具只出现一次；截图前仅暂缓本机供应商的下一响应，以观察错误和已消费问题状态。

提问目前没有持久命令回执查询接口。因此未知返回场景只验证一次消费、错误可见、后端问题消失、不重弹、不自动重发及完整重开没有重放；不会声称存在“查询原回答回执”或已确认恢复协议。

已实际打开并审阅以下截图：

- `test-results/question-tool-contract-complete-main-question.png`：两题中的其他文本与补充、一次提交按钮、独立普通草稿；长问题卡可滚动，未挤掉输入框。
- `test-results/question-tool-contract-complete-member-question.png`：真实成员节点及其问题，选项、补充和提交均在该成员详情内。
- `test-results/question-tool-contract-stop-restored.png`：重开显示本轮已停止，普通草稿仍在，没有旧问题重新弹出。
- `test-results/question-tool-contract-unknown-response-lost.png`：真实消费后 `TEST_RESPONSE_LOST` 可见，原问题已消失，成员仍继续运行；“重新读取”是既有运行详情刷新，不是答案回执查询。
- `test-results/question-tool-contract-unknown-restored.png`：重开保持真实业务完成和普通草稿，没有自动重问。

机器证据为 `test-results/question-tool-contract-{complete,stop,unknown}-ui-smoke.json`，汇总为 `test-results/question-tool-contract-desktop-final-summary.json`。三场各自正常关闭 EXE/Pi 及供应商后，复核本包和本测试临时目录关联进程为0；`cbim-question-contract-ui-1qOOow`、`cbim-question-contract-ui-vpvrem`、`cbim-question-contract-ui-NFjQ4I` 均已删除。没有处理此前其他步骤被策略拒绝的目录。

## 其他验证与限制

- 最终冻结代码相关回归 **18文件144/144**，见 `test-results/question-tool-contract-final.json`，包括新四组真实 Pi、旧显式 Workflow 选择两组 Pi，以及主/成员/人工/Workflow/工具权限兼容。另 **13项边界**、最终类型和架构检查全部通过；本片没有运行全仓，不借用上一步全仓数字。
- 最终架构为51个目录、385个源码/样式文件、694个维护文件、3276条含类型依赖、0循环，7份目录类图同步。
- 提问回执只记录沟通事实，不授予业务写权限、不形成持久人工验收决定，也不让普通“同意”自动恢复 waiting。
- 合法 answer/cancel wire、工具成功和成员交付候选均不等同业务验收；本报告依赖真实读取和后续目标审阅的完整记录。
