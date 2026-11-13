# 当前架构与迁移边界

已建立共享 core：便携 utility 与独立 Node 摘要。旧 backend 暂承载后端业务，frontend 暂承载视图，bridge 保持原通信实现；尚未整体改名为 logic/view。

Core 不依赖其余层，前后端通过公开入口共享同一技术契约。平台依赖按环境隔离，View/前端不允许 Node/Electron。旧 backend/core 是领域规则与执行机制，不等同于共享 core。

目标四层和后续切片见 [四层架构设计](../design/four-layer-architecture.md)，实际 Core 边界见 [Core 契约](core/CONTRACT.md)。新目标目录的依赖规则已启用；旧目录保留细粒度限制，尤其 Bridge 现有纯领域契约重导出是迁移期结构，不宣称目标已全部实现。
