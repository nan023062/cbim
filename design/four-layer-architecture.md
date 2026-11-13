# 四层架构与渐进迁移设计

来源：2026-11-13 用户明确选择 Core、逻辑层、桥接层、视图层，并要求先建立 Core 与依赖规则。本文是目标设计与迁移规格，不是实时待办；当前事实由 src 契约、实际代码及开发记录维护。

## 目标目录

```text
src/
  core/
    utility/                通用算法、数据结构；按数据/问题类别组织
    contracts/              按真实需要沉淀通用技术端口，不放业务 DTO
    platform/
      node/                 Node 文件、摘要等机制
      browser/              浏览器环境基础实现
      electron/             Electron 专属基础实现
  logic/
    workspace/              工作区身份与生命周期
    knowledge/              知识规则、查询与事务
    tasks/                  任务、目标与调度
    team/                   岗位、成员与归属
    models/                 模型目录、供应商连接、选型与配置服务
    execution/              运行循环及引擎适配
    resources/              资源与资料业务
    updates/                更新策略、状态与安装流程
  bridge/
    contracts/              通信操作、请求/响应 DTO 与事件
    client/                 视图调用入口
    server/                 Logic 公开服务的传输适配
    preload/                Electron 固定安全桥
  view/
    components/             共享界面组件
    conversation/           对话界面与交互状态
    tasks/                  任务界面与交互状态
    settings/               设置界面与交互状态
    ...                     其余业务视图
  main.ts                   薄装配入口，不作为第五个业务层
```

目录随真实代码迁移创建，不预建空模块。逻辑业务模块以 index.ts 暴露最小服务/契约，内部按职责维护规则、服务和存储；不建立全业务共用的 services/data 大目录。Core 不持有业务身份、权限或事务。Main 的生命周期装配必须与可复用逻辑分开；迁移入口时逐项保留构建与冷壳路径，不能提前开放任意计算式加载。

## 依赖规则

| 使用方 | 目标许可 |
| --- | --- |
| Core 便携能力 | 自身公开技术能力、获准语言/第三方库；不得引用平台专用实现或其余三层 |
| Core Node/Browser/Electron | 同环境内部与便携 Core；Electron 可组合获准 Node 能力；均不得反向引用业务 |
| Logic | 自身模块公开入口及适用的 Core；不引用 Bridge/View |
| Bridge contracts | 纯通信契约与便携 Core；目标结构不引用 Logic 私有模型 |
| Bridge client | contracts 与便携/浏览器 Core；不引用 server 或 Logic |
| Bridge server | contracts、Logic 各模块 index.ts、便携/Node Core |
| View | 自身、Bridge client/contracts、便携/浏览器 Core |

类型、重导出、字面量动态加载与普通导入同样检查。新 Core 模块未登记则失败；私有实现不能从业务侧直达。旧目录的限制继续生效，不能借新 Core 放宽引擎、调度、更新子系统的 Node/files/web 访问。

Bridge 是通信边界，不是业务服务定位器。Logic 定义自己的服务和状态；Bridge server 将外部 DTO 转为服务参数、订阅业务事件再转发。Logic 不反向依赖 IPC。主入口创建 Logic 实例并连接 Bridge，业务模块不导入主入口。

## 状态与兼容

业务事实、授权、事务和恢复归 Logic；输入框、展开、选择、加载等交互状态归 View；请求关联与传输订阅归 Bridge。Core 的队列/集合是调用方拥有的实例，不构成全局事件总线或共享业务状态。

旧 backend/core 的领域协议不整体搬入 Core。相同语言不证明 JSON、错误或生命周期契约相同；合并实现前保留排序、空值、字段、取消和错误语义。IPC 名称、运行数据、原子提交和冷壳加载在相应迁移片中分别验证，不顺带改协议。

## 分片规格

1. **共享 Core 与规则。** 将原 utility 的便携实现放入 core/utility，Node 摘要独立放入 platform/node；前端 equalJson 组合共享排序且保留原策略。建立目标层、运行环境、公开入口及反向依赖回归，保留旧业务位置和规则。
2. **其余基础方案。** 核实 files/web 的平台契约，逐项迁移；Electron 适配与普通 Node 入口分别处理。前端订阅、异步代次、图算法和注入式存储按语义核实后共享，不能机械合并不同图算法或生命周期。
3. **Logic 业务边界。** 按工作区/知识/任务等实际事务与服务端口迁移规则、编排及存储，保留原原子账本和运行所有者；每片交付真实消费者与公开 index.ts，不只批量改路径。
4. **Bridge 与 View。** 将 IPC 分发与客户端从装配/页面剥离，通信 DTO 与领域模型分开；迁移视图及交互控制器，消除旧契约对 backend/core 的过渡重导出。
5. **装配与旧入口退出。** 核实构建、冷壳、运行时加载和测试夹具后迁移薄入口，清除实际零消费者的旧目录与过渡规则；完整制品验收归后续集成/发布。

每片独立测试、注释/类图/工作流同步并提交，失败时整体回退该片的路径、调用方和规则。本文的后续规格不表示已经实施；是否继续以当前用户授权及 Issues 为准。

## 第一步验证与 review 入口

独立 Core 单元、Node 摘要单元、前端 JSON 比较及直接控制器消费者、后端字节/排序/指纹/RPC 适配契约；类型检查、架构检查、测试模块检查与依赖检查器回归。无行为变化的其他业务不自动全量测试。

先读 src/core/CONTRACT.md，再读 utility 与 platform/node 契约、前端 equalJson 适配及 scripts/check-dependencies.mjs。实际命令、失败及最终结果写开发记录。当前迁移期仍保留 backend/frontend，旧 Bridge contracts 对 backend/core 的受限引用尚未退出，不能把目标四层宣称为已完成的物理结构。


## 模型首批迁移边界

按用户要求，Logic 模型首批先于其余基础方案迁移。模型规则归 logic/models/index.ts，配置存储和凭据解析归 logic/models/service/index.ts。后者是明确登记的宿主入口，旧 Main 可以装配，旧引擎/调度不能加载；规则不得反向引用 service。随本批迁移 Node files 和通用 Fault，以避免 Logic 依赖旧 backend。主 Agent 设置和请求预算暂留原位。

迁移期仅 bridge/contracts/models.ts 可具名重导出模型纯入口，其他 Bridge 文件通过该契约访问；不放宽成整个 Bridge 可引用 Logic，也不将业务规则塞进 Core。这个兼容出口保留现有同步草稿预览，后续 Bridge DTO/预览迁移需同时处理其真实消费者后退出。它是过渡事实，不是四层目标已经实现。


## Web 迁移切片

WebService、WebSettings 和工具协议归 logic/web；基础网页机制分为 Core 纯契约/正文算法、Node 抓取和 Electron 适配。SecretCipher 提升为 Core 技术端口，系统加密实现仍由宿主注入。只有旧桌面 main.ts 可引用 Electron 读取入口；旧调度器只使用 Logic 纯工具契约。bridge/contracts/web.ts 仅保留 webConfigureInput/WebSettingsView 的具名兼容导出，未来 DTO 迁移后退出。保留现有 robots、缓存、错误、取消和凭据语义；反馈与资源服务不在本片范围。

## 反馈迁移切片

反馈协议、范围、GitHub 授权与提交服务归 logic/feedback；纯 index.ts 与宿主 service/index.ts 分开。原 scope-schema 组合并重导出本域范围，避免 Logic 反向依赖工具体系。KernelLock 实现进入 core/platform/node/locking.ts，旧出口共享同一构造器以兼容工作区/资源消费者。bridge/contracts/github-feedback.ts 仅转接配置 Schema 与公开状态；旧 Main 通过服务公开入口装配，工具只能读纯契约。凭据、发送屏障、原目标核实与持久化字节保持；资源业务不在本片范围。

## 资源仓库迁移切片

边界已闭合的本地仓库、HTTP 和共享生命周期迁入 logic/resources/service；资源定义与状态归纯入口。目录通过结构端口注入。知识包与仓库授权连接需随知识业务继续迁移，当前不将未完成部分画成已迁移。

## 领域规则迁移落地

旧 backend/core 的领域规则与端口已迁入 Logic 各业务 rules/ports；JSON 错误适配与摘要兼容函数归共享 Core。按真实消费者保留细粒度公开入口，并继续执行私有读模型、规则到服务和运行环境边界检查。没有新增全域 barrel，也没有更改业务状态、事务与恢复行为。宿主服务、调度、Bridge 与 View 仍按后续分片迁移。
