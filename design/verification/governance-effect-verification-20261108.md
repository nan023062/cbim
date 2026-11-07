# 原治理与责任保存核实验证

2026-11-08，Step39 / R03-D2，承接 4db3a27。约定三项原主命令已完成，独立本地提交；不推送。R03 仍有后续适配，第 9 组仅计划。

## 实现与边界

- 原 cbim_governance_observe/propose 与 cbim_module_owner_change_commit 进入既有影响面板、明确处置与新周期关联。严格核 canonical 主身份、唯一周期、实际工具参数、授权效果/knowledge 范围、原 commandId 与完整指纹；调用失败和保存事实分别保留。
- 治理使用已打开且 init/append 校验过整链的唯一账本，在同一知识队列只读原命令；负责人使用唯一 DispatchStore 的不可变责任事件与原回执。原实例从匹配持久请求取得，不换成当前实例，不以当前保护或关系头补造原结果。读取已校验内存投影，不承诺本次重新验证磁盘全部字节。
- 公开摘要是纯叶子，仅身份、指纹、记录类型/时间及原责任版本，无正文/私有路径/权限。sourceHash 另核完整原解析输入与来源；两次读取变化使观察失效。旧处置无字段默认化、basis 不改；absent 不等于未执行，失败或错误返回不可核实。
- 查询不启动模型、不提交、不批准、不实施、不刷新知识、不交接或派发。显式处置仅追加自己的附录，后续核实/修复仍需原协议资格。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| 新服务与真实 Pi | 2 文件 15/15；涵盖三种保存后丢回包、错误输入/身份/指纹/回执、缺失、停止、读取变化、旧报告、旧实例重开 |
| 最终相关回归 | 19 文件 177/177，0 失败/跳过；含原影响、知识原事务、治理/负责人服务与真实 Pi、13 项依赖/分层；与前项重叠，不累加 |
| 类型及桌面脚本类型 | pnpm typecheck；独立脚本 tsconfig，均通过 |
| 架构和依赖 | 51 目录、494 源码/样式，0 文档差异；926 维护文件、4894 含类型依赖、0 环，3 处已审核外部动态加载 |
| 最终构建 | 20261108-063249，500 项源码/配置构建前后同指纹 ec96e10d5eec53b8957d3049c98e532e6f00c9c8371b9660120410aea112d8ff |

本片未重跑全仓；Step37 的 1915/1915 是前序记录。初次测试有新增夹具语法笔误、请求计数误计及测试 unknown 类型错误，修正后通过；原失败报告 persistent-effect-first.json 保留，不计成功。产品源码没有因这些夹具错误放宽边界。

## 最终 Windows EXE

三场均先在隔离源码 Application 通过真实 Pi 及领域写入保存一次，再故意丢弃返回（负责人破坏返回身份）。最终 EXE 使用同一隔离数据、没有注入，通过真实按钮核实原调用、保存处置、查询原处置、关闭并重开读取。

| 模式 | 原调用 | 原记录 | 原种子模型请求 | EXE/重开新增请求 |
| --- | --- | --- | --- | --- |
| observe | failed | observation recorded | 9 | 0 |
| propose | failed | proposal recorded | 8 | 0 |
| ownership | failed | ownership recorded，原第1版 | 6 | 0 |

每场故障目标的真实写入 1 次；治理观察模式后续的提案是正常独立步骤，不把整条种子流程称为只有一次领域写。原 dispatch 字节前缀、治理账本/锚、知识 journal、canonical/native 保持；新增事务恰为 1 条明确处置，无其它 mutation。重开后的原命令与 basis 一致，草稿保持，页面/通信/服务错误为 0，自有应用/服务/临时目录清理完成。生成 9 张截图，目检 6 张：observe 原记录/处置，propose 原记录/重开，ownership 原记录/重开。确定性本地 HTTP 服务验证真实 Pi 工具链，不代表在线模型自主质量。

证据：test-results/persistent-effect-related.json、persistent-effect-make-final-receipt.json、persistent-effect-{observe,propose,ownership}-{pi-evidence,ui-smoke}.json。原字节归档位于对应 *-ui-original/。截图与临时证据不作为仓库源码提交。

## 产物

- build/20261108-063249/CBIM Assistant-win32-x64/CBIM.exe：213976576 字节；SHA-256 6c77b231128e13735385655295d4b740af8250e62dbf4dfdab83f06be7033794
- build/20261108-063249/CBIM Assistant-win32-x64/resources/app.asar：2993395 字节；SHA-256 5b53dbc201aeb4952e3c0a0706be874908602f80fd555bd83169875d9a1b7ade
- build/20261108-063249/make/zip/win32/x64/CBIM-Assistant-20261108-063249-win32-x64-0.1.0.zip：180238088 字节；SHA-256 e23cea63612140cc7374f6c12619e986d1a509255a1463f98662a36a71608201

## 同步维护与接续

同步新/改文件的中文文件头、原身份和只读端口说明，7 份 CONTRACT（Core tasks/governance/workspace，Main/workspace，Scheduler execution，Frontend tasks）及 8 份目录类图（含 Core 父层）。实际关系由源码生成器核对，不编造类或继承。

下一片 Step40 / R03-D3 将原受控文件阶段及补偿记录接入同一影响观察与明确处置，复用已有严格报告与独立补偿入口；不新增自动回滚。旧 refresh 内部请求绑定及其它异常矩阵仍继续，任意 shell/外部未知不重放；随后推进 R04–R17。第 1–8 组尚未整组完成。
