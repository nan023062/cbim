# Core、Logic、Bridge、View

四层源码迁移已完成。旧 backend/frontend/foundations 源码目录已经退出，当前实现按以下职责维护。

| 层 | 职责与修改入口 |
| --- | --- |
| [Core](core/ARCHITECTURE.md) | utility、错误与 JSON、文件/网页/锁/加密等技术机制；便携与 Node/Electron 入口分开，不依赖业务 |
| [Logic](logic/ARCHITECTURE.md) | 领域规则、业务数据、运行编排、存储和业务平台实现；Application 持有唯一业务生命周期 |
| [Bridge](bridge/ARCHITECTURE.md) | 通信契约、IPC/CLI/桌面服务端与 preload；适配 Logic，不持有第二套业务状态 |
| [View](view/ARCHITECTURE.md) | React 页面、交互状态及视图专属适配；仅经 Bridge 通信，可组合便携 Core |

依赖箭头从使用者指向被使用者。Core 不依赖其余三层；Logic 不导入 Bridge/View/Electron；View 与通信客户端不得加载 Node/Electron。Bridge contracts 只具名转接已登记的纯业务契约，不能暴露服务、凭据或平台入口。preload 是当前真实客户端实现，没有为目录完整预建 client 或 browser 模块。

跨模块使用 index.ts 或已经登记的细粒度公开文件。类型边也必须无环；不创建全域 barrel 强行合并纯契约和运行实现。规则不能依赖运行服务，具体引擎仅由 execution/assembly 选择，普通服务不得反向读取 Application。

业务语义与状态归属保持：派发、知识和文件事务沿用原一致性边界；取消不代表物理操作退出，未知写入不自动重放。文件无环与目录迁移不等于依赖密集模块已全部拆分；后续治理从 [业务边界](logic/BOUNDARIES.md) 与具体模块契约进入。

设计与切片依据见 [四层设计](../design/four-layer-architecture.md)，实际验证见 [开发记录](../design/development-log.md)。本地模块通过不代表全量 CI、制品、安装或发布验收通过。
