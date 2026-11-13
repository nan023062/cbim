# P1 架构整改与复扫记录

> 导航维护说明（2026-11-14）：正文保留当时的路径、结论与验证边界；可点击源码链接已更新到当前归属，仅供导航，不作为历史版本证据。未留存的阶段入口另行注明，不伪造源码或制品归档。

日期：2026-11-11。依据：[架构设计规范](../project-architecture-standard.md)、[治理流程](../architecture-governance-process.md)、[原扫描报告](architecture-audit-20261111.md)。

## 1. 结论、基线与范围（S1–S3）

原报告四项 P1（A03–A06）按各自“最小整改”及验收范围完成，累计 **58 个测试文件、431 项不同用例通过**，类型与全工程架构复扫通过。A05 完成请求预算领域试点，A06 完成统一工具注册及验证能力迁移；不表示共享状态和整个 Runtime 已完成全面拆分。A07–A09 三项 P2 仍存在。

- `source`：用户直接要求“继续处理P1问题，改完再扫描验证一遍”。实施前核实 `nan023062/cbim` 的开放 Issues 为空，无关联 Issue，未创建或回填工单。
- `baseline`：HEAD 为 `a5938170cf9675b69960dde6a9bb535eb845bdd8`；开始时两份规范、Skill、原扫描及 P0 整改均未提交。本轮以包含这些成果的实际工作区为基线，保留原改动。[P0 报告](architecture-p0-20261111.md)和原扫描不改写。
- `change_reason.kind`：A03 为指引缺陷修复及说明维护；A04–A06 为边界治理、契约演进。工作性质 C3，附 C1 受影响验证与 C2 全工程静态复扫。
- `layers/scope`：Core 的知识、请求预算和运行能力，Scheduler 的查询／执行／指引，Main 的预算存储适配与装配，以及直接消费者和测试夹具；未修改前端、IPC、文件存储格式或产品发布配置。
- `cognition_level`：A03/A04 为 L2；A05/A06 涉及稳定公共运行入口和事务依赖，按 L3 交付取舍、迁移、失败验证及回退说明。尚未获得维护者人工 review 结论。
- `stable_boundary`：原 read/ask/execute、知识保护、可信调用 ID、先授权落盘再执行、原版本与幂等、同一串行事务、未知结果不重放、停止及实际资源排空。

## 2. 整改项、优先级及验收（S4–S6）

### A03 / P1：统一主 Agent 实际职责

修正 [main-agent.ts](../../src/logic/conversation/runtime/main-agent.ts) 的 Team 指引，与 Auto 及已实现行为一致：未配置自定义负责岗位时，主 Agent 在当前主会话直接实现和验证；显式岗位按原计划和可信绑定派发。保留“主角色不得派成独立成员”的限制。同步 [团队契约](../../src/logic/team/rules/CONTRACT.md)、[会话契约](../../src/logic/conversation/runtime/CONTRACT.md)、README 和执行身份注释。

验收：真实 Pi 加本地确定性模型服务的 8 种场景覆盖 Team/Auto、read/ask/execute、存在业务模块等组合；检查实际发送的提示不再包含相互冲突的禁止语句，同时保留审批、工作区知识保护与不生成伪成员任务的断言。默认执行角色退役、正式目标及统一工具策略用例通过。现行源码、运行资料和 README 未再检出旧禁止语句。

### A04 / P1：分离知识读取与事务刷新

- [KnowledgeQueries](../../src/logic/knowledge/rules/knowledge-queries.ts) 只接收 `KnowledgeSnapshotReader.snapshot`，保留四个查询方法；知识工具和 Workflow 上下文显式转发读取能力。
- [KnowledgeRefresh](../../src/logic/knowledge/rules/knowledge-refresh.ts) 独立接收 `assert / snapshot / committedReceipt / commit`。`KnowledgeCommit` 放入纯数据契约，旧 ports 只重导出同一类型。
- [知识工具](../../src/logic/tools/runtime/knowledge-tools.ts) 保留原刷新 v2 Schema、写权限与调用包装；逻辑规则不再允许查询导入完整工作区写端口或刷新服务。

验收：仅提供快照的替身即可调用真实团队／模块查询，无 Application、任务表或物理路径。刷新覆盖结构无效不提交、旧版本拒绝、原成功回执优先、重复不再提交但返回当前校验；完整工作区测试继续核实原 journal 字节、取消、同键异参以及可信契约版本。查询、输出协议、刷新及 Workflow 消费者均通过。

### A05 / P1：请求预算只依赖所属领域端口

[model-request-budget-storage.ts](../../src/logic/budget/rules/model-request-budget-storage.ts) 定义窄读视图、追加命令及准入端口：周期身份、冻结预算策略、主运行 ID、请求预算记录。它不导入 `DispatchState` 或 `DispatchScope`，不声明岗位、任务图、邮箱等无关字段。

[ModelRequestBudgetService](../../src/logic/budget/runtime/model-request-budget-service.ts) 已迁移；[request-budget-store.ts](../../src/logic/dispatch/storage/request-budget-store.ts) 在唯一 `DispatchStore.transact` 的原回调内投影并复制视图，只返回预算变化和回执，拒绝夹带其他 mutation 键。Main 负责装配。`ScopeBudgetService.preflightRequest` 同样只读预算视图；跨域准入仍使用原协调者与事务。

验收：服务可用最小领域状态替身独立预留、发送及结算；适配验证读取发生在原事务内、嵌套数据隔离、原命令及回执透传、无法提交 scopes 等其他领域变化。真实 FileDispatchStore 覆盖并发竞争、原命令重放、异参拒绝、可靠保存失败、重开未知账本、旧运行失效与停止。真实请求传输、预算启动及周期预检消费者通过。

取舍：没有拆存储文件或另建锁，也没有把一次原子事务拆成多次写入。按相同 AST 口径，直接命名导入 DispatchStore/DispatchState 的源码文件仍为 67 个：预算服务移除一处，Main 新适配增加一处。治理收益是业务服务及其替身的能力收窄，不能用此试点宣称全仓共享状态已经解耦。

### A06 / P1：通用运行上下文不再枚举业务工具

- [EngineContext](../../src/logic/execution/rules/types.ts) 的九类专用工具字段替换为统一 `capabilities`；[engine-tools.ts](../../src/logic/execution/rules/engine-tools.ts) 只消费统一目录／调用端口，没有具体业务或 EngineContext 导入。
- [member-tool-capabilities.ts](../../src/logic/execution/rules/capabilities/member-tool-capabilities.ts) 显式装配原九类能力，保留调用 ID、取消信号及业务指引。Pi/Claude/Codex 按可信 `disableNativeTools` 策略关闭原生工具，不判断特定业务字段。知识工具继续由各引擎的可信选项注入。
- [run-validation.ts](../../src/logic/execution/rules/capabilities/run-validation.ts) 持有启动前准备及工厂：数量上限、正式身份、JSON/CSV/PNG 实际支持。Runtime 保留原调用位置，只注入进度、代次、授权／在途检查、清单复核与可靠保存；不再判断具体验证器名称或容量常量。
- 迁移 22 个既有测试／夹具中的旧上下文访问。六处坏回包注入移到能力实现、工具输出校验之前，保留真实保存、原失败、门闩及有效证明断言，不重新暴露业务实例给引擎。

验收：新增任意具名能力无需改通用上下文／注册器；非法或重复工具名、未注册调用均拒绝，目录不受外部修改污染。工具原身份和取消信号保持，Claude/Codex 的能力策略实际限制目录和执行；真实 Pi 范围执行通过。三个真实引擎桥使用本地确定性模型服务验证授权、拒绝、回执、预算及原生执行。产物、完整清单、JSON/CSV/PNG、受控写、删除／移动、检查点、求助及其审阅消费者均通过，覆盖保存后坏回包、在途并发、取消、未知副作用和 drain。

取舍：沿已有 EngineToolsPort 做显式装配，没有新增插件发现框架。Runtime 仍负责跨能力证据与生命周期协调，其他业务能力的准备尚未全部外移；本轮完成原报告指定的同类扩展入口及一个真实验证能力切片。

## 3. 实际验证与失败处理

选择依据：A03 检查实际发送提示及权限；A04 检查读取、刷新事务与工具输出；A05 检查最小替身及真实存储／传输；A06 沿所有迁移的测试夹具追踪直接消费者，验证业务证据和三个引擎适配。未因修改公共模块自动运行全仓测试。

| 执行批次 | 实际结果 |
| --- | --- |
| 新端口与依赖检查：4 文件、27 用例 | 首轮 26 通过、1 失败；新查询用例漏 await 预期值，修正后在下一批通过 |
| 实际影响清单：55 文件、408 用例 | 首轮 407 通过、1 失败；完整出口坏回包测试仍访问旧对象内部端口，迁到验证实现后补跑 |
| Claude/Codex 能力策略：1 文件、2 用例 | 全通过，验证原生工具目录和实际调用不能绕过关闭策略 |
| 完整出口定向补跑：1 文件、9 用例 | 全通过；保留原坏回包断言，没有修改产品逻辑来放宽验证 |
| 合并不同文件／用例的最后结果 | **58 文件、431 用例通过，无剩余失败或跳过**；重复运行不重复计数 |
| `pnpm typecheck` | 最终通过；早期暴露的适配参数、测试 this 类型及工具 Schema 替身签名已修正 |
| `pnpm check:architecture` | 最终通过，已包含依赖检查 |
| `git -c core.safecrlf=false diff --check` | 通过 |

实际命令（均有显式文件选择，完整 55 文件清单附后）：

```powershell
pnpm exec vitest run tests/knowledge-query-ports.test.ts tests/request-budget-ports.test.ts tests/engine-capabilities.test.ts tests/dependencies.test.ts --reporter=json --outputFile=test-results/architecture-p1-20261111/ports-tests.json
$selected = Get-Content -Raw test-results/architecture-p1-20261111/selected-tests.json | ConvertFrom-Json
pnpm exec vitest run @selected --reporter=json --outputFile=test-results/architecture-p1-20261111/affected-tests.json
pnpm exec vitest run tests/engine-capability-policy.test.ts --reporter=json --outputFile=test-results/architecture-p1-20261111/capability-policy-tests.json
pnpm exec vitest run tests/complete-output-runtime.test.ts --reporter=json --outputFile=test-results/architecture-p1-20261111/complete-output-retest.json
pnpm typecheck
node scripts/source-architecture.mjs
pnpm check:architecture
git -c core.safecrlf=false diff --check
```

未运行全仓回归、打包、真实桌面、安装升级或在线模型验收。三个引擎桥使用实际本机引擎和本地测试服务，不冒充真实模型质量或生产服务验证。历史 Python／JSON 及构建资产未变化，未重复它们的专项检查。

## 4. 全工程复扫

| 指标 | P1 前（P0 完成态） | P1 后 |
| --- | --- | --- |
| 维护代码文件／含类型依赖 | 1,192 / 6,186 | 1,201 / 6,249 |
| 文件循环／物理越层／逻辑违规 | 均为 0 | 均为 0 |
| 未解析引用／未批准动态加载 | 均为 0 | 均为 0 |
| 已审核外部动态加载 | 7 | 7 |
| 已声明逻辑边界／覆盖文件 | 6 / 12 | 10 / 16 |
| 源码与样式／目录 | 601 / 55 | 605 / 55 |
| 源代码 AST 解析错误／缺少定位或原因文件头 | 0 / 0（556 文件） | 0 / 0（560 文件） |
| 架构资料漂移 | 0 | 0 |
| EngineContext 业务工具专用字段 | 9 | 0 |
| KnowledgeQueries 写入方法 | refresh | 无，仅四项只读查询 |

补充清单扫描覆盖当时 1,648 个维护文件；归档本报告增加的是文档，不改变代码扫描口径。静态通过不等于全工程语义完整验证。P0 的公开入口、纯数据辅助与无环约束继续通过；新负例检查阻止只读查询重新获得写依赖、预算重新依赖宽 Store／具体准入服务、通用工具注册重新认识业务装配。

复扫保留的发现：A07 的 IPC 泛型缺口和 153 个 action 分支仍在；A08 的共享展示仍引用 `useExecutionRecovery` 内部契约；A09 的文件历史存储仍包含工作区服务装配。G06 的公共出口与具体引擎适配边界继续作为待核查点，不重复判定为没有 AgentEngine 隔离。本轮没有自行实施 P2。

## 5. 认知交付、迁移与回退（S7）

同步维护 22 个涉及源码文件的定位／设计／接口说明（含 4 个新源文件），更新受影响契约及 **17 份 ARCHITECTURE.md**：backend、core、brain 及 Pi/Claude/Codex、knowledge、tasks、team、main、persistence 及 tasks、scheduler-engine 及 context/conversation/execution/tools。代码目录的覆盖、成员和真实依赖已由生成器核对；没有只更新目录图而保留旧字段说明。

- **Q1：保护什么？** 知识事务、权限证据、预算原子性及运行停止／排空机制。未改变存储格式、工具公开 Schema 或请求版本。
- **Q2：变化限制在哪里？** 知识刷新留在写服务，预算业务只接触专用状态和命令；具体工具、指引与调用参数差异留在装配；验证器准备留在验证能力。公共层不新增同形业务字段。
- **Q3：为何这样验证？** 以实际接口迁移、消费者和副作用为依据。保留完整集成场景，并补最小端口与边界负例；坏回包、并发、停止和恢复用例核实行为，不只检查依赖图。
- **Q4：下一次改哪里？** 查知识先读 KnowledgeQueries，改刷新读 KnowledgeRefresh；预算规则读 ModelRequestBudgetService 与专用端口，原子落盘读 Main 适配／FileDispatchStore；增加工具读 member-tool-capabilities，扩展验证读 prepareRunValidation／RunValidation 及平台接口。权限和排空仍从 Runtime 原入口 review。
- **Q5：规则候选？** 无新增通用原则。新逻辑边界落实既有单向依赖和最小契约要求，不把启发式发现自动晋升为新门禁。

迁移状态：KnowledgeQueries.refresh 和旧九字段均已迁移真实调用方、测试入口及现行文档，无保留兼容转发；KnowledgeCommit 的旧导出仅保留类型重导出。它们是仓库内契约，不是磁盘或外部工具协议迁移。若后续发现行为差异，按 A03/A04/A05/A06 独立切片恢复本轮前代码与对应测试／资料；不回滚用户数据、不重放事务，也不连带撤销 P0 或原规范改动。

本地原始证据位于忽略目录 `test-results/architecture-p1-20261111/`：工作区基线 ZIP／哈希、测试 JSON、类型与架构输出、AST 复扫、去重结果和 P1 专用 review patch。归档中的关键事实与完整用例清单不依赖这些临时文件作为唯一说明。`git diff a5938170 -- src scripts tests` 是包含 P0 的累计已跟踪改动；本轮新增源文件和测试未暂存，review 时须一并读取，不能只看普通 git diff。

交付状态：本地实现与验证完成；人工接受、Git 提交、推送、合并和发布均未进行。P2 及剩余治理点按后续明确授权推进。

## 附：55 个受影响测试文件

以下路径均位于 `tests/`；另执行的依赖、预算窄端口、能力策略文件见前述命令。

```text
abandoned-checkpoint-dependency-service.test.ts
artifact-report-service.test.ts
artifact-runtime.test.ts
artifact-transition-runtime.test.ts
checkpoint-handoff-service.test.ts
claude-engine.test.ts
claude-tools.test.ts
codex-engine.test.ts
codex-tools.test.ts
complete-output-human.test.ts
complete-output-runtime.test.ts
controlled-file-runtime.test.ts
controlled-file-service.test.ts
core-domains-integration.test.ts
core-domains.test.ts
csv-validation-runtime.test.ts
default-executor.test.ts
direct-main-execution-pi.test.ts
effect-observation-service.test.ts
engine-capabilities.test.ts
human-continuation-service.test.ts
human-decision-service.test.ts
human-reconsideration-service.test.ts
json-validation-human-decisions.test.ts
json-validation-runtime.test.ts
knowledge-query-ports.test.ts
knowledge-refresh.test.ts
knowledge-tool-contracts.test.ts
knowledge-tool-output.test.ts
loop-engine.test.ts
member-checkpoint-chain-service.test.ts
member-checkpoint-runtime.test.ts
member-checkpoint-service.test.ts
member-execution.test.ts
member-help-runtime.test.ts
member-help.test.ts
model-request-budget-bootstrap.test.ts
model-request-budget-pi.test.ts
model-request-budget.test.ts
module-ownership-evidence.test.ts
output-manifest-evidence.test.ts
output-manifest-runtime.test.ts
png-validation-runtime.test.ts
question-evidence.test.ts
queued-dependency-replacement-service.test.ts
scope-budget-service.test.ts
scope-goal.test.ts
scope-replan.test.ts
scoped-execution-pi.test.ts
scoped-execution-runtime.test.ts
task-progress-pi.test.ts
team-workflow.test.ts
unified-tool-policy.test.ts
workflow-runtime.test.ts
workflow-selection-evidence.test.ts
```
