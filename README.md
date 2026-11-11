# CBIM Assistant

<img src="branding/cbim-mark.svg" width="64" height="64" alt="CBIM Assistant 图标">

面向 AI 原生团队的桌面工作空间。完整产品名为 **CBIM Assistant**，简称 **CBIM**。品牌资源与生成方式见 [品牌规范](branding/README.md)；官网构建与维护见 [网站说明](website/README.md)。

[产品官网](https://nan023062.github.io/cbim/) · [Windows 下载与更新日志](https://nan023062.github.io/cbim/download.html)

[Loop Engine（Pi）](src/backend/core/brain/ARCHITECTURE.md)：`src/backend/core/brain/` 通过注入的存储端口管理执行事件、中断与显式恢复，桌面主对话经调度引擎派发正式业务任务。执行结束不等于业务验收通过。开发运行要求 Node.js 22.19+。

界面采用工作区侧栏与主会话区：中间切换对话和任务视图，右侧扩展区承载团队架构、业务架构、浏览器与终端。详见 [工作区界面](src/frontend/ARCHITECTURE.md)。

**CBIM 是面向 AI 原生团队的生产与治理体系。** 它推动团队重新划分职责，让任何职业的人都能借助 AI 直接参与实现，同时保证项目和生产流程长期可持续。CBIM Assistant 是承载这一体系的桌面产品入口。

团队按能力与承担的责任组织工作：少量核心治理者负责核心框架、专业规则、工作流程和治理机制；创作与执行者借助 AI，将目标、创造力和专业判断转化为可验证的成果。两类责任均可由程序、策划、美术、QA 等职业承担，最终责任落实到人。

**开放实现能力，守住系统底线。** 生产与治理形成持续循环：创作与实现 → 验证与反馈 → 发现系统问题 → 核心治理 → 更新框架与规则 → 支撑下一轮创作。Team、AI 成员、业务模块、Skill 和 Workflow 承载工作组织，内部知识服务、大脑执行循环、任务调度及确定性校验提供支撑。

成功标准是：**更多人能够自主创造，更多成果能够持续交付，而项目复杂度和治理成本仍然可控。** 完整定位、团队责任与产品方向见 [产品说明](docs/01-AI-Native设计思想总纲.md)。上述内容是产品目标，当前已交付范围见文末及 [验证结果与限制](design/development-log.md)。

沿用 Cindy 桌面技术栈：Electron + React + TypeScript + Vite + Electron Forge + pnpm。桌面与内部 Loop 共用 TypeScript 领域服务，运行时不需要 Python。

## 运行

Windows x64 当前公开桌面版为 [desktop-v0.1.4](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.4)，废弃真人花名册与额外维护确认，保留岗位和模块负责人；修复对象字段、模块模板、责任冲突与实例恢复提示。安装后从左下角「版本与更新」查看版本、日志与新版提醒。此包尚未签名，Windows 可能显示未知发布者或安全提示；核对发布页的 `SHA256SUMS.txt` 不能替代可信签名。后续取得证书后将通过更高版本切换到签名发行。旧 `v1.x` 是 Python 内核通道，不是当前桌面 APP。

当前版本每分钟检查，新版高亮菜单并显示用户栏绿点；点击下载后自动校验、停止任务、安装并重启，失败保留显式重试。真实 0.1.3 → 0.1.4 自动升级、安装前普通退出取消及工作区/模型/对话保留已验证，见 [发布验收](design/verification/desktop-release-0.1.4-20261110.md)。0.1.2 及更早版本仍按旧界面下载后再次确认重启；关闭或离线的客户端需启动并联网后检查更新。

BUG 与需求从对话「+ → BUG 反馈／需求许愿」调用内置 Skill。一句问题或愿望即可提交，其余信息自愿，缺项标“用户未提供”。首次在设置连接自己的 GitHub；成功后不追加结果消息。详见 [OAuth 与反馈指南](design/task/github-feedback-setup.md)。更新程序独立位于 `src/backend/updater/`，安装构建用 `pnpm make:desktop`，维护者步骤见 [正式桌面发布](design/task/desktop-release.md)。

构建目录按北京时间命名：`build/YYYYMMDD-HHmmss/`。Windows 便携程序在其中的 `CBIM Assistant-win32-x64/CBIM.exe`，请保留完整目录。分发包为 `make/zip/win32/x64/CBIM-Assistant-YYYYMMDD-HHmmss-win32-x64-版本.zip`，可按名称排序查找最新构建。

最近成功构建的实际路径记录于 `build/latest-build.json`。`pnpm test:desktop` 与 `pnpm test:portable` 默认验证该程序；仍可通过 `CBIM_TEST_EXE` 指定其他构建。

CBIM 启动时加载全部已登记工作区，各自持有知识库、执行上下文与工程锁，直到退出应用。关闭页面或切换视图不会停止运行；新登记工作区立即启动，失败单独显示并可重试。首次打开缺少 `.cbim/` 的项目会初始化知识骨架，工作区打开流程不修改项目的 AI 工具配置。

开发要求 Node.js 22.19+、pnpm 10：

```powershell
pnpm install --frozen-lockfile
pnpm start
```

日常开发只运行受影响单元的测试：使用 `pnpm exec vitest run` 后跟明确的相关测试文件，必要时用 `-t` 选择用例；类型、依赖和架构检查按实际变化选择。通过后即可记录并提交，不默认执行全量 `pnpm test`、打包或整套桌面测试，详见 [日常验证范围](AGENTS.md#日常验证范围)。面向 `master` 的 PR 由现有 CI 自动执行全量回归；`pnpm package`、`pnpm make` 和 `pnpm test:desktop` 等制品验证留在后续集成／发布阶段按需执行。

正式业务执行使用桌面主对话。`pnpm loop` 保留受限开发兼容接口，旧直接业务启动已拒绝；参数、模型配置和具体限制见 [Loop Engine](src/backend/main/commands/ARCHITECTURE.md)。

## 分支约定

仓库只保留两个分支，GitHub 默认分支为 `develop`：

| 分支 | 用途 |
| --- | --- |
| `develop` | 默认开发分支，用于日常功能开发和缺陷修复 |
| `master` | 稳定主分支，接收通过检查的开发成果 |

日常改动提交到 `develop`；每个 Issue 单独开发、验证受影响单元并提交，记录测试范围、选择依据及结果以便追溯。通过 `develop` → `master` 的 PR 执行全量自动化检查，检查通过后合入主分支，并保留各 Issue 的独立提交。

## 开发协作与架构维护

新人先阅读 [项目协作规范（AGENTS.md）](AGENTS.md)；Claude Code 的项目入口见 [CLAUDE.md](CLAUDE.md)。

开发清单与实时进度统一从 [GitHub Issues](https://github.com/nan023062/cbim/issues) 获取。读取选定 Issue、[相关开发记录](design/development-log.md) 和实际代码，核实范围、依赖与验收后实施，每个 Issue 独立验证、提交并在已有授权内回填。`design/` 保存[关联方案、规范与记录](design/README.md)，`docs/` 仅保留下方四份概念设计。

开发流程 `cbim-development` 提供 [Claude Code](.claude/skills/cbim-development/SKILL.md)、[Codex](.codex/skills/cbim-development/SKILL.md) 和 [通用项目](.agents/skills/cbim-development/SKILL.md) 三个同步入口；必须遵守 [文档 1：通用项目架构设计规范与原则](design/project-architecture-standard.md)。项目架构治理入口 `architecture-evolution` 必须遵守文档 1 并按 [文档 2：架构治理规范与治理流程](design/architecture-governance-process.md) 执行。上述入口仅服务本工程开发，不是产品内置业务 Skill。

桌面发版使用 `cbim-release`：[通用项目](.agents/skills/cbim-release/SKILL.md)、[Claude Code](.claude/skills/cbim-release/SKILL.md)、[Codex](.codex/skills/cbim-release/SKILL.md)。流程覆盖签名／明确选择的未签名发行、CI、草稿恢复、隔离安装与线上升级、官网及双分支收尾；具体分工见 [开发者 Skill 说明](design/README.md#开发入口)。

架构维护流程提供三个同步入口：

- [通用项目：architecture-maintenance](.agents/skills/architecture-maintenance/SKILL.md)

- [Claude Code：architecture-maintenance](.claude/skills/architecture-maintenance/SKILL.md)
- [Codex：architecture-maintenance](.codex/skills/architecture-maintenance/SKILL.md)

修改源码、拆分或移动模块、检查依赖、更新注释与类图时使用该流程。三个入口内容保持同步；代码注释与目录类图要求仅适用于 `src/`。运行 `pnpm check:architecture` 可检查类图同步及包含类型引用的循环依赖。

## 结构与交付

源码阅读从 [src 整体架构](src/ARCHITECTURE.md) 开始：包含目录划分原因、运行路径、数据归属与逐层类图。代码注释和目录架构文档的同步维护规则仅适用于 `src/`。

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
| `docs/` | 01–04 四份概念设计 |
| `design/` | Issue 关联方案、运行规范、Schema 与开发／验证记录 |
| `legal/` | 随包分发的第三方许可和 NOTICE |
| `tests/` | 隔离工程、规则、内部工具、调度与故障恢复测试 |
| `scripts/` | 构建与桌面验证脚本 |
| `build/` | 按构建时间命名的产物与最新构建记录 |

实现说明随源码维护，可从以下入口逐层阅读：

- [执行引擎与生命周期](src/backend/core/brain/ARCHITECTURE.md)
- [任务身份与派发契约](src/backend/core/tasks/CONTRACT.md)
- [调度与成员执行](src/backend/scheduler-engine/ARCHITECTURE.md)
- [运行统计与准入](src/backend/core/runtime/CONTRACT.md)
- [桌面视图与交互](src/frontend/ARCHITECTURE.md)
- [开发事实、验证证据与限制](design/development-log.md)

正式知识仅存于 `<项目根>/.cbim/`；登记和本机项目历史存于 `<用户主目录>/.cbim/`。新应用不创建项目内 `.cbim.local/`。测试全部使用隔离用户目录。

团队架构和业务架构是每个工作区各一份的静态定义图，支持自定义 Agent、模块及各自方法的增删改查，变更先预览再提交。人才市场支持整个 Team、单 Agent、单 Skill 的跨项目复用；业务模板始终整套发布和应用，导入后重新确认目标项目的维护人与源码范围。静态定义不携带成员实例或任务记录；同时存在的多个主会话各自拥有调度器生成的动态任务节点图。

已实现多工作区、模型配置、主 Agent 对话、知识查询与受控事务、任务内进度、成员实例登记、任务派发及增量事件。主 Agent 理解目标与约束、治理团队和业务知识、组织责任与模块边界，并默认在当前主会话实现业务和验证。read 只读，ask 的写入与命令须实际审批，execute 仍遵守工作区保护；`.cbim/` 只能经受控知识服务修改，业务文件和命令使用本轮实际提供的执行工具。

每个主会话与任务图根共用一个持久主实例，主会话之间独立。未配置自定义负责岗位的模块由主 Agent 直接执行；明确配置岗位时，将真实 `ownerSelection` 保存到目标计划和派发，实际领取再次核对责任、来源及配置，使用岗位自己的模型、Skill 和项目适配。已配置岗位失效应报告真实缺口；主角色不能被派成独立成员，已退役的 `cbim:executor` 不得重新登记或派发，旧记录仅保留历史。

每个用户任务开启一个调度周期，跨主模型调用、成员执行和结果回注持续；执行实例随派发任务创建，周期结束后释放，主实例、图和历史证据保留。同一静态 Agent 的不同项目岗位可使用不同模型，每个任务仍有独立实例和 Pi 会话。主角色与自定义角色共用大脑内核，只有主角色有派发工具。显式 IPC 同样要求实际周期、目标计划和责任绑定；旧直接业务 `loop.start` 已拒绝，历史仍可查询。岗位配置变化不改写旧记录；同活动周期可明确撤销旧未领取闭包，或放弃尚未消费的检查点，再按新负责人创建独立任务并以真实新候选审阅，见[存量交接](design/task/module-owner-handoff.md)。

主对话显示独立署名的成员实时动态；任务视图默认展示节点流程图，点击成员节点可看公开回复、工具状态、步骤与证据，并处理独立审批、选项问题或停止执行。节点保留原岗位和模型，手动核实当前配置不会改写任务。图属于当前主会话，派发线和前置依赖线分开；数据按游标增量更新，保留草稿与节点选择。当前岗位派发的打包验证使用 `pnpm exec tsx scripts/owner-execution-ui-smoke.mts`（`--stale` 验证责任变化），见[报告](design/verification/module-owner-dispatch-20261108.md)。

团队架构中的主 Agent、默认执行 Agent 和自定义 Agent 均提供“执行历史”：按静态角色 → 独立 Session → 运行轮次查看输入、回复、工具状态及计划证据。执行实例释放后保留记录，删除角色后可从“历史角色”继续查看。角色/Session 索引存于本机用户数据，正文沿用原始运行日志，不合并模型上下文、不进入人才资源包；旧记录缺少绑定时明确标注。历史页只读、按需分页，手动刷新只补事件增量。

历史构建 `20261107-015449` 的角色历史和默认执行者两种场景均通过，详见[履历验证报告](design/verification/agent-session-history-20261107.md)。旧无绑定派发的桌面脚本须配合其历史构建使用，不能作为当前负责人协议的启动示例。

自动协作不继承主轮“本次任务全部通过”，不把成员结果冒充用户消息；用户队列在周期可靠关闭后按原内容继续。真实 Application/Pi 配合本机可控模型响应已验证主知识授权、自动派发、成员读写、回注、独立 ask 审批、队列与停止边界。`pnpm test:main-instance` 和 `pnpm test:collaboration` 已验证构建 `20261107-012333` 的默认执行者与自定义成员桌面链路，详见[本步验证](design/verification/main-coordinator-20261107.md)；这些测试不等同于真实供应商的自主协作质量。

全局运行管理已提供只读总览，同时统计对话和成员轮次、任务压力与 token 消耗，按真实运行去重汇总；释放实例退出当前活动统计，历史用量保留。已有公平准入、周期软限额、可靠成员求助及同活动周期的一次检查点续执行；通用恢复、逐请求硬预算、全局运行操作、成员启动表单和主动成员聊天仍未接通。执行成员不具备递归派发权。失败、取消或中断的成员通道不直接续接；重启结算未关闭周期，不自动重放历史任务或未知副作用。结构化候选、主会话回注与结果收件确认均不代表正式业务验收通过，上述说明须结合[实际代码](src/ARCHITECTURE.md)和[开发记录](design/development-log.md)核对；当前开发清单与进度以 [Issues](https://github.com/nan023062/cbim/issues) 为准。

## 设计文档

`docs/` 仅保留以下四份设计文档，表达理念、架构原则与目标流程；当前实现和验证事实以源码及开发记录为准。

1. [AI-Native 设计思想总纲](docs/01-AI-Native设计思想总纲.md)
2. [CBIM 架构设计理论](docs/02-CBIM架构设计理论.md)
3. [渐进式架构演进与人工认知保障体系](docs/03-渐进式架构演进与人工认知保障体系.md)
4. [AI-Native 开发全流程设计方案](docs/04-AI-Native开发全流程设计方案.md)

其余旧设计文档已清理，历史内容可用 `git show 812bec16:<原仓库相对路径>` 查阅。产品实际读取的 [Skill／Workflow 规范](design/runtime/shared-skills-workflows.md) 归入运行资料；Cindy 的 [许可](legal/cindy-LICENSE) 与 [NOTICE](legal/cindy-NOTICE) 归入 `legal/` 并随包分发，NOTICE 中的上游目录说明保留原文。
