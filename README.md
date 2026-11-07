# CBIM Assistant

[Loop Engine（Pi）](docs/loop-engine.md)：`src/backend/core/brain/` 通过注入的存储端口管理执行事件、中断与显式恢复，桌面主对话经调度引擎派发正式业务任务。执行结束不等于业务验收通过。开发运行要求 Node.js 22.19+。

界面采用工作区侧栏与主会话区：中间切换对话和任务视图，右侧扩展区承载团队架构、业务架构、浏览器与终端。详见 [工作区界面](docs/workspace-ui.md)。

**CBIM 是面向 AI 原生团队的生产与治理体系。** 它推动团队重新划分职责，让任何职业的人都能借助 AI 直接参与实现，同时保证项目和生产流程长期可持续。CBIM Assistant 是承载这一体系的桌面产品入口。

团队按能力与承担的责任组织工作：少量核心治理者负责核心框架、专业规则、工作流程和治理机制；创作与执行者借助 AI，将目标、创造力和专业判断转化为可验证的成果。两类责任均可由程序、策划、美术、QA 等职业承担，最终责任落实到人。

**开放实现能力，守住系统底线。** 生产与治理形成持续循环：创作与实现 → 验证与反馈 → 发现系统问题 → 核心治理 → 更新框架与规则 → 支撑下一轮创作。Team、AI 成员、业务模块、Skill 和 Workflow 承载工作组织，内部知识服务、大脑执行循环、任务调度及确定性校验提供支撑。

成功标准是：**更多人能够自主创造，更多成果能够持续交付，而项目复杂度和治理成本仍然可控。** 完整定位、团队责任与产品方向见 [产品说明](docs/product-positioning.md)。上述内容是产品目标，当前已交付范围见文末及 [验证结果与限制](docs/acceptance.md)。

沿用 Cindy 桌面技术栈：Electron + React + TypeScript + Vite + Electron Forge + pnpm。桌面与内部 Loop 共用 TypeScript 领域服务，运行时不需要 Python。

## 运行

构建目录按北京时间命名：`build/YYYYMMDD-HHmmss/`。Windows 便携程序在其中的 `CBIM Assistant-win32-x64/CBIM.exe`，请保留完整目录。分发包为 `make/zip/win32/x64/CBIM-Assistant-YYYYMMDD-HHmmss-win32-x64-版本.zip`，可按名称排序查找最新构建。

最近成功构建的实际路径记录于 `build/latest-build.json`。`pnpm test:desktop` 与 `pnpm test:portable` 默认验证该程序；仍可通过 `CBIM_TEST_EXE` 指定其他构建。

CBIM 启动时加载全部已登记工作区，各自持有知识库、执行上下文与工程锁，直到退出应用。关闭页面或切换视图不会停止运行；新登记工作区立即启动，失败单独显示并可重试。首次打开缺少 `.cbim/` 的项目会初始化知识骨架，工作区打开流程不修改项目的 AI 工具配置。

开发要求 Node.js 22.19+、pnpm 10：

```powershell
pnpm install --frozen-lockfile
pnpm start
pnpm typecheck
pnpm test
pnpm package
pnpm test:desktop
pnpm make
```

正式业务执行使用桌面主对话。`pnpm loop` 保留受限开发兼容接口，旧直接业务启动已拒绝；参数、模型配置和具体限制见 [Loop Engine](docs/loop-engine.md#开发调用)。

## 开发协作与架构维护

新人先阅读 [项目协作规范（AGENTS.md）](AGENTS.md)；Claude Code 的项目入口见 [CLAUDE.md](CLAUDE.md)。

`docs/` 是[概念设计](docs/README.md)，`design/` 是[开发计划模块](design/README.md)。继续开发从 [roadmap](design/tool-architecture-roadmap.md) 和 [上一步开发记录](design/development-log.md) 开始：回顾全局与已有成果，确定下一步及验收，每完成一步立即更新计划状态。

开发流程 `cbim-development` 提供 [Claude Code](.claude/skills/cbim-development/SKILL.md)、[Codex](.codex/skills/cbim-development/SKILL.md) 和 [通用项目](.agents/skills/cbim-development/SKILL.md) 三个同步入口；仅服务本工程开发，不是产品内置业务 Skill。

架构维护流程提供两个入口：

- [Claude Code：architecture-maintenance](.claude/skills/architecture-maintenance/SKILL.md)
- [Codex：architecture-maintenance](.codex/skills/architecture-maintenance/SKILL.md)

修改源码、拆分或移动模块、检查依赖、更新注释与类图时使用该流程。两份 Skill 内容保持同步；代码注释与目录类图要求仅适用于 `src/`。运行 `pnpm check:architecture` 可检查类图同步及包含类型引用的循环依赖。

## 结构与交付

当前目录迁移说明见 [源码目录与迁移说明](docs/source-layout.md)。源码阅读从 [src 整体架构](src/ARCHITECTURE.md) 开始：包含目录划分原因、运行路径、数据归属与逐层类图。代码注释和目录架构文档的同步维护规则仅适用于 `src/`。

顶层分为 `src/frontend/`（前端视图层）与 `src/backend/`（本机后端逻辑层）。`src/bridge/` 集中维护两层之间的公开契约和 Electron 安全桥。后端继续分为 main、scheduler-engine 和 core，保持单向依赖。

| 位置 | 内容 |
|---|---|
| `src/backend/core/brain/` | 大脑 执行层：引擎无关生命周期、存储端口与 Pi 适配器 |
| `src/backend/core/connectors/` | 链接器定义、身份与插件映射 |
| `src/backend/core/team/` | Team、Agent、真人与 Skill 领域视图 |
| `src/backend/core/workspace/` | 业务 Workspace、Module 与 Workflow 领域视图 |
| `src/backend/core/knowledge/` | 核心规则、查询、对象治理及事务契约 |
| `src/backend/scheduler-engine/` | 调度引擎：团队工作流准备、内部知识接入与执行管理 |
| `src/backend/main/` | 应用装配；分为工作区、持久化、平台、IPC、资源和内部执行命令 |
| `src/bridge/preload/`、`src/frontend/`、`src/bridge/contracts/` | 隔离 IPC、React 界面、跨进程协议 |
| `docs/` | 概念设计、产品和架构说明及配套参考 |
| `design/` | 开发路线图、逐步记录与计划入口；现有规范/Schema 和迁移对照资产保留原路径 |
| `tests/` | 隔离工程、规则、内部工具、调度与故障恢复测试 |
| `scripts/` | 构建与桌面验证脚本 |
| `build/` | 按构建时间命名的产物与最新构建记录 |

- [架构、存储与生命周期](docs/assistant-architecture.md)
- [Agent 派发与增量事件](docs/agent-dispatch-contract.md)
- [主会话协作、成员执行与结果回传](docs/member-execution.md)
- [主 Agent 的目标调度循环设计](docs/main-agent-orchestration-loop.md)
- [全局成员与任务监控](docs/global-runtime-management.md)
- [静态 Agent 的 Session 执行历史](docs/agent-session-history.md)
- [静态架构编辑与资源复用](docs/workspace-ui.md#静态架构编辑与复用)
- [本地与账号服务器资源仓库](docs/resource-repositories.md)
- [规则迁移和行为差异](docs/rule-migration.md)
- [验收证据与限制](docs/acceptance.md)

正式知识仅存于 `<项目根>/.cbim/`；登记和本机项目历史存于 `<用户主目录>/.cbim/`。新应用不创建项目内 `.cbim.local/`。测试全部使用隔离用户目录。

团队架构和业务架构是每个工作区各一份的静态定义图，支持自定义 Agent、模块及各自方法的增删改查，变更先预览再提交。人才市场支持整个 Team、单 Agent、单 Skill 的跨项目复用；业务模板始终整套发布和应用，导入后重新确认目标项目的维护人与源码范围。静态定义不携带成员实例或任务记录；同时存在的多个主会话各自拥有调度器生成的动态任务节点图。

已实现多工作区、模型配置、主 Agent 对话、知识查询与受控事务、任务内进度、成员实例登记、任务派发及增量事件。主 Agent 是具备工程、架构和结构化思维的团队与技术管理者：理解目标与约束、治理团队和业务知识、组织责任与模块边界、派发任务并审阅证据。它可按 read/ask/execute 权限通过内部服务增删改查 `.cbim/`，但永不直接修改业务文件或执行命令，业务实现与验证交给独立执行 Agent。

每个主会话与任务图根共用一个持久主实例，主会话之间独立。主 Agent 按模块查询负责岗位，将真实 `ownerSelection` 保存到目标计划和派发；实际领取再次核对责任、来源及配置，执行使用岗位自己的模型、Skill 和项目适配。没有合适专业角色时，可将内置静态 `cbim:executor` 明确登记为项目岗位并设置模块责任；无负责人或配置失效不会隐式回退。默认角色不写入项目定义。

每个用户任务开启一个调度周期，跨主模型调用、成员执行和结果回注持续；执行实例随派发任务创建，周期结束后释放，主实例、图和历史证据保留。同一静态 Agent 的不同项目岗位可使用不同模型，每个任务仍有独立实例和 Pi 会话。主角色与自定义角色共用大脑内核，只有主角色有派发工具。显式 IPC 同样要求实际周期、目标计划和责任绑定；旧直接业务 `loop.start` 已拒绝，历史仍可查询。岗位配置变化不改写旧记录，存量交接尚待 R02-D。

主对话显示独立署名的成员实时动态；任务视图默认展示节点流程图，点击成员节点可看公开回复、工具状态、步骤与证据，并处理独立审批、选项问题或停止执行。节点保留原岗位和模型，手动核实当前配置不会改写任务。图属于当前主会话，派发线和前置依赖线分开；数据按游标增量更新，保留草稿与节点选择。当前岗位派发的打包验证使用 `pnpm exec tsx scripts/owner-execution-ui-smoke.mts`（`--stale` 验证责任变化），见[报告](design/verification/module-owner-dispatch-20261108.md)。

团队架构中的主 Agent、默认执行 Agent 和自定义 Agent 均提供“执行历史”：按静态角色 → 独立 Session → 运行轮次查看输入、回复、工具状态及计划证据。执行实例释放后保留记录，删除角色后可从“历史角色”继续查看。角色/Session 索引存于本机用户数据，正文沿用原始运行日志，不合并模型上下文、不进入人才资源包；旧记录缺少绑定时明确标注。历史页只读、按需分页，手动刷新只补事件增量。

历史构建 `20261107-015449` 的角色历史和默认执行者两种场景均通过，详见[履历验证报告](design/verification/agent-session-history-20261107.md)。旧无绑定派发的桌面脚本须配合其历史构建使用，不能作为当前负责人协议的启动示例。

自动协作不继承主轮“本次任务全部通过”，不把成员结果冒充用户消息；用户队列在周期可靠关闭后按原内容继续。真实 Application/Pi 配合本机可控模型响应已验证主知识授权、自动派发、成员读写、回注、独立 ask 审批、队列与停止边界。`pnpm test:main-instance` 和 `pnpm test:collaboration` 已验证构建 `20261107-012333` 的默认执行者与自定义成员桌面链路，详见[本步验证](design/verification/main-coordinator-20261107.md)；这些测试不等同于真实供应商的自主协作质量。

全局运行管理已提供只读总览，同时统计对话和成员轮次、任务压力与 token 消耗，按真实运行去重汇总；释放实例退出当前活动统计，历史用量保留。已有公平准入、周期软限额、可靠成员求助及同活动周期的一次检查点续执行；通用恢复、逐请求硬预算、全局运行操作、成员启动表单和主动成员聊天仍未接通。执行成员不具备递归派发权。失败、取消或中断的成员通道不直接续接；重启结算未关闭周期，不自动重放历史任务或未知副作用。结构化候选、主会话回注与结果收件确认均不代表正式业务验收通过，完整状态以[开发路线图](design/tool-architecture-roadmap.md)为准。
