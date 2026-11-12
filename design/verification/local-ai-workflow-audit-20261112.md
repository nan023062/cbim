# 本地 AI 团队开发闭环：现状审计与清理

日期：2026-11-12。代码基线：`2187842f`（0.1.14 开发树）。用户直接授权分析现状、删除失效资产和对齐文档；本轮不实现新调度功能。查询时仓库无开放 Issue，本文是带日期的审计证据，不另建实时开发清单。

## 结论与范围

后续实施：本文保留审计时点的缺口事实；通用代码验证已完成并有[全量回归记录](full-code-check-20261112.md)，其后的有界自动返工和可靠成果重启接收见[专项实施验证记录](automatic-rework-recovery-20261112.md)。当前行为以源码契约为准，不将下表当作实时待办。

**现有架构可以继续演进，主要缺口在自动验证、失败返工和恢复的闭环，而不是缺少团队、任务或引擎抽象。** 当前应优先打通一个本地工作区的真实开发交付，不建设 Cindy 承载、联网协作或大型组织平台。

本轮复用已有源码依赖检测器，扫描清理前的 634 个 src 脚本；维护范围的依赖图为 1340 个文件、6799 条边。结合入口配置、脚本入口、静态导入、类型依赖和测试引用做文件可达性检查，再阅读目标、调度、成员、证据和知识链路。未逐行审计所有函数，也未证明所有导出符号都被使用；没有运行真实模型的端到端无人值守验收。

## 现有模块与状态所有权

| 模块 | 当前职责与源码入口 | 保留的边界 |
| --- | --- | --- |
| 知识与工作区 | [core/workspace](../../src/backend/core/workspace/ARCHITECTURE.md)、[main/knowledge](../../src/backend/main/knowledge/ARCHITECTURE.md) | 模块、来源、Skill/Workflow 与知识事务；作者来源不是执行许可 |
| 目标与任务 | [scope-goal-service](../../src/backend/scheduler-engine/goals/scope-goal-service.ts)、[任务契约](../../src/backend/core/tasks/CONTRACT.md) | 目标计划、任务分配、版本化 review 与交付核验；执行完成不等于验收完成 |
| 调度与成员 | [auto-collaboration](../../src/backend/scheduler-engine/dispatch/auto-collaboration.ts)、[member-execution](../../src/backend/scheduler-engine/members/member-execution.ts) | 领取、占用、结果回流、主运行接续与成员求助 |
| 执行与引擎 | [执行内核](../../src/backend/core/execution/ARCHITECTURE.md)、[引擎适配](../../src/backend/engines/ARCHITECTURE.md) | 运行事件、权限、取消与协议转换；不由引擎裁决业务完成 |
| 证据与恢复 | [core/evidence](../../src/backend/core/evidence/ARCHITECTURE.md)、[scope-recovery-service](../../src/backend/scheduler-engine/goals/scope-recovery-service.ts) | 核实真实日志、知识版本和副作用；未知结果不重放 |
| 界面与装配 | [frontend](../../src/frontend/ARCHITECTURE.md)、[main/assembly](../../src/backend/main/assembly/ARCHITECTURE.md) | 提供操作入口、装配存储与平台服务，不成为第二套领域状态机 |

真实协作链是：主运行建立目标/计划 → 派发服务持久任务 → 成员执行并形成结果 → 自动协作将真实结果交回主运行 → 主运行审阅 → 目标服务核验后关闭。已经存在自动回流、重规划和替代失败任务的机制，不能把系统描述为只有聊天或全部依赖人工派发。

## 缺口与改进顺序

以下优先顺序是本次评估建议；实施范围与状态仍应进入 Issues。

| 优先级 | 现有基础与具体缺口 | 建议的最小演进与验收 |
| --- | --- | --- |
| P0：代码验证证据 | [workflow-contract](../../src/backend/core/workspace/workflow-contract.ts) 的 `requiredValidations` 只有 JSON、CSV、PNG；原生命令和工具证据已存在，但工具调用成功不等于构建/测试及业务断言通过 | 增加代码开发使用的验证契约与真实执行结果适配，绑定命令、工作目录、源码/产物版本、退出状态和检查范围；用真实失败测试证明不能误判通过。保留现有确定性证据接口，不另建平行日志 |
| P0：最终验收失败后的有界自动返工 | [auto-collaboration.finishCycle](../../src/backend/scheduler-engine/dispatch/auto-collaboration.ts) 捕获 `GOAL_*` 后记录阻塞并暂停；[goal review](../../src/backend/core/tasks/scope-goal.ts) 已有 `replan`，但最终关闭失败没有自动修复接续。`superseded` 对失败/过期/人工拒绝有严格身份核验 | 将可修复失败分类并交回主调度，在现有周期预算与运行上限内生成新候选、再验收；保留旧候选及证据。未知副作用、权限问题与耗尽预算仍停止，不能把所有失败盲目重试 |
| P1：无人值守恢复 | [scope-recovery-service](../../src/backend/scheduler-engine/goals/scope-recovery-service.ts) 提供只读核实；[member-resume-service](../../src/backend/scheduler-engine/members/member-resume-service.ts) 与等待目标接续核验当前身份、检查点和版本。安全停放、人工补充和显式恢复已存在 | 区分可证明安全的自动接续与必须介入的未知结果；先做单进程重启后的一个受控任务恢复用例，不把“自动恢复”实现成重放旧命令 |
| P1：从开发结果到整合交付的产品约定 | 已有产物清单、受控文件变更、工作范围与结果核验；本轮源码搜索未找到产品自有的 Git worktree/合并/提交闭环。模型仍可经命令做 Git 操作，不能据此声称产品提供了独立集成保证 | 先明确本地交付是工作区变更还是指定提交，再为并行写入、集成冲突及最终版本建立可核实流程。不要为单人场景先建设远程 PR 平台 |
| P1：经验沉淀的验收 | 知识预览/提交与 [knowledge-effect-reader](../../src/backend/main/evidence/knowledge-effect-reader.ts) 能记录和核实变更；后者是事务事实读取，不是经验质量评价。尚缺本轮核实过的“交付 → 提炼 → 后续任务复用”端到端证据 | 先用一个真实缺陷任务沉淀一条方法，在第二个任务验证召回和用途；避免每次任务全自动生成大量没人消费的文档 |

这些缺口不能通过删除权限、版本和完成核验来解决。本轮没有改动上述运行行为。

## 边界与依赖密度

清理前依赖检查无循环或规则违规，但这不代表职责已经足够集中。按 src 文件对唯一目标文件的导入计数，`loop-engine.ts` 为 53、`dispatch-service.ts` 为 44、`application.ts` 为 42、执行 `runtime.ts` 与 `member-execution.ts` 各为 41、`scope-goal-service.ts` 为 36。数量包含类型导入，不是复杂度评分。

- **装配与业务裁决分开看。** `loop-engine`、`application` 集中接线具有合理性，不因导入多就拆。保持领域层不反向依赖具体平台实现。
- **调度和目标验收是后续变化热点。** 目标验收同时关联日志、版本、产物、人工决定与替代任务。新增验证类型时优先扩展证据契约与验证适配，避免让每个状态服务都重新认识具体测试工具。
- **产品规范与概念方案边界曾混杂。** 旧 Python Skill、副本规范与现行运行正文并存，增加误读风险。本轮删除退出路线的副本；真实运行资产仍由 `builtins.ts` 白名单控制。

四问：保护现有单向依赖、事务与真实证据；把本轮变化限制在失效资产退出和说明修正；以入口引用、相关回归及架构检查检验；下一轮从验证契约与最终验收失败分支切入。第五问候选：不新增强制流程。治理按 C3／L3 分析全局关系，但实施仅做可核实清理，不做猜测性抽象重构。

## 本轮删除与保留

共删除 49 个工作区文件（其中 Cindy 草案原为未跟踪文件）：

| 删除对象 | 数量 | 依据 |
| --- | --- | --- |
| `GraphViewControls.tsx` 及专属 CSS、`tasks/FlowView.tsx` | 3 | 源码入口、导入及测试均无消费者；前者契约仍误称被业务/团队图复用，后者是旧占位界面 |
| `core/workspace/maintenance.ts` | 1 | 只有旧数据回归测试引用类型；删除生产类型，测试保留原始历史输入与全部断言 |
| `design/scripts/`、`design/skills/` | 41 | 旧 Python 工具、预览 HTML、旧方法副本和配套测试组成自包含历史工具链；无当前产品、包命令或 CI 调用。不是“不能手工运行”，而是本轮明确退出重复的旧维护入口 |
| `design/preview_modules.cmd` | 1 | 仅启动上述旧预览器，一并退出 |
| `design/capability/people.schema.json` | 1 | 旧真人花名册协议，无当前加载与引用；当前 authors 不再关联花名册 |
| `design/connector/base-connector.md` | 1 | 无引用的旧声明摘要，只描述 Cindy 插件，已被现行联合协议规范覆盖 |
| `design/cindy-host-boundary.md` | 1 | 已停止路线的分析草案，不再作为当前设计资产维护 |

旧工具与文档的已跟踪原文可用 `git show 2187842f:<路径>` 查阅。清理前打包脚本会复制整个 design/docs，因此旧资产虽非执行入口仍会随包附带；删除也减少后续包内无效资料。本轮未声称已重新打包或验证升级。

保留并区分：

- `design/runtime/`、实际使用的 Schema、工作区 Skill/Workflow：由运行白名单或知识服务消费，不因 Markdown 入链少就删除。
- 三种执行引擎、现有资源仓库、反馈、更新与发布设施：都有真实消费者，属于可选扩展或已有交付能力，不是死代码。Cindy 插件声明分支为已有数据兼容保留，不代表建设接入。
- 发布、恢复、缺陷调查等历史证据与有解释价值的方案：保留日期和当时事实；纠正导航误称“当前版本”或“尚未实施”的文字，不抹掉历史。
- `module.legacy.schema.json`、仍被规范引用的索引 Schema：不以“旧”直接认定无用，本轮未改变其兼容契约。

## 文档对齐与成本控制

README、四份概念文档和设计导航对齐本地小团队自动开发范围；04 清除旧试点待办、真人花名册流程、Python 目录和“只有方案未有执行器”的现状描述，改为目标流程与实现边界。02 修正作者来源和岗位派发现状；03 明确普通授权内工作无需逐步人工审批。连接器和模块规范纠正只描述 Cindy 插件的过期文字，保留当前协议。

受影响的 workspace、components、tasks 三份源码类图重新生成；组件契约删除失效说明，回归夹具注释说明为何仍保留旧输入。当前业务事实继续由源码契约维护，不复制到另一套待办。

后续 review 优先复用确定性依赖检查、现有源码架构和实际 diff，只在受影响调用链使用模型分析。此次扫描原始结果与删除清单放在忽略的 `test-results/local-workflow-audit-20261112/`，不将临时扫描器包装成新的永久平台。

## 验证

选择 `dispatch-context` 覆盖旧数据兼容，`builtins` 覆盖运行白名单资源仍可读；类型检查覆盖删除类型与组件后的引用；架构检查覆盖清理后的目录、类图和依赖。

| 实际命令或检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/dispatch-context.test.ts tests/builtins.test.ts` | 2 个文件、5 个用例全部通过；旧维护声明仍不阻塞当前派发，24 项内置资料均可读取 |
| `pnpm typecheck` | 通过 |
| `pnpm check:architecture` | 87 个目录、677 个代码/样式文件的架构说明一致；1336 个维护文件、6793 条依赖，0 循环、0 违规 |
| `node test-results/local-workflow-audit-20261112/scan.mjs` | 清理后 631 个 src 脚本，在本轮入口/工具根集合下无剩余不可达文件；不等于没有未使用导出或运行语义缺陷 |
| `node test-results/local-workflow-audit-20261112/check-links.mjs` | 扫描 413 份 Markdown，变更文档及指向被删文件的本地文件链接无断链；不包含外部 URL、标题锚点和自然语言路径 |
| `git diff --check` | 通过 |

未运行全量测试、构建安装、公开升级或真实模型闭环验收。单元与静态检查通过只证明本轮清理的验证范围通过，不表示上述能力缺口已经补齐。
