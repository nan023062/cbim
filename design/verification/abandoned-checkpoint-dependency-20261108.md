# 已放弃检查点来源换边验证

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

2026-11-08，Step43 / R04-3，承接 `5321e78`。复用单条候选替换协议，完成 Step34 留下的“显式放弃检查点后保留未启动后继”分支。

## 实际行为

原来源必须 cancelled 且有完整 `abandoned_by_handoff`、唯一未恢复完成段、冻结检查点证明、原成员/租约/通道、原领取及交接信封；已预约的恢复信封须 processed 且无 claim。普通取消、未放弃、已恢复、未知或损坏来源拒绝。服务两次核 canonical 并重算原检查点和 logHash，不刷新旧文件/native 证明，也不复活旧任务。

新候选、目标及完整未领取后继沿既有当前知识、岗位、Workflow、模块覆盖、实际证据与领取门禁。原边退役，原任务/计划/实例/信封保持；目标完成仍须显式真实 `superseded` 审阅。旧来源当前文件已变化可保留历史，但新候选必须证明自己的当前事实；后继岗位过期仍拒绝。

## 验证

- 最终相关回归 `test-results/abandoned-checkpoint-related.json`：33文件、240/240、无失败/跳过，260秒。覆盖新分支、已有失败/求助替换、多边修订、检查点/放弃/负责人、原命令、目标、视图及13项依赖分层检查。早期服务5/5和真实Pi4/4与该批次重叠，不累加；本片未重跑全仓。
- 真实 Store 测试无预约/有预约放弃、原任务及运行/信封保持、当前文件新候选、原键幂等/存储重开、实际 B 首次领取新 A2；对错误来源、证明、预约、租约、canonical 缺失/截断/错配/未知及停止竞争整体拒绝，无半条边。
- 真实 Pi 四场：complete、bad-output、submitted-stop、restart-held。实际读文件/采集/检查点→预约→放弃→独立 A2→换边→原 B/C 首次执行。原检查点只一个 run，原 canonical/native 字节保持；坏输出实际提交1次、原 failed 与只读 committed 分开。停止/重开不自动执行。
- 最终源码类型、脚本类型、架构检查通过；51目录499源码/样式、947维护文件5044依赖0环，3项已审核动态加载。5组中文注释、CONTRACT 和 ARCHITECTURE 同步：core/tasks，scheduler-engine 的 execution/tools/conversation，frontend/tasks；内置规则同步。

## 最终 Windows EXE

构建 `20261108-074927` 退出0，505项源码/配置构建前后及验收后同指纹 `87c8e10eb5dc8ee907f7189c944039a9192802c2c6388c47340e20568b9fa9c0`。本机确定性 HTTP 模型驱动真实 Pi，不代表在线模型自主业务质量。

| 实际桌面场景 | 主/成员请求 | 结果 |
| --- | --- | --- |
| complete | 18 / 20 | 真实检查点放弃、新候选、原 B/C 首次执行和目标替代审阅；原卡片、换边及原命令查询通过 |
| stop | 15 / 10 | 换边保存后实际停止，原 B/C 无运行，原放弃和审计保持 |
| restart-held | 15 / 10 | 主轮尚未结束时关闭重开，原后继安全封存，原命令/放弃记录保留，无重放 |

三场查询及重开新增请求0，原日志/草稿保持；页面/通信错误0，自有程序及模型服务关闭、成功临时样本清理。证据为 `test-results/abandoned-checkpoint-{complete,stop,restart-held}-ui-smoke.json`。21张成功截图，目检6张：complete 的 original-checkpoint/held-audit/restored-command，stop 的 settled-audit，restart-held 的 restored-checkpoint/restored-command。没有操作用户日常程序或工作区。

产物 SHA256（完整字节数见 `test-results/abandoned-checkpoint-final-artifacts.json`）：EXE `beeaab9e0242dbd2163047bcbae73e8e462a9594b3f224e6938fcf5feca58ff5`；app.asar `ec018b46ea5f011450db89aaf648d95dc13943faddbfa1f3d69ca7faddc6051b`；ZIP `b582dd3874e66aba903bd5247ca9ef637d7f2fcf15556b99a2fde6cf3f556756`。

## 初次问题与限制

初次夹具错误地给严格游标传入完整图身份；修正后发现产品比较将可信运行/命令附加字段一同视为 GraphIdentity，误拒合法来源，改为精确比较对应身份字段。第一批15/20、服务1/5失败报告保留，最终5/5与240/240复验。早期Pi在旧门禁上等待的运行被终止，不计完成；随后测试对序列化后不存在的 claim 字段使用了过强断言，纠正后四场通过。测试辅助函数签名/类型错误已修。

独立脚本类型配置初漏 noEmit，生成304个未跟踪 JS/MJS 副本；按工作区内已核实的 TS 对应文件逐一清理，清单留在 `abandoned-checkpoint-emitted-cleanup.json`，未改原源码/已跟踪文件。修正配置后类型及架构复验通过。首次桌面选择器匹配状态标签和检查点卡两处；限定卡片后，同一最终 EXE 三场通过，失败 JSON/截图/样本保留。

R04 已约定的安全待办依赖调整范围及拒绝域见[支持表](../task/dependency-revision-support.md)；不包括旧已执行任务复活、强行修改过期岗位或未知来源。下一片 R05-A 处理可靠成员检查点和未启动后继的持久等待与重启后显式继续，再扩展多段检查点及其它受支持生命周期。R03/R07/R13对应缺口仍跟踪，第1–8组未全部完成，第9组仅计划。本步独立本地提交，不推送。
