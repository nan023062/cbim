# 源码目录与迁移说明

日期：2026-11-06。本文记录本次目录与职责重构的实际结果。工具功能的后续建设见 [工具架构计划](tool-architecture-roadmap.md)，不能将目录存在视为相应能力已完成。

## 顶层边界

```text
src/
  backend/              本机后端逻辑层
    core/               核心领域、大脑和共享机制
      foundation/         错误、标识、JSON、哈希、路径端口及最小文件原语
      brain/              执行循环；llm/ 模型契约；pi/ 引擎适配
      connectors/         链接器定义
      knowledge/          知识类型、只读快照、规则、查询、CRUD 规划与存储端口
      policy/             当前权限与人工确认契约
      runtime/            全局动态成员、任务、负载与消费的公开监管契约
      tasks/              任务及待执行消息契约
      team/               组织、Agent 与 Skill 继承
      tools/              注册表、调用与结构化问题契约
      workspace/          业务模块与本模块 Workflow
    scheduler-engine/   与 core 平级，单向依赖 core
      context/            团队任务上下文准备
      conversation/       主 Agent 指引、队列、提问及运行内审批
      execution/          运行装配、工作区执行和恢复
      runtime/            应用级运行索引、代际隔离、负载与用量聚合
      tools/              内部 Loop 的知识工具及任务工具适配
    main/               应用装配与实际平台环境
      commands/           内部 Loop 开发命令
      ipc/                应用 action 路由
      persistence/        knowledge/ 知识事务；tasks/ 日志附件；settings/ 配置
      platform/           路径、锁、加密、终端及原生访问检查
      resources/          共享资源仓库
      workspace/          本机登记和运行实例
  bridge/               前后端通信边界（不是第三个业务层）
    contracts/          跨进程公开数据与界面 DTO
    preload/            Electron 固定 IPC 桥
  frontend/             前端视图层，原 renderer 按功能组织
    conversation/       对话、输入框、附件和消息队列
    tasks/              当前会话任务视图
    workspace/          项目业务架构
    team/               项目团队架构
    knowledge/          知识编辑与检查
    diagnostics/        工作区知识问题诊断
    shell/              侧栏、用户栏及扩展区域
    settings/           应用设置
    resources/          三类共享资源
    automation/         工作区自动化展示
    components/         公共展示组件
```

源码以外维持 `design/`（内置运行规则资产）、`docs/`（人类设计说明）、`tests/`、`scripts/`、`build/` 和 `test-results/`。不把目标项目 `.cbim/` 或用户运行数据搬入源码。

前端与后端是两个职责层，后端默认运行在本机，并非远端服务器。`bridge/` 只承载公开契约和安全通信：前端通过 preload 调用后端，后端通过契约返回数据。后端内部保持 main → scheduler-engine → core 的依赖方向，main 也可以直接装配 Core。

本次目录映射：`src/renderer/` → `src/frontend/`；`src/main/`、`src/core/`、`src/scheduler-engine/` 分别进入 `src/backend/`；`src/contracts/` 与 `src/preload/` 分别进入 `src/bridge/`。下表记录此前职责拆分；其中 main/core/scheduler-engine 的相对路径均以 backend 为基准，contracts 以 bridge 为基准，renderer 的现归属为 frontend。

## 实际迁移

| 原位置或混合职责 | 当前归属 |
| --- | --- |
| `core/knowledge/service.ts` 工具定义与参数协议 | `scheduler-engine/tools/knowledge-tools.ts`；领域查询及对象规则仍在 Core |
| `core/storage/paths.ts` | `main/platform/paths.ts` 实现；Core 的 `StoragePaths` 端口与错误、序列化、文件原语分别归 Foundation |
| `core/brain/llm/profiles.ts` | `main/persistence/settings/llm-profiles.ts`；运行快照及加密端口在 `core/brain/llm/ports.ts` |
| `core/brain/journal.ts` | `main/persistence/tasks/run-journal.ts`；大脑通过 `RunStorage` 接口取得日志 |
| `main/workspace/workspace.ts` 知识初始化、读取、事务与恢复 | `main/persistence/knowledge/knowledge-store.ts`；Workspace 保留生命周期并委托存储 |
| Core ObjectCrud 的物理目录与缓存操作 | `main/persistence/knowledge/object-storage.ts`，由 Core `ObjectStorage` 端口注入 |
| `core/knowledge/knowledge.ts` 文件遍历 | `main/persistence/knowledge/files.ts`；结构规则和派生索引保留在 Core |
| 调度顶层散放文件 | 分为 Context、Conversation、Execution 和 Tools |
| 执行管理器的审批等待与任务内授权 | `scheduler-engine/conversation/approvals.ts` |
| `main/application.ts` action switch | `main/ipc/dispatch.ts`；应用仍控制服务生命周期 |
| `main/infrastructure/` | 执行装配在 `main/execution.ts`，其余按平台与持久化归属 |
| `shared/` | 领域类型归 Core，公开跨进程数据归 `contracts/` |
| 业务架构面板 | `renderer/workspace/WorkspaceView.tsx`；知识编辑器仍在 Knowledge |

## 依赖规则

- Backend/Main 装配 Core、调度及平台实现。Core 和调度不反向导入 Main，连类型依赖也不允许；后端任何模块都不导入 Frontend。
- 文件级依赖必须无环，包含类型引用。`Application` 实现 `main/ipc/services.ts` 的 `ApplicationServices`，路由只引用该契约，不反向引用应用类。
- Frontend 只依赖自身和 Bridge/Contracts；不得直接导入 Core、调度、主进程实现或 Preload。
- Contracts 可以重导出 Core 的公开可序列化类型和纯格式化函数，不能暴露持密钥的运行快照。
- 调度上下文准备直接调用 Core 查询服务，不通过模型工具协议取得数据。
- Team 与 Workspace 只读快照辅助依赖严格 JSON 解析器，不通过 Rules 反向依赖完整领域查询门面。目录级依赖聚合不等于存在文件级循环。
- `KnowledgeTools` 使用通用 `ToolRegistry` 注册协议。注册与发现不授权，调用使用可信运行的实例身份、版本和权限；桌面知识操作由固定 IPC 路由调用领域服务。

## 本次保持的行为

目录整理保持内部工具名、工作区身份算法、用户数据路径、事务日志、Pi 会话和队列文件格式。桌面与 `pnpm loop` 是实际运行入口；构建清单只包含应用、preload 和内部 Pi 运行资源。

内部 Loop 的原生与知识写入已经共用运行权限，目录整理本身不自动迁移项目知识或重放任务。Foundation 的 Node 文件原语、规则校验的只读文件核验、Pi 的进程适配以及会话队列自身的持久化仍保留其现有职责；Core 不是浏览器可执行的纯函数包。

尚未建立 `evidence/`、`governance/`、`planning/`、`workflow/`、`delivery/` 等空目录。只有相应阶段开始实现实际能力时才创建，避免用目录替代交付。

## Review 与维护

成员封装与任务调度见 [任务派发图契约](agent-dispatch-contract.md)：Core 持有成员、图、命令和存储端口；调度负责知识核实与可靠入队；main 持有事务日志及工作区生命周期；Bridge 导出图 DTO。各模块 `CONTRACT.md` 分开记录已实现范围与后续设计，生成器同步附加到对应 `ARCHITECTURE.md`；上方类图仍只描述当前实现。修改契约源后运行生成器，避免未来 API 混入现状图。

从 [src 总览](../src/ARCHITECTURE.md) 逐层进入，每个维护目录包含代码清单、Mermaid 类图和子目录链接。大图按文件或边界拆分，跨组依赖明确列出。

分析真实职责后更新 `scripts/source-architecture.mjs` 的目录定位，再运行 `node scripts/source-architecture.mjs` 同步清单和实际声明。`node scripts/source-architecture.mjs --check` 检查文档漂移；脚本不能替代对职责、关键接口和设计理由的人工 review。

`tests/layer-boundaries.test.ts` 检查嵌套目录、类型依赖及重导出的单向边界，并检查文件头和目录文档。`tests/core-domains.test.ts` 保留领域查询与调度边界回归，防止迁移后检查只扫描空的调度根目录而失效。

固定流程见 [架构维护 Skill](../.claude/skills/architecture-maintenance/SKILL.md)。`pnpm check:architecture` 同时检查类图漂移与文件依赖；`pnpm check:dependencies` 可独立运行。`tests/dependencies.test.ts` 将全量扫描接入默认 `pnpm test`，并使用临时目录验证类型环、长环、自引用、动态导入、别名及声明文件遮蔽。

依赖扫描覆盖 src、tests、scripts、design、docs、.claude、.codex 中维护的 JS/TS（含声明文件）和根目录 JS/TS 配置，排除构建产物、第三方依赖和缓存；.agents 的宿主 Skill 链接复用 .claude 实体。新增其他源码根时须更新扫描 roots。类型 import/export、内联类型引用、import type 表达式、字面量动态 import、require 和 createRequire 常见别名都会构成依赖。无法解析的本地引用、范围外代码、未知源码边界、层级越界和未经审核的计算式加载会使检查失败。现有两处第三方动态加载通过精确表达式及理由登记；不允许豁免项目内部循环。任意反射或运行时生成的加载逻辑仍需人工审核，静态扫描不构成其运行依赖的证明。

## 前后端目录整理验证

2026-11-06 完成前后端分组后：

- TypeScript 类型检查通过；40 个测试文件、141 项测试通过。
- 188 个 JS/TS 文件、495 条依赖（包含类型引用）无循环、无分层越界；新增前端直连后端、后端导入前端、Preload 直连 Main 的拒绝测试。
- 47 份目录架构文档覆盖 135 个代码/样式文件，同步检查及文档链接检查通过。入口注释已明确 frontend、backend、bridge 的职责；两份架构维护 Skill 同步采用新边界。
- `pnpm package` 生成 `build/20261106-141226/CBIM Assistant-win32-x64/CBIM.exe`。
- 打包后的扩展区界面验证通过：浏览器、终端、中央对话隔离、页签展开收起与布局。
- 便携包复制到工程外并移除 PATH 中的 Node/Python 后，内置 Skill、知识 CRUD 验证通过；不是另一台干净电脑测试。

## 此前职责拆分验证

2026-11-06 在 Windows 开发机完成：

- TypeScript 类型检查及未使用导入检查通过。
- 39 个测试文件、130 项测试通过，覆盖知识事务恢复、真实 Pi 调用、图片、队列、权限和分层边界。
- 45 个维护目录的架构文档覆盖 134 个代码/样式文件；文档同步检查与相对链接检查通过。
- `pnpm package` 生成 `build/20261106-133705/CBIM Assistant-win32-x64/CBIM.exe`。
- 便携包复制到工程外、从 PATH 移除 Node/Python 后启动成功，内置 Skill、知识 CRUD 验证通过；这是本机隔离目录验证，不是另一台干净电脑验证。
- 新版扩展区桌面测试通过：浏览器、命令终端、团队/业务架构入口、中央草稿隔离、页签收起展开及几何布局。

本次未发布或推送代码，未修改用户工作区知识与运行数据。后续工具功能仍按工具架构计划分阶段实现。
