# Step46 / R06 逐模型请求预算验证

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

日期：2026-11-08。承接 Step45 `a2868f6`。当前状态：本片约定范围完成；冻结全仓311文件2068/2068、最终定向113/113及最终EXE三场通过。

## 实际交付与边界

新目标可明确启用 `enforcement: request`。旧设置缺省仍为运行间软限额，旧周期不迁移。主 Agent、正式成员、Pi 重试及自动摘要的每次实际模型 HTTP 请求，经同一工作区 DispatchStore 串行预留后才能发送。请求绑定原 workspace/root/scope/task/run、所有者实例、冻结模型及策略版本；阶段追加保存，查询与重启不重发。

按冻结模型完整输入容量加本次明确输出上限保守预留，缓存输入取冻结价格中的最高单价；实际结算区分非缓存输入、输出和缓存，推理分量不重复计入输出。金额是本地估算，不是供应商账单。未知、未保存终态和跨所有者遗留保持预留；只有当前 IO 所有者可靠确认未发送才释放。用量超出预留保存实际事实，并阻断后续请求。

真实发送由父进程代理执行，真实 API key 留在父进程。子进程启动时安装 fetch 门禁并核实握手，固定供应商地址、模型、API 路径和输出上限；不使用会吞掉异常的 Pi 扩展钩子充当阻断。终态只有在严格完整 SSE 用量与可靠结算完成后才交付。未知屏障同时阻止后续模型请求和工具调用；关闭先结束实际 IO 和账本保存，再释放运行资源。

支持本项目固定 Pi 1.5.0 的 `openai-completions`、`openai-responses` 和 `anthropic-messages` 流式协议。拒绝 OAuth、重定向、未知私有协议、后台请求、多候选、缺少明确输出上限及与冻结模型不符的请求。端口验证不能冒充操作系统网络隔离，后者仍属于 R12。每工作区最多16,384个请求、每周期4,096个，附录32 MiB；为在途终态预留存储空间，超限不删除历史来继续运行。

## 检查与定向验证

| 记录 | 实际结果 | 说明 |
| --- | --- | --- |
| `request-budget-first.json` | 8文件48/48 | Core/Store、用量、传输与旧设置的初次相关验证 |
| `request-budget-pi-first.json` | 1文件9/10 | 自动摘要夹具没有触发真实摘要，失败保留 |
| `request-budget-compaction-probe.json` | 1失败、9未选择 | 只运行摘要定位用例，不计全量通过 |
| `request-budget-compaction-native-history.json` | 1失败、9未选择 | 已触发真实摘要，但断言误把摘要归到第二周期 |
| `request-budget-pi-view-fixed.json` | 1文件10/10 | 当时 `.tsx` 视图用例不在 Vitest 发现范围，不能称视图通过 |
| `request-budget-targeted.json` | 11文件72/72 | 视图用例改为被发现的 `.test.ts` 后运行 |
| `request-budget-targeted-post.json` | 20文件113/113，无失败/跳过 | 最终源码，含真实 Pi、旧软限额、负责人执行、检查点链、Store及依赖/分层 |
| `request-budget-checks-final-receipt.json` | 全部 exit 0 | `pnpm typecheck`、`pnpm check:architecture`、桌面脚本独立 `tsc --noEmit` |

最终定向耗时134秒。上述批次重叠，不相加。真实 Pi 的11项覆盖三协议、同轮额度阻断、未知后重试不再到达供应商、真实自动摘要、主/成员共享额度及等待继续拒绝。摘要用例实际4次 HTTP，其中一次为 Pi 自动摘要，跨两个周期合计50,360 Token；不是只调用摘要模拟回调。主/成员完整场为6/5次，合计1,920 Token。等待额度不足时原 wait、goal、tracking、journal 保持，修改未来设置和重启不绕过旧额度。

Core/Store 验证并发预留、精确幂等、伪身份/阶段、写前及 fsync 后故障、重启遗留、缺价格、极小正金额、超额报告、重算 checksum 后的坏日志与跨票据未知屏障。真实本机传输验证断流、HTTP错误、取消、重定向、usage冲突和结算失败，不能把这些错误解释为免费。极小正金额换算不得下溢成零；界面仅将显示值整理为6位有效数字，不修改账本。

## 冻结全仓回归

最终311文件、2068/2068通过，无失败或跳过，耗时1486秒。原始报告为本机 `test-results/request-budget-full.json`，回执 `request-budget-full-receipt.json`。运行前后重新枚举源码/配置、内置资料和测试/脚本，三组数量及hash均一致，也与最终定向和构建相同。期间仅整理非内置开发文档，未混入下一步代码。

## 最终 Windows EXE

最终构建 `20261108-103605`，`pnpm make` exit 0。三场均由真实 EXE、真实 Pi 和本机确定性 HTTP 供应商完成，实际点击设置及显式刷新；不是在线供应商计费或自主业务质量验证。

| 场景 | 供应商实际请求 | 请求账本 | 重开结果 |
| --- | --- | --- | --- |
| 正常主/成员完成 | 主6、成员5 | 11次结算，1,920 Token，本地约 $0.00224 | 原周期、图和日志逐字保持，新增请求0 |
| 同轮额度不足 | 主1、成员0 | 1次结算120 Token、1次拒绝；下一次需69,632，剩余69,580 | 原拒绝保持，新增请求0 |
| 用量未知 | 主1、成员0 | 未知1次，保留69,632 Token及约 $0.106496 预留 | 原未知保持，新增请求0 |

三场将未来设置改为500,000 Token后，原冻结策略及原报告仍保持。页面错误0，自有成功进程与临时目录已清理；未操作用户原桌面进程。最终生成9张截图，已目检正常设置、正常结算/重开、额度阻断及未知重开5张关键图。

初包 `20261108-102908` 正常流程已通过；阻断场脚本过早读取尚未建立的 journal，以 `ENOENT` 退出且供应商请求0，不能计为预算验证。修复仅对该启动等待中的 `ENOENT` 重试，并等待实际界面终态；费用浮点尾数的显示修复后重新构建和验证最终三场。初始截图、日志及失败 JSON 以 `first-request-budget-*` 保留，失败现场也保留。

## 冻结指纹与产物

最终检查、定向回归和构建的 before/after 全部一致；桌面验收使用此最终包。完整回归前后也核实为同一组指纹。

| 范围 | 数量 | SHA-256 |
| --- | ---: | --- |
| 源码/样式及构建配置 | 523 | `81093f42a6018cd9f0348c796ea7e26ac873e9e15d5b9dc5fcc37474647c6140` |
| 内置运行资料 | 21 | `7e7f215b192e5b5dfcd21eb9d58d7cde37c2b172e40ba0b1d9824e501fac903e` |
| 测试与脚本 | 500 | `b364dc739f431b9d3ca6be8c9f7c494ee8b3b2d7af932dc5994d1c3a8443e4e1` |

指纹脚本本次将 `tsconfig.json` 和 `vitest.config.ts` 纳入配置清单，不能直接用数量与上一步不同清单比较。

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `CBIM.exe` | 213976576 | `002cb5a1fbd8f20e098b1352e1da6bfac44fa8f61b7d85833913a9dba513856f` |
| `resources/app.asar` | 3093869 | `9803c8afffd9274b220498a1d4bf11cbf3afe04f5599a4dbbbc4208b17b89c86` |
| `CBIM-Assistant-20261108-103605-win32-x64-0.1.0.zip` | 180318473 | `f86d53d851b4089b871443dbcf1231b299b9c1248359f42d567c1cc5cd56253d` |

EXE单文件不包含全部应用代码；须与同目录 `resources/app.asar` 和完整ZIP一起对应。散列回执为本机 `test-results/request-budget-artifacts.json`，其余测试、构建、UI回执也在 `test-results/`，不把本机忽略目录当远端已上传证据。

## 同步维护与接续

11组目录的中文文件头/关键接口、CONTRACT与ARCHITECTURE同步：Core tasks、brain/llm、brain/pi，scheduler-engine/execution，Main及ipc、persistence/settings、persistence/tasks，bridge/contracts，frontend/settings、frontend/tasks。共51目录514源码/样式；依赖扫描979维护文件、5,232条含类型依赖、0循环、3项已审核第三方动态加载。

内置 `business-execution.md` 和 `task-loop.md` 同步请求预算及未知屏障；后者同时纠正已过时的“一次检查点”说明，匹配 Step45 的16段和持久等待实现。R03未覆盖异常、R07完整产物至R17继续按既有清单，第9组仅保留计划。本步按授权独立本地提交，不推送；实际提交号以Git产生的记录为准。
