# 执行过程工具业务输出契约验证

日期：2026-11-07。对应 [Step21 开发计划](../task/member-tool-output-contracts.md)，承接 Step20 主调度工具契约。本片沿真实工具服务验证七项成员执行工具的输出边界；确定性本机模型只驱动流程，不代表在线模型的理解或业务验收能力。

## 真实 Pi：保存后回包损坏

`pnpm exec vitest run tests/member-tool-contract-pi.test.ts --reporter=json --outputFile=test-results/member-tool-contract-pi.json` 最终 **2/2 通过**。使用真实 Application、Pi、正式独立执行成员、原生文件工具、canonical 日志、调度器和隔离用户数据目录，没有生产故障入口或用户账号。

| 场景 | 主请求 / 成员请求 | 保存及结算事实 |
| --- | ---: | --- |
| 求助暂存后坏回包 | 6 / 5 | 真实 `task.help_requested` 写入一次；返还对象绑定损坏触发 `TOOL_OUTPUT_INVALID`；没有安全 HelpMessage 或 `task.help` |
| 检查点暂存后坏回包 | 6 / 8 | 真实 write 一次、read 一次、采集基线、`task.checkpoint_requested` 写入一次；坏回包触发 `TOOL_OUTPUT_INVALID`；没有可续执行检查点或预约 |

注入严格限于测试 spy：求助先通过原 `save` 保存独立完整快照，再改坏准备返回对象的身份；检查点先 `await` 原 `stage`，再返回身份不符的副本。原始事件没有损坏，业务调用没有替换为模拟成功。两场都断言 canonical 和原生 Pi 历史出现失败工具回执及错误文本，错误不泄露注入的错误身份值。

随后测试供应商故意要求一次额外 read，真实运行门闩将其拒绝，日志有 `tool.denied` 且没有对应 `tool.allowed`。成员正常结束的真实终态是 `run.settled(status: completed, acceptance: not_evaluated)`，但安全交接核验失败使任务 **blocked**，不产生交付候选。主调度读取真实节点后提交 blocked 审阅，目标最终 failed；没有自动重派、检查点恢复或重复文件写入。

重建 Application 后，任务图、持久调度记录、canonical/原生 JSONL 字节和业务文件修改时间均不变，模型请求不增加。证据：[最终 Pi 结果](../../test-results/member-tool-contract-pi.json)、[用例](../../tests/member-tool-contract-pi.test.ts)、[本机供应商](../../tests/member-tool-contract-provider.ts)。

初轮失败来自新增 fixture 的两项错误假设，均保留证据：先将任务状态错断为 failed，实际安全结算为 blocked；随后使用不存在的 `run.completed` 事件名，实际终态为 `run.settled`。修正为真实协议的严格断言后通过，未调整生产实现或放松安全交接要求。原结果见 [初轮](../../test-results/member-tool-contract-pi-initial.json)和[终态断言诊断](../../test-results/member-tool-contract-pi-terminal-fixture.json)。

## 最终 Windows 桌面

最终产物为 `build/20261107-160638/CBIM Assistant-win32-x64/CBIM.exe`，manifest `stage: make`，完成于 `2026-11-07T08:07:27.335Z`。四个命令均显式固定 `CBIM_TEST_EXE` 到同一文件、串行执行，首轮全部 exit 0。

| 实际桌面命令（前缀 `pnpm exec tsx`） | 主请求 / 成员请求 | 实际结果与回执 |
| --- | ---: | --- |
| `scripts/workflow-condition-ui-smoke.mts` | 6 / 9 | [Workflow 回执](../../test-results/workflow-condition-complete-ui-smoke.json)：计划前 write 在审批前拒绝；随后真实一次写入审批；缺 read 的交付拒绝，真实读取后目标 completed |
| `scripts/member-help-ui-smoke.mts` | 10 / 10 | [求助回执](../../test-results/member-help-ui-smoke.json)：暂存后正常关闭才交接，原求助不是候选；主调度新增任务/实例补做，原副作用只发生一次 |
| `scripts/member-checkpoint-ui-smoke.mts` | 11 / 22 | [续执行回执](../../test-results/member-checkpoint-complete-ui-smoke.json)：真实采集与检查点；预约阶段尚无新 run，之后同 task/实例/逻辑及原生会话新增 run，旧证据清空并重新读取，B/C 首次执行 |
| `scripts/member-checkpoint-ui-smoke.mts --stop` | 8 / 7 | [停止回执](../../test-results/member-checkpoint-stop-ui-smoke.json)：预约尚未启动时真实点击停止，目标 cancelled；没有新增成员轮次，检查点与预约保留为封存历史 |

四场景页面和本机供应商通信错误均为 0；Workflow 没有额外原生确认弹窗。草稿及历史任务保留，重开后模型请求均不增加。Workflow 核对旧 canonical 与双会话草稿；求助核对原图/周期记录、原副作用文件内容及修改时间；两项检查点核对源 canonical 字节、原实例身份、文件只写一次及修改时间不变，续轮仅使用本轮重新读取证据。全部为真实打包 Electron/Pi、原生文件工具和真实 UI 点击，没有在桌面流程注入坏输出。

已查看最终截图并核对状态与记录：

- [真实写入审批](../../test-results/workflow-condition-complete-real-approval.png)、[交付后目标完成](../../test-results/workflow-condition-complete-result.png)。
- [原求助与新执行节点并存](../../test-results/member-help-node.png)：明确说明求助不构成交付候选、权限提升或人工验收。
- [预约尚未启动](../../test-results/member-checkpoint-complete-queued.png)、[新轮已经登记](../../test-results/member-checkpoint-complete-settled.png)：来源轮次与新轮分开呈现。
- [停止后检查点封存](../../test-results/member-checkpoint-stop-settled.png)：明确不能沿历史检查点恢复，不显示成功或新执行事实。

最终自有桌面/Pi 进程和三类测试隔离临时目录均已正常清理，进程/目录检查为 0；未触碰其他测试保留目录和用户应用。旧脚本和 fixture 未修改，运行前的 25 份 JSON/PNG 保存在 `test-results/member-tool-contract-previous/`。

中间包 `20261107-160157` 已通过 Workflow、求助、检查点续跑三场，主/成员请求分别 6/9、10/10、11/22，页面及通信错误为 0。随后源码复核发现新增进度身份校验比既有 `safeId` 收窄，会错误拒绝前导下划线或连字符的合法身份；修复并补回归后重建为上述最终包。中间包没有启动停止场景，不作为修后验收，其 19 份证据保存在 `test-results/member-tool-contract-intermediate-160157/`。

## 其他验证与边界

身份兼容修正前，27 个实际测试文件 **200/200** 通过，覆盖进度、Workflow、求助、检查点、基线、执行报告及运行接续；这不是全仓测试。修正后 Core 17/17、类型检查通过；最终新进程 8 文件 **55/55** 通过，包含 13 项依赖/分层边界以及进度与普通/主运行接续。最终架构为 51 目录、373 源码/样式、654 个维护文件、2988 条含类型依赖，0 循环；4 份 ARCHITECTURE 与对应中文注释、CONTRACT 同步。

结果：[27 文件回归](../../test-results/member-tool-output-final-targeted.json)、[身份边界回归](../../test-results/member-tool-output-identity.json)、[最终 8 文件验证](../../test-results/member-tool-output-identity-final.json)。未重复执行全仓慢回归。

输出 Schema 通过不等于专业验证或人工验收。文件基线仅覆盖选定文件，暂存记录不等于已安全交接；交付候选仍须主调度及真实证据门禁核实。额外 read 被拒只证明求助/检查点的本轮结束门闩保持，不应推广为文件采集工具永久封住后续工具：文件采集使用短锁，真实工具结束后可释放。
