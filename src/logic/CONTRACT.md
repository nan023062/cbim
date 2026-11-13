# Logic 当前迁移范围

Logic 拥有业务规则、服务和状态，单向组合共享 Core；不得依赖 Bridge、View 或旧 backend 的实现。当前模型目录、供应商连接、引擎选型及配置服务已迁入 [models](models/CONTRACT.md)，[Web 服务](web/CONTRACT.md) 也已迁入，其他业务仍在旧目录。

模型纯规则入口与有副作用的服务入口分别维护，不能通过纯入口导出存储。旧宿主仅在登记的入口装配服务；旧执行模块只能使用纯模型契约。依赖检查同时核实公开入口、运行环境与类型引用，未对旧后端开放整个 Logic。

反馈业务已迁入 feedback/index.ts 与 feedback/service/index.ts：纯输入/正文/范围和宿主授权/账本分开。反馈范围唯一实现归 Logic，旧工具日志组合其契约；Core 只提供文件、摘要、原生锁及加密端口。

资源仓库实现已迁到 src/logic/resources/service，纯定义归 src/logic/resources；旧 Main/resources 暂留与知识事务相关的连接授权和发布导入。宿主目录通过 ResourceRepositoryPaths 注入，Logic 不依赖 Main Paths 或 Bridge。
