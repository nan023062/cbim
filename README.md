# CBIM Assistant

新增 [Loop Engine（Pi 首版）](docs/loop-engine.md)：`src/backend/core/brain/` 通过注入的存储端口管理执行事件、中断与显式恢复，开发入口为 `pnpm loop`。已接入桌面对话；执行结束不等于业务验收通过。Loop 开发运行要求 Node.js 22.19+。

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

内部执行开发入口为 `pnpm loop`，参数、模型配置和权限见 [Loop Engine](docs/loop-engine.md)。

## 开发协作与架构维护

新人先阅读 [项目协作规范（AGENTS.md）](AGENTS.md)；Claude Code 的项目入口见 [CLAUDE.md](CLAUDE.md)。

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
| `design/` | 现有规范与 Schema；Python 文件暂留作迁移对照 |
| `tests/` | 隔离工程、规则、内部工具、调度与故障恢复测试 |
| `scripts/` | 构建与桌面验证脚本 |
| `build/` | 按构建时间命名的产物与最新构建记录 |

- [架构、存储与生命周期](docs/assistant-architecture.md)
- [Agent 派发与增量事件](docs/agent-dispatch-contract.md)
- [全局成员与任务监控](docs/global-runtime-management.md)
- [规则迁移和行为差异](docs/rule-migration.md)
- [验收证据与限制](docs/acceptance.md)

正式知识仅存于 `<项目根>/.cbim/`；登记和本机项目历史存于 `<用户主目录>/.cbim/`。新应用不创建项目内 `.cbim.local/`。测试全部使用隔离用户目录。

已实现多工作区、模型配置、主 Agent 对话与工具执行、知识查询与受控事务、任务内进度、成员实例登记、任务派发持久化及增量事件。全局运行管理已提供后端与 IPC 接口，尚无监控界面；成员收件箱自动执行、递归派发和完整团队协作闭环尚未接通。结构校验与执行结束都不能替代业务验收和架构判断。
