# CBIM Assistant

<img src="assets/branding/cbim-mark.svg" width="64" height="64" alt="CBIM Assistant 图标">

本地／多端定位的 AI Native 工作流工具，当前以单人本地使用为主。完整产品名为 **CBIM Assistant**，简称 **CBIM**。品牌图形源为 [cbim-mark.svg](assets/branding/cbim-mark.svg)，使用 `pnpm build:brand` 生成 PNG／ICO、`pnpm check:brand` 核对摘要；官网构建与维护见 [网站说明](website/README.md)。

[产品官网](https://nan023062.github.io/cbim/) · [Windows 下载与更新日志](https://nan023062.github.io/cbim/download.html)

[Office 执行编排](src/logic/projects/ARCHITECTURE.md)通过统一 Agent 实例连接独立引擎包与模型，处理主对话、成员派发、队列和追加输入。执行结束不等于业务验收通过。开发运行要求 Node.js 22.19+。

界面采用工作区侧栏与主会话区：主区域承载 Office 对话、组织架构、业务架构和数据架构。详见 [工作区界面](src/view/ARCHITECTURE.md)。

**CBIM 是本地／多端的 AI Native 工作流工具，当前面向单人使用。** 用户组织 Agent 在具有业务架构、岗位责任和知识的工作区中执行任务与交接；不建设独立账号、多人邀请、在线状态或协作服务。工程团队协作未来通过插件和连接器接入 P4、Git、飞书等工具，多端定位不代表已实现完整同步或远程能力。

执行引擎由独立适配器接入；工具、MCP、连接器和插件属于能力或业务扩展。已有模型服务、反馈和更新可能使用网络，因此“本地优先”不等于已经支持完全离线运行。

当前已具备目标计划、岗位派发、成员结果自动回流、权限与证据核验等基础；完整无人值守开发闭环仍有缺口。见 [核心模型](https://github.com/nan023062/cbim/blob/7dcff4142e09fdac1a670438bd3081d6c0341f23/design/product-model.md) 和 [源码审计与清理记录](https://github.com/nan023062/cbim/blob/c3178be11e24259d99ed59db60cc4781afb15782/design/verification/local-ai-workflow-audit-20261112.md)。产品目标与现有实现分别维护，不能用模型回合结束代替业务验收。

桌面技术栈为 Electron + React + TypeScript + Vite + Electron Forge + pnpm。桌面与内部 Loop 共用 TypeScript 领域服务，运行时不需要 Python。

## 运行

Windows x64 当前公开桌面版为 [desktop-v0.1.19](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.19)，内置资源为 **[C 0.1.19 / R1](https://github.com/nan023062/cbim/releases/tag/runtime-c0.1.19)**。统一图标、状态、表单、帮助提示和明暗主题，改善窄窗口与减少动效体验；页面按需加载，保留未保存输入提示、独立频道草稿及 Agent 工作记录。

本次包含新的基础安装包与 R1，固定新的 Ed25519 资源身份；历史公钥仅兼容本地引擎来源，新引擎索引按公钥隔离，旧通道不变。四个官方 E 包保持原摘要，安装、停用状态及缓存继续保留。实际安装与公开升级范围见 [0.1.19 发布验收](https://github.com/nan023062/cbim/blob/c3178be11e24259d99ed59db60cc4781afb15782/design/verification/desktop-release-0.1.19-public-20261115.md)。更新后台准备，就绪后由用户明确点击安装，普通退出不应用；Windows 安装包未签名、发布者未验证。首次使用未安装的引擎需要联网。实现边界见 [更新模块](src/logic/updates/ARCHITECTURE.md)。

供应商只管理统一模型列表，模型菜单按接口兼容性筛选；对话栏与团队页面设置同一份主 Agent 配置，项目岗位保留独立配置。Windows 安装包仍未签名，可能显示未知发布者或安全提示；`SHA256SUMS.txt` 与资源清单 Ed25519 签名均不能替代 Windows 可信代码签名。后续取得证书后通过更高版本迁移，不改写已公开附件。旧 `v1.x` 是 Python 内核通道，不是当前桌面 APP。

旧反馈宿主已退役，目前保留引擎工具需要的数据契约。更新程序位于 `src/logic/updates/service/`，安装构建用 `pnpm make:desktop`，维护者步骤见 [正式桌面发布](ainative/skills/cbim-release/references/release-runbook.md)。

构建目录按北京时间命名：`build/YYYYMMDD-HHmmss/`。Windows 便携程序在其中的 `CBIM Assistant-win32-x64/CBIM.exe`，请保留完整目录。分发包为 `make/zip/win32/x64/CBIM-Assistant-YYYYMMDD-HHmmss-win32-x64-版本.zip`，可按名称排序查找最新构建。

最近成功构建的实际路径记录于 `build/latest-build.json`。旧 Loop／旧桌面接口的 smoke 脚本与 runtime-acceptance 工作流已退役，不能再作为当前 Office 的验收入口。发布仍须完成适配当前桌面的真实安装与升级验收；本次源码迁移不提供该验收结果。

CBIM 启动时加载全部已登记工作区，各自持有知识库、执行上下文与工程锁，直到退出应用。关闭页面或切换视图不会停止运行；新登记工作区立即启动，失败单独显示并可重试。首次打开缺少 `.cbim/` 的项目会初始化知识骨架，工作区打开流程不修改项目的 AI 工具配置。

开发要求 Node.js 22.19+、pnpm 10：

```powershell
pnpm install --frozen-lockfile
pnpm start
```

日常开发只运行受影响单元的测试：使用 `pnpm exec vitest run` 后跟明确的相关测试文件，必要时用 `-t` 选择用例；类型、依赖和架构检查按实际变化选择。通过后即可记录并提交，不默认执行全量 `pnpm test`、打包或整套桌面测试，详见 [日常验证范围](ainative/AGENTS.md#日常验证范围)。面向 `master` 的 PR 由现有 CI 自动执行全量回归；`pnpm package`、`pnpm make` 等制品验证留在后续集成／发布阶段按需执行。

正式业务执行使用 Office 对话；旧 `pnpm loop` 命令及其宿主已移除。

## 分支约定

仓库只保留两个分支，GitHub 默认分支为 `develop`：

| 分支 | 用途 |
| --- | --- |
| `develop` | 默认开发分支，用于日常功能开发和缺陷修复 |
| `master` | 稳定主分支，接收通过检查的开发成果 |

日常改动提交到 `develop`；每个 Issue 单独开发、验证受影响单元并提交，记录测试范围、选择依据及结果以便追溯。通过 `develop` → `master` 的 PR 执行全量自动化检查，检查通过后合入主分支，并保留各 Issue 的独立提交。

## 开发协作与架构维护

新人先阅读 [AI 协作统一入口](ainative/AGENTS.md)。根目录 [AGENTS.md](AGENTS.md)、[CLAUDE.md](CLAUDE.md) 以及各工具的 Skill 入口均转到共享源；已有规则与流程正文只需修改 `ainative/` 一处。

开发清单与实时进度统一从 [GitHub Issues](https://github.com/nan023062/cbim/issues) 获取。读取选定 Issue、相关 PR／Git 提交记录和实际代码，核实范围、依赖与验收后实施，每个 Issue 独立验证、提交并在已有授权内回填。`design/` 保存[新版桌面 UX 交互设计规范](design/desktop-ux-spec.md)和原型，操作流程沿项目 Skill 和工具维护，验证事实进入提交及关联 Issue／PR；`ainative/docs/` 保存下方概念设计、编码规范与架构标准。

四个项目工作流均必须读取并遵守 [05《代码阅读设计及编码规范》](ainative/docs/05-代码阅读设计及编码规范.md) 和 [06《架构设计原则和工程结构规范》](ainative/docs/06-架构设计原则和工程结构规范.md)，只引用规范，不复制正文。入口与选择见 [项目协作入口](ainative/AGENTS.md#工作流入口)；架构治理步骤维护在 [architecture-evolution](ainative/skills/architecture-evolution/SKILL.md#架构治理执行流程)。这些入口仅服务本工程开发。

桌面发版使用共享 [cbim-release](ainative/skills/cbim-release/SKILL.md)。流程覆盖签名／明确选择的未签名发行、CI、草稿恢复、隔离安装与线上升级、官网及双分支收尾；桌面构建须设置 `CBIM_DESKTOP_NOTES`，指向本次非空发布说明文件；不再从仓库历史资料目录自动取正文。

修改源码、拆分或移动模块、检查依赖、更新注释与类图时，使用共享 [architecture-maintenance](ainative/skills/architecture-maintenance/SKILL.md)。各工具只维护发现入口，流程正文与配套资料统一位于 `ainative/skills/`。运行 `pnpm check:architecture` 可检查类图同步及包含类型引用的循环依赖。

## 结构与交付

源码阅读从 [src 整体架构](src/ARCHITECTURE.md) 开始；阅读设计、注释和架构说明要求统一引用文档 05、06。

源码采用 Core、Logic、Bridge、View 四层：Core 提供共享技术能力，Logic 持有业务与数据，Bridge 处理通信和可信宿主，View 负责界面与交互。便携能力与 Node/Electron 平台入口独立，具体允许依赖以检查器为准。

| 位置 | 内容 |
|---|---|
| `src/core/` | 通用算法、错误、文件/网页/锁/加密等基础能力 |
| `src/logic/` | 当前业务生命周期、Office 编排、模型与引擎包协议 |
| `src/engine-plugins/` | 独立引擎适配器与 SDK 集成 |
| `src/bridge/server/` | 桌面入口、冷启动、通信与可信工具 |
| `src/bridge/contracts/`、`src/bridge/preload/` | 公开通信契约及受限安全桥 |
| `src/view/` | 当前桌面入口、Office 页面与共享展示组件 |
| `ainative/docs/` | 01–04 概念设计、05 代码阅读设计及编码规范与 06 架构设计原则和工程结构规范 |
| `design/` | 产品目标、核心取舍、未落地设计和原型 |
| `assets/` | 实际使用的品牌图像与生成摘要；运行规范由各业务源码模块维护 |
| `legal/` | 随包分发的第三方许可和 NOTICE |
| `tests/` | 全部测试、夹具、归属登记和说明；`tests/src/`、`tests/scripts/` 镜像源码目录，整体测试放根层 |
| `scripts/` | 构建、发布、CI、源码检查与仍适用的手动验收脚本 |
| `build/` | 按构建时间命名的产物与最新构建记录 |

手动验收脚本不一定由 `package.json` 或 CI 调用，不能仅按引用数量判断是否无效。已失效的旧接口验收、截图夹具和源码探针可用 `git show 41885249fa2486941f6123b6b964535020dc89ae:scripts/<文件名>` 追溯；它们只适用于对应历史源码与夹具，不能作为当前版本的通过证据。

实现说明随源码维护，可从以下入口逐层阅读：

- [业务层模块模型与阅读入口](src/logic/ARCHITECTURE.md)
- [执行引擎与生命周期](src/logic/execution/rules/ARCHITECTURE.md)
- [任务规则设计](src/logic/tasks/rules/ARCHITECTURE.md)
- [调度与成员执行](src/logic/ARCHITECTURE.md)
- [Office 与 Agent 实例编排](src/logic/projects/ARCHITECTURE.md)
- [桌面视图与交互](src/view/ARCHITECTURE.md)
- 开发事实、验证证据与限制：查 Git 提交说明及关联 Issue／PR；已退出的资料保留在 Git 历史中。

正式知识仅存于 `<项目根>/.cbim/`；登记和本机项目历史存于 `<用户主目录>/.cbim/`。新应用不创建项目内 `.cbim.local/`。测试全部使用隔离用户目录。

团队架构和业务架构是每个工作区各一份的静态定义图，支持自定义 Agent、模块及各自方法的增删改查，变更先预览再提交。人才市场支持整个 Team、单 Agent、单 Skill 的跨项目复用；业务模板始终整套发布和应用，导入后重新确认目标项目的维护人与源码范围。静态定义不携带成员实例或任务记录；同时存在的多个主会话各自拥有调度器生成的动态任务节点图。

已实现多工作区、模型配置、主 Agent 对话、知识查询与受控事务、任务内进度、成员实例登记、任务派发及增量事件。主 Agent 是具备工程、架构和结构化思维的团队与技术管理者：理解目标与约束、治理团队和业务知识、组织责任与模块边界、派发任务并审阅证据。它可按 read/ask/execute 权限通过内部服务增删改查 `.cbim/`，未配置自定义负责岗位时也在当前主会话直接实现和验证业务。主角色不能作为独立成员派发，业务文件与命令仍受本轮权限及真实工具门禁约束。

每个主会话与任务图根共用一个持久主实例，主会话之间独立。主 Agent 按模块查询负责岗位，将真实 `ownerSelection` 保存到目标计划和派发；实际领取再次核对责任、来源及配置，执行使用岗位自己的模型、Skill 和项目适配。未配置自定义负责岗位的模块由主 Agent 在原会话执行；已有自定义岗位配置失效时报告具体问题，不绕过绑定。`cbim:executor` 已退役，历史记录可读，不接受新登记或派发。默认主角色不写入项目定义。

每个用户任务开启一个调度周期，跨主模型调用、成员执行和结果回注持续；执行实例随派发任务创建，周期结束后释放，主实例、图和历史证据保留。同一静态 Agent 的不同项目岗位可使用不同模型，每个任务仍有独立实例和 Pi 会话。主角色与自定义角色共用大脑内核，只有主角色有派发工具。显式 IPC 同样要求实际周期、目标计划和责任绑定；旧直接业务 `loop.start` 已拒绝，历史仍可查询。岗位配置变化不改写旧记录；同活动周期可明确撤销旧未领取闭包，或放弃尚未消费的检查点，再按新负责人创建独立任务并以真实新候选审阅，见[存量交接](https://github.com/nan023062/cbim/blob/c3178be11e24259d99ed59db60cc4781afb15782/design/task/module-owner-handoff.md)。

主对话显示独立署名的成员实时动态；任务视图默认展示节点流程图，点击成员节点可看公开回复、工具状态、步骤与证据，并处理独立审批、选项问题或停止执行。节点保留原岗位和模型，手动核实当前配置不会改写任务。图属于当前主会话，派发线和前置依赖线分开；数据按游标增量更新，保留草稿与节点选择。当前岗位派发的打包验证使用 `pnpm exec tsx scripts/owner-execution-ui-smoke.mts`（`--stale` 验证责任变化），见[报告](https://github.com/nan023062/cbim/blob/c3178be11e24259d99ed59db60cc4781afb15782/design/verification/module-owner-dispatch-20261108.md)。

主 Agent、自定义 Agent 及已退役角色的历史记录均提供“执行历史”：按静态角色 → 独立 Session → 运行轮次查看输入、回复、工具状态及计划证据。执行实例释放后保留记录，删除角色后可从“历史角色”继续查看。角色/Session 索引存于本机用户数据，正文沿用原始运行日志，不合并模型上下文、不进入人才资源包；旧记录缺少绑定时明确标注。历史页只读、按需分页，手动刷新只补事件增量。

历史构建 `20261107-015449` 的角色历史和默认执行者两种场景均通过，详见[履历验证报告](https://github.com/nan023062/cbim/blob/c3178be11e24259d99ed59db60cc4781afb15782/design/verification/agent-session-history-20261107.md)。旧无绑定派发的桌面脚本须配合其历史构建使用，不能作为当前负责人协议的启动示例。

自动协作不继承主轮“本次任务全部通过”，不把成员结果冒充用户消息；用户队列在周期可靠关闭后按原内容继续。真实 Application/Pi 配合本机可控模型响应已验证主知识授权、自动派发、成员读写、回注、独立 ask 审批、队列与停止边界。`pnpm test:main-instance` 和 `pnpm test:collaboration` 已验证构建 `20261107-012333` 的默认执行者与自定义成员桌面链路，详见[本步验证](https://github.com/nan023062/cbim/blob/c3178be11e24259d99ed59db60cc4781afb15782/design/verification/main-coordinator-20261107.md)；这些测试不等同于真实供应商的自主协作质量。

全局运行管理已提供只读总览，同时统计对话和成员轮次、任务压力与 token 消耗，按真实运行去重汇总；释放实例退出当前活动统计，历史用量保留。已有公平准入、周期软限额、可靠成员求助及同活动周期的一次检查点续执行；通用恢复、逐请求硬预算、全局运行操作、成员启动表单和主动成员聊天仍未接通。执行成员不具备递归派发权。失败、取消或中断的成员通道不直接续接；重启结算未关闭周期，不自动重放历史任务或未知副作用。结构化候选、主会话回注与结果收件确认均不代表正式业务验收通过，上述说明须结合[实际代码](src/ARCHITECTURE.md)及相关提交记录核对；当前开发清单与进度以 [Issues](https://github.com/nan023062/cbim/issues) 为准。

## 设计文档

`ainative/docs/` 保存以下七份设计与规范文档，表达理念、架构原则、目标流程与工程文件组织规范；当前实现和验证事实以源码及开发记录为准。

1. [AI-Native 设计思想总纲](ainative/docs/01-AI-Native设计思想总纲.md)
2. [CBIM 架构设计理论](ainative/docs/02-CBIM架构设计理论.md)
3. [渐进式架构演进与人工认知保障体系](ainative/docs/03-渐进式架构演进与人工认知保障体系.md)
4. [AI-Native 开发全流程设计方案](ainative/docs/04-AI-Native开发全流程设计方案.md)
5. [代码阅读设计及编码规范](ainative/docs/05-代码阅读设计及编码规范.md)
6. [架构设计原则和工程结构规范](ainative/docs/06-架构设计原则和工程结构规范.md)

`ainative/docs/` 不依赖项目设计或操作记录；项目设计与提交／Issue／PR 中的验证记录依据这些准则维护。

其余旧设计文档已清理，历史内容可用 `git show 812bec16:<原仓库相对路径>` 查阅。旧知识内置加载器已退役；当前 Skill 设置与加载沿 [Office 模块](src/logic/projects/ARCHITECTURE.md) 阅读。Cindy 的 [许可](legal/cindy-LICENSE) 与 [NOTICE](legal/cindy-NOTICE) 归入 `legal/` 并随包分发，NOTICE 中的上游目录说明保留原文。
