# 主调度工具业务输出契约验证

日期：2026-11-07。对应 [Step20 开发计划](../task/main-tool-output-contracts.md)。本报告区分真实工具事务、测试层故障注入和最终桌面操作，不把本机确定性响应等同于在线模型的自主规划质量。

## 真实 Pi 集成

`pnpm exec vitest run tests/main-tool-contract-pi.test.ts --reporter=json --outputFile=test-results/main-tool-contract-pi.json` 首轮 **4/4 通过**。使用真实 Application、Pi 子进程、原生文件读取、调度服务、用户数据目录和日志；模型响应来自独立本机 HTTP SSE 测试服务，没有用户账号或在线模型调用。

| 场景 | 主模型请求 | 成员模型请求 | 实际断言 |
| --- | ---: | ---: | --- |
| 完整调度 | 8 | 5 | 主计划→唯一派发→整图/单节点查询→成员真实 read→候选→目标查询/审阅；最终 completed；主与成员实例不同 |
| 成员启动后停止 | 5 | 1 | 显式停止后 cancelled，无业务候选；没有结果回注模型请求 |
| 规划已提交后坏回包 | 3 | 0 | 原计划已是第 2 版，只调用规划一次；坏输出被拒，原计划仍可只读查询 |
| 派发已提交后坏回包 | 5 | 0 | 原任务和信封已提交，只派发一次；坏输出被拒，整图和目标查询仍能看到同一个原任务 |

故障注入仅发生在测试 spy：先 `await` 真实 `goals.plan` 或 `dispatchTask`，再分别移除回包 `scopeId`、改错回包 `cursor.rootSessionId`。生产工具包装、业务服务、持久化事务和错误日志均未替换。两种故障都产生 `TOOL_OUTPUT_INVALID`、失败的维护工具回执，以及原生 Pi 历史的 `isError` 工具消息；错误中不泄露注入的错误身份值。服务未重做原事务。

故障场景中的模型先实际只读查询，再由测试明确停止当前运行，故周期终态为 cancelled；这里没有声称“坏输出自动回滚、自动停止或自动恢复”。已提交任务在停止前保留，停止后仍无成员运行。四场景均重建 Application，核对任务图、周期存储和 canonical/原生日志字节不变、请求数不增加；业务文件保持原内容。

证据：[Pi 结果](../../test-results/main-tool-contract-pi.json)、[集成用例](../../tests/main-tool-contract-pi.test.ts)、[确定性供应商](../../tests/main-tool-contract-provider.ts)、[隔离工作区构造](../../tests/main-tool-contract-fixture.ts)。

## 最终桌面验收

最终产物 `build/20261107-153107/CBIM Assistant-win32-x64/CBIM.exe`；manifest `stage: make`，完成于 `2026-11-07T07:31:57.075Z`。三个命令都固定 `CBIM_TEST_EXE` 指向此文件，首轮均 exit 0，没有使用中间构建 `152723`。

| 实际桌面命令 | 主请求 / 成员请求 | 结果及回执 |
| --- | ---: | --- |
| `pnpm exec tsx scripts/main-tool-contract-ui-smoke.mts` | 8 / 5 | [正常回执](../../test-results/main-tool-contract-complete-ui-smoke.json)：唯一派发、真实读取、真实候选及目标审阅，最终 completed |
| `pnpm exec tsx scripts/main-tool-contract-ui-smoke.mts --stop` | 5 / 1 | [停止回执](../../test-results/main-tool-contract-stop-ui-smoke.json)：真实点击停止，等目标 cancelled、活动归零后才释放测试响应，无候选或回注 |
| `pnpm exec tsx scripts/member-checkpoint-ui-smoke.mts` | 11 / 22 | [检查点回执](../../test-results/member-checkpoint-complete-ui-smoke.json)：真实预约与续执行；同 task、实例、逻辑及原生会话，新 run，后继任务首次执行 |

正常及停止场景通过真实 UI 发送输入、展开派发工具结果、选择任务节点、切回对话和重开原会话。业务文件保持原值，没有 write/edit/bash。检查点场景复用既有真实 fixture，文件实际 write **1 次**；预约阶段仍未新增运行，待原主轮结束后才续执行，重新读取验证后交付。旧 canonical 日志字节和文件修改时间保持不变；没有把旧证据直接当作新轮交付。

三场景均验证原草稿保留、重开请求数不增加，`pageErrors` 与供应商 `transportErrors` 都为空。正常/停止两场景同时逐字核对 canonical 和原生 JSONL；检查点场景核对来源 canonical 不变、原生会话身份相同且新轮重新验证。桌面流程没有坏回包注入或新增生产测试入口。

已实际查看关键截图：

- [目标完成](../../test-results/main-tool-contract-complete-settled.png)与[真实任务节点](../../test-results/main-tool-contract-complete-node.png)：主与成员清晰分离，候选仍显示“交付待审阅”。
- [明确停止](../../test-results/main-tool-contract-stop-settled.png)：目标显示“本轮已停止”，并提示不能将输出视为目标完成。
- [只预约未执行](../../test-results/member-checkpoint-complete-queued.png)与[新轮已登记](../../test-results/member-checkpoint-complete-settled.png)：来源和续执行轮次分别展示，没有把预约回执当已执行。

本轮所有测试桌面/Pi 进程和成功隔离临时目录均已正常清理，最终进程检查为 0；未碰其他测试保留目录或用户应用。覆盖旧检查点回执前，已将旧 JSON/PNG 复制到 `test-results/main-tool-contract-checkpoint-previous/` 保留历史证据。

## 其他验证及限制

新桌面脚本独立严格 TypeScript 检查已通过。最终类型、架构及边界 **13/13** 通过；51 个目录、370 个源码/样式文件，647 个维护文件、2940 条含类型依赖、0 个循环；同步 4 份目录类图及相关中文注释、CONTRACT。

首次全量 **203 文件、1183/1187** 通过（约 616 秒），见[原始报告](../../test-results/main-tool-output-full.json)。该进程启动后补齐了 assign/cancel/replace/resume 的空值或缺数组保护；四个新断言在该全量进程中仍见旧 TypeError，未把这轮标成全绿。其余既有目标、人工决定、治理、恢复、知识及运行管理测试通过。

最终源码的[七文件回归](../../test-results/main-tool-output-scheduler-final.json) **67/67** 通过；全量结束后另起新进程执行[九文件最终回归](../../test-results/main-tool-output-final-targeted.json)，**77/77** 通过，包含四个失败断言、严格输出与真实提交服务、四种主工具 Pi 场景，以及原有撤销、依赖替换和检查点 Pi 流程。没有第二次全量重跑。最终 EXE 是空值护栏之后重新构建的 `153107`；`152723` 只保留为中间构建，未用于本报告桌面验收。

本片验证输出结构、可信归属、既有事务不重放及正常执行兼容性；不宣称调度维护回执是业务证据，也不将目标 complete 工具成功当作目标已经闭合。正常场景最终完成仍经过主运行终态与成员证据复核。成员候选保留 `acceptance: not_evaluated`，没有伪造人工验收。
