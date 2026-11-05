# CBIM Assistant

界面采用工作区侧栏与可自定义页签：对话、任务流程、团队组织架构、团队知识图。页签支持拖动排序、重命名与本机恢复；详见 [工作区界面](docs/workspace-ui.md)。

**CBIM 是面向 AI 原生团队的生产与治理体系。** 它推动团队重新划分职责，让任何职业的人都能借助 AI 直接参与实现，同时保证项目和生产流程长期可持续。CBIM Assistant 是承载这一体系的桌面产品入口。

团队按能力与承担的责任组织工作：少量核心治理者负责核心框架、专业规则、工作流程和治理机制；创作与执行者借助 AI，将目标、创造力和专业判断转化为可验证的成果。两类责任均可由程序、策划、美术、QA 等职业承担，最终责任落实到人。

**开放实现能力，守住系统底线。** 生产与治理形成持续循环：创作与实现 → 验证与反馈 → 发现系统问题 → 核心治理 → 更新框架与规则 → 支撑下一轮创作。Team、AI 成员、业务模块、Skill 和 Workflow 承载工作组织，知识管理、架构可视化、确定性校验及 MCP 提供支撑。

成功标准是：**更多人能够自主创造，更多成果能够持续交付，而项目复杂度和治理成本仍然可控。** 完整定位、团队责任与产品方向见 [产品说明](docs/product-positioning.md)。上述内容是产品目标，当前已交付范围见文末及 [验证结果与限制](docs/acceptance.md)。

沿用 Cindy 桌面技术栈：Electron + React + TypeScript + Vite + Electron Forge + pnpm。UI、CLI、MCP 共用 TypeScript 规则与服务，运行时不需要 Python。

## 运行

构建目录按北京时间命名：`build/YYYYMMDD-HHmmss/`。Windows 便携程序在其中的 `CBIM Assistant-win32-x64/CBIM Assistant.exe`，请保留完整目录。分发包为 `make/zip/win32/x64/CBIM-Assistant-YYYYMMDD-HHmmss-win32-x64-版本.zip`，可按名称排序查找最新构建。

最近成功构建的实际路径记录于 `build/latest-build.json`。`pnpm test:desktop` 与 `pnpm test:portable` 默认验证该程序；仍可通过 `CBIM_TEST_EXE` 指定其他构建。

人工启动后点击「添加工作区」并选择业务工程根；可以同时运行多个工作区，切换不停止后台服务。启动恢复默认关闭，由侧栏显式设置控制。

开发要求 Node.js 22.12+、pnpm 10：

```powershell
pnpm install --frozen-lockfile
pnpm start
pnpm typecheck
pnpm test
pnpm package
pnpm test:desktop
pnpm make
```

命令入口：`pnpm cli --root "<业务工程根>" --query "资源"`，或 `--validate`；仅连接已运行工作区，不启动应用。

## 结构与交付

| 位置 | 内容 |
|---|---|
| `src/main/` | 工作区、路径、内核锁、TypeScript 规则、事务、MCP、CLI |
| `src/preload/`、`src/renderer/`、`src/shared/` | 隔离 IPC、React 界面、共享类型 |
| `design/` | 现有规范与 Schema；Python 文件暂留作迁移对照 |
| `tests/` | 隔离工程、规则、正式 MCP 与故障恢复测试 |
| `scripts/` | 构建与桌面验证脚本 |
| `build/` | 按构建时间命名的产物与最新构建记录 |
| `publish/` | 交付说明 |

- [架构、存储与生命周期](docs/assistant-architecture.md)
- [MCP 接口与发现](docs/assistant-mcp.md)
- [规则迁移和行为差异](docs/rule-migration.md)
- [验收证据与限制](docs/acceptance.md)

正式知识仅存于 `<项目根>/.cbim/`；登记和本机项目历史存于 `<用户主目录>/.cbim/`。新应用不创建项目内 `.cbim.local/`。测试全部使用隔离用户目录。

首版实现多工作区、模块树、知识编辑预览、规则校验、事务恢复与真实 MCP。自动 AI 调度、架构语义判断和业务运行验证不属于已实现能力。
