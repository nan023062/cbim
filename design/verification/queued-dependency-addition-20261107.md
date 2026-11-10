# 未领取任务追加前置依赖验证

状态：2026-11-07，Step28 / R04-1 已完成最终回归与同包桌面验收，承接 `3007c6d`。本片只验证单条前置追加，不代表完整通用依赖修订。

## 单元、服务与初轮回归

- 前端初轮 `test-results/queued-dependency-addition-view-initial.json`，2 文件 **11/11**。真实组件覆盖追加/替换混合历史、compact 按节点版本选最新、损坏记录拒绝显示、会话隔离、文本转义及后来创建 A 的拓扑顺序；此时后端仍在实现，不称为最终冻结组合回归。
- 服务/工具初轮 `dependency-addition-backend-initial.json` 为 **46/47**，唯一失败是新增 Auto 夹具的 `goalPlanRevision` 错填 1，而目标版本为 3，被严格回包检查正确拒绝。首次类型检查的 GraphEdge 联合未缩窄也已修正；随后类型退出 0，5 文件 **55/55**：`dependency-addition-backend-final.json`。覆盖实际 Store、知识准备后停止/版本变化、缺审计拒绝、真实提交后的坏身份/别名回包不重复加边及迟到回复停止收口。
- Core 首轮相关 **46/47**，唯一失败是旧测试硬编码主工具总数 8，本片实际增加至 9。精准更新该数量后，最终 5 文件 **62/62**：`queued-dependency-addition-core-final.json`；另前轮 dispatch-scope **9/9**。新增13项涵盖真实闭包、长环、版本及主运行身份、权限状态、假审计/额外变更、领取先后、历史与旧替换兼容，以及严格回包。纯规则和实际服务证据分别记录。

## 真实 Pi 链路

新增独立 `tests/queued-dependency-addition-provider.ts`、`queued-dependency-addition-fixture.ts`、`queued-dependency-addition-pi.test.ts`，没有修改旧依赖替换夹具。所有模型请求发往本机确定性 HTTP/SSE 服务；Application、Pi 子进程、主工具、调度事务、成员读取、候选与审阅均使用真实实现。

主 Agent 真实调用工具先创建 B、再创建依赖 B 的 C、最后创建 A。通过 `cbim_goal_inspect` 取得实际图游标和节点版本，再调用 `cbim_dispatch_add_dependency` 增加 A→B。主末轮保持期间核实三个任务均没有运行或候选；成员实例、逻辑会话、原任务计划和指派信封保持。追加审计不携带虚构结果，新边只固定来源计划版本。

主轮结束后，实际领取顺序为 A、B、C；各自只启动一次。B 的冻结前置精确引用 A 的真实 run/result，C 引用 B，原任务及执行实例没有重建。所有文件都经实际 `read`，步骤和交付候选引用本轮读取回执，主最终审阅只引用真实成员候选，不把新增依赖工具的回执当完成证据。

首轮 `test-results/queued-dependency-addition-pi-initial.json` **4/4 通过**：

| 场景 | 实际结果 | 主/成员 HTTP 请求 |
| --- | --- | --- |
| 正常追加 | A→B→C 按真实候选首次顺序执行，目标完成 | 10 / 15 |
| 知识准备中停止 | 实际知识读取返回后保持，停止再放行；无新边、无成员运行 | 6 / 0 |
| 已提交后停止 | 保留追加边和审计，三个成员均未启动，周期取消 | 7 / 0 |
| 实际提交后丢回复 | 工具回执失败；真实 inspect 看见已提交审计，原命令查询不再提交，随后按真实候选审阅完成 | 11 / 15 |

故障只由测试包装实际服务：先 `await addQueuedDependency` 完成真实事务，再抛出明确测试错误。没有伪造成功回执、图节点或工具结果。同一完整原命令经同一个生产服务返回真实持久回执，图与记录不变；同命令改原因精确拒绝 `COMMAND_ID_CONFLICT`。停止只在已实际读取的知识返回处保持，不替换知识内容。

四场结束后均重新创建 Application，核对周期、图、运行、主历史；没有新模型请求，原业务文件内容不变。随后加强每个真实主/成员运行的原生证明：强制 `sessionFile`、`session.bound.sessionId` 非空，成员绑定与持久运行一致，读取 canonical/native 原字节并在重开后逐字比较，证据保存身份、长度与 SHA256，不再因可选字段缺省跳过。

加强后的首轮四场因测试错误要求“整个执行结束后指派信封仍与开始前相等”失败，保留 `queued-dependency-addition-pi-native-final.json`；实际执行会正常修改 delivery/claim。修正为追加事务时信封完全不变、结束时固定身份不变且领取对应真实 run/lease，并未放宽副作用或任务身份。`queued-dependency-addition-pi-native-verified.json` **4/4** 通过：正常/丢回复各 2 个主运行、3 个成员运行的 canonical/native 字节验证；两停止场各 1 个主运行、0 成员，不补造记录。请求数保持上表，供应商错误 0。最终组合另行记录。

## Windows 桌面验收结果

`scripts/queued-dependency-addition-ui-smoke.mts` 使用同一最终 EXE **20261107-201817**，正常、真实点击停止、主工具提交后正常关闭并重开三场均退出 0。通过真实主对话发送、任务图选择原 B、查看追加原因和来源任务，核对原始实例及真实边。成员未启动时没有假 run/result；正常执行后才核对真实结果固定。

| 模式 | 实际结果 | 主/成员请求 |
| --- | --- | --- |
| 正常 | 主轮结束前成员 0 运行，之后 A→B→C 首次依次执行、固定真实结果，原 B 与实例保留，目标完成 | 10 / 15 |
| 停止 | 提交追加后真实点击停止，保留边/审计，三任务均未启动、周期取消 | 7 / 0 |
| 保持时关闭重开 | 主工具已提交、主轮尚未结束时正常关闭；关闭收口取消，重开保留原审计与未启动记录 | 7 / 0 |

三场页面/通信错误均 0，普通草稿保留；正常场两主/三成员、停止场各一主/零成员的 canonical/native 绑定均非空，并在完整重开后逐字相同，没有新增请求。最后一场验证的是正常关闭收口后的重开，不冒称强杀或崩溃恢复。未知回复的注入只在 Pi 服务测试覆盖，不宣称桌面也注入了同样故障。

回执为 `test-results/queued-dependency-addition-{complete,stop,restart-held}-ui-smoke.json`，汇总 `queued-dependency-addition-desktop-final-summary.json`。Root 实际查看 `complete-settled-graph.png`、`stop-restored-audit.png`、`restart-held-restored-audit.png`（均带 `queued-dependency-addition-` 前缀），目标状态与 B 的追加历史清晰，停止和重开均为同步后的最终画面。

正常首轮脚本把 section 标题在 details 内查找而失败，实际界面已显示“已追加前置任务”；原 JSON/截图留在 `queued-dependency-addition-initial/`。修正定位后同包通过，最终脚本严格类型检查退出 0，未因此改动产品。成功场次和首次失败的自有隔离目录均已核实清理，无本轮遗留进程；没有触碰前序被拒绝删除的目录。

## 限制

本机供应商只用于稳定组织工具调用及保持窗口，不证明在线模型自主规划质量或实际收费。新增边只表示前置条件已保存；候选、工具成功和结构化主审阅不等于人工业务验收。没有新增主 Agent 业务写权限、成员派工权限或自动恢复旧任务。

## 最终冻结源码检查

`pnpm typecheck`、`pnpm check:architecture` 均退出 0；51 个目录、396 个源码/样式文件，726 个维护文件、3504 条含类型依赖、0 循环。本片同步 10 份目录类图、Core tasks／调度 execution/tools/conversation／前端 tasks 共 5 份 CONTRACT，以及相关文件头、接口注释与成员执行说明（历史文档：`docs/member-execution.md`，已清理）。

最终组合 `test-results/dependency-addition-combined-final.json` **29 文件、243/243**；架构边界 `dependency-addition-boundaries-final.json` **2 文件、13/13**。覆盖增强后的四条新 Pi、旧前置替换 Pi、Step27 运行内补充 Pi、图/实际 Store、成员执行、主工具、前端历史及增量回归。本片未重复全仓；前述初轮夹具和断言失败原记录保留。

独立交叉审查用真实 FileDispatchStore 验证变造 cause、缺审计、伪结果、夹带 source 或 scope 变更均被拒且零持久变化；合法追加后撤销、关闭旧周期后新周期追加和重开正常。另用实际 MemberExecutionManager 与本地可控引擎产生 canonical，验证 A 失败→A2 实际候选→正式替换退役新增边→重开日志一致；该补充检查不冒充 Pi。证据为 `dependency-addition-readonly-check.json`、`dependency-addition-replacement-check.json`。

`pnpm make` 退出 0，最终 `build/latest-build.json` 为 `stage:make`，包号 **20261107-201817**，程序 `build/20261107-201817/CBIM Assistant-win32-x64/CBIM.exe`。桌面证据来自上述同一最终包，构建本身不替代真机验证。
