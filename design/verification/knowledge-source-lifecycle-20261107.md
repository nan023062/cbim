# 受控来源代次验证

Step32 / R02-C 前置，承接 `2f4cb66`。状态：本片完成，于2026-11-08完成最终桌面验收。[计划](../task/knowledge-source-lifecycle.md)定义范围；实际负责人派发仍由[下一片](../task/module-owner-dispatch.md)接通。

## 最终结论

- 两轮全仓均保留原结果：第一轮257文件、1624/1625，通过修正启动顺序解决真实历史误诊；第二轮258文件、1627/1628，原历史测试通过，唯一队列夹具的异步采样问题精确修正后5/5定向通过。未跑第三轮全仓，不将这些结果表述为单批1628项全绿。
- 修后历史/损坏/观察/启动定向6文件35/35、队列5/5、最终类型与架构检查通过。第二轮之后产品源码未变化，仅修队列测试的基线采样；源码冻结指纹与构建前检查保留在`test-results/knowledge-source-frozen-code.json`。
- `pnpm make`退出0，最终Windows包`20261107-235854`，manifest为`stage: make`。两场实际EXE桌面首次通过，11张截图逐张目检，模型请求/运行及页面/通信错误均0。
- 注释、15份CONTRACT及18份目录类图同步；最终51目录、436源码/样式、799维护文件、3928条含类型依赖、0循环。

## 当前实现

同一 DispatchStore 追加来源捕获、prepared和resolved事件，保持独立游标。普通内容修改与受控对象替换分别处理；旧岗位和责任不自动采纳来源。首次来源捕获与明确岗位/责任采纳原子保存，已有来源按当前引用核实。内置执行者使用实际能力内容指纹，不创建项目目录代次。

界面分别展示内容差异和来源状态；岗位沿明确能力采纳，模块沿独立同负责人 `adopt_source` 预览和确认。旧缺省、退役、未决和来源不可核实不冒充可执行。提交前保存原请求，未知只查原命令；首次明确来源屏障拒绝可回编辑，已经未知的命令不会因晚到拒绝而换ID。

知识事务以私有计划v2记录有序删除/创建与整包替换范围。prepared journal先保存，来源pending确认后才允许写正式文件；成功后的final或通知失败不回滚知识。未能证明Store受理时封闭实例，避免后续写入破坏原before；若能证明真实pending，保留只读诊断而继续阻止新知识写入和采纳。恢复只核原日志，缺失和冲突不猜测成功。

启动时在工作区锁内核对唯一DispatchStore身份，再恢复知识和来源。普通无关文档变动不改变岗位能力采纳依据；真实来源代次、内容、模型或岗位变化仍使旧依据失效。原请求的属性顺序和旧内部可选hash字段保留，不把解析后的重排对象用于原命令指纹。

## 已执行的阶段验证

- 前端3文件25/25通过（`test-results/knowledge-source-view-final.json`），包含原岗位/责任状态回归、来源展示、同owner采纳、保留原来源和未知回复恢复。此前初轮24/24通过，补source pending断言后25/25；不能叠加计数。
- Core初轮新增来源13/13、旧岗位/责任/Store3文件38/38；容量与竞争补齐后4文件54/54。最终依据兼容修正后2文件32/32（来源18、岗位14），报告`test-results/knowledge-source-core-basis-final.json`。各批重叠，不累加为一次全过。
- Main最终定向4文件22/22，恢复/资源包3文件19/19，主工具/计划2文件13/13，旧对象/资源包/生命周期/崩溃4文件22/22；报告分别为`knowledge-source-owned-final.json`、`knowledge-source-recovery-package-final.json`、`knowledge-source-owned-new-3.json`、`knowledge-source-owned-regression-initial.json`。它们是重叠分批证据，最终两轮全仓结果及精确修正另列如下。
- 最终类型、目录架构与含类型依赖检查通过；完整输出见`knowledge-source-type-verified.log`、`knowledge-source-architecture-verified.log`。独立层级边界文件2/2通过，完整回归另覆盖11项依赖测试。
- 固定旧EXE `20261107-222611` 在新建隔离目录实际生成旧格式知识、岗位和责任日志，HTTP0，保存原字节/hash并关闭旧程序。它是兼容样本准备，不是新版功能验收。首轮seed脚本误读`member.capability`，修为真实`member.adoption`后通过；未改旧产品，初失败报告和现场保留。

故障与实际子进程终止6/6通过，第二轮全仓亦通过。实际进程在知识committed、来源final前被终止，重开只追加一次结算；正式知识字节/修改时间和原committed journal未变，第二次重开零重写、模型HTTP0。原现场报告`test-results/knowledge-source-actual-process-exit.json`。

## 首轮问题及修正依据

- 真实资源包导入暴露产品问题：Zod解析后的属性顺序改变既有请求指纹，现只验证并保留原wire；同路径同字节目标在真实非空整包替换中仍换代。
- 旧岗位回归暴露新basis错误纳入全库revision，现仅在basis中排除无关revision，真实来源事件仍保存完整观察。旧内部KnowledgeFile变更的可选hash兼容已恢复，来源/计划伪造字段仍拒绝。
- 旧并发测试钩在Workspace.snapshot，实际采纳已走withSourceSnapshot；一处在持有知识队列时同步等待第二次提交导致测试自锁。改为真实快照窗口和隔离目录外部文件变化，继续核停止、来源变化和未写日志，而不是放宽产品门禁。中断批事实见`test-results/knowledge-source-regression-interrupted.json`。
- 新夹具曾使用无效初始Agent、错误profile保存字段和无变化内容的“模型采纳”，另有错误码与message断言混用；修正夹具后逐项通过。prepared/noStore的初修过度封闭了已证明pending的只读诊断，现按真实原记录区分两种情况。首失败JSON保留，不计作通过。
- 第一轮全仓257文件/1625项，1624通过、1失败。唯一失败是重开后的Agent历史多出错误诊断，历史items及分页未变；独立重跑稳定复现，证据`test-results/agent-history-source-review-isolated.json`、`agent-history-source-review-diff.log`。新增来源启动提前触发Store观察器，历史索引尚未初始化就接收投影，随后正常记录被当成重复。修正采用在工程锁与路径身份核实后、首次Store读取前初始化历史；不放宽重复检测、不清空已有投影、不修改旧断言。修后6文件35/35及第二轮全仓中的原历史2/2、启动边界3/3通过。第一轮原始证据为`knowledge-source-full-final.log`；当时命令多余`--`使JSON reporter未生效，不能宣称存在同名JSON报告。
- 第二轮完整报告`test-results/knowledge-source-full-verified.json`及同名log：258文件1628项，1627通过、1失败、0跳过。队列ack-unknown夹具在模型退出后立即保存重启基线，捕获到已阻塞但尚未闭合的active周期；7毫秒后正确关闭为failed，多出closedAt/outcome。请求仍2次、steer1次，没有重放。仅改夹具等待真实非空周期全部closed，再明确核failed/unknown，保留全文相等与请求断言；最终`knowledge-source-queue-insertion-final.json`为5/5。原差异见`knowledge-source-queue-insertion-original-diff.json`。独立首次单跑碰巧通过不是修正依据，也未据此掩盖全仓失败。

## 最终包与真实桌面

EXE：`build/20261107-235854/CBIM Assistant-win32-x64/CBIM.exe`；ZIP：同版本目录下`make/zip/win32/x64/CBIM-Assistant-20261107-235854-win32-x64-0.1.0.zip`。本片不签名或发布，也不替换用户当前运行程序。

| 场景 | 实际操作 | 结果 |
| --- | --- | --- |
| complete | UI知识提交5次、岗位采纳2次、同负责人来源采纳1次 | 普通编辑保留代次；同路径同字节重建换代；明确采纳后current，memberId/bindingId保持 |
| legacy | 固定旧222611 EXE真实生成记录，新包读取；UI改名及能力采纳共2次、责任来源采纳1次、知识提交0次 | 读取和改名不暗补来源；恰两条observed_existing捕获；原知识与知识事务字节不变 |

两场重开均0提交、0模型HTTP、0模型运行、0页面/通信错误，原回执、调度及知识journal字节、双工作区普通草稿保持。汇总`test-results/knowledge-source-lifecycle-desktop-final-summary.json`，分场`knowledge-source-lifecycle-{complete,legacy}-ui-smoke.json`。11张截图已逐张检查，根线程复核正常退役/采纳与旧记录/重开视图。成功场次自有桌面进程、HTTP探针和临时目录已清理；旧种子首轮失败目录及其他失败证据保留。用户正在运行的旧版进程未操作。

## 尚存边界

受控来源只追踪已记录事件；首次观察不证明此前连续，离线同字节删除重建若未留下观察/事务也无法追溯。来源与知识仍非跨存储ACID，未知须保留原事务。当前片不接实际负责人派发、领取或存量交接；R02-C/D仍待后续。本轮第9组只保留计划。
