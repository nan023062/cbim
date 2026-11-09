# 受控文件统一核实验证

2026-11-08，Step40 / R03-D3，承接 a3b9f37。约定范围已完成，独立本地提交，不推送；R03 后续通道与第1–8组其它包仍待推进，第9组仅计划。

## 实现与边界

- 原成员 cbim_file_write_controlled 的原准备、执行、完成、未发写和未知阶段，连同独立补偿序列，进入统一影响观察与明确处置。原工具结果、原操作与补偿分别保留，不把 applied 或补偿视作业务验收。
- Scheduler 按原 canonical、授权及完整成员绑定校验；额外核原 scope、稳定 operationId、路径、before 和 intendedAfter 摘要。两次查询阶段或补偿变化使依据过期；查询时钟不进入 basis。错误身份、原输入、私有扩展或端口错误只给不可核实，缺记录不证明没写入。
- Main 复用原 ControlledFiles.report，仅读原 Store/canonical；不创建子进程、租约，不读取或写入业务文件及备份。补偿仍由独立预览/提交入口核实当前对象与字节，观察不授予补偿资格。旧报告不默认增加字段或改变 basis。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| 新服务边界 | 13/13；五种阶段、身份/输入/授权、坏端口、缺失、停止、读取变化、旧依据及旧报告 |
| 真实 Electron utility/Pi | 6/6；正常、真实部分写、坏 wire、停止前未写、部分写与坏 wire 后换调用 ID 对抗；核实/处置/重开无新增写入 |
| 最终相关回归 | 15文件172/172，0失败/跳过；含13项依赖/分层，与服务13项重叠，不累加 |
| 类型 | pnpm typecheck 和独立桌面脚本 tsc 均通过；选择器修正后脚本类型再次通过 |
| 架构与依赖 | 51目录495源码/样式，0文档差异；928维护文件4914含类型依赖，0循环、3处已审核外部动态加载 |
| 最终构建 | 20261108-064352，501项源码/配置前后同指纹 2eec22afbe4916121c059e049af968a4661ab10b7814e1cf61c35d0fb5eaaf8f |

本片没有重跑全仓；Step37 的1915/1915是前序证据。最终 EXE 首场因测试选择器未限定成员轮次而严格匹配失败，原错误与截图保留为 controlled-effect-complete-selector-failure.*；只修脚本，未改产品或放宽门禁，再用相同 EXE 完成两场。源码指纹仍与构建一致。

## Windows EXE 真实点击

| 场景 | 原事实 | 实际 apply 进程 | 主/成员/辅助会话请求 |
| --- | --- | --- | --- |
| 正常 | 原工具成功、原 applied；独立补偿 applied，原记录不改 | 原写1次、补偿1次 | 6/11/1 |
| 真实只读映射部分写 | 原工具失败、原 unknown；确实改写前缀而截短失败，无补偿入口 | 原写1次 | 6/5/1 |

两场均真实选择原调用、核实、保存并查询明确处置、关闭和重开读取历史。正常补偿已真实保存后由测试丢一次 IPC 回复，只查询原命令，未二次补偿。核实及处置不新增文件进程；重开零模型请求、零文件重放。原任务、周期、审阅、canonical/native 和两个会话草稿保持；处置只追加自身记录，重开后 journal 和业务字节一致。页面/通信/本地服务错误为0，自有进程与成功临时目录清理，首场失败目录保留。

18张截图生成，目检6张统一面板关键图：两场原记录、处置与重开。使用本地确定性 HTTP 模型响应验证真实 Pi/EXE，不代表在线模型自主质量。证据位于 test-results/controlled-effect-{related,pi,make-final-receipt}.json、controlled-effect-{complete,partial}-ui-smoke.json、相应 *-ui-{original,final}-bytes/ 及 controlled-file-*-effect-pi-evidence.json；均为本机验证资产，不提交临时产物。

## 最终产物

- build/20261108-064352/CBIM Assistant-win32-x64/CBIM.exe：213976576字节；SHA-256 b1ceccf526bbd3078e9b7f3362072d8b426400904efb5b4a99495a791465e030
- build/20261108-064352/CBIM Assistant-win32-x64/resources/app.asar：2999131字节；SHA-256 9f48795e84c247fa571653a5da024ff6b1bf6a13bf9e0484f45d59f79f09c43f
- build/20261108-064352/make/zip/win32/x64/CBIM-Assistant-20261108-064352-win32-x64-0.1.0.zip：180244591字节；SHA-256 32d6ca46c3cfd6a1deca33fe43979d153c97e8d24a55dda67e3f2516467cfa58

## 同步与接续

同步相关中文文件头、原身份/只读端口/停止语义说明及4份 CONTRACT、4份 ARCHITECTURE（Core tasks、Scheduler execution、Main、Frontend tasks）。纯 ledger 契约保持单向依赖，新执行层适配不泄露 Node 实现到前端。

下一片核实 cbim_knowledge_refresh 的内部请求绑定并完成 R03 剩余支持矩阵；旧调用缺少可靠事务身份时保留未知，不猜测原请求。随后继续 R04–R17，明确区分本机可验证通道、外部服务与真人接管条件。
