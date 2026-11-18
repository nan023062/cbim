# Cindy 源码架构评审报告

**结论**　Cindy 的跨端界面复用和宿主适配值得 CBIM 参考。按 CBIM 对兄弟模块和脚本单向依赖的要求，所评版本在两个层级均未通过。最值得关注的是桌面主进程：调度、提醒和存储等职责之间出现反向依赖，维护者很难仅凭目录判断一项修改需要连带理解哪些业务。

本报告面向架构设计与代码评审。评审对象是 Cindy 公开仓库的固定提交，所有源码证据均指向该版本。产品体验、线上稳定性、团队交付速度需要各自的实测数据。[源码快照](https://github.com/makecindy/cindy/tree/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469)

## 一、评审依据

1. 每个文件夹视为一个模块，嵌套目录表示父子归属。子模块之间的组合或聚合，须从谁创建、持有和释放对象判断。目录结构本身只能证明源码归属。
2. 兄弟模块的依赖必须单向。若 C 的子模块 A 引用 D 的子模块 B，在 C 与 D 的共同父目录下记作 C → D。只要 D 的任一后代再引用 C 的后代，就出现 D → C，即使两次引用涉及四个不同的文件。
3. 每个脚本文件也检查依赖方向。同目录与跨目录文件采用同一规则。A → B → C → A 同样构成循环。类型导入也计入源码依赖，因为修改类型契约会影响引用方。
4. 同时检查文件图与各父目录下的兄弟模块图。文件环可以完全藏在一个目录内；两个目录也可以通过不同的文件互相依赖，即使那几条引用没有形成文件环。

## 二、架构全景

下图表示源码归属。共享包按能力概括，逐目录、逐文件的关系可查阅[交互架构图](cindy-architecture.html)。

```text
Cindy
├─ apps
│  ├─ desktop                  Electron 桌面端，含 renderer、preload、main
│  ├─ web                      复用桌面 Renderer 的浏览器适配层
│  ├─ host                     提供本机 HTTP 接口的 Node 宿主
│  ├─ mobile                   移动端页面、会话、设备连接与原生适配
│  ├─ cindy-headless           CLI 与 Harbor BaseAgent 适配入口
│  └─ android-platform-tools-bin    Android 平台工具
├─ packages                    41 个目录，含 Agent、调度、模型、设备、协议与工具
├─ scripts、tools              开发、发布、迁移、模型目录等工程工具
└─ config、i18n、docs 等       配置、语言资源与项目资料
```

**值得借鉴的边界是界面与宿主之间的契约。** 桌面端和浏览器端复用 Renderer。桌面端经 Preload 和 Electron IPC 进入主进程；浏览器适配层提供相同形状的接口，将支持的通道转发给本机 HTTP 服务。Headless 面向另一种使用方式，通过 CLI 和 Harbor 适配器复用 maker-core 与 MCP 契约，运行 Claude Code、Codex 和 Pi。对 CBIM 的参考意义在于：共用工作流可以保留一份，各宿主分别承担传输、授权与能力差异。[浏览器适配实现](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/web/shim.js) · [Headless 运行时说明](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/cindy-headless/README.md)

## 三、定量结果

| 统计项 | 兄弟目录模块 | 源码文件 |
|---|---:|---:|
| 循环依赖组 | 19 | 90 |
| 循环组内成员 | 172 | 951 |
| 直接互引对 | 236 | 167 |
| 参与循环的有向边 | 904 | 2,519 |
| 最大单组成员数 | 76 | 491 |

循环组指强连通分量，即组内任意两个成员都可以沿依赖路径相互到达。同一组可以含多条环。每对直接互引贡献两条有向边。目录与文件是对同一批源码的两种观察，两列的数字应分别解读。最大文件组的 491 个成员描述静态可达范围；启动加载量及实际改动影响还取决于执行路径和所改契约。

| 位置 | 直接互引对 | 分布与含义 |
|---|---:|---|
| 桌面主进程 main 的直接子目录 | 142 | 其中 140 对位于 76 个模块的大组，另 2 对位于独立的 3 模块组 |
| 移动端 src 的直接子目录 | 28 | 17 个模块处于同一循环组 |
| 桌面 renderer 的直接子目录 | 22 | 12 个模块处于同一循环组，components 和 features 内部另有更深层的环 |
| 全部直接互引文件对 | 167 | 119 对同目录，48 对跨目录 |

## 四、代表性源码证据

### 1. 桌面主进程的调度与提醒

agent-island 在归档确认时调用 scheduler-host 的存储入口，读取活动计划。反方向上，scheduler-host 在处理调度结果时调用 agent-island 服务，判断谁负责展示任务提醒。归档和提醒来自不同文件，上卷后构成明确的兄弟模块双向依赖。若 CBIM 遇到类似情况，可先确认“查询计划”和“决定提醒归属”分别由谁负责，再由上层装配两项能力。[归档读取计划](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/archiveConfirmation.ts#L26) · [调度查询提醒归属](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L83)

### 2. 同目录脚本的职责倒置

companion-cloud/store.ts 从 uploader.ts 导入 canonicalJson，而 uploader.ts 从 store.ts 导入读取偏好、计算存储值哈希等能力。两条都是值依赖。这里有一个范围明确的解环方案：将双方所需的确定性序列化放到本域的独立文件，保留上传层对存储层的单向使用。若实施，应验证现有序列化结果与哈希值保持兼容。[存储引用上传](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/store.ts#L14) · [上传引用存储](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/uploader.ts#L10)

### 3. 桌面组件与移动端请求层

桌面 cindy-brain 的安装确认界面引用 components 的确认框，components/chat 的动作行反过来引用 cindy-brain 的插件状态 Hook。移动端的 api/client 引用 device-link 的中继授权逻辑，而设备 API 又回引 api/client 的 ApiError。这两例提示评审者区分通用能力和具体业务策略：通用确认框、通用请求以及某一业务的状态和授权规则，各自有不同的变更原因。[确认框引用](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/ForgeOidcInstallConfirmHost.tsx#L4) · [聊天动作行](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/AgentActionRow.tsx#L99) · [中继授权](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/api/client.ts#L3) · [设备 API](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/agentNetDeviceApi.ts#L3)

### 4. 根目录与共享包呈现不同结构

在已解析的图中，apps、scripts、tools 都指向 packages；apps 与 scripts、apps 与 tools 分别双向依赖，scripts 还指向 tools。例如桌面 CI 引入根 scripts 的发布工具，而根 scripts 的迁移演示直接导入桌面主进程实现。工程脚本参与根级循环，评估产品运行时影响时应单独识别这类边。packages 的同级包间未检出循环，但 maker-core/src 内的 agents、types、interfaces、memory 处于同一循环组，其中包含类型依赖。[桌面 CI](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/scripts/ci/lib.mjs#L17) · [迁移演示](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/scripts/dev-legacy-migration-demo.mts#L22) · [内存服务装配](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/memory/host-factory.ts#L16)

## 五、对 CBIM 的参考结论

| 设计问题 | 可采用的做法 | 验收方式 |
|---|---|---|
| 多宿主如何共用业务界面？ | 让共享界面依赖明确的宿主能力契约，传输和平台差异由适配器处理 | 选择一条真实用户操作，分别追踪桌面与浏览器如何完成 |
| 模块目录划分是否有效？ | 将后代引用折算到共同父目录，再检查兄弟模块有向图 | 每一层都能给出依赖顺序；发现环时保留正反方向的源码证据 |
| 一个目录内部是否仍然耦合？ | 把脚本作为独立节点，纳入类型导入和重导出 | 对同目录和跨目录脚本执行同一无环检查 |
| 怎样判定组合、聚合？ | 追踪真实实例的创建方、持有方、注入点和销毁方 | 用一个启动、替换或退出场景说明生命周期责任 |
| 怎样确定治理优先级？ | 先看环是否穿过核心业务，再查形成环的具体职责 | 优先核实双向值调用；类型环、纯工具归属和工程脚本分别评估 |

**综合评价**　Cindy 是跨端宿主适配的参考案例，也是理解“有目录分层仍可能出现业务互依”的实例。若以 CBIM 的模块独立性为验收门槛，桌面主进程的大型循环组足以判定该项未通过。单看目录树会漏掉业务反向依赖，单看文件图又会漏掉由多个文件分别承担的模块互引。

## 六、覆盖范围与资料索引

扫描覆盖 apps、packages、scripts、tools 中筛选后的 10,702 个 JS/TS 文件，解析相对路径、桌面和移动端支持的别名、静态导入与重导出，以及可识别的字面量导入和 require。工作区包名归到包目录。725 次本地路径或别名引用未映射到扫描文件。测试、夹具、部分构建配置、原生代码、Shell、运行时计算路径、IPC 与进程间消息均在本次静态统计范围之外。这里给出的数字只对应已解析图。

- [附录 A：兄弟模块循环依赖完整清单](cindy-module-cycles.md)按父目录列出 19 组，含成员、直接互引对、全部循环边、闭合路径和源码位置。
- [附录 B：文件循环依赖完整清单](cindy-file-cycles.md)列出 90 组。每条循环边附一条最短闭合路径，同一条边可能参与更多路径组合。
- [附录 C：交互架构图](cindy-architecture.html)支持从目录下钻到文件，查看引用方和被引用方。解压参考包后可在浏览器本地打开。

