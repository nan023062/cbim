/** 作用定位：按实际源码生成目录清单与现状类图，并独立附加 CONTRACT.md 的设计契约与落地范围。
 * 设计原因：让未来接口与现状结构分开维护，避免重新生成类图时丢失契约；--check 同时检查两部分漂移。 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const scope={
  "src/core/platform/node/files": "Node 单文件 I/O 基础方案：存在探测、JSON 读取、内容 fsync 后原子替换；路径权限、并发顺序和业务事务属于调用方。",
  "src/logic/models/service": "LlmProfiles 配置持久化、公开快照、受控锁内选型与延迟解密；index.ts 仅向宿主提供服务，平台加密由端口注入。",
  "src/logic/models": "模型目录、公开配置 Schema、供应商预设与引擎接口选择；index.ts 是纯公共入口，不加载 Node 或服务。配置服务位于 service，旧预算端口和主 Agent 设置不属于本片。",
  "src/logic": "Logic 业务层；当前模型目录、供应商连接、选型和配置服务已迁入，其他业务仍在旧 backend。业务状态与策略不放入共享 Core，通信和宿主装配不进入本层。",
  "src/core": "四层架构的共享基础公共层：utility 提供便携算法与数据结构，platform 隔离运行环境；不依赖业务、桥接或视图。前端比较和后端指纹适配组合相同排序实现，业务策略留在消费者。",
  "src/core/platform": "按运行环境隔离基础实现；当前 Node 提供摘要与单文件 I/O，便携 Core 不依赖平台实现。",
  "src/core/platform/node": "Node 专属摘要及文件能力分别从 digest.ts 与 files/index.ts 公开；不决定业务字段、路径权限或事务。浏览器与便携入口禁止加载本目录。",
  "src/frontend/foundations": "前端域的独立基础类库；前端业务单向组合其公开能力，不依赖页面、bridge 或后端基础库，不持有业务状态与通信权限。",
  "src/frontend/foundations/utility": "前端通用工具按类别内聚：json.ts 提供保留现有排序与空值规则的 JSON 比较，events.ts 提供实例级同步订阅集合，async.ts 提供实例异步代次标记，graphs.ts 提供前端分层，storage.ts 提供注入式 JSON 记录读写，index.ts 是公开入口。订阅按函数身份去重、通知遍历当前集合且异常原样传播；代次只判断迟到资格，业务状态、失效时机、轮询与销毁留在控制器。JSON 排序已组合共享 Core，其余能力保留原实现和生命周期。",
  "src/core/utility": "前后端共享通用算法与数据结构，按 JSON、字符串、字节、异步协调和图类别内聚。index.ts 是便携公开入口；Node 摘要归 ../platform/node/digest.ts。无业务、Node、Electron 或页面依赖；排序比较器、字段规则、生命周期和业务策略由消费者持有。",
  "src/backend/core/foundation/web": "独立网页读取方案：安全公网 HTTP、正文提取、robots/缓存/限速与可注入浏览器兜底；Node 公共入口不加载 Electron，具体 Chromium 适配有独立入口。",
  "src/backend/bootstrap": "固定冷壳入口：先验证同 C 的签名资源集合，再放行候选访问原 profile；独立选择日志、单实例、失败恢复及按需引擎下载由冷壳持有。计算式 main.js 装载保留可审计的源码依赖边。",
  "src": "当前共享 Core 已建立于 src/core，backend/frontend 仍保留原业务与视图实现，bridge 为通信边界。目标 Logic/View 尚未整体迁移；公共机制通过 Core 公开入口共享，不开放前后端业务互引。",
  "src/backend": "本机后端：core 持有领域规则和执行契约；engines 实现具体模型引擎；scheduler-engine 编排任务与装配引擎；main 管理平台、存储和应用入口；updater 独立更新。Core 不导入具体引擎或上层；目录聚合图的双向关系不等于文件循环。",
  "src/backend/core": "领域规则、存储端口和引擎无关执行机制。按预算、证据、任务、派发、知识、模型及工具职责聚合；execution/runtime 仍是执行模块内部实现，尚未解决该运行内核的依赖密度。禁止反向依赖 engines、scheduler-engine、main 或前端。",
  "src/backend/core/automation": "自动化定义、运行与执行/存储端口及纯时区日程计算，不依赖调度和桌面实现。",
  "src/backend/core/budget": "预算领域：Scope 使用量、预占/结算、模型请求规则和存储端口。规则不访问应用文件与具体传输，业务服务在 scheduler-engine/budget。",
  "src/backend/core/connectors": "链接器定义、查询与唯一身份检查；另定义 GitHub 反馈字段、公开登录状态与可信端口，纯协议不发网络请求或授予权限。",
  "src/backend/core/dispatch": "派发存储及命令端口：保持当前宽存储接口和原子性边界。只是明确接口目录，尚未拆分共享 DispatchStore；任务规则仍在 tasks，编排在 scheduler-engine/dispatch。",
  "src/backend/core/evidence": "证据领域：输出清单、产物、命令/人工/效果观察与完成报告规则。记录、有效性和业务验收分别核实；平台读取在 main/evidence，编排在 scheduler-engine/evidence。",
  "src/backend/core/execution": "引擎无关的运行契约与执行入口。runtime、capabilities 是同一执行模块的内部职责分区，不声明为已经独立解耦的子系统；状态、日志和授权语义保持原有契约。具体引擎由上层装配。 EngineRuntimeResolver 是受管引擎已验证包的窄契约；不包含下载实现、活动指针或用户凭据。",
  "src/backend/core/execution/capabilities": "执行模块内部的成员能力组合与受控工具门面。把冻结 Workflow、身份、证据和平台端口投影为可调用能力；不把工具发现或模型完成当作授权与业务验收。",
  "src/backend/core/execution/runtime": "执行模块内部运行机制：回合驱动、事件、工具协调、输出验证与计量。继续依赖领域规则与能力，迁移不拆分运行状态所有权；依赖过密仍是独立治理项。",
  "src/backend/core/file-operations": "受控文件操作和隔离执行的冻结协议、规则与恢复状态。平台副作用经端口实现，不因物理目录聚合改变授权、路径校验或证据效力。",
  "src/backend/core/foundation": "迁移期后端领域约定与适配：标识、路径、JSON Fault 和 hash/json 保留；errors.ts 为共享 Core Fault 的在用兼容出口。utility 与 Node files 已迁出，web 暂留原独立边界。",
  "src/backend/core/governance": "模块知识治理的纯协议、保护规则与有界主工具投影。可信来源、冻结意见引用与本机评价独立于正式实施，旧意见替代不改历史，不把治理记录当业务验收。",
  "src/backend/core/knowledge": "知识快照、校验、领域查询、对象变更和可移植静态包规划。私有v2计划冻结有序操作与整包替换范围，公共变更不能提供来源证明；物理事务与缓存经端口注入。团队能力可独立复用，业务模板必须完整，不携带动态成员或任务。 KnowledgeQueries 只接收 snapshot；KnowledgeRefresh 独立持有身份核实、原回执查询与提交。 read-models.ts 是固定快照读取的公开入口，snapshot 与 Team/BusinessWorkspace 模型属于同一私有实现边界；查询编排不反向进入纯快照契约。 产品反馈 Skill 只读发布两套上下文格式，不包含 GitHub 创建接口。 快照数据与只读访问是独立公共边界；索引刷新通过收窄端口调用原知识事务，不导入团队或模块查询视图。 SourceSnapshotReader 只提供知识队列外层的同版快照，调用方不得在任务事务内反向获取。 原知识工具和事务观察共用实际输入解析，纯摘要区分未查到、持久阶段及不可核实，不返回正文或私有路径。",
  "src/backend/core/knowledge/read-models": "知识只读模型边界：snapshot、team、workspace 是私有实现，只通过 index.ts 提供公开查询。类型、领域工程定义与纯基础构成允许依赖；不加载查询编排、文件存储或 SDK。",
  "src/backend/core/models": "仅保留逐请求预算窄端口；模型目录、配置契约和选型已迁至 logic/models，具体传输仍由 engines/transport 实现。",
  "src/backend/core/runtime": "应用级只读监管、真实周期白名单与独立准入契约。周期等待/结算和模型轮次分开，严格传输不补造缺失计量；游标、票据和占用不签发恢复权。",
  "src/backend/core/tasks": "任务计划、派发图、目标与等待。资料清单保留旧文件v1，新增严格v2来源并核同序与字节；快照不等于当前来源或业务验收。依赖追加核实两端及后继未领取、当前计划与真实图，完整审计验证后才放行精确新边；保留原任务/实例，领取时绑定真实结果。运行内补充以pending/accepted/rejected/unknown分开，接受与waiting共享连续输入版本，未知阻止完成。流程选择共用叶子契约，缺省与显式分开匹配，已派发选择不可改写；严格输出区分保存与交付，历史不补造授权或证据。 model-request-budget-storage 只公开请求预算状态、追加命令及准入能力，不授予其它领域写入。 正式协议将目标分配、任务、准备、模型和历史审计相互核对；岗位绑定不可重写，旧在途仅按原事实收束。 检查点显式放弃有独立严格协议与精确联合变更校验；原任务和检查点证据不可重写，纯 ACK 与后续周期释放保持可用。 原主命令核实定义八工具的有界报告；原工具结果、事务保存和业务验收分开，查询回执不能成为交付证据。 主／成员影响来源使用严格联合；观察、不可变处置和新核实／修复引用分别表达，当前文件不补造成功基线或业务验收。纯 scope-public 白名单供主工具与会话详情共用，保留安全恢复来源并隐藏原生上下文。 影响报告的可选知识事务摘要保留原工具状态并参与观察依据；旧处置缺省不补字段。 单文件操作公开协议不含正文备份；私有意图与阶段严格绑定原成员运行和原授权，补偿引用可靠 applied 与真实 before，终态不可改写。 保守产物时序包含外部写，GitHub 回执不能充当文件基线来源。",
  "src/backend/core/team": "Team、小组、Agent 和父链 Skill 视图、实例及静态角色 Session 履历契约。主实例归主会话，业务实例归周期与任务；履历按角色聚合真实通道，释放或删定义后保留，旧记录不补造实例。另含稳定工作区岗位的严格DTO、采纳快照与不可变登记规则；岗位启用不等于执行许可。 model.ts 是知识读取模块的私有实现，外部通过 knowledge/read-models 访问；岗位与执行状态契约不归读取视图所有。 负责岗位选择、冻结执行绑定、当前来源/能力/模型判定及只读分组发现均为纯契约；同角色多岗位独立。",
  "src/backend/core/tools": "工具 Schema、版本、副作用、调用决策、严格提问/答案及回执。提问按原题同序核验，取消与答案排他；during_wait只承诺结束未完成交互。结果只核唯一 JSON 快照，不用解析改写制造成功；历史可读不等于当前业务证据有效。注册、发现及用户回答不授予权限。 原生能力按 Pi/Claude Code/Codex 提供真实预检清单，Codex 由宿主执行既有文件操作，Claude 不宣称独立 ls。 GitHub 反馈使用独立 scope 和 external-write 效果；不把外部提交回执当作业务文件或知识成果。",
  "src/backend/core/tools/policy": "工具统一授权策略：read/ask/execute 决策及协议；业务写入和知识写入共用策略，不能豁免平台边界，也不等于操作系统隔离。",
  "src/backend/core/workspace": "领域工程、Module、Workflow与稳定岗位责任协议。来源代次和写前屏障由纯规则投影；内容指纹、来源身份、负责人关系分别核实。同负责人明确采纳递增关系版本，不迁移任务；旧缺省记录不补造来源。Workflow验证不自行读文件或签发业务验收。 model.ts 是知识读取模块的私有实现，外部通过 knowledge/read-models 访问；项目根定义仍为独立纯公开契约。 executionScope只收窄原权限，全模块一致冻结，预算合并取小。 主调度的负责人发现按所选模块真实分组，缺口不推测继承或默认负责者。",
  "src/backend/engines": "具体引擎适配边界：Pi、Claude、Codex 及其共享 HTTP 预算传输和原生工具加载。依赖 Core 的引擎/模型契约，由 scheduler-engine/assembly 选择并注入；不持有任务派发与应用存储。 runtime-binding 在 agentHome 固定原生会话的 E 摘要；包变化时拒绝无兼容依据的恢复，历史不删除、不自动迁移。 可组合 utility 通用入口的分帧与在途集合，不依赖其 Node 入口或其他基础方案。",
  "src/backend/engines/claude": "Claude Agent SDK 适配、内部工具门禁与真实原生会话生命周期；环境和账号归 CBIM，工具复用上层契约，不提供对外 MCP。原生工具开关只读可信能力的 disableNativeTools 策略，不认识具体业务工具槽位。 SDK 入口可由签名 E 包提供，仍限制适配器支持的版本，账号/历史目录不随缓存迁移。",
  "src/backend/engines/codex": "Codex App Server 的受管进程、双向 RPC、真实 thread/turn、Responses 代理与动态工具；固定 CLI 和私有账号目录，内置执行关闭，工具经宿主授权、预算结算及同一回执；宿主原生工具目录按可信能力的 disableNativeTools 策略收窄。 原生 EXE 与 Pi 宿主工具库分别使用可信受管包，不重新编译或借用外部客户端。",
  "src/backend/engines/pi": "Pi 协议、临时桥与运行参数；插入在原生状态查询后复核取消，发送后只凭queued回复确认，不自动重试。工具经一次性gate授权并校验结果；结构验证仅在正式成员有冻结要求及真实端口时公开。受控续执行在启动及加载原生会话后再核冻结证明，回传作为custom数据，不冒充用户授权。 范围模式只注册cbim工具，转发受限读取与隔离Node的原调用身份。 主角色提示要求未配置自定义岗位时自己执行；内置默认执行角色已退役，不能登记后绕过主会话。 受控文件工具仅在真实端口存在时安装，维持桥接容量及调用授权，工具结果和实际文件操作终态分别校验。 CLI 入口由宿主固定包解析；进程、工具门禁与会话验证保持原协议。",
  "src/backend/engines/transport": "引擎 HTTP 请求预算与计量适配。通过 Core 的 ModelRequestBudgetPort 预占、结算或记录未知结果；网络实现与稳定模型端口分离，保留各引擎错误和取消语义。",
  "src/backend/main": "Electron 入口与应用装配。显式资料导入共用应用级取消表，关闭撤销在途读取，原生选择迟到不落新会话。应用单例持有全局准入和持久策略，主/成员共享许可；工作区代际退役撤销等待，已有运行真实退出才释放。注入可信身份及证据，重启不执行历史票据或等待周期。 可信桌面提交注入本机明确操作来源，选定文件核实共用只读租约与平台端口。 member-dispatch 为请求预算注入窄 Store，底层跨领域事务继续统一持有。 正式安装版调用独立updater，主Frame固定IPC与正常排空后显式安装；启动前恢复更新重启的用户目录，开发和便携包不自动联网。 agent-history 独立组合历史服务与canonical读取，只接收工作区身份、目录和存活断言；工作区持锁初始化及排空关闭顺序保持。 工作区唯一账本装配岗位模型端口；明确拒绝旧直接业务启动，原聊天和知识治理保持独立。 原 canonical 历史端口独立装配给交接处置，不开新的模型或原生运行入口。 原命令核实只装配已打开工作区的 canonical 和唯一账本，不隐式启动、初始化或恢复。 影响服务装配已打开工作区端口，真实本机处置身份不由模型或 IPC 参数指定。 影响观察注入原知识事务窄读取端口，不向调度层开放写入或恢复方法。 装配独立文件 utility 及唯一工作区服务；原运行释放前确认物理操作排空，缺少平台能力时不装配可写工具。 11项原生操作按契约解析并配对成功值，主Frame和安装门禁先行。 startDesktop 由固定 bootstrap 调用；初始化应用目录后先加载窗口，再恢复工作区。R 启动确认同时需要页面加载完成和 React 的目录 IPC 成功。",
  "src/backend/main/assembly": "应用装配：连接 IPC、调度、运行与平台服务并管理应用生命周期。准入和工具能力在这里注入；不把装配目录当新的领域模型。 Application 可拆开初始化与恢复；主/成员工厂共用宿主的 EngineRuntimeResolver，界面与模型不能指定 E 路径。",
  "src/backend/main/automation": "自动化应用服务及文件存储：计划、执行请求与持久化属于同一应用职责，领域调度契约仍在 Core。",
  "src/backend/main/commands": "CLI 入口，复用应用和调度，不拥有第二套领域规则。",
  "src/backend/main/dispatch-storage": "当前派发图、命令、领取及任务状态的文件存储实现。保留共享事务与 DispatchStore，未按目录拆开一致性边界；这仍是依赖密集的共享实现。",
  "src/backend/main/evidence": "真实工程效果读取适配：在明确范围和版本下采集观察供证据服务使用。",
  "src/backend/main/feedback": "GitHub 反馈的登录、请求和持久化服务，公开字段与端口在 Core/connectors。",
  "src/backend/main/file-operations": "受控文件操作与隔离执行的应用服务，连接冻结授权、工作区身份与 platform 实现；不把底层完成当业务验收。 所有受控文件与删除/移动操作继续拒绝安装、用户及独立 R/E 缓存根。",
  "src/backend/main/governance": "工作区模块知识治理服务、可信桌面操作与独立主运行端口。登记保护、决定及实施只属桌面；模型仅可读取、观察、提案和核查回执；反馈来源在批准与实施前串行复核，未知不重放。",
  "src/backend/main/governance/storage": "知识治理记录的物理持久化；业务规则和不可变意见契约在 Core，应用治理服务在父目录。",
  "src/backend/main/history": "履历应用装配与文件索引。assembly.ts 连接角色/运行来源，file-store.ts 只实现 SessionHistoryStorage；文件存储不得反向依赖装配或工作区服务。",
  "src/backend/main/ipc": "应用 action 路由；等待资料独立导入/目录/取消入口不启动模型，受理只读保存快照。队列插入传递原expectedRunId，由调度拒绝缺失、过期及停止。公开准入游标读取和版本化设置，不开放许可领取/撤销。报告、核实和业务重规划保持独立；启动额度不足明确未受理，桌面发送方在 Electron 接入处核验。 人工提交参数不接受 actor，保存不启动模型；查询保留历史身份。 161项应用操作按业务组装配，request统一保留关闭/受理前错误码后解析，实际处理器受响应映射约束。 dispatch.ownerInspect 只读核原任务并返回当前观察；正式派发必须显式绑定主周期。 dispatch.commandReport 固定原工作区、主根、运行和调用，桌面与模型共用同一只读服务。 五项影响观察／处置／原回执／历史／关联入口相互分开，查询不启动新任务；保存只接受本机显式决定。 四个文件报告/补偿入口固定原调用或原命令；actor 由桌面入口注入，查询不启动文件操作，补偿不得改变目标路径或内容。",
  "src/backend/main/knowledge": "知识仓库文件、事务、缓存及对象写入实现。与 Core 的规则/存储端口单向连接，物理写入和授权语义不因目录迁移变化。",
  "src/backend/main/materials": "聊天输入、附件与引用材料的本机采集/持久化；保存的快照不自动证明当前来源有效。",
  "src/backend/main/models": "仅保留主 Agent 设置及工作区 revision 校验；模型配置服务已迁至 logic/models/service，通过其公开入口使用配置短锁。",
  "src/backend/main/platform": "平台实现按职责分区：isolation 处理受限进程及恢复，files 处理受控文件操作；锁、网络等其他平台能力仍在本层。不是一个业务领域。 Paths 拒绝更新资源/引擎缓存及其别名作为业务工程。",
  "src/backend/main/platform/files": "受控文件平台：主进程传输、utility 子进程、Win32 文件实现及结果协议。打包产物仍在原输出位置，__dirname 相邻子进程入口约定不变。",
  "src/backend/main/platform/isolation": "隔离执行平台：Win32/Job/LPAC、冻结输入、执行结果和恢复核实。权限和资源释放语义保持原有实现；目录整理不声称修复历史隔离恢复竞争。",
  "src/backend/main/registry": "岗位、来源与责任登记的应用服务；协调知识、文件实现和 Core 的规则，不拥有正式运行准入。",
  "src/backend/main/resources": "链接器、人才和完整业务模板共用的本地/远端资源仓库。静态资料单次HTTP捕获前后核授权与共享代际，正文快照不安装执行。静态发布与导入同时核对源仓库和目标知识版本，显式提交复用知识事务；资源定义不等于可执行工具。 GitHub 反馈采用独立直连服务，设备授权和原提交账本由本机管理；固定目标、跨会话去重、未知只核实，成功不回传 Issue 链接或开发进度。 本地资源库不能指向签名程序缓存，避免数据编辑入口改变受管代码。",
  "src/backend/main/run-storage": "运行日志、运行内输入和游标文件实现；按 RunStorage 等 Core 端口提供持久化，保留追加、未知和恢复语义。",
  "src/backend/main/settings": "应用设置及命名文件存储；与模型配置、派发、运行及知识持久化分开定位。",
  "src/backend/main/web": "CBIM 网页工具的业务适配，组合 backend/core/foundation/web 并添加来源不可信标记；独立处理 Brave 搜索配置与节流，不持有浏览器或 HTTP 实现。",
  "src/backend/main/workspace": "本机工作区、静态编辑与受控来源协调。获取工作区锁后在唯一DispatchStore核身份、恢复知识和来源，再发布服务。岗位和负责人以同知识快照明确采纳；首次真实观察与消费者同事务保存。来源、能力、模型分别展示，不以登记回执启动实例或改写旧任务。 负责岗位和模块责任只读发现供实际主工具调用；当前配置观察与历史执行事实分开。 原知识事务适配复用现有串行 journal 核验，固定计划与旧实例只读；不提交、刷新、恢复或修剪目录。 ControlledFiles 连接原成员授权、唯一 Store、文件平台与私有备份；原not_applied与真实退出才解除运行屏障，显式补偿重新核文件身份/摘要/关闭周期，未知不重试。",
  "src/backend/scheduler-engine": "工作区调度。装配团队上下文与模型工具，协调会话、运行、用户问题和队列；只依赖自身及 Core。",
  "src/backend/scheduler-engine/admission": "运行准入的票据与运行注册，保持可信入口、占用与释放语义；与业务验收分离。",
  "src/backend/scheduler-engine/assembly": "引擎装配：loop-engine 将实际 Pi/Claude/Codex、模型预算及工具能力接入 Core 运行循环。这里有意认识具体实现；高密度装配依赖仍需独立评审。 主/成员运行按可信端口准备 E，并用 pinRuntimeEngine 固定历史兼容边界；可执行路径不来自公开运行选项。",
  "src/backend/scheduler-engine/automation": "串行版本配置、持久启动意图与定时调度；同项不重叠，重开跳过过期，不重放未知运行。",
  "src/backend/scheduler-engine/budget": "预算应用服务：协调请求和目标预算预占/结算，通过明确存储端口保存结果；不直接访问共享派发 Store。",
  "src/backend/scheduler-engine/context": "内置主角色诊断和治理知识，执行者冻结角色/Skill、模块/岗位责任、Workflow与规范。显式流程只从本模块挂载清单解析，准备按任务原选择重核，不回退默认或刷新旧绑定；前置替换保留原实例和流程；两种模式的主会话都可直接执行未配置自定义岗位的模块，不把主 Agent 派成独立成员。 team-workflow 只向知识查询转发 snapshot，查询不取得工作区写能力。 team-workflow 调用 Core KnowledgeQueries，后者只取快照读取端口并组合 Team/BusinessWorkspace；跨查询一致性由准备用例核版本，索引写入留在知识领域。 执行上下文同时冻结负责岗位、项目适配、采纳能力与模型身份，主模型不会替换成员配置。",
  "src/backend/scheduler-engine/conversation": "主会话执行管理，连接执行循环、输入和运行视图；正式成员调度在 members。",
  "src/backend/scheduler-engine/dispatch": "派发编排：任务状态、领取、图依赖与应用命令通过 Core 的派发端口写入；共享 Store 尚未拆分。",
  "src/backend/scheduler-engine/evidence": "证据编排：收集、核实和提交产物/输出/效果/人工证据，消费 Core 的证据规则及存储端口。",
  "src/backend/scheduler-engine/goals": "目标周期、等待、续执行、恢复与重计划编排。ScopeGoalService 的跨域依赖仍在，目录迁移不冒充职责重构。",
  "src/backend/scheduler-engine/history": "会话履历查询编排，依赖 Core 履历契约，实际文件索引在 main/history。",
  "src/backend/scheduler-engine/members": "正式成员执行、自动协作与检查点服务；按冻结任务/Workflow 建立真实运行，保留取消、等待与证据绑定。",
  "src/backend/scheduler-engine/runtime": "监管、履历与全局并发准入职责分离。可靠提交同步周期白名单，scope-only 更新独立游标，未变投影不重复发布；检查点计待办而不占活动名额，报告用量不授予额度或恢复权。",
  "src/backend/scheduler-engine/tools": "把知识、主调度及实际装配的用户交互注册为 cbim_ 工具。新增前置追加与已有主调度工具共用固定运行身份、原命令映射和严格单次编码输出，回执只证明保存；坏回包先核实原记录。QuestionTools冻结原题，严格核验答案或取消，坏回包不重问；维护和问答回执不算业务证据，执行者不获得调度权。 知识查询和事务刷新分别注入最小读/写端口，写权限及原请求版本检查保持。 负责人发现和计划/派发选择共享严格协议，固定主运行身份，历史回执不签发新领取许可。 主工具显式放弃原检查点/预约，绑定原 run/call 命令，坏回包只核实原事实，不取得业务完成资格。 主 Agent 可按明确原 run/call 查询控制面事务；可信闭包固定工作区和根，读取本身无写命令且不触发成员执行。 知识提交和对象提交的执行参数与历史核实使用同一解析定义，权限及当前实例核验仍在实际执行入口。 FeedbackTools 只在桌面主会话实际连接后注册；严格解析反馈字段，未知只核实原提交，不能让模型改投目标或提供凭据。",
  "src/backend/updater": "独立桌面更新子系统：公开 Release 读取、稳定版本筛选、后台预下载与用户确认重启的状态机和 NSIS 适配均在此目录。只依赖公开更新契约及系统/第三方库，不导入 main、scheduler-engine 或 core/runtime；仅明确安装时通过关闭回调等待主程序排空。安装包缓存独立于运行数据。 C/R 复用一个准备和显式应用状态机；Ed25519 清单、完整 ZIP 文件集合、不可变包缓存和激活日志属于冷壳可信机制。候选一旦接触数据，失败只能恢复，不能自动降级。",
  "src/bridge": "前后端通信边界：contracts 声明公开数据，preload 提供 Electron 安全桥。契约可重导出 Core 公开类型和纯函数，不暴露后端服务、凭据和存储实现。",
  "src/bridge/contracts": "可序列化 IPC 与展示契约；多来源附件只传选择身份，公开旧v1/新v2清单与真实仓库目录，不暴露凭据。图增量公开前置追加/替换审计而非执行许可，目标摘要公开运行内补充计数与未核实状态，详情保留已接收快照，纯协议不携IO。排队插入必须传用户点击时的原主run，缺失不推测当前轮次。检查点私有恢复证明留在后端；结构验证公开当时文件/规则指纹及无原值诊断，人工决定与文件观察保留真实依据。岗位IPC只传明确选择与公开采纳/回执，类型不带凭据或后端哈希IO。 桌面更新只公开版本、日志、阶段和进度，不传安装路径或任意命令。 ipc-call 用联合元组关联全部172项操作（含1项退役拒绝）；分组契约共享请求Schema与响应，纯workspace-view避免类型循环。 owner-execution 公开原岗位绑定与显式当前观察；按任务修订核对身份，不公开解密配置。 公开检查点放弃审计和请求/回执纯契约，不向渲染进程授予主调度处置身份。 command-verification 只导出严格公共报告和八工具支持矩阵，隐藏原事务和执行准备信息。 effect-observation 只公开来源联合及严格公共 DTO，恢复／重规划保留旧协议并显式绑定新处置，不暴露正文备份或原生上下文。 controlled-files 仅导出公开纯协议与限制，隐藏 blob、原生文件身份、句柄和后端规则。",
  "src/bridge/preload": "固定 Electron IPC 桥；不向页面暴露 Node、凭据或任意磁盘 API。 实现关联调用签名并沿原信封转发，不重试错误或改变主Frame授权。",
  "src/frontend": "React 桌面界面。业务消费通信 contracts、自身组件及前端 foundations 的公开入口；前端基础库不反向引用页面或通信契约，不依赖后端公共库、调度或主进程实现。",
  "src/frontend/automation": "当前工作区自动化列表、配置和运行历史；固定页签不接自选工作目录，真实运行通过原会话定位。",
  "src/frontend/components": "通用展示组件，不持有领域服务与运行状态。 EngineModelPicker 固定三引擎目录，按协议筛选统一模型，空目录仍可选择引擎。",
  "src/frontend/conversation": "中央主对话、目标摘要、输入、附件及队列；附件区明确显示目录清单、URL指针、网页摘录与仓库静态资料。两处插入口冻结原run，入队成功保留事实，停止锁独立于插入等待。进程准入等待与持久用户等待分别展示，纯等待不累计工作时长；未受理保留草稿。核实与重规划权限分离，可续聊头由后端核实。 双视图共享人工决定控制器，保存意见不清除聊天草稿或消费等待。 主对话栏读写工作区主 Agent 的统一执行配置，与团队配置页双向同步；模型按协议映射，Claude Code/Codex 只保留排队。 加号菜单分别请求 BUG 反馈和需求许愿 Skill，按原会话发送或排队，保留已有草稿及附件。 tasks/ToolActivity 在业务装配层组合原命令核实、影响观察及恢复；公共消息/状态已迁到 execution-view，队列操作名限制为实际四项。 目标摘要可跳转本周期原任务或替代成果，沿已有任务详情导航，不改草稿、附件或执行状态。 原工具记录显式核实保存事实，保留原失败；控制器按四重身份隔离迟到响应，轮询不重复读取，失败保留旧报告并提示时效。 主调用提供显式影响观察；未知不再凭勾选调用 ID 直接续跑，进入独立只读核实，普通草稿不受影响。 当前工作区实例传入成员详情用于补偿预览时效，主聊天草稿不受补偿控制器影响，挂载不触发文件读取或写入。 可信 GitHub submitted 工具回执之后隐藏追加结果文字；失败、未知及后续普通用户输入仍正常显示。 发送捕获原任务/运行，审批使用原审批任务；动态队列按操作解析。",
  "src/frontend/diagnostics": "只读展示工作区运行状态和知识校验问题，不把工作区就绪视为知识校验通过。",
  "src/frontend/execution-view": "主对话、成员任务和团队履历共用的消息、工具轨道、状态、问答及输入展示。只依赖公开通信契约和通用组件；查询、恢复和处置控制器由页面组合，不反向依赖 conversation、tasks 或 team。主对话、成员与历史共用的消息、工具轨道及运行状态；只消费公开快照和最小展示插槽，不依赖任务或会话控制器。原核实与恢复由页面显式组合，Markdown 的用户链接点击继续通过固定 Bridge。",
  "src/frontend/governance": "静态业务模块的知识治理面板。展示真实来源、精确差异、补证/异议与回应评价。审阅绑定来源版本，未评价不补造理解，人工决定与实施分开；原命令先保存再发送，未知只查询。 IPC 名称从冻结的治理动作形成有限联合，保留原命令未知查询。 操作联合与表单请求经对应Schema配对，原命令回执控制器不变。",
  "src/frontend/knowledge": "知识问题、预览提交、静态表单与共用来源说明。展示当前、退役、待采纳及待核实状态，不从路径或正文相同猜来源连续；来源组件无提交副作用。固定编辑基线，不要求真人维护声明，业务架构展示位于workspace。 Agent 编辑可保存本机默认引擎/模型，已有岗位不自动采纳。 动态架构表单先按对应IPC Schema核实；本地数据选择为封闭类别。",
  "src/frontend/resources": "统一资源仓库的查看、编辑、静态包发布与下载应用。人才按团队/Agent/Skill复用，业务按整套架构应用；工作区身份及预览版本固定。设置通过统一入口打开。 连接操作名使用持久命令的动作联合，提交、未知与核实流程保持。 连接提交与回执查询按具体Schema形成操作元组。",
  "src/frontend/runtime": "全局只读运行管理。分别呈现目标周期、人员、任务、准入等待和已报告消耗；单次在途游标读取保留未变行，隐藏时退订，按真实身份定位既有会话而不执行任务。",
  "src/frontend/settings": "模型、资源仓库、GitHub 反馈连接、并发及新目标软限额配置。GitHub 采用 Device Flow，页面仅持公开 Client ID 与短期授权码；资源服务器账号仍为占位。并发实时状态不覆盖草稿；软限额默认关闭，显式保存与新周期生效相区分，失败保留输入且不盲目重试。 反馈预置公开产品连接；版本更新由侧栏图标与独立详情呈现，设置表单不因查看日志而卸载。 预算和反馈的动态入口验证操作请求；开启/停止共享各自使用确定签名。",
  "src/frontend/shell": "工作区侧栏、会话选择、用户栏与右侧扩展页签；会话区与项目级视图区分开。向会话传递活动页签状态，隐藏页签保留草稿/节点选择并降低成员与任务图同步频率。 用户栏更新图标显示版本和进度，仅就绪后显式安装；新版提醒打开详情，原页面与草稿保持挂载。 导航的操作桥按明确请求Schema解析，坏历史记录不能当完整运行。",
  "src/frontend/tasks": "主会话任务图、目标与准入状态；依赖追加/替换只读历史核对身份和节点修订，摘要按实际版本选择最新，图沿真实启用边排列，不补造结果。运行内补充按真实接收记录显示，未知优先旧审阅，同版摘要/详情核对后增量呈现。根停止使用独立在途标记，插入等待不锁住停止按钮。等待补充共享多来源草稿与导入锁，原等待选择代次阻止迟到导入；明确目录/链接/网页/授权仓库来源，普通聊天草稿独立。流程、验证、检查点、基线、人工决定与用量保留各自冻结身份和证据，不把历史当当前验收。 任务根和成员正文显式注入业务详情插槽，共用 execution-view 展示；资料准备与成员交互端口只列实际 IPC 操作。 成员卡片、节点详情和目标分配展示原岗位及模型；手动核实当前配置独立显示差异，迟到响应按原任务/修订隔离。 主对话、图和详情区分显式交接放弃与普通封存，保留原岗位和运行；审阅中的原/新任务仅按同周期真实节点导航。 成员详情可选择原调用并显式观察；处置先保存本机稳定请求，丢回包只查原命令。历史选择与后续关系按同一处置展示，迟到读取不覆盖其他来源；各面板共享根会话时效，PublicDispatchScope 真实提供新核实和修复来源，沿既有资格创建。 同一影响面板分别显示原工具失败和原知识事务阶段，明确处置继续绑定原观察，查询不取得写权限。 原调用卡分别显示工具/文件操作/补偿结果；显式预览读取当前文件，提交前保存固定本机请求，丢回复只查原命令；查询错误保留已知拒绝/终态，预览过期不能提交。 任务详情与续接动态端口按操作解析后进入关联桥，状态所有权不变。",
  "src/frontend/team": "工作区唯一的静态Team/组/Agent图、继承与人才复用，节点按Session查看只读履历。岗位面板独立登记、明确采纳和暂停退休；改名和模型更新保留原能力来源。来源屏障首次拒绝可重新编辑，未知仍查原命令；反查责任委托workspace，不启动模型。 岗位登记支持默认或明确引擎/模型，详情展示冻结引擎。 历史查询按操作关联请求和响应，分页状态与原迟到隔离保持；Markdown 复用 execution-view。 当前岗位启用不是运行许可，真正执行还核模块责任和原计划；编辑不会搬运历史。",
  "src/frontend/updates": "侧栏更新图标、C/R 版本 tooltip、应用及独立引擎准备进度与更新详情。共享窗口级本机更新快照；仅 C/R 就绪时点击安装，E 下载不授予安装资格，详情保留原页面与草稿。只依赖公开 IPC，不导入后端更新实现。",
  "src/frontend/workspace": "工作区唯一的工程/模块图及自身Workflow。负责人面板展示来源和有界历史，支持同负责人明确采纳当前来源；原回执必须匹配同一关系、版本及owner，未知不换命令。知识编辑和整架构复用委托knowledge/resources；登记不移交旧任务。 一级负责人读取/预览只使用有限 InlineOwnerCall 操作，写入仍由独立命令控制器持有。 关联任务包含新旧协议节点，负责人变更不移交旧任务；实际领取重核原版本。 模块责任按是否给定memberId选择明确入口，内联岗位表单经过Schema配对。"
};
const norm=p=>p.replaceAll('\\','/');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
const files=walk('src').filter(f=>/\.(tsx?|jsx?|mjs|cjs|css)$/.test(f));
const directories=[...new Set(files.flatMap(f=>{const a=[];let d=path.posix.dirname(f);while(d==='src'||d.startsWith('src/')){a.push(d);if(d==='src')break;d=path.posix.dirname(d)}return a}))].sort();
const text=new Map(files.map(f=>[f,fs.readFileSync(f,'utf8')]));
const ast=new Map(files.filter(f=>!f.endsWith('.css')).map(f=>[f,ts.createSourceFile(f,text.get(f),ts.ScriptTarget.Latest,true)]));
function imports(f){const s=ast.get(f);if(!s)return [];const out=[];const visit=n=>{if(ts.isStringLiteral(n)&&n.text.startsWith('.')){const p=n.parent;if(ts.isImportDeclaration(p)||ts.isExportDeclaration(p)||(ts.isLiteralTypeNode(p)&&ts.isImportTypeNode(p.parent))){const t=norm(path.normalize(path.join(path.dirname(f),n.text)));const resolved=[t,t+'.ts',t+'.tsx',t+'/index.ts'].find(x=>text.has(x));if(resolved)out.push(resolved)}}ts.forEachChild(n,visit)};visit(s);return [...new Set(out)]}
const deps=new Map(files.map(f=>[f,imports(f)]));
const id=s=>'N_'+s.replace(/[^a-zA-Z0-9_]/g,'_');
const link=(from,to)=>norm(path.relative(from,to));
const clean=s=>s.replace(/[<>"{}|\r\n]/g,' ').slice(0,95);
function role(f){return text.get(f).match(/作用定位：([^\r\n]+)/)?.[1]?.trim()||(f.endsWith('.css')?'对应界面的布局与视觉样式。':'源码入口，见文件正文。')}
function node(f,label=path.posix.basename(f),directory=false,entries=[]){return `class ${id(f)}["${clean(label)}"] {\n  <<${directory?'directory':f.endsWith('.tsx')?'component':f.endsWith('.css')?'stylesheet':'module'}>>\n${entries.length?entries.join('\n')+'\n':''}}`}
function declarations(f){const a=ast.get(f);return a?a.statements.filter(n=>(ts.isClassDeclaration(n)||ts.isInterfaceDeclaration(n)||ts.isTypeAliasDeclaration(n))&&n.name):[]}
const chunks=(values,size)=>Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size));
/** 类型别名只展开本地声明的对象字段；引用和联合分支不伪装成无条件拥有的成员。 */
function objectMembers(type){
 if(ts.isTypeLiteralNode(type))return [...type.members];
 if(ts.isParenthesizedTypeNode(type))return objectMembers(type.type);
 return ts.isIntersectionTypeNode(type)?type.types.flatMap(objectMembers):[];
}
function members(n,a){
 const declared=ts.isTypeAliasDeclaration(n)?objectMembers(n.type):[...(n.members||[])];
 const properties=declared.filter(ts.isConstructorDeclaration).flatMap(c=>c.parameters.filter(p=>p.modifiers?.some(m=>[ts.SyntaxKind.PublicKeyword,ts.SyntaxKind.PrivateKeyword,ts.SyntaxKind.ProtectedKeyword,ts.SyntaxKind.ReadonlyKeyword].includes(m.kind))));
 const visibility=m=>m.modifiers?.some(x=>x.kind===ts.SyntaxKind.PrivateKeyword)?'-':m.modifiers?.some(x=>x.kind===ts.SyntaxKind.ProtectedKeyword)?'#':'+';
 // 公开入口先展示，后续分段保留其余成员；不能用私有字段占满固定名额后截掉生命周期接口。
 return [...new Set([...properties,...declared.filter(m=>m.name&&!ts.isPrivateIdentifier(m.name))]
  .sort((a,b)=>Number(visibility(a)!=='+')-Number(visibility(b)!=='+'))
  .map(m=>`  ${visibility(m)}${clean(m.name.getText(a))}${ts.isMethodDeclaration(m)||ts.isMethodSignature(m)?'()':''}`))];
}
/** 模块公开函数单独成图，文件同时声明接口或类型时也不丢失入口。 */
function exportedFunctions(f){
 const entries=[];
 for(const statement of ast.get(f)?.statements||[]){
  if(!statement.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))continue;
  if(ts.isFunctionDeclaration(statement))entries.push(`  +${clean(statement.name?.text||'default')}()`);
  else if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){
   if(ts.isIdentifier(declaration.name)&&declaration.initializer&&(ts.isArrowFunction(declaration.initializer)||ts.isFunctionExpression(declaration.initializer)))entries.push(`  +${clean(declaration.name.text)}()`);
  }
 }
 return [...new Set(entries)];
}
function functionDiagrams(f){
 const groups=chunks(exportedFunctions(f),12);
 return groups.map((group,index)=>(groups.length>1?`公开入口 ${index+1}/${groups.length}（同一模块）。\n\n`:'')+diagram([node(f,undefined,false,group)])+'\n').join('');
}
function heritage(f,n,key,decl,a,visible){
 const lines=[];
 for(const h of n.heritageClauses||[])for(const t of h.types){
  const name=t.expression.getText(a),parent=decl.find(x=>x.name.text===name);
  const target=parent?id(f+'_'+parent.name.text):id(f+'_external_'+name);
  if(!parent)lines.push(`class ${target}["${clean(name)} (外部契约)"] {\n  <<external>>\n}`);
  // 分图不改变声明归属：同文件的父接口在另一段时，仍以同一节点表示其边界。
  else if(!visible.includes(parent)){const kind=ts.isInterfaceDeclaration(parent)?'interface':ts.isTypeAliasDeclaration(parent)?'type':null;lines.push(`class ${target}["${parent.name.text}"] {\n${kind?'  <<'+kind+'>>\n':''}}`)}
  lines.push(`${target} <|${h.token===ts.SyntaxKind.ImplementsKeyword?'..':'--'} ${key}`);
 }
 return lines;
}
function diagram(lines){return '```mermaid\nclassDiagram\n'+lines.join('\n')+'\n```\n'}
let changed=[];
for(const d of directories){
 const own=files.filter(f=>path.posix.dirname(f)===d),children=directories.filter(c=>path.posix.dirname(c)===d);
 if(!scope[d])throw Error('需要先审视新目录职责：'+d);
 let out=`# ${d} 架构\n\n## 目录定位\n\n${scope[d]}\n\n本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](${link(d,'scripts/source-architecture.mjs')}) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。\n\n## 代码清单\n\n`;
 out+=own.length?'| 文件 | 当前职责 |\n| --- | --- |\n'+own.map(f=>`| [${path.posix.basename(f)}](${path.posix.basename(f)}) | ${role(f).replaceAll('|','／')} |`).join('\n')+'\n':'本层无直接代码文件。\n';
 out+='\n## 架构类图\n\n';
 if(children.length){
  const boundaries=[...children,...own];
  const owner=f=>own.includes(f)?f:children.find(c=>f.startsWith(c+'/'));
  const edges=new Set();for(const f of files.filter(f=>f.startsWith(d+'/'))){const a=owner(f);for(const dep of deps.get(f)||[]){const b=owner(dep);if(a&&b&&a!==b)edges.add(`${id(a)} ..> ${id(b)} : 导入依赖`)}}
  // 分组展示较大的目录边界，跨组关系另列，避免缩成不可读的大图。
  for(let i=0;i<boundaries.length;i+=6){const group=boundaries.slice(i,i+6),ids=new Set(group.map(id));out+=diagram([...group.map(f=>node(f,path.posix.basename(f)+(children.includes(f)?'/':''),children.includes(f))),...[...edges].filter(e=>{const [a,,b]=e.split(' ');return ids.has(a)&&ids.has(b)})])+'\n'}
  out+='各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：\n\n';
  out+=[...edges].map(e=>{const [a,,b]=e.split(' ');const f=boundaries.find(f=>id(f)===a),t=boundaries.find(f=>id(f)===b);return `- \`${path.posix.basename(f)}\` → \`${path.posix.basename(t)}\`：导入。`}).join('\n')||'本层无目录间直接导入关系。';out+='\n';
  for(const f of own){const functions=functionDiagrams(f);if(functions)out+=`\n### ${path.posix.basename(f)} 公开入口\n\n`+functions}
 }else{
  for(const f of own){out+=`### ${path.posix.basename(f)}\n\n`;const a=ast.get(f),decl=declarations(f);
   const functions=functionDiagrams(f);out+=functions;
   if(!decl.length&&!functions)out+=diagram([node(f)]);
   for(const group of chunks(decl,4)){
    const memberGroups=group.map(n=>{const parts=chunks(members(n,a),16);return parts.length?parts:[[]]});
    const count=Math.max(...memberGroups.map(parts=>parts.length));
    for(let section=0;section<count;section++){
     if(count>1)out+=`成员 ${section+1}/${count}（同名节点为同一声明，跨图合并阅读）。\n\n`;
     const lines=[node(f)];
     const visible=group.filter((_,index)=>memberGroups[index][section]);
     group.forEach((n,index)=>{const part=memberGroups[index][section];if(!part)return;const key=id(f+'_'+n.name.text),kind=ts.isClassDeclaration(n)?null:ts.isInterfaceDeclaration(n)?'interface':'type';lines.push(`class ${key}["${n.name.text}"] {\n${kind?'  <<'+kind+'>>\n':''}${part.join('\n')}\n}`);lines.push(`${id(f)} ..> ${key} : 声明`);lines.push(...heritage(f,n,key,decl,a,visible))});
     out+=diagram(lines)+'\n';
    }
   }
   const references=deps.get(f)||[];if(references.length)out+='直接依赖：'+references.map(t=>`[${link(d,t)}](${link(d,t)})`).join('、')+'。\n';
   out+='\n';
  }
  const edges=[];for(const f of own)for(const t of deps.get(f)||[])if(own.includes(t))edges.push([f,t]);
  if(edges.length){out+='### 本目录调用边界\n\n';for(let i=0;i<edges.length;i+=4){const group=edges.slice(i,i+4),nodes=[...new Set(group.flat())];out+=diagram([...nodes.map(f=>node(f)),...group.map(([f,t])=>`${id(f)} ..> ${id(t)} : 导入依赖`)])+'\n'}}
 }
 out+='\n## 子目录导航\n\n'+(children.length?children.map(c=>`- [${path.posix.basename(c)}/](${path.posix.basename(c)}/ARCHITECTURE.md)：${scope[c]}`).join('\n'):'无子目录。')+'\n';
 if(d!=='src')out+='\n[返回上层](../ARCHITECTURE.md)。\n';
 out+='\n每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。\n';
 const contract=d+'/CONTRACT.md';
 if(fs.existsSync(contract))out+='\n## 设计契约 v1 与落地范围\n\n以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。\n\n'+fs.readFileSync(contract,'utf8').trim()+'\n';
 const target=d+'/ARCHITECTURE.md';if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==out){changed.push(target);if(!process.argv.includes('--check'))fs.writeFileSync(target,out)}
}
console.log(`${directories.length} 个目录，${files.length} 个代码/样式文件；${changed.length} 份架构文档${process.argv.includes('--check')?'存在差异':'已更新'}。`);
if(process.argv.includes('--check')&&changed.length)process.exitCode=1;
