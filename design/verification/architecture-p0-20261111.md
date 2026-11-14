# P0 架构整改与复扫记录

> 导航维护说明（2026-11-14）：正文保留当时的路径、结论与验证边界；可点击源码链接已更新到当前归属，仅供导航，不作为历史版本证据。未留存的阶段入口另行注明，不伪造源码或制品归档。

日期：2026-11-11。仓库：`nan023062/cbim`。产品基线：`a5938170cf9675b69960dde6a9bb535eb845bdd8`。

## 范围与结论

用户授权按[扫描报告](architecture-audit-20261111.md)先处理 P0，再扫描验证。本轮完成 A01／G01 的最小逻辑边界试点和 A02／G02 的测试依赖隔离，并通过相应验收；没有把其余七项 P1／P2 计作完成。

实施前核实 GitHub 开放 Issues，查询结果为空；本轮按用户直接授权执行，没有创建、更新或关闭工单。上一轮规范、Skill 和审计文档的未提交修改全部保留。本轮尚未提交、推送、合并或发布，人工 review 尚未发生。

原因分类为边界治理。按 S1–S7 完成基线、证据、切片实施、验证、源码资料和本记录；没有改变知识写入、事务、授权、运行或恢复语义。A01 按跨模块边界提供 L3 阅读与迁移说明，A02 按 L2 交付消费者迁移证据。

## A01：逻辑方向与公共入口

[architecture-boundaries.mjs](../../scripts/architecture-boundaries.mjs) 新增六个明确的逻辑边界，由现有[依赖检查器](../../scripts/check-dependencies.mjs)一并执行。

| 边界 | 实际归属 | 允许依赖 |
| --- | --- | --- |
| pure-foundation | errors、json、serialization | 内部及明确的 `jsonc-parser`／`node:crypto` |
| knowledge-data | knowledge/types | 无外部实现依赖 |
| project-definition | workspace/project-root | 无外部实现依赖 |
| knowledge-read-models | read-models 公开入口；snapshot、Team、BusinessWorkspace 私有实现 | 纯基础、知识数据、项目根定义及 `node:path` |
| knowledge-query-orchestration | knowledge-queries | 读取模块、数据、纯基础，以及现行 ports／knowledge-write-input 两个明确入口 |
| test-data | tests/data 下的数据辅助 | 纯基础、知识数据及 `node:crypto` |

逻辑方向、公开入口和外部依赖均为可检查约束；包含类型导入、重导出、别名、字面量动态导入及相对路径直达 `node_modules`。保留原物理层矩阵、文件级强连通检测、未解析引用拒绝及七项已核实的外部动态加载说明，没有增加目录级豁免。

新增 [read-models.ts](../../src/logic/knowledge/rules/read-models/index.ts) 作为固定快照读取入口。查询编排、成员上下文、执行管理、模块负责人服务和相关测试已迁移；三份实现不再接受外部直接导入。逻辑归属跨越原有 knowledge／team／workspace 目录，不为满足图形而搬动文件。

**验收事实：** 有真实生产消费者通过公开入口访问；反向依赖、私有类型入口、别名重导出、私有动态导入和外部 SDK 均有拒绝用例。直接及间接引入文件操作的绕行也被覆盖。复扫中六个边界覆盖 12 个文件，违规 0；私有读取实现的外部直接消费者为 0。

**范围限制：** 这是报告要求的首个逻辑边界试点，不表示全部 core、main 和 frontend 内部都完成逻辑治理。其他源码仍受原物理层和文件无环检查；后续边界要随真实 P1／P2 迁移登记。`KnowledgeQueries.refresh` 继续使用现有工作区端口，A04 所述查询／刷新职责拆分尚未完成。

## A02：测试数据、端口适配与应用夹具分离

- [tests/data/knowledge.ts](../../tests/data/knowledge.ts)：保存原 `request`、`summary`、`moduleFiles`，只依赖知识数据类型与纯基础能力；没有反向导入桥接或完整应用。
- [tests/knowledge-tool-fixture.ts](../../tests/knowledge-tool-fixture.ts)：适配调用方提供的 `KnowledgeWorkspace`，保留原逐次调用身份和权限，不创建应用。接口从具体 Workspace 收窄为知识端口。
- [tests/helpers.ts](../../tests/helpers.ts)：只保留完整 Application 集成夹具，初始化、关闭和临时目录清理保持原样；不再重导出数据辅助或工具适配。
- [tests/data/domain-snapshot.ts](../../tests/data/domain-snapshot.ts)：为读取模型构造固定快照输入，不把它当成知识 Schema／事务已经验证的证据。
- [core-domains.test.ts](../../tests/core-domains.test.ts)：领域读取改用固定快照，验证继承、本模块 Workflow、未知对象／正文及不改写输入；不再依赖 Application。
- [core-domains-integration.test.ts](../../tests/core-domains-integration.test.ts)：保留原真实应用生成快照、关闭工作区后继续读取的场景与断言。

**迁移事实：** 114 个测试或脚本调用点迁移到数据辅助／知识工具适配。相对基线检查 119 个迁移文件，忽略注释、导入和 CRLF／LF 表示后，可执行代码 token 序列相同；三个数据辅助导出定义与完整应用 fixture 定义也与原版一致。核心领域测试的调整单独验证，没有把它列入“仅改导入”的证明。

**验收事实：** 依赖测试沿真实图遍历，确认两个数据辅助文件与 `core-domains.test.ts` 均不可达 Application／Main、Scheduler 或 `tests/helpers.ts`。禁止通过共享纯基础模块间接引入文件操作；完整应用集成场景继续通过。

复扫时完整应用夹具有 152 个直接消费者，数据辅助有 110 个、知识工具适配有 17 个；这些集合可重叠，不能相加当作测试数量。仍然需要应用的消费者保持完整夹具，没有为了减少数字改弱集成验证。

## 实际验证

依据是读取入口、检查器和测试夹具变化：检查器用例证明拒绝行为；领域与上下文测试证明原读取结果；知识刷新、模块负责人和工作区测试核实事务／实例边界；输出协议测试核实实际传输结果。

第一批执行：

```text
pnpm exec vitest run tests/dependencies.test.ts tests/layer-boundaries.test.ts tests/source-architecture.test.ts tests/core-domains.test.ts tests/core-domains-integration.test.ts tests/knowledge-tool-output.test.ts tests/knowledge-refresh.test.ts tests/architecture-service.test.ts tests/dispatch-context.test.ts tests/member-execution-context.test.ts tests/module-ownership-service.test.ts tests/workspace.test.ts --reporter=default --reporter=json --outputFile=test-results/architecture-p0-20261111/tests.json
```

结果：12 个文件、72 项全部通过，0 跳过。随后代码自查发现相对路径进入 `node_modules` 的外部依赖识别缺口，修正后增加一个拒绝用例，只补跑对应检查器：

```text
pnpm exec vitest run tests/dependencies.test.ts --reporter=default --reporter=json --outputFile=test-results/architecture-p0-20261111/dependencies-final.json
```

结果：18 项全部通过。两轮合计 **12 个不同测试文件、73 个不同用例通过**，没有把重复通过累加成 90 项。其他业务测试未受后续检查器修正影响，没有重复运行。

最终执行 `pnpm typecheck`、`pnpm check:architecture`，均通过。架构命令已包含依赖检查，不再另行重复跑依赖命令。

| 复扫指标 | 整改前 | 整改后 |
| --- | --- | --- |
| JS／TS 系列维护代码 | 1,186 | 1,192 |
| 含类型依赖边 | 6,107 | 6,186 |
| 文件循环 | 0 | 0 |
| 现行物理层违规／未解析引用／未获准动态加载 | 均为 0 | 均为 0 |
| 显式逻辑边界 | 尚无本轮规则 | 6 个边界、12 个文件，违规 0 |
| 源码／样式文件、目录 | 600、55 | 601、55 |
| 架构文档漂移 | 0 | 0 |
| 源码文件头缺少定位／原因 | 0 | 0 |

新增公开入口、规则和夹具使文件／边数量增加，治理成效是依赖范围受到约束，不以减少边数衡量。补充全量 AST／文件清单核对时共 1,638 个维护文件、556 个源代码文件；此数量在新增本报告之前产生，后续纯文档归档不改变上述代码扫描结果。

等价检查初版将 Git 中 LF 与工作区模板字符串的 CRLF 识别成差异；核对实际 diff 后统一行尾再比较，119 个文件全部通过。该方法修正没有修改业务正文，也没有删改测试断言。

未运行全仓产品测试、打包、安装升级、真实桌面或在线模型验证。历史 Python／JSON 在前一轮已做语法扫描，本轮没有改动，未重复执行；它们的动态行为仍不在本轮验收范围。

本机原始结果在忽略目录 `test-results/architecture-p0-20261111/`：两份测试 JSON、`migration.json`、`equivalence.json`、`rescan.json`。关键结果已写入本报告，不依赖临时文件作为唯一证据。

## 源码同步与 review 入口

维护 [知识契约](../../src/logic/knowledge/rules/CONTRACT.md)，更新九个涉及源码文件（含新入口）的文件头，并用 `node scripts/source-architecture.mjs` 同步七份架构文档：

- [core](../../src/logic/ARCHITECTURE.md)、[knowledge](../../src/logic/knowledge/rules/ARCHITECTURE.md)、[team](../../src/logic/team/rules/ARCHITECTURE.md)、[workspace](../../src/logic/workspace/rules/ARCHITECTURE.md)。
- [Main workspace](../../src/logic/workspace/service/ARCHITECTURE.md)、[Scheduler context](../../src/logic/execution/context/ARCHITECTURE.md)、[Scheduler execution](../../src/logic/execution/ARCHITECTURE.md)。

建议阅读顺序：逻辑规则 → 依赖检查器及声明 → 读取公共入口／知识契约 → 查询与上下文消费者 → 三类测试辅助 → 单元与原集成场景 → 本报告。新增同类读取实现应先明确归属及公开契约，再由入口导出；新测试数据放入受约束的数据边界，需要真实应用时显式选择完整夹具。

完整已跟踪产品／工具／测试差异可用 `git diff a5938170 -- src scripts tests` 查看。本轮新增、尚未被普通 git diff 展示的六个文件为：`scripts/architecture-boundaries.mjs`、`src/backend/core/knowledge/read-models.ts`、`tests/data/knowledge.ts`、`tests/data/domain-snapshot.ts`、`tests/knowledge-tool-fixture.ts`、`tests/core-domains-integration.test.ts`，均已在本报告链接。

本报告、开发记录的新条目及 design 导航是本轮归档。此前两份规范与多宿主 Skill 修改继续保持未提交状态，不能将它们误记为本轮新改动。

## 复扫后的剩余问题

| 原报告项 | 本轮后的事实 |
| --- | --- |
| A03 主 Agent 指引冲突，P1 | 尚未修改；P0 完成不代表指引已经一致 |
| A04 查询与刷新边界，P1 | 读取公共入口已建立；查询编排仍持有完整写端口，刷新仍在同类中 |
| A05 共享调度状态，P1 | DispatchState／DispatchStore 未收窄 |
| A06 运行核心与业务能力，P1 | EngineContext 工具槽位和运行能力装配未调整 |
| A07 IPC 类型契约，P2 | 操作名与请求／响应映射尚未治理 |
| A08 前端展示与任务控制，P2 | 公共展示仍引用任务控制类型 |
| A09 历史存储与装配，P2 | 工作区历史服务工厂仍在存储文件中 |

G06 的既有引擎契约和剩余核查结论保持。以上是带日期的复扫事实，不替代 Issues 中的实时任务，也不自动启动后续整改或定期扫描。

## 四问与退出条件

- **Q1 保护的稳定能力：** 固定快照领域读取、数据构造、现有事务／权限以及原有文件无环约束；读取实现和应用 fixture 的行为保持。
- **Q2 变化限制的位置：** 新读取实现进入已登记的读取边界，经公开入口提供；纯测试数据不得进入应用／调度装配。其余逻辑模块仍按后续真实迁移治理。
- **Q3 验证为什么足够：** 119 处机械迁移以 token 等价及类型检查核对，真实入口以 73 个不同用例验证，完整静态图和资料另行复扫；不把这些通过当成全量、桌面或发布通过。
- **Q4 下次修改入口：** 边界从 architecture-boundaries 开始；读取从 read-models 与 knowledge CONTRACT 开始；测试先选择 data、知识端口适配或完整应用夹具。
- **Q5 规则候选：** 无新增通用原则；本轮在用户授权内落实既有 P03／P05／P09／P10 的项目约束，没有自动晋升其他启发式指标。

旧私有读取文件保留为实现，外部直达入口已退出；旧 helpers 的混合数据出口已移除，只有完整应用 fixture 保留。回退必须同时恢复对应消费者与规则，不能单独放宽私有入口检查。若后续发现读取、刷新或实例生命周期的行为差异，应保留证据并暂停受影响切片，不通过移除断言处理。
