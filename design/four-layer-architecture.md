# 四层架构与迁移落地

来源：2026-11-13 用户明确选择 Core、逻辑层、桥接层、视图层，并授权分批迁移。本文维护分层设计、当前落地和保留的边界，不作为实时待办。实际模块以 [源码契约](../src/CONTRACT.md)、[源码架构](../src/ARCHITECTURE.md) 和依赖检查器为准；历史分片及验证见 [开发记录](development-log.md)。

## 当前目录与职责

Core、Logic、Bridge、View 的源码迁移已完成。下列目录均对应实际代码，不列尚未使用的 browser/client 占位目录。

~~~text
src/
  core/
    utility/                 便携算法和实例数据结构
    contracts/               通用技术端口，如 SecretCipher
    web/                     网页纯契约与 HTML 算法
    platform/node/           摘要、文件、锁与网页读取机制
    platform/electron/       匿名浏览器读取与系统加密
  logic/
    application/             唯一业务应用生命周期与服务装配
    models/                  模型目录、供应商选型与配置
    budget/                  请求/目标预算规则、设置与编排
    execution/               运行规则、引擎、准入、装配及存储
    knowledge/               知识规则、查询、事务、存储与服务
    workspace/               工作区、模块责任与生命周期
    team/                    岗位、成员、主 Agent 设置及执行编排
    tasks/                   目标、任务、依赖及恢复编排
    dispatch/                派发契约、事务存储与调度
    resources/               仓库、共享与静态知识包
    connectors/              显式连接、授权与资料读取端口
    web/、feedback/          Web 工具业务与 GitHub 反馈业务
    updates/                 更新策略、准备、安装与恢复
    ...                      其余业务域见 Logic 导航
  bridge/
    contracts/               IPC 操作、公开数据及已登记纯规则
    server/                  桌面主入口、冷壳、IPC、CLI 与平台传输
    preload/                 Electron 固定安全桥及真实客户端
  view/                      React 页面、控制器、hooks 与视图适配
~~~

主入口是 bridge/server/main.ts；业务生命周期由 logic/application/application.ts 持有。Bridge Application 只增加 dispatch，复用原实例状态及关闭顺序，没有再建业务容器。构建继续产生原固定输出名，运行数据目录和原生会话协议未随源码目录变化。

## 依赖规则

| 使用方 | 实际允许方向及限制 |
| --- | --- |
| Core 便携能力 | 自身公开技术入口和获准第三方；不加载 Node/Electron 或三层业务 |
| Core 平台实现 | 同环境与便携 Core；Electron 可组合获准 Node 能力，不反向依赖业务 |
| Logic | Logic 公开入口及适用 Core；不依赖 Bridge/View/Electron |
| Bridge contracts | 纯协议与便携 Core；精确登记的 Logic 纯数据/规则可具名重导出，不加载服务或凭据 |
| Bridge server | contracts、Logic 公共入口和适用 Core；冷壳及更新继续受窄边界约束 |
| Bridge preload/client | contracts 与允许的便携能力；preload 是现有客户端实现 |
| View | 自身、Bridge 通信入口与便携 Core；不导入 Logic 服务或平台实现 |

类型、重导出和可识别动态加载同样纳入依赖图。旧源码层级已经退出；检查器仍保留 browser/client 的环境规则，但没有为规则完整而创建空目录。Logic 的同层许可不代表任意访问：规则不得依赖运行服务，普通服务不得反向依赖 Application，具体引擎只由 execution/assembly 选择，私有读模型和文件实现仍通过明确公开入口消费。

模型、Web、反馈和资源服务以纯 index.ts 与 service/index.ts 分开。其余域按真实消费者登记细粒度入口，未建立全域聚合导出以掩盖类型环。Core 不持有业务身份、授权、事务或全局业务状态；队列和集合由调用方逐实例持有。

## 业务与平台边界

- 模型目录和供应商接口选择归 models；主 Agent 设置归 team/settings；请求预算端口及账本规则归 budget/rules，预算编排归 budget/runtime，传输适配归 execution/engines/transport。
- 网页机制拆为 Core 纯契约、Node 读取器及 Electron 匿名渲染；Bridge 桌面在 ready 后注入读取器，Logic 不导入 Electron。WebService 负责业务校验、Brave 搜索及不可信来源标记。
- 反馈服务持有授权与提交账本，先保存发送意图再发网，未知结果只核实；共享锁只有 Core 的 KernelLock 一份实现，旧锁/错误转发入口已经删除。
- 资源仓库归 resources/service；静态包发布导入归 resources/packages；工作区连接授权归 connectors/service。三者通过明确契约协作，不能因相同 IO 而合成一个服务。
- 业务 DTO 由各 Logic 域定义；Bridge 持有通信操作、受限输入与传输。现有具名数据/纯规则重导出仍是实际兼容边界，四层目录完成不等于所有通信 DTO 已与领域模型完全分离。若移除，须同步替换同步预览和数据消费者。
- 更新服务与普通应用/调度分离，仅使用本域契约、获准便携 utility 及系统/第三方能力；Bridge 执行启动与安装意图，Application 提供业务排空回调。

## 状态与不变量

业务事实、授权、事务和恢复归 Logic；输入、展开、选择与加载状态归 View；请求关联和传输归 Bridge。跨进程公开数据不包含服务实例、原生句柄、私有路径或凭据。

目录迁移保留模型选型、字段、错误、持久化字节、取消/排空及未知写入不自动重放的语义。相同语言不证明 JSON 排序、空值或生命周期契约相同；共享算法通过显式策略组合。原知识及派发跨领域原子事务没有被目录迁移拆开，密集装配和业务内聚仍需后续按真实变化治理。

## 已完成分片与验证入口

按顺序完成：基础库整合与 Core 规则；模型、Web、反馈及资源仓库；领域规则/端口；具体引擎与编排；有状态服务及 Bridge；View 与旧层退出。各片模块测试、路径/类型核对及注释/类图维护的实际结果见开发记录，不将早期“待迁移”说明作为当前事实。

2026-11-14 针对 eaa85d9d 的 [全量 CI](https://github.com/nan023062/cbim/actions/runs/43458901536) 已通过：482 测试文件、3283 通过、0 失败、2 项依赖历史 EXE 的条件跳过；类型、架构、模块边界和官网浏览器检查通过。该结果不包含桌面打包、安装升级或发布验收，也不证明两项跳过用例通过。

后续阅读从 [Core](../src/core/CONTRACT.md)、[Logic 边界](../src/logic/BOUNDARIES.md)、[Bridge](../src/bridge/CONTRACT.md)、[View](../src/view/CONTRACT.md) 下钻。改业务应按实际影响选择模块与契约测试；纯文档核事实、引用及生成同步，不重复产品回归。
