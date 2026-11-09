# Step34：负责人变更后的存量任务交接

日期：2026-11-08。状态：实现、定向与全仓回归、最终构建和三场桌面验收已完成。承接 `f94c821`，对应 [R02-D 实施计划](../task/module-owner-handoff.md)。本片连同 Step30–33 完成 R02 约定的登记、责任控制、按负责人执行及有界存量交接；R03–R17 仍须逐包推进。

## 实际行为与边界

- 主 Agent 用 `cbim_dispatch_abandon_checkpoint` 显式放弃同活动周期未消费的可靠检查点；可包含已预约但未领取的恢复请求。只取消原任务，保存不可变 `checkpointAbandonment`，保留原负责人、运行、预约、检查点和证据。
- 原命令先查回执；历史 canonical、TaskSpec、终态、日志哈希和既存证明在 Store 事务外核实。当前 native、知识、模型或业务文件变化不阻止旧待办处置；历史 canonical 缺失或损坏仍拒绝，不刷新原证明。
- 最终短事务核对原图、目标、任务、原运行和租约。精确处置只递增一次原成员租约、更新原节点与投影并处理未领取恢复信封；不得夹带其它状态变更。放弃和领取由同 Store 串行裁决，旧检查点结果信封的迟到确认独立保留。
- Auto 将操作及回执核实纳入停止屏障；即使原公开回包损坏或丢失，也只查询原持久命令以撤销旧恢复票据，保留原工具错误，不重复提交或伪称模型已收到成功。
- 主调度明确撤销未启动后继闭包，按当前负责人创建新计划和独立任务。新候选与 `superseded` 审阅才可满足完成门禁，取消、放弃或负责人更换都不是业务成果。
- 前端区分显式交接放弃与普通封存，展示原记录、原因及审计；当前负责人另行核实。两处目标卡可以定位同周期原任务与新成果，不修改派发边、不触发执行或清理草稿。

这不是通用异常恢复、跨重启续执行、旧原生会话迁移或 cancelled 来源依赖边的通用替换。已领取任务继续使用原身份结算；关闭或中断周期不自动复活。

## 定向验证

报告位于本机 `test-results/`。组合存在重叠，不将下列数字相加冒充全仓测试数量。

| 范围 | 结果与报告 |
| --- | --- |
| Core / Store / 图 / 主工具契约 | 9 个不同文件共 89 项；`checkpoint-handoff-core-final.json`、`checkpoint-handoff-core-legacy-final.json`、`checkpoint-handoff-graph-store-final.json` |
| 服务、自动协调、原检查点服务、工具 | 4 个不同文件共 63 项；`checkpoint-handoff-backend-final.json`、`checkpoint-handoff-service-final-nine.json`及 initial 中原检查点服务 7 项 |
| 前端事实投影及目标导航 | 2 文件 26/26；`checkpoint-handoff-view-final.json` |
| 真实 Pi 四种场景 | 正常、已预约、准备中停止、已提交后坏回包分别通过；`checkpoint-handoff-pi-initial-complete.json`、`checkpoint-handoff-pi-initial-boundaries.json`、`checkpoint-handoff-pi-lost-output-after-fixture-fix.json` |

Pi 正常与坏回包场景模型请求分别 main/A/B = 21/7/15；预约场景为 22/7/15，均产生独立 B 候选并完成目标。准备中停止为 9/7/0，周期 cancelled，无处置提交、新 B 运行或旧运行重放。原 A canonical/native 字节保持，原命令重复查询不增加 journal。

初轮失败证据均保留：Core 新夹具遗漏证据身份；service 夹具变更回调字段误用、同步拒绝断言方式错误；Pi 坏回包夹具误将真实纯文本错误当 JSON。修正夹具后精确复测，不隐去初次失败，也不把被名称筛选跳过的场景计为通过。

## 源码与架构

最终门禁：`checkpoint-handoff-final-gates.log`、`checkpoint-handoff-final-boundaries.json`。类型检查、类图同步与含类型依赖检查通过；51 目录、451 源码/样式文件，842 维护文件、4360 依赖、0 环，13 项边界测试通过。

15 份 `ARCHITECTURE.md` 与受影响的 Core、调度、Main、Bridge、任务/会话视图注释和 CONTRACT 已同步。主 Pi 提示同时纠正了内置执行者缺省派发措辞，明确仍须岗位、模块责任及独立采纳模型。

生产源码与六份构建配置共 457 项冻结为 `c8f9be257888c11ac65a91cd6720da63691a8f80469c8963a4ae8c248a93e5fc`，清单 `checkpoint-handoff-candidate-source.json`。最终桌面结束后须再次核对，不能以较早程序代替。

## 最终打包与桌面验证

全仓 270 文件、1716 项全部通过，无失败或跳过；最终源码上的单批结果见 `test-results/checkpoint-handoff-full-final.json`，完整日志 `checkpoint-handoff-full-final.log`。包含上一片修正后的旧夹具，未用定向报告拼接成全仓成功。

`pnpm make` 退出 0，日志 `checkpoint-handoff-make.log`；实际清单 stage 为 make。三场固定同一个 `build/20261108-021118/CBIM Assistant-win32-x64/CBIM.exe`（213,976,576 字节），ZIP 为同目录 `make/zip/win32/x64/CBIM-Assistant-20261108-021118-win32-x64-0.1.0.zip`（180,119,027 字节）。冒烟后 `checkpoint-handoff-source-match.json` 再次确认源码清单及 SHA256 未变。

三场均首次退出 0，无源码或脚本重试修改，汇总 `checkpoint-handoff-ui-summary.json`：

| 场景 | 主 / A / B HTTP 请求 | 主 / 成员运行 | 真实结果 |
| --- | --- | --- | --- |
| 正常交接 | 21 / 7 / 15 | 3 / 4 | completed；实际界面将负责人 A 换成 B，原 A 不被迁移，B 的三个新任务提供独立候选 |
| 已预约后交接 | 22 / 7 / 15 | 3 / 4 | completed；原恢复预约保留并被处置，没有被领取或产生第二次 A 运行 |
| 已保存放弃后点击停止 | 10 / 7 / 0 | 2 / 1 | cancelled；真实 UI Stop，处置事实保留，B 零请求、零运行 |

24 张截图逐张检查；两个 completed 场实际点击审阅中的原/新任务引用，跳转正确岗位和模型。原 A 冻结绑定、canonical/native 字节及原图边保持；业务原写入只有 1 次。普通草稿保留；重开全部运行字节和请求序列不变，无自动重放。三场页面、传输及可控供应商错误全部为 0。

只清理三场自有通过样本和进程，均确认清理成功，无测试进程残留；没有操作用户正在运行的旧 `235854` 程序。未知回包仅在真实 Pi 故障注入验证，桌面未注入该故障，不将两种证据混称。

Pi 和桌面均使用真实引擎与 localhost 可控模型响应，验证装配与状态，不代表在线模型的专业判断、费用账单或真实业务试运行。R03–R17 仍须继续推进，第 9 组仅保留计划。
