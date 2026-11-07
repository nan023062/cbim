# 安全等待补充文件与图片验收

本报告对应 [Step24 计划](../task/waiting-attachments.md)。测试使用隔离工作区、实际 Application/Pi 与本机确定性 SSE 响应，不使用用户模型密钥或真实业务目录，不证明在线模型的视觉理解质量。

## 真实 Pi / Application

首轮 `tests/waiting-attachments-pi.test.ts` **4/4 通过**，记录为 `test-results/waiting-attachments-pi-initial.json`。

| 场景 | 主 / 成员模型请求 | 实际核实 |
| --- | --- | --- |
| 快照与结果回注 | 13 / 10 | 安全 waiting 后登记文本与 PNG，修改文本源并删除图片源；实际 Pi 仍发送原快照字节。补充后新派一次只读成员并回注完成，原 scope / 主实例 / 原生 session 文件保持，新 run 与执行实例独立。 |
| 受理前拒绝 | 6 / 5 | 非视觉模型、缺失快照、跨工作区 ID、损坏快照分别拒绝。原 waiting、目标输入版本、图、运行历史均不消费，无新增请求；重开保留原等待。 |
| 实际受理后丢回复 | 13 / 10 | 测试层在真实 `loop.goalContinue` 完成之后丢弃返回，查询取回真实 receipt。已受理后删除图片快照，原命令重试仍回原记录；改变附件 IDs 拒绝，重开不重放。 |
| 预算 await 期间停止 | 6 / 5 | 开启真实 Token 软限额，供应商返回明确 usage，真实预算检查已核实 `tokensComplete=true` 后仅暂停返回。停止后放行，补充未受理、无新增 run / 模型请求；原等待目标按明确 stop 关闭为 cancelled，checkpoint 与原目标记录保留。 |

快照清单逐项核对 ID 顺序、原快照 SHA-256、内容 SHA-256、字节数、图片 MIME 与展开正文 hash/bytes。原用户正文不被展开正文覆盖。已受理同命令查询/重试不会重读已丢失的快照。

“图片不重复”的证据来自真实原生 JSONL：仅一条 user 消息包含该图片。后续成员结果回注的完整模型请求仍包含一次历史图片，这是正常上下文复用；不把“后续请求完全没有图片”作为错误的验收条件。独立执行成员只接收其自己的任务上下文，没有自动获得主用户参考图。

四组使用同一真实等待基础：主 6 次、成员 5 次请求后无运行占用。正常与丢回包场景继续到主 13 次、成员 10 次；最终主历史为 4 个 run，补充与结果回注的 source 类型不同，原生图片用户消息数仍为 1。重开后原图、scope、canonical 摘要、原生文件字节及请求计数保持。

预算停止用例首轮只覆盖默认关闭策略下的 `admit` await；随后收紧为真实开启策略、核实真实 usage 后的窗口，独立重跑 **1/1 通过**，记录 `test-results/waiting-attachments-budget-stop-real-check.json`（其余三项被筛选跳过）。没有放松产品门禁或新增产品测试入口。

## 桌面与系统文件选择器

最终同一 Windows EXE `build/20261107-175901/CBIM Assistant-win32-x64/CBIM.exe`，`pnpm make` / manifest `stage=make`。`scripts/waiting-attachments-ui-smoke.mts` 正常与 `--unknown` **两模式均 exit 0**；各为主 **13** 次、成员 **10** 次真实 Pi 请求，页面错误与模型传输错误均 **0**。中间包 `174538` 未作为最终桌面验收。

脚本通过真实界面点击 `chat.pick`，没有替换 `dialog.showOpenDialog`。Cindy computer / Cua 0.38.0 按实际测试 PID 与原生“打开”窗口逐一定位文件名控件，使用 `type_text` 经 UIA ValuePattern 填写本测试临时文件，再用 UIA Invoke 点击“打开”。正常 PID `22404` 完成普通草稿、13项拒绝、有效补充三个原生窗口；未知回执 PID `77924` 完成普通草稿与有效补充两个窗口。没有 shell 模拟键鼠、剪贴板或其他用户窗口操作。

首次 `set_value` 把 Windows 可编辑文件名组合框当成下拉选项，返回 `option_not_found` 且明确未更改内容。重新观察同一窗口后，改用同一 Cindy 工具集的 `type_text`，返回 `value_readback confirmed`，成功完成真实选择。这是控件适配诊断，不是 CBIM 产品失败。打开按钮点击后窗口立即销毁，宿主因此返回无法复查原窗口；脚本独立核实了实际附件或超限错误后才进入下一阶段，没有将单纯“点击已发送”当作成功。回执保存在 `test-results/waiting-attachments-native-picker-receipts.json`。

正常场景实际选择13个隔离临时文件后显示“最多选择12个附件，请减少选择后重试”。快照目录没有增加文件，原 scope/图、普通草稿及其附件、补充正文保持，补充附件数仍为0、请求仍为6/5；随后有效文本和 PNG 导入并完成接续。主对话卡与任务根共享附件、文本快照可预览，修改文本源和删除图片源后实际模型仍收到原字节。普通 composer 草稿和普通附件跨补充、成员回注及完整重开保持。

`--unknown` 在一次真实 `loop.goalContinue` 成功后才丢弃该次 IPC 回复，显示 `TEST_RESPONSE_LOST` 和原请求查询入口；真实服务调用数为1，原 continuation 为 `777eea0e-a353-4d4e-a41a-4d52ff1e764f`。模型完成后完整退出重开，查询确认同一 receipt，原生历史、canonical 摘要、scope/图与请求数保持，没有补发附件或自动重跑。此故障注入不捏造服务端状态。

已实际查看以下截图，确认状态、附件和普通草稿布局：

- `test-results/waiting-attachments-complete-thirteen-rejected.png`：明确超限错误，普通草稿附件保留。
- `test-results/waiting-attachments-complete-shared-attachments.png`：任务根的同一补充正文与两份附件。
- `test-results/waiting-attachments-unknown-unknown.png`：真实已受理但回包丢失，显示查询入口而不是再次提交。
- `test-results/waiting-attachments-unknown-restored.png`：重开查询已受理、周期已结束，普通草稿和附件仍在。

两份机器回执为 `test-results/waiting-attachments-complete-ui-smoke.json` 与 `test-results/waiting-attachments-unknown-ui-smoke.json`。两场初次脚本运行即通过；宿主首次控件适配失败在同一隔离实例继续核实，没有重建产品或更换假选择器。脚本正常关闭后复核本包 CBIM/Pi 测试进程为0；`cbim-waiting-attachments-ui-mYcyyr` 与 `cbim-waiting-attachments-ui-jxakcy` 两个自有临时目录均已删除。未处理以前被策略拒绝的目录。

## 验证状态与限制

- 新 EXE 脚本独立严格 TypeScript 检查已通过。
- 首轮冻结代码全仓 **221文件1309/1309**，见 `test-results/waiting-attachments-full.json`。其后补充已受理回执仅允许 `scopeStatus` 变化、原生13项导入前明确拒绝；最终 **8文件61/61**（含增强后的真实 Pi 四场）、**13项边界**、类型检查通过，见 `test-results/waiting-attachments-final.json` 及最终边界记录。没有在这两处修正后再次跑全仓，不将首次全仓数字描述为修正后第二次全仓。
- 最终架构检查：51个目录、384个源码/样式文件、687个维护文件、3227条含类型依赖、0循环，7份目录类图同步；最终构建 `175901` 包含上述修正。
- 当前片段仅补充普通文件和图片；附件是用户参考资料，不替代业务文件验证、人工验收或权限授予。
- 本报告的 Pi 故障注入与桌面实际点击分别记录；不会把端口替身称作系统选择器实测。
