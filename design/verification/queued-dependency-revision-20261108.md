# 未领取任务原子前置修订验证

2026-11-08，Step42 / R04-2，承接 `908416a`。本片完成同一未领取目标的多条前置原子增删；R04 仍保留显式放弃检查点来源后的候选替换分支，不把本片写成整包完成。

## 实际交付与边界

- `cbim_dispatch_revise_dependencies` 固定完整图游标、目标/来源版本和理由，一次最多退役32条原边、新增32个来源。目标、变更来源及前后图的后继闭包（最多500任务）必须未领取；当前计划、知识、岗位配置及原信封均重新核实。未改变的反向前置可已有真实有效候选。
- 完整新图防环，旧边只退役不复活，新边不伪造结果。目标只升节点版本，保留计划、实例、原信封和执行身份；重算等待状态。统一 Store 门禁独立重选闭包并核精确边/节点/成员变更，原审计不可修改，不能借 cause 绕过。
- 知识→模型→Store 锁顺序核实当前绑定，停止、领取、版本竞争拒绝整批。真实主工具、严格输出、独立调用键、Auto 原闭包跟踪和历史界面均接通；主运行结束前不领取成员。
- 新工具纳入第九类原主写命令只读核实。保存后的坏回包仍保留原失败，只读返回原 committed，不重发、不清除未知。重开不自动执行；删除最后一条边恢复 queued 也不是业务完成。

## 测试与检查

最终相关回归 `test-results/dependency-revision-related.json`：33文件、245/245，通过、无失败/跳过，192.95秒。覆盖新规则/真实 Store/真实 Pi/视图及已有追加、替换、负责人、检查点、原命令、依赖分层等；早期13项、60项、服务9项和Pi4场与最终批次重叠，不累加。本片没有重跑全仓；Step37 的1915项是历史证据。

有意义的反例包括完整图环、空/重复/原样换边、陈旧边计划、错误闭包/审计/回执/主身份、跨对象 co-write、旧 CAS、停止/知识变化，以及真实 MemberExecutionManager 先领取后拒绝删除运行中来源。坏回包和参数别名损坏仅提交一次；连续三次合法修订保留退役及审计历史。

最终 `pnpm typecheck`、独立烟测脚本类型检查、`pnpm check:architecture` 通过：51目录499源码/样式、942维护文件5011依赖、0环，3项已审核动态加载。初次类型接线和测试夹具 toolPolicy 缺失已修；命令行引用和搜索通配符错误不计产品验证通过。中文文件头、接口及字段说明与7组 CONTRACT/ARCHITECTURE 同步：core/tasks，scheduler-engine 的 execution/tools/conversation，bridge/contracts，frontend 的 tasks/conversation。实际类型字段另在 Core CONTRACT 类图中补齐。

## 最终 EXE

构建 `20261108-072613`，`dependency-revision-make-final-receipt.json` 退出0。505项源码/构建配置在冻结、构建前后及验收后同指纹：`2a23ada1fcd4e107be4f888593c88e5ecb8069025eb3b1207142e3d76d0e9f5e`。随后仅补类图/报告，不修改产品源码。

| 场景 | 模型请求（主/成员） | 实际结果 |
| --- | --- | --- |
| complete | 11 / 20 | 原 B→C 退役，新增 A→C、D→C；四原任务/实例/信封保持，按真实 A、D 候选领取 C；原命令、历史及重开通过 |
| stop | 8 / 0 | 修订已保存后实际点击停止；原审计保留，未启动成员，重开不重放 |
| restart-held | 8 / 0 | 主运行尚未结束时关闭并重开同一 EXE；任务安全封存，原审计/原命令仍可核实，无自动执行 |

三场均实际通过桌面点击，查询/重开新增请求0，原 canonical/native 字节与普通草稿保持；页面和通信错误0，自有程序/模型服务关闭且临时样本清理。报告位于 `test-results/dependency-revision-{complete,stop,restart-held}-ui-smoke.json`。共生成21张截图，目检6张：complete 的 held-audit/original-command/restored-command，stop 的 settled-audit，restart-held 的 restored-audit/restored-command。真实 Pi 使用本机确定性模型服务；未验证在线模型自主分工质量，未触碰用户日常程序或工作区。

产物哈希详见 `test-results/dependency-revision-final-artifacts.json`：

| 产物 | SHA256 |
| --- | --- |
| CBIM.exe | `1cee9286f76b5354b821658de1fd8727d5acff932360bf650ffaa8bee9b24859` |
| resources/app.asar | `6ab2c3e12ab85694ff03813df1dafd33a8c8d38ebb0cd475f5a594f84a9ab9d1` |
| CBIM-Assistant-20261108-072613-win32-x64-0.1.0.zip | `e1b9cd0b495c3526d88c183fcefa77af8fb5206f3944b5067f76c75c58a9763b` |

## 接续

本片不允许删除已执行、失败或未知来源来掩盖事实。可靠失败来源已有独立候选替换协议；下一片 R04-3 承接 [Step34](../task/module-owner-handoff.md)，仅对已经明确放弃的可靠检查点来源保留未启动后继并换入真实候选。随后继续R05–R17；R03外部/完整产物缺口按支持矩阵联动，第9组仅计划。本步独立本地提交，不推送。
