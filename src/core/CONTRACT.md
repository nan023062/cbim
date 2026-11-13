# 共享 Core

Core 是四层架构的基础公共层，不含业务规则、通信操作、页面状态或应用装配。前端和后端可以组合相同公开能力；运行环境是独立约束，Node 能力不经便携入口加载。

当前真实入口为 [utility](utility/CONTRACT.md) 、[Node 摘要与文件](platform/node/CONTRACT.md) 和 errors.ts 的 Fault/fail。utility 仅使用语言/Web Streams 原语及 jsonc-parser；platform/node/digest.ts 仅使用 node:crypto。它们都不依赖 logic、bridge、view 或旧 backend/frontend，包含类型引用。跨模块仅使用已登记公开入口；新 Core 模块必须登记职责、入口及第三方依赖，否则检查失败。

前端 equalJson 是第一条双端复用路径：控制器 → 前端比较适配 → Core orderJsonValue；后端历史指纹适配也调用同一算法。比较器、字段选择、错误映射和业务接受条件仍由消费者拥有。共享实现不要求不同策略产生相同字节。

旧 backend/core 是待迁移的业务层，不属于本目录；backend/core/foundation 的 safeId、StoragePaths 和 JSON/摘要适配保留；errors.ts 为共享 Fault 的在用兼容出口。Node files 已迁入 platform/node/files，web 尚未迁移。当前 Logic 已完成模型首批，其他业务及 Bridge/View 尚未整体迁移；目标结构与分片方式见 [四层设计](../../design/four-layer-architecture.md)。

没有全局 Core 容器或统一大导出。公共函数不持有业务状态，队列/集合由调用方逐实例创建并负责关闭策略。通用入口不能经重导出或间接依赖加载 Node/Electron；业务数据、路径权限、事务和进程生命周期不因使用基础库而转移。
