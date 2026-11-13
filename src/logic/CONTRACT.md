# Logic 业务层

Logic 拥有业务规则、服务与状态，单向组合 Core，不依赖 Bridge、View 或旧 backend。模型、Web、反馈与资源仓库服务已经迁入；其余领域规则由旧 backend/core 迁入对应业务的 rules 目录，执行身份和工作区路径归 ports。具体引擎已迁入 execution/engines，准入和引擎装配归 execution，其他编排归各业务 runtime/monitoring。宿主服务与桌面入口仍在迁移中。

公开入口按真实消费者登记在 scripts/logic-domain-entries.mjs。规则保留细粒度入口，不通过一个领域总 barrel 同时加载纯契约、运行规则和平台实现；类型依赖同样受无环检查约束。读模型、预算存储端口、引擎工具注册等较窄边界仍限制私有文件访问。

规则不导入应用服务，已有跨领域规则协作仍保留明确契约。迁移没有改变状态所有权：任务版本和原子提交、知识写入授权、运行未知结果与恢复判断仍由原模块负责。当前文件无环不代表领域聚合已经全部解耦。

模型/Web/反馈/资源的纯入口与 service 入口分开。Bridge 只暴露需要传输的类型；宿主通过公开服务入口装配，浏览器不能加载 Node/Electron。目录导航见 [类图](ARCHITECTURE.md)。

编排协作与失败恢复约束集中见 [调度契约](SCHEDULING.md)。规则不能加载运行服务；具体引擎只由 execution/assembly 选择，其他编排依赖引擎契约。公开文件登记在 scripts/logic-runtime-entries.mjs，原私有预算边界仍有效。
