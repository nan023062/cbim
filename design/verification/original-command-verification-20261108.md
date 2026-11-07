# Step35 原主命令只读核实验证

日期：2026-11-08。承接 `a519dd4`。状态：本片已完成。全仓 276 文件、1771 项全部通过，无失败或跳过，定向、最终类型／架构及最终 EXE 两场均通过；本片仅 R03-A，不代表整个 R03 完成。

## 实际交付

- 八类主写命令共用严格原调用核实：目标计划／审阅、派发、未领取撤销、前置追加／替换、检查点续执行预约和显式放弃。可信原 workspace/root/run/call、主实例的对话通道／任务邮箱、唯一周期、连续 canonical、授权及指纹共同决定可核实性。
- `FileDispatchStore.commandEvidence` 只从实际 durable publish／已验证 replay 的原前态建立窄索引，派发隐藏父版本取原 root revision。旧 journal 不改格式／字节，原 `commandReceipt` 两字段形状不变；查询不触发初始化或重新执行。
- 领域指纹适配保留原解析、缺省、trim、映射和键序，兼容旧无 ownerSelection 的合法历史。公共回执再核实际提交游标及原派发信封的不可变身份，不依赖今天的任务状态、计划版本或负责岗位。
- 新主工具 `cbim_dispatch_command_report` 和 `dispatch.commandReport` 共用服务，查询只读、不置 Auto 的 workRequested，不清 unresolved、不作验收或恢复资格。Store→log→command→command→log→Store 反向闭合观察；变化、查无、缺失、无效、未支持分别保留真实限制。
- 主对话工具记录显式查询：原工具失败与原事务已保存同时显示，当前工具不重发。挂载、展开和普通轮询零自动读取；在途重复点击合并；跨身份和迟到报告拒绝；读失败保留上次报告并提示时效。原草稿和附件不参与查询。

## 定向验证

全仓 `pnpm exec vitest run` 为 276 文件、1771 项全部通过，无失败或跳过，证据 `test-results/original-command-full-final.json`／同名 log。全仓期间仅发生下文记录并证明的一份 CSS 收口，产品 TypeScript 与构建配置保持冻结。以下报告存在重叠，不与全仓数量相加。

| 范围 | 实际结果 | 证据 |
| --- | --- | --- |
| Core／Store 五文件 | 64 项通过；初批 63 项中的 Store6 后由最终 Store7 替换，Core13 后续仅补断言 | `command-verification-core-final.json`、`command-verification-core-matrix-final.json`、`command-verification-store-freeze.json` |
| 服务／Main／协调／工具六文件 | 79/79；最后两文件 20/20 覆盖历史合法演进补强 | `command-verification-backend-final.json`、`command-verification-backend-verified.json` |
| 前端状态与展示 | 12/12 | `original-command-view.json` |
| 真实 Pi 三分支 | 3/3 | `original-command-pi-current.json` |
| 最终样式收口后的类型／架构／UI＋边界 | 类型 0、架构 0、25/25；860 维护文件、4488 条含类型依赖、0 循环 | `original-command-style-final-gates.log`、`original-command-style-final-view.json` |

所有机器报告位于 ignored `test-results/`。Core／Store 覆盖原提交前态、当前根变化、旧 prefix 重开、隔离副本、原 receipt 形状、不隐式 init、fsync 失败及在途屏障；服务覆盖八算法、旧格式、不可伪造参数、错误分类、跨身份、重复 scope、游标／信封、唯一日志头和终态、取消、关闭、观察竞争及不清未知。前端覆盖重复点击、取消观察、四重身份／错工具／私有字段、保留旧报告和八种控制面结果。

## 真实 Pi 与故障边界

使用实际 Application、Pi 子进程、正式工具、独立成员模型及本机确定性 HTTP 供应商。测试在真实 plan／dispatch 提交之后仅损坏回包，原工具留下 `TOOL_OUTPUT_INVALID`；模型从真实 scope.runTracking 取得原运行，再调用新的只读报告核实，沿原计划／唯一任务完成成员执行和真实候选审阅，不重发坏工具。

| 模式 | 主／成员／另一 root 请求 | 实际结果 |
| --- | --- | --- |
| bad-plan | 10 / 5 / 1 | 原计划真实提交一次，原工具仍 failed，查询 committed，正常成员 read 与候选／review 完成 |
| bad-dispatch | 10 / 5 / 1 | 原任务真实登记一次，坏回包不重复实例化，查询后沿唯一任务完成 |
| absent-plan | 5 / 0 / 1 | 测试在真实提交入口之前抛错，原事务未产生；查询 absent 仍不授权重试或派发 |

重复查询、同 root 历史、有效另一 root 拒绝、未接入工具、重开均核对原 canonical/native/journal 字节，不以手造 canonical 或账本回执代替真实执行。这里的 absent 样本已知测试故障发生在提交前；产品报告仍不能由查无推论未执行。

## 最终 Windows EXE

- 构建：`build/20261108-030214/CBIM Assistant-win32-x64/CBIM.exe`，213,976,576 字节；ZIP 为 `make/zip/win32/x64/CBIM-Assistant-20261108-030214-win32-x64-0.1.0.zip`，180,139,369 字节。
- `build-info.json` stage 为 make；`original-command-make.log` 对应 make exit0。
- 466 项源码／构建配置最终 SHA-256：`90406cb1bb5a37ff1d23005421ad01afc724fedd17177a44d96641a0b46da345`；`original-command-source-match.json` 确认一致。

两场均先由测试中的真实 Application＋Pi 生成原历史，关闭后用同一最终打包 EXE 显式查询。**种子执行与打包端查询分层记录**；未声称在 EXE 内注入了运行故障，也没有增加生产故障后门。

| 最终场次 | 种子主／成员／另一 root 请求 | EXE 实际查询 | EXE 新模型／事务 |
| --- | --- | --- | --- |
| committed | 10 / 5 / 1 | 首查、刷新、重开后查询，共 3 次 | 0 / 0 |
| unknown | 5 / 0 / 1 | 首查、刷新、重开后查询，共 3 次 | 0 / 0 |

两场首次通过，8 张截图逐张目检，Root 另亲自检查最终未知场截图。原失败、canonical/native/journal、两主会话草稿均保持；首次挂载／重开为未查询状态，没有自动 replay。页面、通信、供应商错误均为 0。实际 DOM 核实卡正文／按钮／依据使用主题 text，原失败轨道保留 danger，保存结果 green、未知 warning；分别有颜色断言。

证据：`original-command-ui-summary.json`、`original-command-{committed,unknown}-ui-smoke.json`、每前缀的 before-query／queried-original-failure／other-root-draft／restored-read-only PNG。成功自有样本已清理，进程核查为空；没有操作用户旧程序或此前被拒绝清理的目录。

## 初次问题、修正与证据保留

1. 真实 Pi 首次 bad-plan 揭示产品错误：服务误把同一主实例的 task 邮箱和 conversation 通道要求为同 ID。已改为分别核两通道的实例、团队、主根与用途；不放宽跨身份校验。初次／诊断报告与原字节保存，失败临时样本 `cbim-test-F6oCiC` 保留。
2. Core 新 fixture 初批缺持久字段 attachmentIds，服务新 fixture 使用错误 review gap／伪授权 scope，Main 新 fixture 未实际启动 Runtime 却误断重开封存不得发生。均修夹具和断言，未放宽产品 Schema 或恢复门禁；相应初次失败 JSON 保留。
3. 独立审查补上回执游标与实际提交匹配、原 assignment 身份、唯一日志头／合法终态及反向闭合读取。旧任务合法修订不影响原命令核实，新的类型和两文件 20 项复验通过。
4. 初包 `20261108-025734` 两场功能均通过；目检发现核实卡继承原失败红色。仅更改一份 CSS 的主题色和中文说明，最终包重新完成两场。初包 8 图／日志／JSON／原字节保存于 `original-command-initial-025734/`。全仓回归运行期间未改产品 TS/TSX 或构建配置；`original-command-style-only-proof.json` 通过重构初版 CSS 的总指纹验证仅此样式差异，最终类型／架构／UI 25 项和最终 EXE 另行通过。

## 维护与未完成范围

本片同步新文件／受影响脚本中文注释、9 份 CONTRACT、15 份目录架构文档及生成器职责说明；源码共 51 目录、460 代码／样式文件。Bridge 仅导叶子公开协议，前端未依赖后端实现，报告不暴露 Prepared、原始事务、私有 native 或凭据。

本片仅 R03-A。它证明有支持协议的原控制面事务，不证明任意 shell／外部操作的全部副作用，不修旧日志，也不提供补偿或通用跨重启恢复。R03 后续仍需实际影响观察、显式处置／新修复关联、有操作前正文的受控文件补偿及其它实际通道适配。下一片计划见[异常影响核实与新修复关联](../task/effect-observation-repair.md)。确定性供应商不代替在线模型质量、真实外部服务或最终账单验证，第 9 组仍只保留计划。
