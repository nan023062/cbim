## 2026-11-14：切片 2c——生成/向量逐角色预算

- 基线 59366dc7。预算角色从完整冻结执行快照派生；primary 保留旧形状，额外角色同时保存角色配置 hash 与完整绑定 hash，成员 Store 审计逐字段核容量、身份、价格。向量只有输入容量、维度与输入价格，不假造输出上限；请求 maxOutputTokens=0 仅对向量合法。旧生成账本不补字段、不重算历史。
- 同周期全部角色共享原准入、可靠阶段和未知停止屏障；向量不得报告输出/缓存用量。请求结果未知或结算不可验证时保留预留，重开不释放或重试。生成 SSE 传输明确拒绝向量操作；向量 HTTP 的实际消费留在记忆引擎切片，预算服务不联网。
- 按受影响规则、服务、传输和原周期消费者运行 pnpm exec vitest run tests/unit/logic/budget/model-role-rules.test.ts tests/unit/logic/budget/model-role-service.test.ts tests/model-request-budget.test.ts tests/model-request-budget-transport.test.ts tests/model-request-budget-usage.test.ts tests/request-budget-ports.test.ts tests/scope-usage-service.test.ts --reporter=dot：7 文件 43/43。覆盖角色价格伪造、完整绑定切换、向量计量、跨角色未知屏障与重开未决。
- 新公开规则只加入预算服务原精确依赖白名单；服务改为消费无凭据公开预算配置，不依赖引擎服务。检查器 168 个用例先通过，仓库审计发现残留类型 import 后修正并单跑该用例通过（总 169）。最终 pnpm typecheck、pnpm check:test-modules（500 文件，151/155/194）、pnpm check:architecture（1530 文件，7418 依赖，0 循环/违规）通过。同步 budget/rules、budget/runtime、transport 的注释、契约和类图；未跑全仓、SDK、桌面或发布验收。

## 2026-11-14：切片 2b——Agent V2 角色引用与完整执行快照

- 延续用户“依次实施后面的步骤”授权，基线 8cb0d5f7；本步仍在独立工作树开发，未动原 develop 发布资料。primary 保持原字段唯一事实，V2 modelRoles 只保存额外角色；官方声明控制必填、操作类型和型号范围，不允许用户注册角色或覆盖 primary。
- EngineModelProfiles 用同一模型短锁捕获全部角色，公开预览修改不能污染实际解密结果；回调结束缓存失效。Agent 设置、岗位采纳、自动兜底、队列、续接、恢复与主对话完整传递角色，公开快照不含凭据。历史字段和指纹不回填。当前代码引擎无额外角色，编辑 UI/向量 IO/逐角色预算留在后续切片。
- 验证选择依据为新增纯角色规则、配置锁、主设置、岗位及直接消息/执行消费者。执行 pnpm exec vitest run tests/unit/logic/engines/model-roles.test.ts tests/engine-configuration.test.ts tests/main-agent-settings.test.ts tests/workspace-member-service.test.ts tests/workspace-member-core.test.ts tests/owner-execution-service.test.ts tests/member-execution.test.ts tests/message-queue.test.ts tests/scope-continuation.test.ts --reporter=dot：83/83。新增岗位 V2 真事务回归发现 Store 仍把角色变化当同一引用，补齐注册、修改、刷新审计中的角色核对；重跑 workspace-member-service/core 两套 27/27（合计 84 个不同用例）。
- pnpm typecheck、pnpm check:test-modules（498 文件，149/155/194）、pnpm check:architecture（1527 文件、7404 依赖、0 违规/循环）及 diff 空白检查通过。首次架构检查的服务私有入口已改为公开导出。同步所有受影响源码注释、目录类图和契约；模型快照归模型模块，角色政策归引擎，岗位状态归 Team。未跑全仓、真实模型、桌面安装或公开 CI；继续第 2 步预算与后续包边界。

## 2026-11-14：切片 2a——向量模型能力与跨角色原子准备

- 用户明确授权依次实施后续步骤；复核独立工作树 1891ce1a 与开放 Issues（仍只有无关 #65），继续在 refactor/engine-model-catalog 推进，未改原 develop 的发布/官网收尾资料。为使第 2 步可逐段 review，先交付模型操作边界，再接 Agent V2 与预算。
- 生成配置与向量配置分开：embedding 显式保存端点、输入容量、维度与输入价格，纯向量供应商无需假造生成型号/defaultModel。端点共用同一校验；新增向量凭据目标必须重新输入 Key，旧配置缺省和生成快照不补 embedding。
- LlmProfiles.withModelOperations 在原 SerialQueue 中一次读取并捕获全部角色；公开 profiles 不解密，按角色索引延迟解密，原回调结束后缓存同样失效。未知操作、缺失/禁用型号不回退，不联网或自动重试。此步未接入向量请求、Agent 多角色 UI 或任务调度。
- 依据模型配置及原引擎快照消费者选择验证：`pnpm exec vitest run tests/unit/logic/models/model-operations.test.ts tests/llm.test.ts tests/owner-model-configuration.test.ts tests/engine-configuration.test.ts --reporter=default`：4 文件 38/38；补充未知操作断言后仅重跑新套件 4/4。首次类型检查发现异构 profile 容器的联合类型定义不匹配，改为模型模块拥有的 ResolvedModelOperation 契约后通过。
- 最终 `pnpm typecheck`、`pnpm check:test-modules`（497 文件，148/155/194）、`pnpm check:architecture`（1523 文件、7392 依赖、0 循环/违规）及 diff 空白检查通过。同步 models、models/service 文件头、接口语义、契约和类图；新增 endpoint.ts/embedding.ts 及责任单元登记。未跑全仓 CI、SDK 联网或桌面发布验收，继续实施第 2 步剩余绑定与预算。

## 2026-11-14：切片 1——引擎与模型解耦、官方静态清单

- 来源为用户明确授权“先做引擎与模型解耦和静态清单”；实施前读取开放 Issues，只有无关 #65，未新建或回填无关工单。本步在独立分支 refactor/engine-model-catalog、基线 74019e20 开发，保留原工作树的 0.1.16 发布收尾资料。[完整目标方案](task/domain-agent-loop-engine-architecture.md) 保留后续切片边界，本次不自动实施其余阶段。
- Logic 新增 engines：catalog/supported-engines.ts 用只读 TypeScript 静态声明统一 Pi、Claude Code、Codex 的身份、显示名、业务类型和支持协议；枚举和兼容投影从清单派生。模型模块只保留供应商、模型、通用 ModelConnectionRequirement 和凭据服务，AgentModelSelection 归 Team。旧 definition.engine 使用冻结读取 schema，不参与选型、不随未来引擎扩展。
- EngineModelProfiles 组合原 LlmProfiles，复用唯一配置队列与锁内延迟解密；ResolvedEngineModel 组合可选 engine，旧缺省快照不补字段、不改哈希。Application、主 Agent 设置、岗位/领取、执行装配和 Bridge/View 迁移到对应入口。models.test 的公开请求/回执保持兼容，内部由引擎服务投影。模型模块禁止反向依赖引擎，静态清单禁止加载 SDK/平台，冷启动及更新模块禁止导入新清单。
- 行为与验证选择：静态目录及通用连接为责任单元；引擎/模型、SSR 选型和历史快照为契约；主 Agent、IPC、岗位与领取为受影响的应用集成。先运行 `pnpm exec vitest run tests/unit/logic/engines/catalog.test.ts tests/unit/logic/models/provider-connections.test.ts tests/engine-configuration.test.ts tests/provider-connections.test.ts tests/llm.test.ts tests/owner-model-configuration.test.ts tests/model-actions.test.ts tests/main-agent-settings.test.ts tests/workspace-member-service.test.ts tests/dependencies.test.ts --reporter=dot`：10 文件、238/238。再核执行装配直接消费者 `pnpm exec vitest run tests/owner-execution-service.test.ts tests/member-execution.test.ts --reporter=default`：2 文件、27/27。共 265/265，保留重复启动、失败上限、停止屏障、原回执复用及恢复不重放断言。
- 静态验证：`pnpm typecheck` 通过；`pnpm check:test-modules` 通过（496 文件，unit=147 / contract=155 / integration=194）；`pnpm check:architecture` 通过（1520 文件、7381 条依赖、0 循环、0 违规）。首次类型检查用于定位尚未迁移的调用方和测试夹具，迁移后通过；首次依赖检查发现 model-actions 缺少新 engines 桥入口许可，按实际公开契约补齐后通过。
- 注释与资料同步：新增 engines 四个目录的文件头、接口语义和类图；更新 models/service、Team 选型、Application/assembly、Bridge、执行及 View 消费目录的类图和对应契约。维护入口为 [引擎契约](../src/logic/engines/CONTRACT.md)、[通用模型连接](../src/logic/models/provider-connections.ts)、[引擎模型服务](../src/logic/engines/service/model-profiles.ts)。状态、凭据和恢复仍由原服务拥有，不增重试、调度器或数据迁移。
- 验证边界：未运行全仓 CI、真实厂商 SDK 联网、桌面安装/升级或打包；现有界面只迁移契约来源，新增引擎管理页面、多模型角色、已下载包清单、通用冷壳及独立引擎发布属于后续切片。本步不等于整套包架构或发布已完成，不改当前安装版本。

## 2026-11-14：直接连接资源重启进程，连续观测公开冷包下载

- `43550661868` 在新资源窗口刚出现时正常关闭超时，未进入差分统计；前一轮过早缓存与本轮关闭时序证据均保留。改为直接接入同一真实原生进程，不再通过关闭/重开交接资源升级。
- 仅发现已核实安装路径/PID 的本机监听端口，先连接 Node inspector、再次核对 PID/EXE、安装原被动流量观测，再通过 Chromium CDP 连接该进程页面；不暂停执行、不改变请求、更新定时器、用户目录或缓存。下载后普通退出仍使用 ElectronApplication.close 同样的 app.quit 入口并释放调试器，原差分/缓存复用/NSIS 与保留断言不变。
- 新验收连接模块用自身空 Node 子进程验证实际调试协议：身份、异步乱序响应、远端异常后继续、断开拒绝挂起请求、重连及拒绝远程端点。`pnpm exec vitest run tests/desktop-inspector-connection.test.mjs`：2/2；脚本语法和 `git diff --check` 通过；`pnpm check:test-modules`：495 文件通过。新增测试登记为 integration，未导入完整产品 Application；`src/` 无改动，不涉及产品类图。

## 2026-11-14：修正资源重启后的线上差分观测时序

- 公开 0.1.16 的线上验收 `43549948251` 已真实激活 C 0.1.15/R4，并就绪正确摘要的新冷包，但差分断言失败。记录只有重开后的 latest.yml：验收器在未连接的新原生进程中等待 15 秒，超过旧版 10 秒预下载启动点，安装包先被缓存，因此不能把缺失的 Range 证据计为成功。
- 只修改验收脚本的资源重启交接：确认同一路径的新主进程及真实窗口后立即正常关闭，随后带被动网络观测启动；冷安装的 15 秒稳定观察保留。没有修改已公开附件、产品定时器、更新源或客户端缓存，原差分和无全量回退断言不变。
- 选择验收目标识别与被动网络统计两个直接协作单元，`pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs tests/desktop-update-network-evidence.test.mjs`：60/60；`node --check scripts/desktop-release-acceptance.mjs`、`git diff --check` 通过。真实 Windows 时序必须由新隔离 runner 复验；当前不报告在线升级通过。未修改 src、导入或测试归属，不涉及类图、类型或模块检查。

## 2026-11-14：公开 0.1.16 前补齐真实旧版资源升级前置

- 用户已明确授权公开发布、自动升级与差分下载验收，沿用已确认的未签名候选。建立 develop → master PR #72，原草稿、四附件和冻结源码保持不变；未纳入无关开放 Issue #65。
- 核对真实 `desktop-v0.1.15` 的 RuntimeUpdates：客户端优先同 C 的资源更新，公开 R4 尚未应用时不会直接选择新 C。原安装验收器只等待目标 C 就绪，会把正常 R4 就绪误判为版本错误。修正验收输入与脚本，真实等待旧版 R4、验证普通退出不应用、点击旧版侧栏就绪入口、观察同一安装路径新进程并核对已激活 R4，之后由原定时器发现 C 0.1.16。只读观察，不改下载源、激活日志或缓存。
- 中间跳转严格固定已核实的 C 0.1.15/R4，拒绝未知 R、跨 C、降级/重放、错误 tag、非 ready 和错误快照；资源就绪不计为安装器就绪。继续核同一用户目录、唯一已完成模型请求、冷包实际 Range、无全量回退、缓存摘要、普通退出及 UI 重启安装。R 的真实执行结果将在公开升级报告中记录，不将脚本准备视为已通过。
- 按实际影响选择 `pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs`：57/57；`node --check scripts/desktop-release-acceptance.mjs` 通过；测试导入变化后 `pnpm check:test-modules`：494 文件通过。未改产品或构建输入，不重打包；`src/` 无变化，不涉及产品注释与类图。PR 使用新 head 重跑完整检查后再公开。

## 2026-11-14：0.1.16 在线模型、候选安装与完整 CI 验收通过

- 沿用户确认的 Windows 未签名方式完成候选，R 清单继续使用原 Ed25519 身份。[完整记录](verification/desktop-acceptance-0.1.16-20261114.md) 保存制品摘要、来源、实际命令、失败与修复以及验证边界。冻结源码 `b21a77ec23f17089a80ec738bbe365f9c56e71d5`，候选 `unsigned-20261114-094902-d205c3b0`，安装器 SHA-256 `4ca66fdb13118b67c6e2f08891b9204fc854dc6dabfb2609c09fa182b670ef39`。
- `pnpm make:desktop --unsigned` 和固定公开 E 字节的 `verify-cold-payload --published-engines` 通过。实际打包 EXE 完成 DeepSeek `deepseek-flash` 在线主/成员派发、两话题排队、候选审阅、同一逻辑子会话与不同原生上下文隔离；六项执行隔离通过。重开同一隔离 profile 没有新运行，办公室当前任务 0、历史 2，头顶入口返回原成员结果。证据入口见报告；生产工作区与已安装程序未被替换。
- [候选安装 43543271035](https://github.com/nan023062/cbim/actions/runs/43543271035) 通过：干净 Windows runner 全新安装，真实 C 0.1.15/R1 → C 0.1.16/R1 覆盖升级；原会话/工作区/模型/知识/业务文件/主 Agent 设置/自动化全部保留、无重放，实际 NotSigned，固定 Pi 下载 15338 文件通过。模式为 candidate，不将自动发现、差分下载或公开 UI 重启安装计为通过。
- 验证提交 `cfb30c776a2bd84aa72b1172a29b675f29db4188` 的 [完整 CI 43545100842](https://github.com/nan023062/cbim/actions/runs/43545100842) 通过：494 文件、3354 通过、0 失败、2 项原有历史 EXE 前置条件跳过，类型/架构/模块边界/官网及四片覆盖汇总通过。与冻结候选之间仅测试、夹具和记录差异，没有产品/构建输入变化；无需重新生成已验证制品。先前取消与失败运行保留，不复用为通过证据。
- 本次收尾仅回填报告和开发记录，不修改 `src/`，没有注释/契约/类图变化；不重复产品测试。自包含 HTML 内嵌真实截图，核对 320px 浅色/深色无溢出。草稿 Release `444935258` 的四附件保持冻结身份；master、公开 0.1.15 通道、旧 Python latest 与官网不变。本轮没有公开、合并或安装到用户生产环境。

## 2026-11-14：候选全量 CI 发现的测试契约与派发夹具修正

- 冻结制品 `b21a77ec23f17089a80ec738bbe365f9c56e71d5` 的完整 CI [43543016620](https://github.com/nan023062/cbim/actions/runs/43543016620) 已结束：静态检查、第 2/4 片通过，第 1/3 片共 9 项失败。本步核对实际 Conversation 管理器、View 输入状态、派发原文及原始 HTTP 记录，未修改产品源码、构建输入、依赖或签名制品。开放 Issue 仍仅 #65；不把本轮候选验收作为其已修复证据。
- 7 项旧测试断言未跟随办公室设计更新：`starting` 回调明确传递队列话题标识及可选关联话题；普通新任务在在线等待期间为 pending，重启后为 paused；等待期间普通输入仍排队，显式补充沿独立话题入口。修正三个测试文件，增加队列原 ID 传入回调、重启暂停及禁止继续等待队列的断言；租约释放、不可变历史、去重和停止边界保留。
- 另 2 项真实 Pi 依赖修订测试本地复现。确定性供应商从全部上下文匹配第一个任务名，误将系统提供的前置 A 证据当成当前 D 派发，读取了 A；产品正确拒绝无效候选，随后脚本主轮过早宣称完成。夹具现在从真实用户轮的完整派发原文精确选任务，仍通过真实 read/计划/候选审阅与目标审阅。修复后 A/B/C/D 各自返回对应文件标记；没有绕过依赖审阅、延长超时或改调度状态。
- 因失败分别属于管理器协作契约、输入状态及真实 Pi 集成，选择 `pnpm exec vitest run tests/queued-task-cancel-pi.test.ts --reporter=json --outputFile=test-results/desktop-016-20261114/queued-task-cancel-local.json`：3/3；`pnpm exec vitest run tests/execution-collaboration.test.ts tests/queue-insertion-view.test.ts tests/queued-dependency-revision-pi.test.ts --reporter=json --outputFile=test-results/desktop-016-20261114/ci-regressions-after.json`：30/30。原失败报告和请求现场另存同目录；`pnpm check:test-modules`：494 文件（146 unit / 155 contract / 193 integration）通过。
- 此提交只校正验收代码与记录，不影响已通过在线模型和隔离安装的冻结候选。接着对本提交运行完整 CI，结果独立回填；本步不将局部通过写成全仓或公开发布通过。`src/` 没有修改，不涉及产品注释或类图更新。

## 2026-11-14：修复冷包中空目录与签名文件清单不一致

- 首个候选冻结于 `a2fdce3a7f07083fbe7218ad449f38aec8c4dc4d`，目录 `build/desktop-release/0.1.16/unsigned-20261114-094417-9c19e1db`。R/E 制品验证和 NSIS 生成已完成，最终 `verify-cold-payload` 因“资源目录包含多余内容”失败；此候选不发布，回执与现场保留。
- 实际比对发现 `design/skills/` 迁出后留下多个空目录，`collectResources` 递归复制目录，但签名清单及 ZIP 只登记文件，因此冷包携带了无法由文件清单证明存在的目录。修复 [runtime-packaging.ts](../scripts/runtime-packaging.ts)，仅在新建的资源制品边界内移除空目录，拒绝链接、不改源码目录，不放宽启动器的严格校验。没有修改 `src/`、产品状态或类图。
- `pnpm exec vitest run tests/runtime-packaging.test.ts`：3/3，新增回归覆盖多级空目录移除、声明文件字节保留、源码空目录保持原状及冷启动器不混入 R；选择该文件是因为修复属于资源收集和制品身份。导入变化后运行 `pnpm check:test-modules`：494 文件边界通过。完整 CI [43542347851](https://github.com/nan023062/cbim/actions/runs/43542347851) 针对首个冻结提交仍在执行，不能作为本次修复后的完整通过证据；重新冻结及打包后另核准确信息。

## 2026-11-14：冻结 0.1.16 未签名安装候选输入

- 沿用户已确认的未签名方式，版本提高到 0.1.16，补充 [版本说明](releases/desktop-v0.1.16.md)。当前公开桌面仍为 0.1.15；旧 Python latest 为 `327801733 / v1.0.2`。本步仅准备候选，公开通道、旧附件和官网不变。
- 对照真实 `desktop-v0.1.15` 标签的更新入口与 RuntimeUpdates：安装器仍使用后台准备、显式重启交互，固定 C 的模型运行先准备签名 E 包。验收输入显式纳入 0.1.15；旧包缓存摘要、主 Agent 配置及自动化保留断言同步纳入，工作流描述同步。候选模式验证真实 C 0.1.15 内置 R1 → 新 C；未将其称为 R4 起点或公开在线升级通过。原客户端可能优先发现同 C 的资源更新，公开路径必须另外核对实际起点。
- 选择 `pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs`，因为本步改变的是旧版输入白名单及原交互分类；46/46 通过，继续拒绝同版、降级、未验证的未来旧版及无效制品身份。测试归属、导入和产品源码均未改，不重复模块登记或产品类图生成。完整 Windows CI、准确候选打包及隔离安装结果在完成后追加，尚不据此宣称发布通过。

## 2026-11-14：办公室真实在线模型与跨话题上下文验收

- 用户直接要求继续在线模型和打包发布验收；本步使用 `d6d5db507df5fba398bf338e73c919add95323e9` 的产品源码，新增 [office-team-online-smoke.mts](../scripts/office-team-online-smoke.mts)。模型为本机已配置的 DeepSeek `deepseek-flash`，真实 Pi 引擎、真实 Electron 编译入口及后端；知识与岗位是隔离验收数据，模型响应不设替身。仅复制加密模型配置及系统加密元数据到临时 profile，结束删除副本，不操作生产工作区。
- `pnpm exec tsx scripts/office-team-online-smoke.mts` 通过，耗时约 131 秒：主 Agent 真实派发两项只读文件核实任务，第一话题完成后队列自动建立第二话题；两个成员候选均 accept、两个目标均 completed。4 个主回合、2 个成员回合成功，页面错误为 0，两个独立标记分别来自成员实际读取。证据：`test-results/office-online-v2RDiK/report.json`、原始隔离运行日志及截图。不是打包 EXE 或安装器验收。
- `pnpm exec tsx scripts/office-team-online-smoke.mts --verify-report test-results/office-online-v2RDiK/report.json` 通过；只读复核原事务和 Pi 原生记录，不新增付费请求。一个办公室中的同一角色仅一个逻辑 Session，两话题使用不同原生 Session，成员上下文包含各自文件标记且不含另一话题的结果。额外证据单独写入 `member-context-evidence.json`，原报告不覆盖。
- `node scripts/check-dependencies.mjs`：1510 文件、7354 依赖、0 循环／违规；本步新增验收脚本的导入边界通过。没有改动产品源码、契约或类图，不重复产品单元测试；后续精确冻结版本的完整 CI 及安装升级验收分别记录。
- 当前源码实际冷指纹 `c192e18fe4616db92dca948f4d279426313e73d150fb7e90eb7996037f5deac9` 与 C 0.1.15 基础不符，不能仅发布 R5；下一步准备 C 0.1.16 安装候选。用户已明确沿用 Windows 未签名模式，R 清单继续由原 Ed25519 身份签名；授权范围为候选验收，未公开发布、未合并或更新官网。

## 2026-11-14：补齐办公室浅色／窄屏 Electron 桌面渲染验收

- 用户直接要求推送最新提交并补齐剩余浅色／窄屏验收，无对应新增 Issue；核对当前 Issues 后不扩展到无关工单。产品源码基线 `fea0b8a5eecaa338c6a96af3d1e00655d664f6f7`，本次只修改验收脚本及记录，不修改 `src/`，也不把桌面渲染验收等同于完整程序或发布验收。
- 新增 [office-team-desktop-smoke.mjs](../scripts/office-team-desktop-smoke.mjs)：使用 Electron 40.10.6、真实 React App 和既有公开 IPC 内存夹具，绑定 127.0.0.1，使用独立临时用户目录，退出时关闭测试 Electron 与 Vite。复用 [office-team-ui-fixture.tsx](../scripts/office-team-ui-fixture.tsx)，修正会话详情读取参数为公开协议的 `selectedScopeId`。不打开用户项目、不调用在线模型、不操作已安装 CBIM 或用户系统动画设置。
- `node scripts/office-team-desktop-smoke.mjs`：16 项检查通过，进程退出码 0。核对每个逻辑 Agent 仅一个人物、默认历史折叠、真实新派发／汇报驱动两个人物往返、停止全部人物动态、展开撤销任务、成员原结果可见、成员普通输入仅向主 Session 排队、头顶主／子对话与原话题跳转、重复点击主会话回到对话、两个办公室身份和队列隔离、减少动画偏好分支。页面错误、夹具错误和意外 IPC 均为空；唯一执行类写入为内存 `loop.enqueue`，没有实际模型／项目写入。
- 保存并逐张目视检查 7 张原生合成截图：浅色桌面 1280×1200，以及 320×900 浅色／深色各上中下三段。窄屏面板高 809px，滚动位置 0／433／865px，连续覆盖主工位、两个成员工位、当前任务与折叠历史；文字、人物、按钮均可辨认，文档、办公室及工位没有横向溢出。证据为本机 `test-results/office-desktop-NKPt1m/report.json` 与自包含 `report.html`（内嵌全部 PNG，未纳入 Git）。补齐了第 12 步未完成的浅色／窄屏目视检查和减少动画行为验证。
- 验收工具问题及修正：最初 Electron 入口按绝对包路径引用导致取到二进制路径，改为生成入口中的 `require('electron')`；CDP 视口模拟与隐藏窗口合成尺寸不同导致截图超时，改为真实 BrowserWindow 内容尺寸及 `webContents.capturePage`；下段截图重复上段时发现滚动了内部展示节点，改为实际 `.session-task-panel` 并断言滚动距离和覆盖连续性。失败目录保留，不将这些工具失败或重复截图计为产品通过证据。
- `node scripts/check-dependencies.mjs`：1509 文件、7348 依赖、0 循环／违规。`git diff --check` 通过。因只涉及验收工具与夹具，选择上述真实渲染流程验证，不重复产品单元、类型检查或架构生成；此前 12 步的结果保留为历史证据。本轮未执行全仓回归、完整打包后端、在线模型链、安装升级、合并或发布；远端 CI 另以实际运行结果为准。
- Review 入口为本次三个文件的 diff：验收脚本 → 夹具协议修正 → 本记录；没有产品职责、状态归属或架构类图变化。按照本轮明确授权推送 `develop` 的原 12 个提交及本次验收提交，推送结果以远端分支回执及最终回复核对。

## 2026-11-14：办公室改版第 12 步——人物工位、往返动态与双向导航

- 基线 `28621d7b`。任务视图默认办公室，可切换原依赖图；每个正式逻辑 Agent 一个人物，显示当前模块/目标、真实状态与同角色待办。历史沿原完成/撤销规则折叠。新增派发驱动主 Agent 往返，候选、求助、检查点驱动成员汇报往返；首次进入、重复/旧图和隐藏期间不回放。关闭动态停止行走及工作摆动，系统减少动画同样保留文字状态和所有入口。模块工位键与主工位/休息区分开，允许业务模块同名。
- 人物头顶入口返回对应主/子对话与原话题；修复侧栏重复点击相同 Agent 仍滞留任务视图的问题。主子会话和办公室共用 execution-view/team-conversations 投影；只迁移共享只读能力，不允许 Tasks 反向依赖 Conversation。用量折叠，办公室优先展示人物。各相关文件注释、四份 CONTRACT 及五个目录类图同步。
- Q1 保护真实执行与历史归属，动画不能触发执行；Q2 共享身份投影归 execution-view，办公室状态/动作归 tasks，文字导航归 Conversation/Shell；Q3 本片只影响展示、图消费者、导航与依赖入口，选择对应单元/契约；Q4 teamConversations → officeScene / OfficeEventTracker → OfficeScene → Conversation → App；Q5 无新增通用治理规则。
- `pnpm exec vitest run tests/office-scene.test.ts tests/task-history-view.test.ts tests/session-task-view.test.ts tests/scope-goal-view.test.ts tests/team-conversations.test.ts tests/team-conversation-view.test.ts tests/runtime-navigation.test.ts tests/chat-chrome.test.ts`：48/48；之后补充工位同名边界并关闭全部人物动态，精确重跑 `tests/office-scene.test.ts`：5/5。首轮旧依赖图断言因默认展示变化失败，改核办公室中全部当前节点，独立依赖图的连线断言保留。
- `pnpm typecheck`、`pnpm check:architecture`（751 代码/样式、1508 文件、0 类图差异/循环/违规）、`pnpm check:test-modules`（494 文件：unit 146 / contract 155 / integration 193）通过。首次依赖检查指出 Tasks 引用 Conversation 及夹具绝对导入，迁移共用投影、修正路径后通过；精确登记共享入口和 Dispatch 类型契约，没有放宽目录限制。`tests/dependencies.test.ts -t 'snapshot contracts and domain views reject reverse or private dependencies without a file cycle|View and Logic can only meet through public Bridge contracts'`：2 通过，149 未选择。最后 `node scripts/source-architecture.mjs --check`：0 差异。
- 实机渲染验收使用 `node scripts/office-team-ui-preview.mjs` + Cindy 管理的 Chrome，只连接 127.0.0.1，真实 React App 与公开 IPC 形状的内存夹具，不启动模型、不触碰用户工作区。核对两办公室独立人物身份、默认历史折叠、主/成员头顶跳转、侧栏重复点击返回、成员普通输入的 loop.enqueue.taskId=root、只浏览零执行请求。新增派发/汇报各一个人物，测得途中位移 (-269.25,342)/(269.25,-342)，终点均回 (0,0)，轮询不重放；后台定时采样超时后改用页面内动画关键帧测量，不把采样超时当业务失败。关闭动态后行走及工作摆动节点为 0，对话按钮仍有 3 个。
- Chrome 最小窗口内宽 500，因此使用同源嵌入页获得真实 320px viewport：文档宽/scrollWidth 均 320，办公室 281/281，工位 257/257，无横向溢出；页面 errors/unexpected IPC 均为空。深色截图已目视检查。浅色/深色真实计算样式分别白底深字/深底浅字；截图接口中途返回 CHROME_OPERATION_FAILED，未将浅色和窄屏截图目视验收报告为通过。减少动画系统偏好分支做代码核对，未改变用户系统设置。
- 本设计的会话身份、话题/排队、上下文、整话题补充、历史关联和办公室场景已完成本轮代码实现；逐片验证不等于全量回归或发布。真实主/成员模型链的本地确定性 Pi 集成见第 6/7/8/11 步；本片未跑在线模型、完整桌面程序、打包/安装升级、全仓回归或 CI，未推送、合并或发布。

## 2026-11-14：办公室改版第 11 步——主 Agent 的按话题归档读取

- 基线 `908a5d8d`。新增只读 `cbim_office_history`，主 Session → 话题 → 原内容引用，按需读取原目标/输入/补充、主轮、派发、成员公开对话及回传。正文沿 canonical 保存，不复制存储或按时间猜归属；长公开消息可完整分块，续页须核原版本。主工具绑定原办公室，成员 Loop 不提供归档入口；公开白名单继续隐藏内部提示词、原生信息及工具私有正文。
- Q1 保护归属、真实发送者、子上下文隔离及原日志；Q2 协议归 Tasks rules，读取归 Tasks runtime，工具只适配和核回包，Dispatch 装配现有存储端口；Q3 选择新服务/工具、调度工具消费者、真实 Pi 主/成员链；Q4 OfficeHistoryService → OfficeHistoryTools → 主 DispatchTools，mainInstructions 说明读取及历史授权边界；Q5 无新增通用规则。
- `pnpm exec vitest run tests/office-history-service.test.ts tests/office-history-tools.test.ts tests/dispatch-tools.test.ts tests/auto-collaboration.test.ts tests/loop-engine.test.ts`：82/82。`tests/office-history-pi.test.ts`：1/1，真实 Application/Pi 在关联新话题调用归档并读到原用户输入，原话题保持结束；`tests/application-member-pi.test.ts tests/agent-role-instructions.test.ts`：11/11，真实成员请求不含归档工具且保持跨话题上下文隔离，均使用本机确定性供应商。
- 首轮类型检查发现测试夹具使用不存在的 team 模式，模块检查发现服务单元直接校验另一模块 Schema；改为真实成员模式并将契约断言留给工具测试，精确重跑服务 4/4。最终 `pnpm typecheck`、`pnpm check:test-modules`（493 文件）与 `pnpm check:architecture`（748 代码/样式、1503 文件、0 差异/循环/违规）通过；公开入口精确登记，边界测试 12 通过/139 未选择。
- 同步五个目录说明和类图；未跑全仓、真实桌面/在线模型、构建或发布。办公室人物/工位场景继续实施。

## 2026-11-14：办公室改版第 10 步——历史话题的关联新任务

- 基线 `7c2db3b8`。历史话题按钮只设置明确可撤销的来源，用户发送后建立独立排队身份。followupOf 随编辑/重启及新周期保存；入队和建周期均核同办公室、已关闭来源，提交/重放拒绝改绑；旧单轮插入不能消费该任务。原话题保持结束，后续不继承旧验收，话题内可返回查看原话题。
- Q1 保护旧话题关闭事实、正文与队列安全暂停；Q2 队列携带来源、派发事务核验、View 选择关联，公开投影保留真实引用；Q3 选择队列/真实管理器、协调器、持久事务、话题展示与联合读取；Q4 enqueue → MessageQueue → starting/openScope → followupOf → ConversationTopics；Q5 无新增通用规则。
- `pnpm exec vitest run tests/message-queue.test.ts tests/dispatch-scope.test.ts tests/queue-insertion-boundary.test.ts tests/auto-collaboration.test.ts tests/conversation-topics.test.ts tests/dispatch-session-read.test.ts tests/scope-goal-view.test.ts`：132/132 通过。类型检查发现测试事务命令夹带未定义字段，修正并增强原生插入拒绝覆盖；精确重跑 `tests/queue-insertion-boundary.test.ts tests/dispatch-scope.test.ts -t '历史后续|关联新话题'`：2 通过、35 未选择。最终 `pnpm typecheck` 和 `pnpm check:architecture`（0 文档差异/循环/违规）通过。
- 同步七个目录契约、注释与类图。没有测试归属/导入变化，不重跑模块归属检查；未运行全仓、桌面、在线模型、构建或发布。主 Agent 归档读取核查及办公室场景继续实施。

## 2026-11-14：办公室改版第 9 步——主子对话的明确话题补充入口

- 基线 `1608019f`。主/子对话选择同一话题后可明确暂停并补充，独立于普通聊天草稿。原请求先本地保存再发送；重开只查回执，未知结果冻结正文、权限和命令，只有明确点击才重试。普通等待保留原表单，已有 interruptionId 的等待只能沿原请求。话题摘要区分正在排空和可靠暂停，联合投影拒绝不一致详情。
- Q1 保护发送幂等、话题身份和用户原文；Q2 View 控制本地请求和选择，暂停事实仍归后端；Q3 覆盖控制器、联合投影、普通等待和主子话题展示；Q4 `TopicInterruptionController` → `TopicInterruptionForm` → `Conversation`；Q5 无新增通用规则。
- `pnpm exec vitest run tests/topic-interruption-view.test.ts tests/scope-continuation-view.test.ts tests/scope-goal-view.test.ts tests/team-conversation-view.test.ts tests/conversation-topics.test.ts`：59/59 通过。首轮类型检查发现测试直接 map(JSON.parse) 的签名不符，改为显式回调；最终 `pnpm typecheck`、`pnpm check:architecture`（745 代码/样式、1497 文件、0 文档差异/循环/违规）、`pnpm check:test-modules`（490 文件）和 `git diff --check` 通过。
- 同步 conversation、tasks、bridge/contracts 的注释/契约和类图，以及 View 上层实际依赖。未跑全仓、真实桌面/在线模型、构建或发布；后续继续关联话题、完整归档核查及办公室场景。

## 2026-11-14：办公室改版第 8 步——安全等待后继续普通话题队列

- 基线 `7154236d`。安全话题等待现在只保留办公室占位，不把普通排队项批量改成持久暂停；文本/人工接续不再改写队列。原话题完成后启动队首 pending，并沿原队列 ID 创建新话题。用户停止、未知结果、重启和既有 paused 队首仍需明确继续，不被自动放行。补充表单同步纠正旧提示，明确普通发送创建新任务。
- Q1 保护队列顺序、持久暂停与重启屏障；Q2 运行管理器控制推进，协调器区分正常等待和异常暂停，View 只说明入口；Q3 覆盖文本与人工接续、协调器和原插入/取消消费者；Q4 `holdCollaboration` → 接续 beforeRun → `collaborationReady/pump`；Q5 无新增通用规范。
- `pnpm exec vitest run tests/scope-continuation-pi.test.ts tests/human-continuation-pi.test.ts tests/auto-collaboration.test.ts tests/queue-insertion-boundary.test.ts`：96/96 通过。新增 live-queue 实际 Pi 用例验证等待不抢跑、当前完成后自动启动下一话题及稳定 ID；原重启、再次等待、取消竞争和人工决定用例保留并核验 paused 语义。`pnpm typecheck`、`pnpm check:architecture`（0 文档差异/循环/违规）通过；本片没有测试归属或导入变化，不重复测试归属检查。
- 同步 conversation/runtime、dispatch/runtime、view/tasks 的源码说明、CONTRACT 和类图。仅本地确定性供应商集成与相关单元/契约验证，未跑全仓、桌面、构建、安装升级或发布。话题内打断表单、关联后续话题与办公室可视化仍继续实施。

## 2026-11-14：办公室改版第 7 步——指定话题补充的持久意图与整组排空

- 基线 `4522455b`。新增 `loop.topicInterrupt`：按原办公室/话题/输入版本保存原文、附件和选型，冻结旧调度，停止主轮及原话题全部成员，等待在途工具、领取、引擎退出和结算，再建立带 interruptionId 的可靠等待。复用原接续事务提升输入版本、清除旧审阅并迫使重规划。普通发送和原生 steer 不成为此入口；本片是后端闭环，界面按钮与队列自动衔接另片接入。
- Q1 保护原话题归属、执行租约、未知结果、人工审批和额度；Q2 Tasks 保存请求/检查点，Dispatch 协调排空，Conversation 管理原主轮和幂等启动，Runtime 仅额外允许可靠 cancelled 主轮的专用接续；Q3 选取持久化/重放、真实协调器、主运行管理器、成员领取、IPC 和 Pi 集成；Q4 `topic-interruption` → `TopicInterruptionService` → `AutoCollaboration.interruptTopic` → `WorkspaceExecutionManager.interruptTopic/continueGoal`；Q5 无新增通用规范。
- `pnpm exec vitest run tests/topic-interruption-service.test.ts tests/scope-continuation.test.ts tests/scope-active-input.test.ts tests/dispatch-session-read.test.ts tests/queue-insertion-boundary.test.ts`：实际选中 4 文件/40 项通过；其中 scope-active-input.test.ts 路径不存在，随后用正确的 scope-active-input-core.test.ts 验证，未将空选择算作通过。`pnpm exec vitest run tests/queue-insertion-boundary.test.ts tests/auto-collaboration.test.ts tests/scope-active-input-core.test.ts tests/ipc-requests.test.ts`：113/113 通过。
- `pnpm exec vitest run tests/topic-interruption-pi.test.ts`：1/1，通过真实 Pi/IPC/事务链取消旧主轮、同话题新输入重新规划及审阅，成员候选未重放；使用本地确定性供应商，不代表在线模型验收。`pnpm exec vitest run tests/member-execution.test.ts tests/dispatch-execution-store.test.ts tests/topic-interruption-service.test.ts tests/ipc-requests.test.ts`：50/50 通过。新增取消竞争、未知退出重启封存、已消费补充重查不能冻结新轮，分别选择 queue-insertion-boundary 的“整话题”2 项、topic-interruption-service 的“未知主轮”1 项、auto-collaboration 的“话题补充”2 项通过。
- 类型检查初次发现两个事务回调未返回 Promise 和两个测试类型问题，修复后 `pnpm typecheck` 通过。架构检查指出新增服务和 IPC 契约未登记，补充精确入口而未放宽目录规则；`tests/dependencies.test.ts -t 'domain migration preserves rule/service boundaries'`：12 通过/139 未选择。最终 `pnpm check:architecture`（743 代码/样式、1494 文件、0 文档差异/循环/违规）、`pnpm check:test-modules`（489 文件）通过。后续幂等分支补充已过专用测试；类图再次生成无差异。
- 同步九个目录源码说明、CONTRACT 和类图。可靠等待重启保留；未能确认排空的意图按现有恢复规则封存为 interrupted，保留原补充供核实，不自动重放。界面入口、已结束话题的关联后续、普通排队的自动衔接和办公室场景仍未在本片完成。未运行全仓回归、桌面冒烟、构建、安装升级或发布；仅独立本地保存。

## 2026-11-14：办公室改版第 6 步——成员当前话题上下文隔离

- 基线 `99356503`。成员每轮冻结办公室、逻辑 Session、话题和输入版本，以及同角色同话题的历史候选引用；提示词只解析原引用，拒绝身份或版本漂移。新补充优先进入有界上下文，明确遗漏数量，原归档不截断。跨话题前置任务在派发和运行事务两处拒绝；不同任务保留独立原生通道，长期逻辑会话不会带入其它话题的原生历史。
- Q1 保护租约、检查点与原生通道身份；Q2 引用契约和纯解析归 Tasks，领取归 Team，装配归 Application；Q3 选取上下文、派发持久事务、实际成员领取和 Pi 装配消费者；Q4 `member-topic-context` → `member-topic-context-rules` → `MemberExecutionManager` → `member-dispatch`；Q5 无新增通用规范。主会话完整归档和整话题打断仍需后续切片。
- `pnpm exec vitest run tests/member-topic-context.test.ts tests/member-execution-context.test.ts tests/member-execution.test.ts tests/dispatch-execution-store.test.ts tests/dispatch-scope.test.ts`：49/49 通过。补充最新输入优先与真实请求断言后，`pnpm exec vitest run tests/member-topic-context.test.ts tests/application-member-pi.test.ts tests/member-checkpoint-domain.test.ts`：12/12 通过，实际 Pi 第二话题请求不含第一话题正文；`tests/dispatch-scope.test.ts -t '新话题拒绝'`：1 通过、9 未选择。
- 首轮架构检查发现引用类型经解析逻辑回到运行记录的类型环，已拆分纯契约与算法并登记两个细粒度公开入口。修复后 `tests/member-topic-context.test.ts tests/dispatch-execution-store.test.ts`：14/14；`tests/dependencies.test.ts -t 'domain migration preserves rule/service boundaries'`：9 通过、139 未选择。最终 `pnpm typecheck`、`pnpm check:architecture`（741 代码/样式、1490 文件、0 文档差异/循环/违规）、`pnpm check:test-modules`（487 文件）和 `git diff --check` 通过。
- 同步五个受影响目录的源码说明、CONTRACT 和类图。未运行全仓回归、桌面冒烟、构建、安装升级或发布；实际 Pi 集成使用本地受控服务，不代表在线模型验收。独立本地保存。

## 2026-11-14：办公室改版第 5 步——普通输入排队与话题身份衔接

- 基线 `3d126a9e`。普通输入在开放/等待话题期间均入队，不再自动转为等待目标的补充；补充保留目标内的明确独立表单。移除界面 Ctrl+Enter/队列项的单轮原生 steer，避免把它误认为整话题暂停；底层旧协议及回归覆盖保留，整话题插入另行实施。
- 排队项 ID 经可信管理器启动钩子作为实际 scopeId，编辑和排序不更换身份；主列表展示排队话题，实际话题出现后去掉过渡重复项。新主题在原主 Session 延续，结果回注仍归原周期；空主列表不再展示最近已关闭目标的展开控制。
- Q1 保护原队列、停止、未知输入和重启暂停门禁；Q2 View 只决定明确入口，Logic 维持可信身份与启动；Q3 选择等待输入、话题投影、真实管理器/原插入边界、协调器、独立补充表单消费者；Q4 阅读 `conversationExecutionState` → `Conversation.send` → `pump/launch` → `AutoCollaboration.starting`；Q5 无新增通用规范。
- `pnpm exec vitest run tests/conversation-waiting.test.ts tests/conversation-topics.test.ts tests/queue-insertion-boundary.test.ts tests/auto-collaboration.test.ts tests/scope-continuation-view.test.ts`：115/115 通过；`pnpm typecheck`、`pnpm check:architecture`（739 代码/样式、0 文档差异/循环/违规）通过。`git diff --check` 初次发现空行尾空格，清理后通过。同步 3 个目录 CONTRACT、类图与源码说明。
- 当前持久等待/异常/重启仍保留原队列暂停规则；本片未宣称整话题暂停、后续自动排队恢复或场景完成。未跑全仓回归、真实桌面/模型联调、构建/发布；独立本地保存。

## 2026-11-14：办公室改版第 4 步——子 Session 导航与成员对话

- 基线 `402369d3`，延续全部需求实施授权。Bridge 公开纯逻辑对话身份；View 联合投影验证办公室、唯一角色/Session 和不可改绑，全部分页追齐后发布。外壳按工作区实例/主根缓存成员导航，主会话保持可见，子角色按名称折叠，只提供查看入口。
- 成员页面按话题、派发任务、执行轮次读取真实公开事件；同角色多执行实例合为一个入口，显示主 Agent 派发、成员正文、工具与回传候选。只挂载当前轮读取，切换身份丢弃迟到响应。输入仍经外层原主 `taskId`，不会直接发给成员；本片未实现显式整话题暂停，也未增加伪造的旧逻辑 Session。
- Q1 保留原执行通道、日志与工具事实；Q2 成员导航属于 View，长期身份由 Logic 原事务提供；Q3 选择联合投影、角色聚合、子对话 SSR、原侧栏与页签消费者；Q4 阅读 `SessionReadProjection` → `teamConversations` → `WorkspaceList/ConversationEntries` → `MemberConversation`；Q5 无新增通用规则。
- `pnpm exec vitest run tests/team-conversations.test.ts tests/team-conversation-view.test.ts tests/scope-goal-view.test.ts tests/chat-chrome.test.ts tests/conversation-tabs.test.ts`：26/26 通过。`pnpm typecheck`、`pnpm check:architecture`（739 代码/样式，0 文档差异/循环/违规）、`pnpm check:test-modules`（486 文件）及 `git diff --check` 通过。同步 bridge/contracts、view/conversation、view/tasks、view/shell 的源码说明、CONTRACT 和类图。
- 未运行全仓回归、真实桌面/引擎联调、构建或发布；仅本地独立保存。完整需求仍包括排队/话题插入、上下文与办公室可视化后续切片。

## 2026-11-14：办公室改版第 3 步——主会话话题列表

- 延续完整设计的分步实施授权，基线 `9f07dc86`。周期摘要提供有界持久主运行身份；主对话按原周期归类，列表展示摘要，打开后展示原正文和工具；完成/撤销折叠到历史，失败/中断保留可见。旧无明确身份及冲突归属进入未分类，不按时间推测。
- Q1 保留原日志、工具证据、目标控制与任务定位；Q2 展示归类归 View，身份由原 Logic 周期投影提供，不新增正文存储；Q3 选择话题纯投影/SSR、联合读取和原目标视图消费者；Q4 阅读 `scope-view.summarizeScope` → `conversationTopics` → `ConversationTopics` → `Conversation`；Q5 无新增通用规范。这里只交付话题阅读，输入排队/整话题打断、子对话及办公室场景未在本片完成。
- `pnpm exec vitest run tests/conversation-topics.test.ts tests/dispatch-session-read.test.ts tests/scope-goal-view.test.ts`：29/29 通过，覆盖迟到反馈、跨办公室隔离、混合来源拒绝、历史折叠和正文范围。`pnpm typecheck`、`pnpm check:architecture`（737 代码/样式、0 文档差异、0 循环/违规）、`pnpm check:test-modules`（484 文件）及 `git diff --check` 通过。
- 同步 tasks/rules 和 view/conversation 的源码说明、CONTRACT 与类图。未运行全仓回归、真实桌面/引擎联调、构建或发布；此为独立本地提交，不代表全部需求完成。

## 2026-11-14：办公室改版第 2 步——同一 Agent 串行、不同 Agent 继续调度

- 延续同一用户授权，基线 `5a77d57c`。先将 [设计第 2 片](task/team-office-topics.md) 的执行槽独立交付，话题队列身份和上下文组装仍是后续切片，未冒充一起完成。
- `teamSessionBusy` 以真实 starting/running 及办公室/角色判定占用。`MemberExecutionManager` 在领取前返回 `TEAM_SESSION_BUSY`，不创建运行或引擎；`dispatch-invariants` 再核验新领取事务，不能换执行实例绕过串行。同角色不同办公室不互相占槽；已结算与旧无逻辑登记历史沿原规则。
- `AutoCollaboration` 遇同角色占用继续寻找其它角色的可执行任务；本批尚有此等待时不提前汇总回传。等待释放仍来自原运行真实结算，停止请求不能自行释放名额。
- 选取规则单元、实际运行入口、持久事务及自动调度消费者：`pnpm exec vitest run tests/team-session.test.ts tests/dispatch-execution-store.test.ts tests/member-execution.test.ts tests/auto-collaboration.test.ts`，89/89 通过。覆盖 starting 阻塞、直接事务绕过被拒、结算后启动下一项、重放和其他角色不被队首等待阻塞。`pnpm typecheck` 通过。四个相关目录的 CONTRACT、类图与重要源码说明同步。
- Q1 保留执行占用、原生历史、检查点和真实结算；Q2 逻辑对话串行归 Team 规则，领取与调度分别消费；Q3 验证只覆盖上述变化链；Q4 从 `teamSessionBusy` → 成员领取 → 持久不变量 → 自动调度异常分支阅读；Q5 无新增通用规则。未运行全仓回归、真实桌面/引擎联调、构建或发布；本片本地保存，不代表整套办公室设计完成。
- `pnpm check:architecture` 通过：128 目录、734 代码/样式、0 文档差异、0 循环/违规；`pnpm check:test-modules` 通过：483 文件，139 unit / 154 contract / 190 integration；`git diff --check` 通过。

## 2026-11-14：办公室改版第 1 步——长期团队对话身份

- 来源：用户直接授权按办公室/话题设计分步实施、测试和保存；基线 `8f743f51`，初始干净。开放 Issue 仅 #65，与此次改版无关，不修改无关工单。方案及 C3/L3 影响边界见 [办公室设计](task/team-office-topics.md)，本文记录已实施切片，不是另建待办。
- `TeamSession` 作为主/子 Agent 共用的长期逻辑身份，以工作区、主 Session、Agent 唯一登记。主根、主对话绑定、成员登记与派发在原事务保存/复用它；任务/周期关闭不删除。执行租约、原生通道、权限、检查点与验收仍沿原任务保存，不批量合并或改写旧历史。
- `FileDispatchStore` 在原 fsync/重放屏障校验登记；拒绝重复、改绑、跨工作区及未登记角色。联合读取只返回所选办公室的身份；旧日志缺省保留。新增纯规则细粒度公开入口，Logic 状态归属不变，不新增 Bridge/View 业务状态源。
- 验证选择：纯规则覆盖唯一性、幂等与隔离；真实 Store 覆盖原子失败及重放；已有派发/关闭/主绑定与联合读取覆盖直接消费者。执行 `pnpm exec vitest run tests/team-session.test.ts tests/dispatch-store.test.ts tests/dispatch-scope.test.ts tests/dispatch-session-read.test.ts tests/conversation-identity.test.ts`，首次 34 通过、1 个旧响应形状断言失败；补充新增字段的明确断言后只重跑 `pnpm exec vitest run tests/dispatch-session-read.test.ts`，7/7 通过，所选 35 个行为用例最终通过。
- `pnpm typecheck` 通过。首次依赖检查发现新细粒度入口未登记；登记 `team-session.ts` 后 `pnpm check:architecture` 通过：128 目录、734 代码/样式、0 文档差异、0 循环/违规。`pnpm check:test-modules` 通过：483 文件，139 unit / 154 contract / 190 integration。公开入口变更额外执行 `pnpm exec vitest run tests/dependencies.test.ts -t 'domain migration preserves rule/service boundaries'`，7/7 通过，其他 139 用例未选取。
- 同步 6 个受影响目录的 CONTRACT/ARCHITECTURE、源码定位/字段说明；`node scripts/source-architecture.mjs` 生成资料，`git diff --check` 通过。未运行全仓回归、桌面场景验收、构建、安装或发布；尚未宣称侧栏、话题插入、上下文组装或办公室画面完成。
- Q1 保护原任务执行与恢复不变量；Q2 将长期对话身份限制在 Team 规则与原调度事务；Q3 验证选择依据及失败修复如上；Q4 从 `team-session.ts` → `prepareMember` → `WorkspaceDispatchService` → `FileDispatchStore.sessionRead` 阅读，测试按同一顺序；Q5 无新增通用规则。切片独立本地提交，未人工 review、未 push/合并/发布。

## 2026-11-14：四层迁移后的全仓文档校正

- 来源：用户明确要求修正所有文档；基线 `af218b19`，开始时工作区干净。查询开放 Issues 仅有 #65，与本轮文档校正无直接对应，不修改工单。覆盖全仓已维护 Markdown、源码契约/类图、README、概念/运行/发布说明、测试说明和三宿主开发 Skill；历史报告保留原日期、统计和范围，旧源码链接更新为当前导航并注明不等于历史证据，未留存的临时源码或本机制品不伪造归档。
- 对照当前目录、导入和消费者修正模型/主 Agent 设置/预算、共享锁与错误入口、知识查询与刷新、Logic 业务规则和 Bridge 公开契约等归属。连接服务中混合的网页、反馈、仓库和静态包说明分归各自实际模块，新增 `src/logic/resources/packages/CONTRACT.md`。四层设计改为当前结构及保留边界，不再把早期分片状态当作待迁移现状；保留仍在使用的具名重导出及未实现的泛化恢复草案。
- 补充 CONTRACT 与生成 ARCHITECTURE 的维护关系，修正测试模块命令、运行说明中的旧源码位置，以及主会话权限/成员执行概述与实际装配不符的表述。两处 usage 文件头仅改职责说明；`scripts/source-architecture.mjs` 只修目录描述，生成算法未改。类型/导入、业务逻辑、测试断言和依赖许可均未修改。
- 实际验证：`node scripts/source-architecture.mjs` 更新后，`node scripts/source-architecture.mjs --check` 返回 128 目录、733 代码/样式、0 份生成差异。本机一次性 Markdown 审核覆盖 505 份文档：相对文件链接、章节/显式锚点、9 类 builtin 引用与三宿主 Skill 一致性通过；修正前 197 处本地文件引用无对应目标，修正后为 0。builtin 引用以 `logic/knowledge/rules/builtins.ts` 白名单核实，没有当成磁盘路径删除。
- 命令示例检查：`pnpm test:module --module core/platform/node/files --list`、`pnpm test:module --module logic/web/service --list`、`pnpm test:module --module logic/web/service --kind contract --list` 均选中实际用例；只列出而未运行测试。两处注释文件经 TypeScript AST 去注释比较与基线实现一致；生成器 `const norm` 起的全部算法文本与基线一致。`git diff --check` 通过。审核结果保存在忽略目录 `test-results/docs-integrity.json`，不作为新开发清单。
- 本轮为文档、注释和生成说明维护，未运行产品测试、类型检查、构建或全量回归；前一轮 CI 仍只证明其原验证提交。61 份受影响架构文档同步；记录与文档独立本地提交，未 push、未合并或发布。维护者可从 README、`src/CONTRACT.md` 和 `src/logic/BOUNDARIES.md` 查看当前结构，再下钻具体模块；本次静态校正不声称完成全部业务行为或历史报告的逐条重新验收。

## 2026-11-14：四层迁移推送与全量回归

- 来源：用户明确要求推送这批迁移提交并执行一次全量回归；延续本会话已授权迁移，无对应迁移 Issue，不扩展到开放的 #65。工作区干净，远端无分歧，将 `de333bf0..eaa85d9d` 共 10 笔提交推送至 `origin/develop`，本地与远端 SHA 均核实为 `eaa85d9d4ef5637608ae50d7af226c4ffa80da01`。
- 命令：`git push origin develop`；`gh workflow run validate.yml --ref develop -f scope=full`。运行 [Validate CBIM #43458901536](https://github.com/nan023062/cbim/actions/runs/43458901536)，验证提交为上述 `eaa85d9d`，最终结论 success。
- 四片 Windows 完整执行当前发现的 482 个测试文件：第 1 片 120 文件 / 961 通过；第 2 片 121 文件 / 741 通过；第 3 片 121 文件 / 837 通过 / 1 跳过；第 4 片 120 文件 / 744 通过 / 1 跳过。合计 **3283 通过、0 失败、2 跳过**。两项跳过来自 `owner-execution-legacy.test.ts` 和 `knowledge-source-lifecycle-application.test.ts` 的既有条件：CI 没有对应历史 EXE，不代表这两项历史制品兼容验收通过。
- CI 中 `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:test-modules`、官网构建及浏览器检查全部通过。四片分别执行 `pnpm exec vitest run --shard=<1–4>/4 --reporter=default --reporter=json --outputFile=test-results/pr-full-suite.json`，最终汇总验证实际发现、分配与执行全集一致，无遗漏或重复。
- 下载全部四片报告到本地忽略目录 `test-results/migration-full-43458901536/windows-validation-<1–4>/`，执行 `node scripts/ci-test-coverage.mjs test-results/migration-full-43458901536` 再核对，返回 482 文件 / 3283 通过 / 0 失败 / 2 跳过，发现集摘要 `8ec9b4032222d8b1ecf3bcb32e4bbd4ab48627298b9f5cf801458fcceaec6fc3`。远端报告由该运行的 artifacts 留存。
- 本次没有产品代码修复；验证记录单独提交。全量回归已完成，未合并到 master、未执行桌面打包或安装升级验收、未发布；保留旧空目录的环境策略限制不影响干净 CI 检出。

## 2026-11-13：连续迁移第五批／View 与四层规则收尾

- 用户授权连续完成所有迁移，基线 8aa3533c。原 frontend 源码、样式和入口迁入 src/view；182 个受影响源码 AST 比对无实现差异。Core、Logic、Bridge、View 均已落地，旧 backend/frontend/foundations 源码层级不再获准，新旧路径不保留无消费者转发。
- 正式依赖矩阵只保留四层及平台/通信子边界；旧层即使没有导入也拒绝。保留领域规则禁向运行服务、只有 execution/assembly 选择引擎、更新与冷壳的窄依赖、浏览器环境及私有入口限制。模块单元仍不加载完整 Application；源路径扫描、测试夹具和 UI 冒烟脚本的旧引用一并修正，未删除原覆盖。
- pnpm exec vitest run tests/brain-status.test.ts tests/conversation-activity.test.ts tests/thread-recovery-notice.test.ts tests/usage.test.ts tests/conversation.test.ts tests/knowledge-tool-view.test.ts tests/markdown.test.ts tests/run-view.test.ts tests/governance-feedback-view.test.ts tests/governance-origin-view.test.ts tests/governance-pending.test.ts tests/knowledge-file-tree.test.ts tests/static-owners.test.ts tests/repository-connection-state.test.ts tests/resource-application.test.ts tests/budget-settings-view.test.ts tests/conversation-tabs.test.ts tests/runtime-navigation.test.ts tests/tabs.test.ts tests/artifact-report-view.test.ts tests/candidate-review.test.ts tests/command-verification-view.test.ts tests/continuation-source-view.test.ts tests/controlled-file-view.test.ts tests/effect-observation-view.test.ts tests/execution-recovery-repeat.test.ts tests/execution-report-view.test.ts tests/member-cancellation-view.test.ts tests/member-checkpoint-view.test.ts tests/member-dependency-addition-view.test.ts tests/member-dependency-revision-view.test.ts tests/member-dependency-view.test.ts tests/member-help-view.test.ts tests/output-manifest-view.test.ts tests/scope-budget-view.test.ts tests/scope-continuation-view.test.ts tests/scope-replan-view.test.ts tests/scope-usage-view.test.ts tests/session-task-view.test.ts tests/task-graph-layout.test.ts tests/task-history-view.test.ts tests/agent-history-view.test.ts tests/team-model.test.ts tests/workspace-member-view.test.ts tests/update-button-state.test.ts tests/module-ownership-view.test.ts tests/unit/frontend/foundations/utility/async.test.ts tests/unit/frontend/foundations/utility/events.test.ts tests/unit/frontend/foundations/utility/graphs.test.ts tests/unit/frontend/foundations/utility/json.test.ts tests/unit/frontend/foundations/utility/storage.test.ts tests/ipc-browser.test.ts tests/ipc-preload.test.ts tests/ipc-desktop.test.ts tests/provider-connections.test.ts --reporter=default：55 文件/342 项通过。包含迁移视图模块单元与浏览器/preload/桌面桥接直接契约。tests/dependencies.test.ts 的 144 项、tests/layer-boundaries.test.ts 的 2 项、tests/test-modules.test.ts 的 10 项通过；新增旧层禁用回归，过时模拟路径迁到实际职责位置。
- 最终路径消费者补验：pnpm exec vitest run tests/core-layer-contracts.test.ts tests/source-architecture.test.ts tests/test-modules.test.ts tests/agent-history-ipc.test.ts --reporter=default。修正规则入口目录匹配后 core-layer-contracts 单独重跑 2 项通过，其余 18 项通过；去重后本片 61 文件/508 项不同用例通过。原断言仍覆盖无环、跨层、完整应用夹具、类图漂移和全部实际 IPC 操作映射。
- pnpm typecheck、pnpm check:architecture（128 目录/733 代码样式，1477 文件/7208 依赖，0 环/违规）、pnpm check:test-modules（482 测试文件，138 unit/154 contract/190 integration）通过。所有源码文档链接及三宿主工作流镜像一致。pnpm exec vite build --config vite.renderer.config.ts --outDir test-results/four-layer-view 通过，保留大于 500 kB 的既有 bundle 提示；这只是渲染构建，不是桌面打包或安装验收。
- 同步 src/CONTRACT、Logic 边界与生命周期、Bridge/View 契约、目录类图、四层设计和 AGENTS/三套 AI 工作流。Q1 既有交互与状态；Q2 业务/通信/视图与平台分离；Q3 模块及真实边界验证；Q4 从 src/ARCHITECTURE.md 下钻；Q5 环境执行策略拒绝删除磁盘上的旧空目录（递归与仅删空目录方案均拒绝），保留为空，Git 已删除全部旧源码且不跟踪空目录。
- 五个独立本地迁移提交完成。未 push、未合并、未发布，未运行全仓 CI、完整桌面或安装升级验收；留后续集成阶段。迁移没有拆开原共享事务，也不把目录收敛或文件无环描述成全部业务耦合已消除。

## 2026-11-13：连续迁移第四批／业务服务、更新与宿主桥接

- 用户已授权连续完成迁移，基线 a54a7c06。94 个旧 Main/Updater/Bootstrap 源文件迁入各领域 service/storage/platform、Logic Application 与 Bridge/server。系统加密归 Core Electron，旧锁转发删除，仍使用唯一 KernelLock。旧 backend 已无维护源码。
- Application 的状态、构造及全部生命周期实现经 AST 去除 imports/dispatch/接口声明后与原版一致。Bridge 适配器继承业务实例且只补充 dispatch；不覆盖业务方法、不复制状态。其余语法差异仅两个文件的类型导入拆分/别名；附件、工作区、包结果和更新类型归业务，Bridge 具名转接，业务到 Bridge 的反向依赖清零。
- 保留原权限、事务、共享账本、未知结果、取消和排空；引擎选择、冷壳可见范围、规则到服务与服务到 Application 方向分别检查。实际跨模块公开入口单独登记。终端与预算设置单元归属随真实职责拆开，原集成覆盖保留。构建输入路径与固定输出文件名对应关系已核对，未运行制品或升级验收。
- pnpm typecheck、pnpm check:architecture（128 目录/733 源码样式，1477 文件/7208 依赖，0 环/违规）、pnpm check:test-modules（482 文件）通过。tests/dependencies.test.ts、tests/layer-boundaries.test.ts、tests/test-modules.test.ts 合计 153 项不同用例通过；迁移时修正模拟输入的相对路径，保留禁向、私有入口和完整应用夹具断言。新增 6 项宿主/生命周期边界回归。
- pnpm exec vitest run tests/command-evidence-store.test.ts tests/ipc-requests.test.ts tests/native-session-files.test.ts tests/artifact-files.test.ts tests/controlled-namespace-platform.test.ts tests/png-artifact-files.test.ts tests/scoped-execution-platform.test.ts tests/isolated-node.test.ts tests/desktop-updates.test.ts tests/nsis-differential-download.test.ts tests/nsis-updater.test.ts tests/release-http.test.ts tests/update-restart-profile.test.ts tests/terminal.test.ts tests/budget-settings.test.ts tests/dispatch-store.test.ts tests/request-budget-ports.test.ts tests/run-journal-integrity.test.ts tests/agent-history-assembly.test.ts tests/controlled-file-service.test.ts tests/isolated-executions.test.ts tests/runtime-manifest.test.ts tests/runtime-journal.test.ts tests/runtime-store.test.ts tests/runtime-updates.test.ts tests/application-runtime.test.ts tests/chat-inputs.test.ts tests/workspace-packages.test.ts tests/ipc-desktop.test.ts tests/workspace.test.ts tests/knowledge-source-lifecycle-fault.test.ts --reporter=default：31 文件/215 项通过。覆盖受影响模块单元及工作区、知识事务故障、IPC、受控文件、派发存储和更新恢复实际协作；不是全仓回归。测试合计 34 文件/368 项。
- 注释、类图、业务契约与调度说明、四层设计、三宿主工作流同步；孤立旧目录契约已归回所属模块。Q1 原事实与关闭顺序；Q2 业务生命周期与消息路由拆开；Q3 模块及直接协作验证；Q4 Logic/BOUNDARIES、Application 与 Bridge/server 类图；Q5 无。未运行全仓、完整桌面、构建或安装升级。下一片迁移 View 并清理过渡边界，当前仅本地提交。

## 2026-11-13: Logic execution and orchestration migration

- Authorized sequential four-layer migration; baseline 02ec6db1. Moved 95 engine/orchestration files into their Logic domains. 110 affected source files compared by TypeScript AST: no implementation differences after import/comment normalization. Kept native protocol, durable identity, permission, recovery, cancellation and build output semantics.
- Registered actual public entry files; only execution/assembly selects concrete engines. Rules cannot depend on runtime services. Updated consumers, build/test paths, module ownership, comments, diagrams, contracts and all three workflow entries.
- pnpm typecheck; pnpm check:architecture (1472 files, 7202 edges, zero cycles/violations); pnpm check:test-modules (482 suites) passed. Boundary regression: tests/dependencies.test.ts + tests/layer-boundaries.test.ts = 137 passed; tests/test-modules.test.ts = 10 passed. Repaired two stale fixture paths and generated the missing new directory diagrams; original restrictions retained.
- pnpm exec vitest run tests/native-tool-paths.test.ts tests/claude-engine.test.ts tests/codex-engine.test.ts tests/codex-tools.test.ts tests/codex-write-recovery.test.ts tests/engine-inactivity-pi.test.ts tests/model-request-budget-bootstrap.test.ts tests/pi-cancellation.test.ts tests/pi-rpc.test.ts tests/pi-tool-catalog.test.ts tests/model-request-budget-usage.test.ts tests/scope-usage-service.test.ts tests/main-history-context.test.ts tests/message-queue.test.ts tests/questions.test.ts tests/global-runtime.test.ts tests/public-run-events.test.ts tests/candidate-review-tools.test.ts tests/coordination-schema.test.ts tests/web-tools.test.ts tests/engine-runtime-binding.test.ts tests/engine-runtime-loader.test.ts tests/engine-inactivity.test.ts tests/run-admission.test.ts tests/automation-scheduler.test.ts tests/execution-collaboration.test.ts tests/goal-repair.test.ts tests/member-failure-limit.test.ts tests/command-verification-service.test.ts tests/agent-history-store.test.ts tests/member-events.test.ts tests/dispatch-tools.test.ts tests/github-feedback-tools.test.ts tests/question-tools.test.ts --reporter=default: 34 files, 203 passed. Selected migrated modules and direct orchestration contracts, including actual CLI cancellation/protocol fixtures. No full suite, packaging or desktop upgrade run.
- Q1 unchanged state and runtime facts; Q2 domain scheduling vs engine selection; Q3 module and direct contract verification; Q4 src/logic/SCHEDULING.md and domain diagrams; Q5 none. This slice is a local commit; remaining services/Bridge/View continue next.

## 2026-11-13：连续迁移第二批／领域规则与端口

- 来源为用户已授权的四层迁移，基线 d1c57e71。旧 backend/core 的 219 个文件迁移：领域规则归 logic/<业务>/rules，身份及工作区路径归业务 ports；严格 JSON 错误适配、hash/json 兼容函数归 Core，旧 Fault 转发删除，消费者使用同一构造器。408 个受影响源码经 TypeScript AST 规范化比对，除模块路径与注释外无实现差异。
- 保护既有事务、权限、幂等、未知结果及恢复语义；不聚合领域总 barrel，保留实际跨领域消费者使用的 197 个细粒度入口。原私有读模型、存储端口和运行环境限制继续有效，新增未登记入口、规则反向服务依赖回归。领域聚合仍有协作关系，不以文件无环宣称完成全部解耦。
- 同步消费者、测试登记、检查器所有权、源码注释、118 份目录类图及相关契约、四层说明和三宿主工作流。pnpm typecheck、pnpm check:architecture（1471 文件/7201 依赖，0 环/违规）、pnpm check:test-modules（482 测试文件）通过。原模拟路径导致的 9 个边界失败已修复，未删除断言。
- pnpm exec vitest run tests/dependencies.test.ts tests/layer-boundaries.test.ts --reporter=dot：132 项通过；新增边界用例单独 -t 'domain migration'：5 项通过、130 项未选中；tests/test-modules.test.ts 前次 10 项通过。业务验证选择迁移领域自身单元及其直接协作契约：pnpm exec vitest run tests/connector-registry.test.ts tests/task-progress.test.ts tests/engine-session.test.ts tests/runtime-usage.test.ts tests/governance-feedback-wire.test.ts tests/module-governance-core.test.ts tests/module-governance-feedback-core.test.ts tests/knowledge-queries.test.ts tests/core-domains.test.ts tests/effect-observation-core.test.ts tests/human-continuation-core.test.ts tests/human-decisions-core.test.ts tests/queued-dependency-replacement-core.test.ts tests/queued-dependency-revision-core.test.ts tests/scope-active-input-core.test.ts tests/tool-registry.test.ts tests/workflow-contract.test.ts tests/scope-usage-metering.test.ts tests/knowledge-query-ports.test.ts tests/rules.test.ts tests/dispatch-graph.test.ts tests/engine-tools.test.ts tests/engine-capabilities.test.ts tests/controlled-file-core.test.ts tests/owner-execution-core.test.ts tests/workspace-member-core.test.ts tests/execution-scope.test.ts tests/repository-tool-core.test.ts --reporter=default，28 文件/220 项通过。合计 31 文件/367 项不同用例通过。
- Q1 状态与实现保持；Q2 规则和服务边界保留；Q3 模块单元及直接契约验证；Q4 logic 各业务 rules/ports 的类图为 review 入口；Q5 无。未运行全仓回归、打包、桌面和升级验证，留后续集成。后续继续有状态服务、调度、Bridge/View；本片独立本地提交，不代表全部迁移完成。

## 2026-11-13：连续迁移第一批／资源仓库

- 用户授权依次完成剩余四层迁移；基线 650c186e，初始干净，开放 Issue 仅无关 #65。C3/L3。先迁边界已闭合的 LocalRepository、RemoteRepository、ResourceRepositories 到 logic/resources/service；Bridge 的纯资源定义归 logic/resources，包/知识事务仍待其依赖闭合后迁移。ResourceRepositoryPaths 仅注入三个目录属性，替代对 Main Paths 的类型依赖；既有 Paths 结构兼容。
- 保持原 CAS、锁名、摘要、文件格式、取消、只读共享代际与未知写结果；Logic 不依赖 Main 或 Bridge。新增公开入口与精确迁移许可，调用方及原 HTTP 子进程测试入口同步。源码注释、类图、契约、四层设计与三宿主工作流同步。
- 类型及架构、测试归属检查通过：105 目录/730 源码样式，1471 文件/7201 依赖，0 环/违规；482 测试文件（138 unit、154 contract、190 integration）。命令：pnpm typecheck、pnpm check:architecture、pnpm check:test-modules。
- `pnpm exec vitest run tests/resource-store.test.ts tests/resource-repository.test.ts tests/repository-connection-http.test.ts tests/repository-connection-service.test.ts tests/repository-tools.test.ts tests/chat-material-imports.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts tests/test-modules.test.ts --reporter=default`：9 文件/180 项通过；`pnpm exec vitest run tests/utility-body-consumers.test.ts -t repository --reporter=default`：2 项通过、9 项按选择器未运行。合计 10 文件/182 项，覆盖本模块 CAS、共享/授权/资料消费者、真实网络取消及修改过的检测规则，不运行无关全仓。
- Q1 原身份/版本/权限与提交语义；Q2 仓库服务与知识包事务分别定位；Q3 单元与实际协作验证保留；Q4 logic/resources 的纯入口和 service 契约；Q5 无。回退单位为此片全部路径、消费者与规则。仅本地提交；后续继续领域、调度、Bridge/View 与旧入口清理，不将本片视为全部完成。

## 2026-11-13：Logic 第三步／反馈服务

- 来源：用户明确授权迁移反馈服务并运行反馈模块测试；基线 ac62d9d3，初始工作区干净。开放 Issues 查询仅 #65，与本次目录迁移无关，未写入无关工单。C3/L3；阅读反馈输入、授权、账本、HTTP、工具策略、Main/IPC 装配和原生锁实际依赖，本片不包含资源或模块治理反馈业务迁移。
- 反馈纯契约迁到 src/logic/feedback/index.ts，GitHubFeedback/GitHubFeedbackAuth 及传输迁到 service；宿主只通过 service/index.ts 装配。githubFeedbackScopeSchema 的唯一实现归反馈领域，旧工具范围组合并兼容重导出它，避免 Logic 依赖旧工具。Bridge 仅具名转接配置 Schema 和公开连接状态，不能导出提交端口、凭据或服务；旧调度/Core 仅获准纯入口。HTTP 文件独立登记逻辑边界与测试责任。
- KernelLock 实现迁到 src/core/platform/node/locking.ts；旧 Main/platform/locking.ts 仍有工作区、资源、执行消费者，保留同一构造器的兼容重导出，共享原进程内 held 集合。Windows/POSIX 实现、锁名、scope、错误及关闭语义未重写。反馈直接组合 Core 的 SecretCipher、Fault、摘要、文件和锁，不依赖模型业务或旧 Main。原配置、指纹、先保存 sending 再 POST、结果未知禁止重发及原目标核实保持，不修改用户数据。
- 测试拆分：纯字段/正文/范围、授权状态和 HTTP 各自单元登记；授权单元直接构造 Auth，使用请求、加密、锁替身与临时文件。提交契约保留真实 Auth/文件/原生锁，原 pending 下不得装配提交端口的断言仍在契约中。新增原生锁集成验证旧新入口同构造器、互斥与释放；工作区跨进程锁及真实 Pi 调用链另选原集成用例，没有以替身删除真实边界覆盖。
- 首轮依赖检查拦下遗漏的旧范围导入造成的循环，以及 HTTP 测试直达未公开文件；模块选择器据此拒绝执行，没有回退全仓。补齐范围归属、独立 HTTP 边界后依赖通过。该循环亦曾使工具回执类型推断失败；修复后仅剩新增测试联合类型未收窄，补充 kind 检查后类型通过，并补跑该测试 3 项通过。产品实现未因测试作行为改写。
- 模块测试：`pnpm test:module --module logic/feedback`（1 文件/3 项）、`pnpm test:module --module logic/feedback/service`（1 文件/9 项）、`pnpm test:module --module logic/feedback/http`（1 文件/1 项）通过。选择依据是纯业务协议、独立授权状态与有界传输责任。
- 直接相关边界：`pnpm exec vitest run tests/github-feedback.test.ts tests/github-feedback-tools.test.ts tests/github-feedback-status.test.ts tests/kernel-lock.test.ts tests/ipc-requests.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts tests/test-modules.test.ts --reporter=dot`，8 文件/187 项通过。`pnpm exec vitest run tests/utility-body-consumers.test.ts -t github --reporter=dot`，2 项通过、9 项未选择；`pnpm exec vitest run tests/workspace.test.ts -t '目录别名与跨进程工程互斥' --reporter=dot`，1 项通过、9 项未选择。`pnpm exec vitest run tests/github-feedback-pi.test.ts tests/github-feedback-lifecycle-pi.test.ts --reporter=dot`，2 文件/5 项通过，使用真实本地 Pi 路径及测试 HTTP，不访问在线 GitHub。合计 15 个文件、208 个不同用例通过，18 项选择器排除不计通过。
- `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:test-modules` 最终通过：103 目录/727 源码样式，1467 扫描文件/7190 依赖/0 环与违规；481 测试文件（137 unit、154 contract、190 integration）。15 个原源码实现去除导入/重导出/注释及单独核对的范围声明后语法一致；范围字段与约束逐项保持，锁与异常使用同一实现。
- Vite 自带 esbuild 对反馈纯入口和桥配置入口做 browser/esm/write:false 打包，12/13 个输入，无服务/平台输入；宿主服务做 node/esm、external koffi、write:false 构建，28 个输入。没有生成发布制品。同步源码注释、受影响类图/契约、四层设计、AGENTS 和三宿主工作流，旧 feedback 目录及无消费者协议文件删除，保留仍使用中的 scope/locking 兼容出口。
- Q1 保持授权代际、加密、锁、发送屏障和回执归属；Q2 反馈字段与格式归纯契约、登录与账本归业务服务、原生互斥归 Core；Q3 按纯行为、直接消费者、真实平台和 Pi 链路验证；Q4 logic/feedback/CONTRACT.md → service/CONTRACT.md → auth/提交/HTTP，对应修改各自责任测试；Q5 无新增自动治理。回退单位为本片目录、规则、消费者与测试的完整提交；保留人工 review。未运行全量回归、在线 OAuth/真实 Issue 提交、完整桌面制品或发布验收；本轮仅本地提交，不 push、合并或发布。

## 2026-11-13：Logic 第二批第一片／Web 服务

- 来源：用户明确授权迁移 Web 服务并运行 Web 模块测试；基线 03abb281，初始工作区干净。开放 Issues 仅 #65，与本片无关，未修改无关工单。C3/L3；范围为网页协议、服务、配置及其技术基础和消费者，不包含反馈及资源业务迁移。
- `src/logic/web/index.ts` 公开纯业务契约，`service/index.ts` 公开 WebService/WebSettings。便携协议及正文转换迁入 Core web，HTTP/代理/页面读取进入 Core platform/node/web，Electron 读取器单独装配。旧 Web 目录及转发入口删除；SecretCipher 提升为 Core 契约，models/ports 保留同名类型重导出兼容原消费者。文件格式、策略缺省、凭据保存、缓存及错误语义不变，不改写用户数据。
- 迁移例外限定为公开入口：旧 Core/Main/调度只按规则访问 Web 纯契约，Main 与桥服务访问 service/index.ts，Electron 读取器仅由桌面 main.ts 装配。bridge/contracts/web.ts 只具名导出 webConfigureInput/WebSettingsView；拒绝星号、服务、凭据及私有文件穿透，前端与桥客户端仍禁止平台实现。WebService 增加可选第五个读取端口参数，原四参和默认真实读取器不变，使业务适配单元独立于 Core 读取实现。
- 测试按责任拆分：原 robots/缓存/重定向等用例移入 web-page-reader，正文转换移入 web-content；真实 HTTP 取消/限额移入 web-http-transport，与真实代理一同明确登记为 integration。web-browser-fallback 保留真实读取器和服务的 contract 覆盖。服务单元增加策略捕获、取消信号、untrusted 标记、非法输入拒绝和原始失败透传；设置单元保持临时目录及加密替身。原断言保留，无跨测试套件导入，归属同步 tests/modules.json。
- 验证选择为迁移模块、Web IPC/工具消费者和修改过的边界检查器。`pnpm test:module --module logic/web/service`：2 文件/7 项通过。`pnpm exec vitest run tests/web-content.test.ts tests/web-foundations.test.ts tests/web-page-reader.test.ts tests/web-browser-fallback.test.ts tests/web-browser-proxy.test.ts tests/web-http-transport.test.ts tests/web-tools.test.ts tests/web-settings-ipc.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts tests/test-modules.test.ts --reporter=default`：11 文件/177 项通过。合计 13 文件/184 项；未以全仓测试替代模块验证。
- `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:test-modules` 通过：102 目录/724 源码样式，1460 扫描文件/7176 依赖/0 环及违规；477 测试文件（134 unit、154 contract、189 integration）。迁移语法比较覆盖 18 个原有源码文件，除 WebService 的可选端口注入外，去除导入、重导出和注释后的实现一致。
- 使用 Vite 自带 esbuild 做 browser/esm/write:false 打包：logic/web/index.ts、bridge/contracts/web.ts、core/web/index.ts 分别为 12/13/32 个输入，无服务或平台实现。Electron 测试夹具以 node/esm、external electron、write:false 构建通过（56 输入），未启动 Electron。同步文件头和接口注释、受影响类图、Core/Logic/旧目录契约、四层设计、AGENTS 及三个宿主工作流；末轮旧链接说明修正后重新生成类图，0 漂移。
- Q1 保持抓取/robots/缓存/持久化原行为；Q2 业务配置归 Logic，读取机制按平台归 Core，资源生命周期不进入 UI；Q3 分开验证单元、跨模块兜底和真实网络边界；Q4 logic/web/CONTRACT.md → service，技术机制从 core/web 与 platform/node/web 下钻；Q5 无新增自动治理。回退单位为本片迁移、消费者、测试归属与边界规则的完整提交，保留人工 review。本轮不含 push、全量回归、真实网站、完整桌面运行或发布验收。

## 2026-11-13：Logic 第一批／模型目录、供应商连接与选型

- 来源：用户明确授权迁移第一批并运行模块测试；基线 aaa050df，初始工作区干净。开放 Issues 查询仅 #65，与本片无关，未修改无关工单或创建平行待办。C3/L3；沿模型设置、主 Agent 选型、岗位配置锁和执行快照核对真实消费者，未宣称全仓逐行审计。
- 目录与规则迁到 src/logic/models，index.ts 为纯入口；LlmProfiles 迁入 service/llm-profiles.ts，经 service/index.ts 向宿主公开。两个边界分别登记，纯规则禁止导入服务、Node、Electron 或 SDK，Logic 不引用旧 backend、Bridge 或 View。旧 Main 的服务访问与旧 Core/引擎/调度的纯入口访问精确登记，没有开放整个 Logic。主 Agent 设置和逐请求预算仍留旧目录。
- Node 单文件原语同步迁到 src/core/platform/node/files，真实消费者改为新入口，无旧 files 转发；通用 Fault/fail 位于 src/core/errors.ts，旧 errors.ts 仍被旧业务使用，作为同一构造器的兼容出口保留。服务只组合 Core 的文件、队列、错误与注入的加密端口；原文件格式、凭据保存条件、锁范围、延迟解密、运行快照及失败语义不变，不重写用户数据。
- Bridge 配套限制：仅 bridge/contracts/models.ts 具名重导出纯模型规则，ipc-settings/model-actions 改经该契约使用 Schema。保留现有同步草稿预览及共同选型；检查拒绝星号、凭据类型和其他 Bridge 文件直接引入 Logic。此处为过渡债务，后续 DTO/预览迁移时连同真实消费者退出，未宣称 Bridge 已解耦。首轮类型检查发现漏导出 connectionSchema/definition，补齐原有校验契约后通过；首轮依赖检查发现服务穿透纯规则私有文件，改用 index.ts 后通过。
- 测试责任调整：模型目录单元只验证 parseModelCatalog；原 Pi SDK 容量断言完整移入 model-capacity-sdk 契约。供应商无 UI 的 11 项断言移入独立模型单元，界面联合断言保留原契约；无跨套件导入或删除原覆盖。配置服务单元保留临时目录、加密替身、排队、锁内失效和错误验证；所有新增/移动归属同步 tests/modules.json。
- 验证命令及选择依据：`pnpm test:module --module logic/models`，2 文件/12 项通过；`pnpm test:module --module logic/models/service`，2 文件/21 项通过。`pnpm exec vitest run tests/unit/foundations/files.test.ts tests/unit/core/errors.test.ts tests/engine-configuration.test.ts tests/provider-connections.test.ts tests/model-capacity-sdk.test.ts tests/main-agent-settings.test.ts tests/model-actions.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts tests/test-modules.test.ts --reporter=dot`，10 文件/126 项通过。选取依据为迁移基础机制、真实模型/界面/主 Agent/IPC 消费者及修改过的边界检查器；应用夹具仍按既有 integration 登记，未伪装成单元。合计 14 文件/159 项通过。
- `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:test-modules` 通过：98 目录/719 源码样式，1452 扫描文件/7162 依赖/0 环及违规，474 测试文件（133 unit、154 contract、187 integration）。规则新增纯入口/宿主入口、私有实现、反向依赖、运行环境和具名桥出口回归。
- 迁移语法核对覆盖 62 个原有源码文件：61 个去除导入/重导出与注释后的语法一致，余下 auto-collaboration 仅改内联 import type 的路径，已核对完整 diff。原错误类/抛出实现保留，旧兼容出口指向同一构造器。用 Vite 自带 esbuild 对 logic/models/index.ts 和 bridge/contracts/models.ts 做 browser/esm/write:false 打包：分别 16/19 个输入、131704/132825 字节，无 service、平台或 Electron 输入，未写出构建制品。
- 同步受影响源码注释、38 份生成类图、Core/Logic/旧模块契约、四层迁移设计、AGENTS 与三宿主工作流。9 份工作流一致；61 份受影响 Markdown 的 2039 个本地链接有效。Q1 保持选型优先级、原文件/快照及锁和失败语义；Q2 供应商变化归模型规则，存储/探测变化归服务，基础机制归 Core；Q3 用单模块行为、真实消费契约、静态边界及浏览器目标证明本片；Q4 models/CONTRACT.md → index.ts → provider-connections.ts 或 service/llm-profiles.ts；Q5 无新增自动治理规则。
- 回退单位为本片目录、消费者、测试归属及边界规则的完整提交。保留人工 review；本轮不含 push、合并、全仓测试、完整桌面构建、在线供应商或发布验收。后续业务迁移不属于本次交付范围。

## 2026-11-13：四层架构第一片／共享 Core 与依赖规则

- 来源：用户确认 Core、Logic、Bridge、View 四层，要求先建立 Core 和规则、再逐步迁移，并提供具体目录与第一步清单。基线 8b1dfd4e，初始工作区干净；C3/L3。当前开放 #65 与本片无关，按用户直接授权实施，不更改无关工单。目标及分片规格在 design/four-layer-architecture.md，当前实现契约在 src；不建立另一份实时待办。
- 第一片迁移原 backend/core/foundation/utility 的六个便携文件到 src/core/utility，Node SHA-256 单独迁入 src/core/platform/node/digest.ts。保留旧 hash/json/JSON Fault 业务适配，全部真实导入与测试同步，无旧路径转发。files/web、业务规则与存储暂留原位；旧 backend/core 不等同于新共享 Core，未将 Logic/View 的目标画成已全部迁移。Node 与便携测试分别归 core/platform/node、core/utility，原测试文件位置保持。
- 第一条双端消费者：前端 equalJson 删除本地排序递归，组合共享 orderJsonValue，显式保留 localeCompare、undefined、数组/整数键/Unicode 同序及异常行为；后端原各类指纹策略保持。队列、请求关联、流与运行生命周期不变。对照 52 个受影响源码，导入与注释外仅前端这一适配变化，其余算法语法一致。
- 依赖规则同时覆盖新目标层与旧迁移期边界：Core 不反向依赖业务、桥或视图；便携入口不引用平台；View 只使用桥客户端/契约及适用 Core；Bridge server 只能使用 Logic 各业务 index.ts，Logic 模块间同样不能穿透私有文件；旧引擎/调度/更新子系统不获得 Node/files/web 权限。Core 未登记模块拒绝，便携模块新文件也受第三方限制；View/前端/Bridge client/contracts 直接导入 node:、Node 内置或 Electron 同样拒绝。新增 29 条参数化/独立回归，包含类型依赖、公开/私有入口及运行环境；旧循环、别名、动态加载与模块测试边界回归保留。
- 首轮命令：`pnpm exec vitest run tests/unit/foundations/utility tests/unit/frontend/foundations/utility/json.test.ts tests/workspace-member-view.test.ts tests/module-ownership-view.test.ts tests/scope-continuation-view.test.ts tests/human-decision-view.test.ts tests/human-continuation-view.test.ts tests/utility-json-contract.test.ts tests/utility-json-order-contract.test.ts tests/utility-serialization-contract.test.ts tests/utility-body-consumers.test.ts tests/utility-redaction-contract.test.ts tests/utility-rpc-framing-contract.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts tests/test-modules.test.ts --reporter=default`，26 文件/231 项通过。选取依据为迁移库、前端比较与五个直接控制器、后端共享机制契约及规则检查器。随后补齐新层的独立矩阵检查，单跑 layer-boundaries 两项通过；增加直接 Node/Electron 绕过回归后仅重跑 dependencies 与 test-modules，76 项通过，最终共 26 文件/235 项通过。
- `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:test-modules` 通过：95 目录/716 源码样式；1446 扫描文件/7151 依赖/0 环与违规；471 测试文件（131 unit、153 contract、187 integration）。通过 Vite 自带 esbuild 对 src/frontend/foundations/utility/json.ts 做 `bundle:true, platform:'browser', format:'esm', write:false, metafile:true` 的浏览器目标验证：9779 字节、13 输入，无 Node/Electron/平台输入。不是完整桌面构建。
- 同步 Core/平台/前端适配及调用方注释、相关契约和类图、测试模块归属、AGENTS 与三宿主 AI 工作流。9 份工作流内容一致、66 处本地引用有效；首轮 48 份受影响/新增文档本地链接有效。Q1 原算法和消费者字节/失败语义；Q2 排序机制共享，业务/视图策略留本地；Q3 独立机制、实际消费者、层规则及浏览器目标验证；Q4 Core 契约→utility/index.ts 或 platform/node/digest.ts→equalJson/后端适配；Q5 无新增候选规则，四层及共享许可来自用户明确决策。
- 回退单位是本片目录、调用方、测试与规则的完整提交。未运行全仓、完整桌面、在线供应商、网站读取或发布验收；不声称后续 Logic/Bridge/View 物理迁移已完成。该片独立本地提交，未 push、合并或发布，保留完整 diff 供人工 review。

## 2026-11-13：后端公共库统一归入 Core/foundation

- 来源：用户明确要求将顶层 foundations 合并到 backend/core/foundation；基线 de333bf0，工作区初始干净，C3/L3。已查询当前开放 Issues，仅 #65 与本目录迁移无关，本项按用户直接授权实施，不改写无关工单。目的为统一后端公共库位置，不宣称目录移动带来新的业务解耦或性能收益。
- 将 utility/files/web 三个能力子目录及契约整体迁入，保留根层 Fault、safeId、StoragePaths 与 JSON/摘要兼容适配。原顶层目录退出，真实消费者、测试与桌面浏览器 fixture 直接使用新入口，无旧路径转发。前端公共库保持独立，仅更新其文档中的后端位置。测试模块 ID 及 tests/unit/foundations 测试路径保持兼容，modules.json 的源码归属同步迁移。
- 依赖保持单向：根层适配 → utility；子库不得依赖根层约定、Core 业务或上层。检查器以独立逻辑层识别新物理位置，Core 的宽路径许可不覆盖技术子库，根层约定许可不递归包含子库；Engines/Scheduler/Updater 仍仅使用 utility 通用入口，Bridge 不取得技术子库权限。公开入口、Node/可移植/Electron 隔离及原测试支持边界保留。
- 验证选取迁移的独立库、直接组合契约及被修改的检查器：`pnpm exec vitest run tests/unit/foundations tests/web-foundations.test.ts tests/web-browser-fallback.test.ts tests/web-browser-proxy.test.ts tests/web-service.test.ts tests/utility-json-contract.test.ts tests/utility-json-order-contract.test.ts tests/utility-serialization-contract.test.ts tests/utility-body-consumers.test.ts tests/utility-redaction-contract.test.ts tests/utility-rpc-framing-contract.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts tests/test-modules.test.ts --reporter=dot`。初轮 178 通过、2 条边界回归失败，证实原 Core 宽路径规则扩大了访问权；修正后仅重跑 `pnpm exec vitest run tests/dependencies.test.ts tests/test-modules.test.ts --reporter=default`，47/47 通过。合计 25 文件、180 项最终通过，新增父层反向依赖及 Updater/Bridge 权限回归，拒绝用无法解析的路径代替真实越界验证。
- `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:test-modules` 通过：92 目录、716 源码/样式文件；1446 扫描文件、7150 含类型依赖、0 环/违规；471 测试文件（131 unit、153 contract、187 integration）。按旧新路径映射比较 81 个受影响源码的去注释语法，导入外逻辑无差异；比较前统一工作树 CRLF 与 Git LF，避免模板字符串换行产生假阳性。三宿主 9 份工作流同内容，57 处本地引用有效；59 份受影响文档的本地链接有效。
- 同步源码边界注释、能力契约、受影响目录及父层类图、架构生成器、依赖检查、AGENTS 与三宿主工作流。Q1 保持原算法、错误、I/O 和资源生命周期；Q2 此次只统一物理归属，业务策略仍留原消费者；Q3 路径迁移以类型/依赖/语法对照及入口回归验证；Q4 从 core/foundation/CONTRACT.md 下钻各子库，业务入口仍在 Main/Core/Engines；Q5 无新治理规则，沿用既有独立边界。回退应整体还原本提交的目录、消费者及规则，不单独恢复旧目录。
- 未运行全仓、真实网站/Electron 冒烟、打包或发布验收，目录迁移未改变运行数据或产物入口；局部验证不代表这些阶段通过。代码与资料供人工 review，本步独立本地提交，未 push、合并或发布。

## 2026-11-13：候选清单收尾六／后端图校验与本轮交付

- 用户批量授权内最后一片，基线 7b009ac9，C3/L2。后端 graphs.ts 提供 isDirectedAcyclic，Core graph-rules 分别组合它检查派发/依赖图与等待图。节点/端点/父子身份、启用边选择及 GRAPH_CYCLE/GRAPH_WAIT_CYCLE 原错误仍留在 Core；公共层不认识业务或前端。无环判断不是授权，重复节点/缺端点由领域先校验，公共入口也拒绝无效结构。
- 命令：pnpm exec vitest run tests/unit/foundations/utility/graphs.test.ts tests/dispatch-graph.test.ts tests/checkpoint-handoff-core.test.ts tests/member-checkpoint-domain.test.ts tests/queued-dependency-addition-core.test.ts tests/queued-dependency-replacement-core.test.ts tests/workflow-selection-core.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts --reporter=dot：9 文件/97 项通过。独立算法覆盖空图、平行边、循环、非法端点、长链；领域测试覆盖图重放、防互等与依赖修订；新增私有类别进入检测清单并验证禁止直达。
- pnpm typecheck、pnpm check:architecture、pnpm check:test-modules 通过：93 目录/716 源码样式，1446 扫描文件/7150 含类型依赖，0 环/违规；471 测试文件（131 unit、153 contract、187 integration）。三宿主 9 份工作流同内容且 57 处本地引用有效；diff 空白检查通过。同步后端 utility/Core tasks 及前后端基础库汇总的五份类图、契约与注释，当前入口清单反映所有已交付类别。
- Q1 原领域防环与错误顺序；Q2 边选择及业务资格变化局限 Core；Q3 独立算法、图消费者与边界回归；Q4 utility/graphs.ts→Core graph-rules.ts；Q5 无新规则，历史频率未知。未运行全仓、完整桌面、打包或发布验收，验证不替代人工 review。
- 本轮原清单剩余六项均已交付：前端分层 d13f402d、本地记录 ffe8c058、后端 JSON 7711dead、脱敏 0fbd20af、RPC 7b009ac9、后端图校验本条。分别验证与提交，完整 review 范围 git diff 4a1b2858..HEAD；之前 JSON 比较/订阅/异步代次三项保持。领域状态机、手工序列化特殊协议、HTTP/进程关闭/日志事务等原明确保留范围没有机械统一。无外部 Issue 写入、push、合并或发布。

## 2026-11-13：候选清单收尾五／后端 RPC 请求关联

- 用户批量授权内，基线 0fbd20af，C3/L2。沿 Pi/Codex 的 register、回包、超时、fail、close 精读实际协议；共同 ID/回调/定时器下沉 async.ts 的 PendingRequests，实例独立，重复 ID 拒绝覆盖，take 清计时器并移除，rejectAll 支持固定错误或逐项错误工厂。
- Pi 保留单请求超时后可继续、发送异常仍经原 Promise 构造器传播；Codex 保留整体失败/杀进程，close 仍等待进程与处理排空。自查发现关闭原本每请求独立 Error，已用工厂保留身份并补测试。集合不发请求、不重试、不宣称物理退出。
- 初轮命令：pnpm exec vitest run tests/unit/foundations/utility/pending-requests.test.ts tests/utility-rpc-framing-contract.test.ts tests/pi-rpc.test.ts tests/codex-lifecycle.test.ts --reporter=dot，4 文件/16 项通过。错误工厂变更后，仅重跑前三者中的 pending-requests、utility-rpc-framing-contract 及 codex-lifecycle（3 文件/15 项通过）；加上未受影响且已通过的 Pi 两项，共 17 项。覆盖独立关联、重复/乱序回包、单项/整体超时、关闭及实际 Pi 子进程。
- pnpm typecheck（工厂变更后复核）、pnpm check:architecture、pnpm check:test-modules 通过，0 环/违规；最终仅注释与契约汇总变更重新生成类图。utility、上层 foundations 及两个引擎四份类图、源码注释、契约与三宿主工作流同步。
- Q1 原协议/时限/失败及错误身份；Q2 进程与业务策略在适配器；Q3 独立数据结构和真实协议契约；Q4 async.ts→两份 rpc.ts；Q5 无新规则。历史变化频率未知。未运行全量、供应商在线或发布验收；独立本地提交未推送，保留人工 review。

## 2026-11-13：候选清单收尾四／后端字符串脱敏

- 用户批量授权内，基线 7711dead，C3/L2。strings.ts 增加 redactLiteral，Pi/Claude/Codex 的原精确 split/join 替换共用实现；空凭据、非重叠、大小写和 JSON 编码顺序保持。Pi 仍只对 api-key 认证替换，Claude 无凭据保留事件引用。凭据发现与事件失败屏障不下沉。
- 命令：pnpm exec vitest run tests/unit/foundations/utility/redaction.test.ts tests/utility-redaction-contract.test.ts tests/engine-inactivity.test.ts --reporter=dot：3 文件/17 项通过；独立字符串单元、三引擎适配契约及既有事件/异常生命周期。pnpm typecheck、pnpm check:architecture、pnpm check:test-modules 全通过，0 环/违规。
- utility/pi/claude/codex 四份类图与契约、源码注释、三宿主工作流同步。Q1 原精确替换；Q2 凭据策略仍在引擎；Q3 算法及适配契约；Q4 strings.ts→各 engine 的 redact/emit；Q5 无新规则。历史频率未知，不声称此函数能识别编码或变形凭据。未运行原生供应商、全仓、桌面或发布验收；本地独立提交未推送。

## 2026-11-13：候选清单收尾三／后端 JSON 复用

- 用户批量授权内，基线 ffe8c058，C3/L2。五处同义递归排序改为已有 orderJsonValue：岗位、来源、负责人绑定、人工决定依据、调度执行上下文。字符序与各自 undefined 规则显式保留，不改变输入、JSON 字节或领域指纹字段；手工拼接协议和排序后读取属性的不同实现保留。
- 调度层仅开放 utility/index.ts，私有 JSON、Node/files/web 仍拒绝。初轮依赖回归发现通用许可遮住细粒度预算规则；首次移动受 CRLF 影响未移除旧行，第二次定位并清除，最终将通用规则放在专用规则之后。现有细粒度拒绝与新增入口许可测试均通过，未弱化原检测。
- 命令：pnpm exec vitest run tests/unit/foundations/utility/json-order.test.ts tests/utility-json-order-contract.test.ts tests/workspace-member-core.test.ts tests/knowledge-source-core.test.ts tests/owner-execution-core.test.ts tests/module-ownership-core.test.ts tests/human-decisions-core.test.ts tests/human-continuation-core.test.ts tests/member-execution-context.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts --reporter=dot；初轮 135 通过/1 失败，仅重跑受影响 dependencies 后 33/33 通过，合计 11 文件/136 项最终通过。选择依据为排序单元、迁移后的领域校验/指纹及变更的边界检查器。
- pnpm typecheck、pnpm check:architecture、pnpm check:test-modules 通过；规则修正后 pnpm check:dependencies 再核实 0 环/违规。未运行完整 Pi/服务集成、全仓、桌面或发布。
- 五份类图、相关契约与源码注释、三宿主工作流及分层说明同步。Q1 历史字节；Q2 业务字段仍局限原消费者；Q3 单元/指纹与边界回归；Q4 utility/json.ts→五个适配；Q5 无新规则。历史频率未知，不把相似文本视为同一契约。独立本地提交未推送，保留人工 review。

## 2026-11-13：候选清单收尾二／前端本地记录读写

- 用户批量授权内第二片，基线 d13f402d，C3/L2。精读岗位与模块负责人持久命令的读取、保存、恢复和失败路径，实际重复为同步 JSON 与 UTF-8 限额，不是整个命令状态机。
- 新 storage.ts 的 JsonRecordStorage 注入存储端口、键与容量；两控制器迁移，原紧凑字节、空串规则、限额/IO 错误、先更新内存后写盘顺序不变。128 条数、schema、回执、corrupt/unavailable、未知只查询/显式重送仍属业务，其他不同存储策略未机械迁移。
- 验证命令：pnpm exec vitest run tests/unit/frontend/foundations/utility/storage.test.ts tests/inline-module-ownership.test.ts tests/knowledge-source-view.test.ts tests/module-ownership-view.test.ts tests/workspace-member-view.test.ts --reporter=dot：5 文件/40 项通过。pnpm typecheck、pnpm check:architecture、pnpm check:test-modules 通过，0 环/违规，467 测试登记。独立单元覆盖 UTF-8 精确边界、坏数据保留、端口故障及不缓存；消费者覆盖存储失败与未知恢复。
- utility/team/workspace 三份类图、契约、源码注释及三宿主工作流同步。Q1 原字节与故障策略；Q2 业务变化局限控制器；Q3 独立存储及直接消费者；Q4 storage.ts→两个 Commands；Q5 无新规则，历史频率未知。未运行全量、桌面或发布；本地独立提交未推送，保留人工 review。

## 2026-11-13：候选清单收尾一／前端拓扑分层

- 用户授权依次完成原清单；从当前会话核实剩余前端图布局/本地记录及后端 JSON/脱敏/RPC/图校验六项，当前开放 #65 无关，未更改工单。基线 4a1b2858，C3/L2，沿 tasks/graph-layout 精读真实启用边、分层、坐标及三套消费者测试。
- graphs.ts 提供 rankDirectedGraph 与结构错误；图层级脱离 GraphSnapshot，原重复节点检查、错误文案、边筛选、同层顺序与 SVG 路由保留。公共算法按类别组织，前后端无依赖。
- 验证：pnpm exec vitest run tests/unit/frontend/foundations/utility/graphs.test.ts tests/task-graph-layout.test.ts tests/member-dependency-view.test.ts tests/member-dependency-addition-view.test.ts --reporter=dot：4 文件/22 项通过。pnpm typecheck、pnpm check:architecture、pnpm check:test-modules 通过；0 环/违规，466 测试已登记。选择依据为纯拓扑及全部直接布局消费者。
- 注释、utility/tasks 两份类图、契约及三宿主开发/架构工作流已同步。Q1 保持原层级与绘制结果；Q2 几何变化止于任务布局；Q3 拓扑单元与实际视图测试；Q4 graphs.ts→graph-layout.ts；Q5 无新规则。机制稳定性依据真实使用，历史频率未知。未运行全量、桌面或发布验收；独立本地提交未推送，保留人工 review。

## 2026-11-13：前端实例异步代次提取

- 来源与基线：用户要求继续前端公共库下一个候选，按已核实清单推进异步响应失效控制，基线 f014d032（前两项已本地提交，未推送）。开放工单仅 #65，与此切片无关，未更改工单状态。治理 C3、认知 L2；复用分层和规范上下文，核对前端代次字段、真实请求/选择/销毁路径及直接消费者测试。
- 机制与迁移：在前端 utility 的 async.ts 提供 AsyncGeneration，经 index.ts 导出 capture、advance、isCurrent。每实例使用 Symbol 标记，捕获不作废旧标记，推进后全部旧标记失效，不复用数字版本、不跨实例命中。12 个消费者迁移：runtime 1、settings 1、shell 1、tasks 9；分别保留每请求推进、只捕获生命周期和选择/取消时推进的原规则。成功、失败及 finally 检查位置、响应验证次序、单次在途与轮询调度保持；不取消请求、不吞错、不统一 Promise 包装。
- 共同机制与合法差异：标记相等判断是稳定候选；失效时机、业务身份/版本、来源与草稿校验、状态发布和资源释放留在控制器。RuntimeFeed/AdmissionFeed 读取只捕获订阅代次，旧读取完成仍为当前订阅安排补读；负责人旧 finally 不清新 inFlight；重规划只隔离预览，冻结命令及其迟到回执仍处理。历史变化频率未统计，以实际消费者差异划界。带业务键的代次 Map、Hook 中混合生命周期的 ref、公开令牌/业务键中的数字序号暂未迁移，不能机械替换。
- 兼容自查：逆向还原本次代次调用、字段和导入后，12 个消费者的 TypeScript AST 与基线一致（去注释并规范化纯标记相等表达式左右顺序）。这证明迁移未夹带其他源码流程改写，不替代运行验证或人工 review；数值内部计数改成不透明标记是本步明确的内部表示变化。
- 注释与资料：实现、公开入口、12 个消费者文件头同步；utility/foundations 和 runtime/settings/tasks/shell 契约补齐边界，维护上述目录及 frontend 的 7 份类图。三套开发/架构工作流的 9 个入口同步且 57 处本地引用有效；未修改产品内置业务 Skill 或分层规则。
- 测试选择：新基础模块单元 4 项验证同代捕获、推进失效、实例隔离和不取消底层工作；预算设置补 2 项旧成功/失败及 finally 不覆盖新请求 busy 的回归。其余 14 个直接消费者套件覆盖原报告、轮询、导航、选择、取消和重规划行为，继续保留既有 unit/contract/integration 归属。实际命令：`pnpm exec vitest run tests/unit/frontend/foundations/utility/async.test.ts tests/admission-view.test.ts tests/artifact-report-view.test.ts tests/budget-settings-view.test.ts tests/command-verification-view.test.ts tests/execution-recovery-view.test.ts tests/execution-report-view.test.ts tests/model-request-budget-view.test.ts tests/output-manifest-view.test.ts tests/owner-execution-view.test.ts tests/runtime-feed.test.ts tests/runtime-navigation.test.ts tests/scope-replan-view.test.ts tests/scope-usage-view.test.ts tests/tabs.test.ts --reporter=dot`：15 文件、113 项通过。新单元只依赖前端 utility，不加载应用或消费者夹具。
- 静态验证：`pnpm typecheck`、`pnpm check:architecture`（93 目录/713 源码样式，1437 扫描文件/7127 含类型依赖，0 环/违规）、`pnpm check:test-modules`（465 文件：126 unit、152 contract、187 integration）及 diff 空白检查通过。未改检测器或分层规则，不重复其测试；未运行全量回归、桌面、打包、安装或发布验收，留后续自动化阶段。
- 维护交接：先读前端 utility/CONTRACT.md 与 async.ts，再读预算设置的成功/失败/finally 和 RuntimeFeed 的订阅生命周期。新增同类页面组合 AsyncGeneration，推进时机只改对应控制器，无需给基础类添加业务条件。Q1 保持迟到结果隔离及原校验次序；Q2 生命周期变化局限各消费者；Q3 独立单元、消费者回归与 AST 自查；Q4 async.ts/各控制器契约；Q5 无新增候选规则。本步独立本地提交，未推送，验证不代替人工 review。

## 2026-11-13：前端实例订阅集合提取

- 来源与基线：用户指定继续前端公共库订阅集合，基线 `b24348bb`（JSON 提取已本地提交、未推送）。开放工单仅 #65，与本步无关，未推进其状态；复用已核实的分层及治理约束，核对前端全部监听集合、订阅/通知/清理入口和直接消费者测试。范围 C3、认知 L2，只提取监听机制，不引入状态管理或跨域工具依赖。
- 实现：前端 utility 的 `events.ts` 提供 SubscriptionSet，经 index.ts 公开 subscribe、notify、size、clear。19 个控制器迁移：runtime 1、settings 1、tasks 15、team 1、workspace 1。集合每实例独立、按函数身份去重，注册不立即通知；notify 同步遍历当前 Set，通知中增删及重入语义保留，异常原样传播并中断本轮。无引用计数、快照、吞错、全局总线、自动调度或异步等待；旧退订删除重新注册的同身份监听器行为保留并有测试。
- 稳定与变化：各控制器仍先改状态再通知；RuntimeFeed/AdmissionFeed 保留首订阅读取、末退订停止计时、generation 与 pending；canRelease 仍包含原在途/预览条件，dispose 仍拥有请求失效及资源逻辑。集合只清监听器，不宣称取消请求或物理资源已退出。TypeScript AST 去注释对比：逆向替换本步监听机制后，19 个消费者与基线源码结构一致，没有附带业务逻辑改写。
- 注释与资料：新类别实现、公开入口与 19 个消费者文件头同步；维护 utility/foundations 契约、runtime/settings/tasks/team/workspace 五目录订阅边界，以及以上受影响目录和 frontend 的 8 份类图。三套开发/架构 Skill 的 9 个入口同步，明确集合机制与业务生命周期分离，全部本地引用有效。
- 测试选择与结果：新集合单元 9 项验证隔离、去重、退订身份、通知中增删、清空、异常、嵌套及不等待 Promise；预算设置补“先更新再通知，退订不阻止状态更新”回归；23 个直接消费者套件验证原页面、回执、恢复和轮询生命周期。实际命令：`pnpm exec vitest run tests/unit/frontend/foundations/utility/events.test.ts tests/artifact-report-view.test.ts tests/admission-view.test.ts tests/budget-settings-view.test.ts tests/controlled-file-view.test.ts tests/continuation-source-view.test.ts tests/command-verification-view.test.ts tests/inline-module-ownership.test.ts tests/human-decision-view.test.ts tests/human-continuation-view.test.ts tests/execution-report-view.test.ts tests/execution-recovery-view.test.ts tests/execution-recovery-repeat.test.ts tests/effect-observation-view.test.ts tests/knowledge-source-view.test.ts tests/model-request-budget-view.test.ts tests/module-ownership-view.test.ts tests/output-manifest-view.test.ts tests/owner-execution-view.test.ts tests/runtime-feed.test.ts tests/scope-usage-view.test.ts tests/scope-replan-view.test.ts tests/scope-continuation-view.test.ts tests/workspace-member-view.test.ts --reporter=dot`：24 文件/242 项通过。
- `pnpm typecheck`、`pnpm check:architecture`（93 目录/712 源码样式，1435 扫描文件/7124 含类型依赖，0 环/违规）、`pnpm check:test-modules`（464 文件：125 unit、152 contract、187 integration）及 diff 空白检查通过。新单元独立登记在 frontend/foundations/utility，无应用或业务夹具。未改变分层检测器，不重复其测试；未运行全仓、桌面、打包或发布验收。
- 维护交接：机制入口为前端 events.ts；新增同类通知在本域组合该集合，首末订阅副作用和状态规则仍修改对应控制器。Q1 保留原 Set 通知契约；Q2 生命周期变化局限原控制器；Q3 集合单元、直接消费者和 AST 对比；Q4 events.ts/控制器契约；Q5 无新增候选规则。验证完成不代替人工 review。本步独立本地提交，未推送。

## 2026-11-13：前端域独立提取 JSON 比较

- 来源与基线：用户明确要求从前端公共库的 JSON 比较开始，基线 `90da0806`；开放 Issues 仅 #65，与此切片无关，未推进该工单。沿用已核实的全局分层，再精读前端比较、五个控制器及消费者测试。前端和后端属于不同域，本步不开放跨域公共工具依赖；治理范围 C3、认知 L2，涉及前端公共入口与依赖边界，不改变业务契约。
- 已实现：新增 `src/frontend/foundations/utility`，以 `index.ts` 公开 `json.ts` 的 equalJson。岗位登记、模块责任、目标接续、人工决定、人工继续五处原排序比较改为消费前端入口；保留 localeCompare、对象 undefined 省略、数组顺序及原异常传播，不修改身份、版本、回执接受条件、持久化或恢复策略。原样 JSON.stringify 比较及负责人视图的特殊字典序/递归序列化保留原实现，未强行统一。
- 边界与维护：前端 utility 无项目或第三方依赖，类别实现私有；前端基础库不反向依赖页面、bridge 或后端，后端也不能消费此前端库。同步两份新 CONTRACT、两个新目录类图，以及 src、后端 foundations、frontend、tasks、team、workspace 六份相关架构文档；更新五个消费者文件头和新入口说明。三个开发/架构 Skill 的 9 个宿主入口保持一致，明确两域独立沉淀、按类别组织及本次比较的迁移限制。
- 测试选择：新比较模块自身单元覆盖嵌套键、数组、空值、冻结输入、自有危险名称键、Unicode 同序键及错误传播；选择五个控制器的直接使用套件，覆盖预览、回执、资料接续、准入及未知结果恢复。实际命令：`pnpm exec vitest run tests/unit/frontend/foundations/utility/json.test.ts tests/workspace-member-view.test.ts tests/module-ownership-view.test.ts tests/scope-continuation-view.test.ts tests/human-decision-view.test.ts tests/human-continuation-view.test.ts tests/inline-module-ownership.test.ts tests/knowledge-source-view.test.ts tests/continuation-source-view.test.ts tests/admission-view.test.ts --reporter=dot`：10 文件/112 项通过，其中公共比较单元 8 项、消费者 104 项。测试登记到独立 frontend/foundations/utility 模块，未引入完整应用夹具或跨套件依赖。
- 因变更依赖规则，运行 `pnpm exec vitest run tests/dependencies.test.ts tests/layer-boundaries.test.ts --reporter=dot`：2 文件/34 项通过，包含公开入口、私有实现、类型反向、跨域、React 越界拒绝。`pnpm typecheck`、`pnpm check:architecture`（93 目录/711 源码样式，1433 扫描文件/7108 含类型依赖，0 环/违规）、`pnpm check:test-modules`（463 文件：124 unit、152 contract、187 integration）与 diff 空白检查通过；三宿主引用与一致性核对通过。
- 维护交接：稳定候选是已有五处完全同义的前端值比较，业务接受规则仍局限在各控制器；新增同类比较先读前端 utility CONTRACT，再使用公开入口，语义变化须核对这些消费者。Q1 保护原比较契约；Q2 业务规则保留原控制器；Q3 使用公共单元、真实消费者与边界回归；Q4 修改入口为前端 json.ts 与相应业务控制器；Q5 无新增候选规则，两域分离落实用户已明确要求。未运行全仓回归、桌面、打包或发布验收，未宣称人工 review 已接受。本步独立本地提交，未推送。

## 2026-11-13：utility 按数据与问题类别合并文件

- 用户直接指定本轮整理：工具函数与数据结构按类别内聚，不采用一函数一文件；开放 Issue #65 与本步无关，未推进其状态。核对基线 `9cccc94e` 的 utility 全部实现、公开出口、依赖白名单、消费者契约测试和现行 AI 工作流，范围为文件组织，不扩展业务行为。
- utility 从 10 个源码文件合并为 6 个：`json.ts` 收拢格式化、严格解析、键排序；`async.ts` 收拢实例串行队列和在途集合；`strings.ts` 承载文本分帧；`bytes.ts` 承载有界字节流收集；`index.ts` 保持通用公开导出；`node.ts` 直接提供 SHA-256 并隔离 Node 依赖。删除旧私有路径，消费者导入和状态归属保持不变。
- 文件边界按类别组织，算法契约和实例状态仍独立：JSON 排序策略与严格解析不隐式组合；Promise 快照不代替物理退出；字符串与字节计量保持分离。现有单元套件继续按具体行为职责拆分，不因源码合并而混合测试。后续同类能力优先进入已有类别，明确的变化原因、环境或契约差异才驱动新文件。
- 同步全部受影响源码文件头与关键接口说明、utility CONTRACT、utility 与 foundations 两份 ARCHITECTURE、生成器目录定位、依赖白名单及对应私有路径回归。开发、架构治理、架构维护三个 Skill 的三宿主共 9 个入口一致，本地引用有效；工作流明确禁止机械的一函数一文件。
- 选取依据：公开 API 未变，验证 utility 各行为及真实消费者组合；依赖文件列表改变，验证分层检测器。`pnpm test:module --module foundations/utility --kind all`：13 文件/52 项通过；`pnpm exec vitest run tests/dependencies.test.ts tests/layer-boundaries.test.ts --reporter=dot`：2 文件/32 项通过。额外用 TypeScript AST 打印去注释后的声明，与基线逐项比较，12 个声明实现完全一致。
- `pnpm typecheck`、`pnpm check:architecture`（91 目录/709 源码样式，1430 扫描文件/7101 含类型依赖，0 环/违规）、`pnpm check:test-modules`（462 文件：123 unit、152 contract、187 integration）及 diff 空白检查通过。未运行全仓回归、桌面、构建或发布验收；本步独立本地提交，未推送或发布。

## 2026-11-13：合并远端 CI 与取消修复，收齐本地变动

- 用户授权提交/push 全部改动；任务历史视图已独立提交 `d342c05e`。正常合并远端 develop `9e3f4d49`，保留本地网页/基础库/测试模块化成果和远端 CI 分流、分片计时与覆盖核对、#70 取消修复回归；不强推或改写远端历史。
- 处理三处内容冲突：validate.yml 采用远端共享检查与分片布局，将本地 `check:test-modules` 放回共享静态任务且只运行一次；resource-http 保留已包含显式 reader 取消的 utility 路径，清理远端旧 readBody 的重复实现及过时类图/契约；开发记录保留双方完整新增段落。新增 CI 测试登记 tooling/ci-validation，并断言模块检查的实际工作流接线。
- 冲突相关验证：`& ./test-results/ci-speed/node22/node.exe ./node_modules/vitest/vitest.mjs run tests/ci-validation.test.mjs tests/repository-connection-http.test.ts tests/utility-body-consumers.test.ts --reporter=dot`，3 文件/50 项通过，包含真实 8 秒 HTTP 超时、未转发取消及 CI 聚合/分片/模块检查。任务历史 16 项结果见下一条记录，不重复运行未受合并影响的前端测试。
- `pnpm typecheck`、`pnpm check:architecture`（91 目录/713 源码样式，1434 扫描文件/7105 含类型依赖，0 环/违规）、`pnpm check:test-modules`（462 文件：123 unit、152 contract、187 integration）、`git diff --cached --check` 通过；四组 Skill 的三宿主入口一致。相关源码说明与资源目录类图已同步。
- 本步验证仅覆盖提交与合并实际影响，未运行完整四片 CI、桌面、打包或发布验收；未创建 PR、合并 master 或发布版本。正常推送当前 develop 后，以 Git 远端 SHA 和工作区状态核对结果。

## 2026-11-13：提交任务历史折叠并准备同步 develop

- 用户要求提交并 push 所有变动。基线 `4f7ba8db`，将此前保留的任务历史视图 7 个文件纳入独立提交；新增测试登记到 frontend/tasks 单元模块。已完成/撤销任务默认折叠、直接定位展开、完整拓扑先校验，均只影响展示，不改变任务状态或调度。
- 核对现有实现、注释、CONTRACT 与类图；执行 `pnpm exec vitest run tests/task-history-view.test.ts tests/session-task-view.test.ts tests/task-graph-layout.test.ts --reporter=dot`，3 文件/16 项通过；`pnpm check:test-modules` 通过（461 文件），`git diff --check` 通过。类型及类图检查沿用本轮之前对相同前端源码的通过结果，未重复运行桌面/全量测试。
- fetch 后本地 develop 有 7 个独有提交，远端有 6 个（CI 优化与 #70 修复等）。本步先保存完整本地工作；随后正常合并远端并验证冲突涉及的 HTTP/CI 边界，再推送 develop，不强推，不自动合并 master 或发布。

## 2026-11-13：utility 候选 5–7 与兼容策略组合

- S1 / 来源：用户直接授权继续候选提炼，并确认“完成剩余 5–7 即可”；原名单没有第 8 项。基线 `e6a5dd39`，本次开放 Issues 查询仅 #65，与本片无对应关系，未新建/修改外部工单。保留原任务历史视图的 7 个并行文件，不纳入提交。
- S2–S4 / C3、L2：核对 Core 证据/预算/知识/任务的对象排序、Main 文件/资料和三种 Run 能力的在途集合、Pi/Codex RPC。保护共同遍历/集合/拆行机制，把历史比较器、字段省略、业务关闭门禁、物理退出和协议限额留在调用方；未逐行审计全仓，也不把无环等同语义解耦。
- S5：新增 `orderJsonValue`，迁移 15 个 Core 排序适配，逐一保留 localeCompare/字符序及 undefined 规则；JSON 序列化与根 fingerprint 排除不变。新增 `InFlightOperations`，迁移 ControlledFiles、ChatMaterialImports、RunControlledFile/RunScopedExecution/RunArtifactTransition、codexTools 和 CodexRpc 共 7 处集合。新增 `LineFramer`，迁移 Pi/Codex 两处 LF 缓冲，保留 Pi 的 UTF-16 长度与去 CR、Codex 的 UTF-8 字节/原 CR、完整空白帧忽略及尾部限额。没有统一 RPC、取消控制器、短门闩或业务恢复。
- 兼容性实证：修改前保存 15 个真实排序实现，以 TypeScript 转译执行与新基础函数比较；6 组输入包含数组空位、undefined、数字键、危险键和非 ASCII，90 次对象结构/最终 JSON 比较一致。原始基线与结果留在本机 `test-results/utility-5-7/`；长期回归由模块单元和 `utility-json-order-contract.test.ts` 的真实消费者契约承担。保留图重放/治理手写字符串 canonical、工具失败参数和调度内部比较，不将不同序列化契约强行统一。
- 模块单元：`pnpm exec vitest run tests/unit/foundations/utility/json-order.test.ts tests/unit/foundations/utility/in-flight.test.ts tests/unit/foundations/utility/line-framer.test.ts --reporter=dot`，3 文件/11 项通过。分别验证递归排序/不修改输入/策略与数组、集合身份/实例隔离/快照排空/拒绝、拆帧/尾部/错误顺序/字符字节差异，不加载应用。
- 生命周期与协议消费者：`pnpm exec vitest run tests/utility-json-order-contract.test.ts tests/utility-rpc-framing-contract.test.ts tests/pi-rpc.test.ts tests/codex-tools.test.ts tests/controlled-file-runtime.test.ts tests/scoped-execution-runtime.test.ts tests/artifact-transition-runtime.test.ts tests/chat-material-imports.test.ts tests/controlled-file-service.test.ts --reporter=dot`，9 文件/76 项通过。覆盖历史指纹、模拟管道的策略差异与关闭等待、真实子进程 Pi RPC/受控 Codex 工具、取消与未知写屏障；平台替身/本机受控协议证据不冒充在线模型或全部 Windows 物理故障验收。
- 排序消费者：`pnpm exec vitest run tests/artifact-evidence.test.ts tests/workflow-evidence.test.ts tests/output-manifest-evidence.test.ts tests/json-artifact-validation-core.test.ts tests/scope-budget.test.ts tests/workspace-packages.test.ts tests/member-execution-context.test.ts tests/member-checkpoint-domain.test.ts tests/member-checkpoint-core.test.ts tests/queued-dependency-replacement-core.test.ts tests/queued-task-cancel.test.ts tests/scope-goal.test.ts tests/scope-run-tracking.test.ts tests/queued-dependency-addition-core.test.ts --reporter=dot`，14 文件/157 项通过，按本次证据/预算/知识/任务规则适配选取。
- S6：引擎增加 utility 通用入口访问权，明确禁止 Node 入口、私有实现、files/web；未放宽 Core 反向依赖或调度装配限定。`pnpm exec vitest run tests/dependencies.test.ts tests/layer-boundaries.test.ts --reporter=dot`，2 文件/32 项通过。以上合计 28 文件/276 项，无重复累计。`pnpm typecheck`、`pnpm check:architecture`（91 目录、713 源码/样式，1426 扫描文件、7096 含类型依赖，0 环/违规）、`pnpm check:test-modules`（460 文件：121 unit、152 contract、187 integration）通过。统计含已有并行源码；不是全仓测试结论。
- 文档与 AI 工作流：同步变更源码文件头/公共接口、utility 与消费者 CONTRACT、13 份受影响类图及生成器；三宿主的开发/架构演进/架构维护入口共 9 份同步，描述现有机制入口、兼容性检查、模块单元与消费者验证。未改产品内置业务 Skill、全局模型规则或 CI。`git diff --check`、相对文件链接及三宿主逐字一致性检查通过。
- S7 / 交接：Review 顺序为 `src/foundations/utility/CONTRACT.md` → 三个独立实现 → 原排序适配、业务关闭/物理退出路径、Pi/Codex RPC → 独立单元与消费者契约。新增业务排序规则、限额或关闭策略在本地适配修改；共同机制缺陷才修改 utility，并沿真实消费者验证。源代码自查与测试已完成，人工 review 尚未发生；不以一次提炼证明长期稳定。保留原 locale 依赖及快照等待边界，未添加定时任务。未运行全仓回归、桌面冒烟、打包或安装验收，未推送、合并或发布。

## 2026-11-13：utility 候选 1–4 收敛与消费者迁移

- 来源与 S1：用户直接授权继续提炼候选 1–4，并同步类图和 AI 工作流；基线 `8eb1c7da`。已核对当前 Issues，无本切片对应工单，不新增或回填外部 Issue。候选 2（SHA-256）与 4（JSON 文本格式化）沿用上一提交，补齐候选 1（有界字节流）与 3（严格 JSON）。原任务历史视图的并行改动保留，不纳入本提交。
- S2–S4：utility 只拥有通用算法及本次 reader，不依赖其他项目模块。字节流机制负责上限、取消、锁与监听释放；URL、凭据、期限、业务错误、JSON 协议和重试决策留在消费者。严格 JSON 保留 jsonc-parser 原行为，Core 适配原 `JSON` Fault。通用入口不加载 Node；摘要仍走独立 Node 入口。保护稳定算法，把业务变化限制在原适配层。
- S5：新增 `readBoundedBytes`/`ByteLimitError`、`parseStrictJson`/`StrictJsonError`。迁移资源仓库、GitHub HTTP、网页材料、Release 列表和更新小清单五处响应体读取，保持各自字节上限及错误映射。核对已有 #70 修复提交 `36c36bf649614b0f4aeac140c9ba90a9767203a2`，保留显式取消挂起 reader 的语义，不依赖 fetch 转发信号；底层 cancel 不返回时也不无限等待。未合并远端分支、改动 CI 或扩大到安装包流式落盘、模型字符限额及 Node 原始 HTTP。
- 模块测试：新增字节流与严格 JSON 的独立单元；Core 错误兼容与五消费者业务映射独立作为契约测试，登记在 `tests/modules.json`。`pnpm test:module --module foundations/utility --kind all` 首轮 8 文件/28 项通过；随后新增的五个超限映射和清单成功/空正文用例包含在下述 Node 22 验证，重叠用例不重复计数。
- Node 22 验证：核对本机 `test-results/ci-speed/node22/node.exe` 为 v22.19.0，SHA-256 `995a3fb3cefad590cd3f4b321532a4b9582fb9c6575320ed2e3e894caac3e362` 与已有官方校验文件一致。执行 `& ./test-results/ci-speed/node22/node.exe ./node_modules/vitest/vitest.mjs run tests/repository-connection-http.test.ts tests/utility-body-consumers.test.ts --reporter=dot`，2 文件/15 项通过；覆盖真实 HTTP 8 秒超时、取消以及 fetch 不转发信号且底层 cancel 挂起的五消费者契约。测试证明读取停止等待和 reader 释放，不把它解释为所有底层连接物理退出。
- 受影响回归选取：解析适配影响规则、数组、领域及产物验证；响应体迁移影响更新、资料与资源仓库；依赖规则调整需验证检测器。执行 `pnpm exec vitest run tests/rules.test.ts tests/rules-json-arrays.test.ts tests/core-domains.test.ts tests/json-artifact-validation-core.test.ts tests/release-http.test.ts tests/runtime-download.test.ts tests/chat-material-imports.test.ts tests/resource-repository.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts --reporter=dot`，10 文件/75 项通过。该批先前执行回执未能恢复，在确认无活动进程后重新取得完整结果。
- Review 补充：发现 Buffer.slice 共享存储会违背字节快照契约。先以 `pnpm exec vitest run tests/unit/foundations/utility/bounded-bytes.test.ts -t 'Buffer' --reporter=dot` 复现失败，再改为显式 Uint8Array 副本，同步注释、契约及类图。执行 `& ./test-results/ci-speed/node22/node.exe ./node_modules/vitest/vitest.mjs run tests/unit/foundations/utility/bounded-bytes.test.ts tests/utility-body-consumers.test.ts --reporter=dot`，2 文件/18 项通过，包含全部流单元和五消费者契约；不重复累加早先已运行用例。
- S6：`pnpm typecheck` 通过；`pnpm check:architecture` 通过（91 目录、710 源码/样式文件，1418 扫描文件、7062 条含类型依赖，0 循环/边界违规）；`pnpm check:test-modules` 通过（455 文件：118 unit、150 contract、187 integration）。检查包含工作区已有并行源码；未改变其内容。三宿主的三个相关 Skill 共 9 份入口逐字一致，`git diff --check` 通过。
- 文档与 S7：同步变更源文件头/公共入口说明、utility 与消费者 CONTRACT、9 份受影响目录类图及生成器/边界规则。AI 工作流补充流消费与连接归属、非阻塞取消、JSON 错误适配及真实消费者回归要求。Review 入口为 `src/foundations/utility/CONTRACT.md`、两项独立实现、Core JSON 适配和五消费者契约测试；未来业务修改留在调用方，新增算法从 utility 契约与模块单元进入。本步只做受影响开发验证，未运行全仓测试、桌面冒烟、构建或发布验收；未推送、合并或发布。

## 2026-11-13：utility 算法与数据结构基础库，迁入实例串行队列

- 来源与 S1：用户要求创建 `foundations/utility`，并明确将实例级串行执行方案迁入；基线 `2a2dca39`。已核实开放 Issues 当前仅 #65，无对应本片工单，沿直接授权实施，不新增或回填外部 Issue。原任务历史界面并行改动完整保留；未整合远端另一轮 HTTP/CI 改动，本片不修改该请求路径。
- S2–S4 / C3 / L2：核实 SerialQueue 及五个设置/模型消费者、Core serialization 与知识/证据消费者。utility 归领域无关算法和数据结构，分别实现、具名导出；通用入口无 Node 依赖，Node 摘要单独公开入口。文件、网页、原生进程、权限、事务、业务关闭和失败屏障仍在原模块。未预建无消费者容器，也未统一不同 canonical 排序。
- S5：SerialQueue 实现与原 2 项测试迁入 utility，WebSettings、BudgetSettings、AdmissionSettings、MainAgentSettings、LlmProfiles 改用新公开入口，旧 concurrency 四文件及目录清理。保留队列顺序、调用者失败可见、失败后继续、drain 等待调用时队尾及实例隔离语义。新增 formatJson 与 sha256；Core hash/json 直接重导出唯一实现以保留现有消费者名称，适配出口尚未退役。JSON 缩进/末尾 LF/异常和顶层 undefined 的既有行为、摘要 UTF-8 与字节视图语义均固定，业务字段与指纹规范化仍由调用者决定。
- S6 选取依据：utility 三类单元验证原语；兼容契约核对旧名称确为同一实现；五个队列消费者覆盖并发版本、保存失败及模型锁；知识和产物证据验证现有字节/指纹消费；依赖与测试检查器覆盖本次规则变更。
  - `pnpm test:module --module foundations/utility`：3 文件 / 6 项通过。
  - `pnpm exec vitest run tests/utility-serialization-contract.test.ts tests/budget-settings.test.ts tests/admission-settings.test.ts tests/main-agent-settings.test.ts tests/web-settings.test.ts tests/owner-model-configuration.test.ts tests/rules.test.ts tests/artifact-evidence.test.ts tests/dependencies.test.ts tests/test-modules.test.ts --reporter=dot`：10 文件 / 72 项通过。共 13 文件 / 78 项，不重复累计。
  - `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:test-modules` 通过：91 目录 / 708 源码样式、1412 扫描文件 / 7043 依赖、0 环/违规；451 测试文件，116 unit / 148 contract / 187 integration。检查包含保留的并行工作，不将其计入本片提交。
- 资料与流程：更新 utility 文件头、接口、契约/类图，foundations、Core/foundation 与上层 Core、Main/settings/models 的相关类图和契约。AGENTS 与开发/演进/维护三类 Skill 的三个宿主入口同步 utility 归属、环境边界、真实消费者和字节兼容要求；9 份入口一致，本地引用与 diff 空白检查通过。模块目录和检查器移除旧 concurrency 归属；历史记录中的旧路径保留为历史。
- S7 / 四问：保护原队列与字节算法，机制变化限制在 utility，业务策略保持原服务；只验证以上实际入口及消费者，不扩大全仓。后续同类能力从 utility/CONTRACT → index/node → 独立实现与模块单元修改；不要向统一类添加业务开关。Q5 的 utility 归属为用户明确要求，未新增定时自动化。完整 review 入口是本片相对 `2a2dca39` 的 diff；回退需同时恢复消费者、旧入口及依赖/测试归属，不能保留两份队列实现。
- 未运行全量回归、桌面、构建/安装/升级或浏览器实站；未推送、合并、发布或对外回填，尚待人工代码 review。

## 2026-11-13：模块测试目录、CI 门禁与 AI 开发流程同步

- 来源：同轮用户直接授权，前一切片提交 `3d6a091d` 已完成基础能力及实际产品测试拆分。本片不继续扩张产品重构，将单元职责/夹具边界接入现有开发流程与 PR 验证；未创建新的任务系统或定时自动化。
- `tests/modules.json` 对 448 文件登记唯一模块和 unit/contract/integration 类型（71 模块，114/147/187）。`scripts/test-modules.mjs` 阻止漏登记、重复、缺文件、跨套件导入、单元间接装配 Application 及越界运行时被测模块；包含类型的循环/应用可达性仍保留。显式模块选择默认 unit，空选择/未知模块失败，不回退全仓；既有未登记、未跟踪的个人草稿不接管。
- `pnpm test:module --module tooling/test-modules` 实际选中 1 文件/10 项通过。首次同一行多条 import 的类型判定用例失败，按 spec 与行号共同定位声明后通过。`pnpm check:test-modules` 验证全部登记测试通过；源码切片已有 `pnpm typecheck` 与完整架构检查通过，文档最后补充后 `node scripts/source-architecture.mjs --check` 无差异。三类 Skill 的三宿主入口共 9 份一致，本地引用核对通过。
- PR 流程新增模块边界检查，完整四片测试仍保留。AGENTS、两份架构规范、设计入口、三个开发/架构 Skill 同步模块单元要求；`tests/README.md` 提供执行命令、夹具规则及静态检查限制。不能把真实集成改名为单元，不能删断言或以改分类掩盖混合职责。
- 全局候选取舍、迁移语义、完整实际测试命令、初轮失败/修复及未运行范围见 [本轮治理与验证](verification/foundations-module-tests-20261113.md)。静态归属不证明所有历史测试已语义解耦；维护者仍需 review 单一责任、共享状态和模拟契约。完整两片 diff 从 `48bd18cd` 起审阅，源码注释/类图在前片同步。
- 未运行全量四片、桌面、构建/安装/升级及实站重测；未推送、创建 PR、合并、发布或对外回填 Issue。任务历史并行工作保留，尚无人工 review 通过结论。

## 2026-11-13：独立文件/队列基础库与消费者迁移

- 来源：用户直接授权按单一职责、开闭原则做全局基础能力优化，并要求基础库不依赖其他产品模块；基线 `48bd18cd`，开放 #65/#68 不对应本次新增范围，未对外写入。C3/L3 分析核对全仓静态图、契约及实际文件/队列消费者，未声称全仓逐行审计。任务历史界面并行改动保留。
- 将文件原语迁入 `foundations/files`，23 个源码消费者改用公开入口，删除旧 Core 出口；修复写入/同步/关闭失败的临时文件清理。新增 `foundations/concurrency/SerialQueue`，替换三个设置、两个模型服务中的恢复型 Promise 队尾。Core 可单向使用 foundations，反向引用含类型及跨能力私有入口仍禁止。
- 业务仍拥有路径授权、Schema、revision、凭据、模型锁和事务；未把失败即停止的证据日志、原生隔离或不同协议的重试强行统一。同步基础库/后端/知识/设置/模型契约、文件头与关键字段说明及所有受影响目录类图。
- 验证依据为文件成功/失败清理、队列顺序/失败恢复、配置并发保存、模型选型，以及历史/工作区/资源真实消费者。与下个测试拆分切片在同一工作区验证：首批 18 文件/92 项中 90 通过，分层两项因旧 Core 镜像与待生成类图失败；修正后分层和新增入口规则复验通过。消费者 6 文件/56 项通过，后续拆分/规则/辅助消费者 8 文件/48 项通过，重合项不重复累计。完整原始选择器及不存在文件名的边界在下一条测试治理记录归档。
- `pnpm typecheck`、`pnpm check:architecture` 通过，91 目录/705 源码样式、1406 扫描文件/7034 依赖、0 环和违规；扫描包含保留的并行工作。源码迁移测试中使用了独立临时目录与拆分夹具，产品测试拆分一并提交，下一片接入全仓目录和 CI。
- S7：保护单文件替换与失败可见性，机制变化限制在基础库，业务变化限制在原消费者。下次修改先看各 foundations 契约与单元，再看 Main/settings/models；真实日志语义需另立契约。未运行全量、桌面、打包/升级；未推送、合并或发布，尚待人工 review。模块单元解耦规则来自本轮用户明确要求，不引入额外自动化。

## 2026-11-13：浏览器 robots 可配置与 Saltline 实站读取

- 来源：用户直接要求“浏览器访问的 robots 策略改成可配置，默认允许读正文，Saltline 实站要能读通”。基线 `61bc5d76`；本轮查询开放 Issues 为 #65、#68，未发现对应新工单，沿已关闭 #39 的能力增量实施，不重开或对外回填。原任务历史折叠前端工作保留，不纳入本次提交。
- S1–S4 / C3 / L3：策略值属于产品设置，WebSettings 持久化并通过既有 IPC/界面公开；WebService 每次调用捕获值，基础读取器只接收 allow/respect 契约。foundations 仍只依赖自身、标准库和必要第三方库，不反向依赖 Core、Main 或前端。独立网络连接与平台渲染分开，避免为一个站点修改搜索或 Agent 工具协议。
- S5：设置→网页与搜索增加浏览器 robots 策略，默认 allow，strict 对应 respect。旧配置缺字段默认 allow，旧客户端省略字段保留已保存值；不需要 Brave 密钥或安全存储。静态路径仍遵守 robots；allow 下静态 robots 拒绝也可触发一次浏览器兜底，respect 对浏览器所有资源核实 robots。缓存按策略分隔，正在执行的读取使用捕获值，后续调用使用新配置。
- 实站根因与调整：解除 robots 限制后，旧 protocol.handle→Node HTTPS 路径仍进入 challenge_redirect 并收到 HTTP 403，补临时 Cookie 未解决，不能据此认定页面私有。最终使用 Chromium 原生网络，经基础类库 openBrowserProxy 固定公网 TCP 地址；CONNECT 不终止 TLS，原生 webRequest 逐资源执行 robots/权限策略。恢复站点当次匿名 Cookie，结束即清理，仍不共享用户登录态、不发送认证头或写请求。禁止内网/保留地址、校验全部 DNS，取消销毁窗口及代理连接。
- 资源边界：两个匿名槽位、每次 30 秒、32 文档/框架、160 资源/连接，代理累计 32 MiB，连接空闲 15 秒；新原生路径的字节上限计算 HTTPS 隧道字节或 HTTP 响应体，不再声称旧协议转发器的“单个解压资源 8 MiB/8 并行请求”约束。静态 PublicHttp 仍保持原体积规则。仍不自动登录、点击游戏或识别 canvas 像素。
- S6 定向选择：web-service（31）覆盖原读取/搜索消费者；web-browser-fallback（22）覆盖策略、缓存隔离、取消和一次兜底；web-settings（3）覆盖旧文件迁移、重启、旧客户端保存及实际 IPC；web-tools-pi（1）覆盖真实工具回传；dependencies（25）/layer-boundaries（2）覆盖基础层与公开入口；新增 web-browser-proxy（7）覆盖 HTTP 固定地址、CONNECT 透明传输、混合 DNS 拒绝、取消及累计字节上限。最终 7 文件、91 个不同用例通过，不累计复跑。
- 实际命令：`pnpm exec vitest run tests/web-browser-proxy.test.ts tests/web-browser-fallback.test.ts tests/web-settings.test.ts tests/web-service.test.ts tests/web-tools-pi.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts`；初轮暴露测试参数数组被 it.each 展开及测试直接导入私有实现，修正参数与经公开入口消费后，`pnpm exec vitest run tests/web-browser-proxy.test.ts tests/dependencies.test.ts` 31 项通过；最后新增体积用例以 `pnpm exec vitest run tests/web-browser-proxy.test.ts -t '响应超过累计字节上限'` 通过，其他 6 项仅因选择器未重跑。类型初检修正 HTTP headers 的索引类型后 `pnpm typecheck` 通过。`pnpm check:architecture`：89 目录、702 源码/样式、1387 扫描文件、7018 条依赖，0 环/违规。
- 真实 Chromium：`node scripts/web-browser-smoke.mjs` 9 项通过，使用生产原生网络与受控代理，仅可信测试 TCP 装配映射夹具；覆盖 JS/跨域 iframe、登录/404 区分、严格 robots 在传输前拒绝、匿名 Cookie 不跨次保留、认证头/写请求/弹窗禁止、取消、私网拒绝、失败复用和静态空正文完整兜底。首轮明文夹具暴露 agent:false 忽略 createConnection，已改为专有 Agent 固定连接并补单元验证，没有放宽公网边界。
- Saltline 验收：`node scripts/web-browser-smoke.mjs --live-only` 使用实际 WebSettings（默认 allow）→WebService→WebPageReader→ElectronBrowserReader→受控代理。2026-11-13T09:18:52.276Z 返回标题 Saltline，正文含 SALTLINE、Deploy、Mission、操作说明与任务说明，cached=false、untrusted=true、truncated=false。脚本强制同时断言游戏标题与 Deploy，失败退出非零；证据为 `test-results/web-browser-smoke/live.json`，夹具证据为 report.json。不复用 Cindy 浏览器结果冒充 CBIM 验收。
- S7：同步 foundations/web、Core/connectors、Main/settings/web/ipc、bridge/contracts、frontend/settings 的源码注释、契约和目录类图。review 顺序为 WebSettings/设置 UI → WebService → page-reader 策略捕获及缓存 → electron-browser-reader/browser-proxy 连接/会话生命周期。保护静态解析、搜索凭据、工具输入及公网边界，浏览器网络实现变化留在 foundations 内。未运行全量回归、完整桌面设置点击/打包、安装升级；未推送、合并或发布，不将源码验收说成已安装生效。

## 2026-11-13：网页浏览器兜底与独立 foundations 基础类库

- 来源：用户明确要求静态抓取失败/正文为空时改用真实浏览器，并补充 foundations 不依赖 Core 或任何其他项目模块。已查询开放 Issues（当时仅 #65），回读已关闭 [#39](https://github.com/nan023062/cbim/issues/39) 的原网页能力与讨论；本步是用户直接授权的增量，不重开旧工单、不创建或回填新 Issue。分析起点 `ae6deee9`，期间独立发布工作合并至 `bff94f9b`；既有任务历史折叠前端改动保留，不纳入本提交。
- S1–S4 / C3 / L3：问题是 Main/web 同时持有通用读取、产品配置和新增浏览器实现。按已确认边界将网页方案迁入 `src/foundations/web`，通过 Node 公共入口和独立 Electron 入口消费；其项目内依赖仅限自身。没有批量迁移其他工具或 Core/foundation，具体变化频率仍未知，不以目录位置证明所有能力已稳定。
- S5：WebPageReader 拥有静态读取、robots/域名节流、5 分钟缓存与一次兜底决策；PublicHttp 复用 DNS 固定传输并支持有界二进制资源；ElectronBrowserReader 使用匿名内存会话及真实 Chromium，读取脚本生成 DOM 和跨域 iframe。WebService 保留 Core 协议、来源不可信标记和 Brave 设置/查询；桌面 Application 注入 BrowserReader，Node 消费者不加载 Electron。静态成功优先返回，空正文、可恢复失败、iframe/短脚本外壳最多渲染一次；取消、SSRF、robots、限流、挑战及体积/跳转上限不绕过。主窗口关闭仍走 before-quit 排空，不因隐藏读取窗口而延迟退出。
- 安全/生命周期：所有 HTTP 资源在协议传输入口核 robots，文档额外节流；浏览器原生网络设不可达代理，真实出网只经校验全部 DNS 并固定地址的 PublicHttp。禁止写请求、透传 Cookie/认证头、下载、弹窗和权限请求；有并发、时间、框架、请求数量及字节上限。取消关闭窗口并清理匿名会话，缓存不接受迟到结果。不存在系统浏览器登录态接入或人工登录能力。
- S6 选取依据：读取/搜索消费者与 HTML/HTTP 迁移由 web-service 覆盖；新增兜底失败、取消、缓存、robots 等由 web-browser-fallback 覆盖；真实 Pi 主工具回传由 web-tools-pi 覆盖；新增基础层和公开入口约束由 dependencies/layer-boundaries 覆盖。实际命令 `pnpm exec vitest run tests/web-service.test.ts tests/web-browser-fallback.test.ts tests/web-tools-pi.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts`：5 文件、78 项通过。`pnpm typecheck` 与 `pnpm check:architecture` 通过：89 目录、701 源码/样式、1385 扫描文件、7013 依赖、0 环/违规。
- 真实验证：`node scripts/web-browser-smoke.mjs --live` 的 9 项 Chromium 夹具检查通过，覆盖动态跨域 iframe、登录/404 区分、iframe robots 在传输前拒绝、禁止写请求/凭据/弹窗、隐藏密码框、取消、私网拒绝、槽位清理复用以及静态空正文→真实浏览器完整链路。证据在 `test-results/web-browser-smoke/report.json`。初轮发现 Electron protocol.handle 不经过预期的 webRequest 回调，已把授权迁到真实协议传输前；之后发现拒绝原因被合成 502 覆盖，已保留首个真实原因，并加真实回归。类型检查发现测试类型声明不完整，已修正，未降低断言。
- 实站边界：Saltline 链接 `https://claude.ai/artifact/BGY1SztrAYcJQHSsnHHGmp` 在新路径下仍被资源 robots 规则拒绝。再以 `node scripts/web-browser-smoke.mjs --live-only` 沿生产 WebService 配置核实，拒绝发生在 `/api/frame/...` 与 `/api/account`，记录于 `test-results/web-browser-smoke/live.json`；未报告已解决该站点、未解释成未公开/必须登录。浏览器读取可见文字，不识别 canvas 像素，也不保证任意延迟脚本全部执行。Brave 付费账号、全量回归、完整桌面退出/打包、安装升级、合并和发布本轮未运行。
- 资料/边界：同步相关文件头、基础类库契约和类图、Main/assembly/resources/web、Scheduler 工具契约及上层导航；三份 architecture-maintenance 入口同步 foundations 单向依赖。依赖检查新增基础层与能力私有入口限制，并用包括类型引用的反向依赖样本验证，不增加循环豁免。旧 public-http/web-content 路径已清理，仓库源码和测试消费者已迁移；不涉及持久化格式或工具 schema 变化。
- S7 / 四问：Q1 保留公开工具协议、Brave 凭据边界及公网/取消不变量；Q2 将网页机制和浏览器平台变化限制在基础网页模块，业务配置留在 Main；Q3 上述定向用例覆盖本次实际消费者和新增网络边界，不重复全仓回归；Q4 从 foundations/web/contracts、browser-reader、page-reader 到 electron-browser-reader，再看 Main/web 与桌面装配。Q5 无新增候选规则，foundations 的独立性为用户本轮明确要求。完整 review 以本提交 diff 为准，尚无人工作代码 review、推送、合并或发布回执。
- 平台依据：[Electron protocol](https://www.electronjs.org/docs/latest/api/protocol)、[WebFrameMain](https://www.electronjs.org/docs/latest/api/web-frame-main)、[Session](https://www.electronjs.org/docs/latest/api/session)；以上平台说明与本次真实 Chromium 证据分别记录，不以文档代替执行验证。

## 2026-11-13：CI 优化成功运行与覆盖对照

- #68 / PR #69 完整 CI run 43404271598 通过：436 文件、3001 通过、0 失败、2 个既有跳过；原 2968 个测试名称及出现次数全部保留。
- 实测从 14 分 49 秒 到 12 分 8 秒，减少 2 分 41 秒（18.1%）。单次 runner 对比，不承诺固定速度；前两轮失败、Node 版本差异及 #70 的定向复现与修复证据均如实保留。
- 详细分片耗时与回执见 [CI 实测记录](verification/ci-validation-20261113.md)。本次仅回填两个白名单文档，使用 PR 验证轻量路径，不重复产品全量，不改动产品或既有测试结果。

## 2026-11-13：CI 暴露的 Node 22 仓库正文取消缺口

- 来源：[#68](https://github.com/nan023062/cbim/issues/68) 实际 CI 两轮均在同一 HTTP 回归失败，独立缺陷 [#70](https://github.com/nan023062/cbim/issues/70)。补充 execFile 诊断后确认被原有 15 秒期限终止、没有业务结果输出；没有原样无限重跑。
- 定位：本地原 Node 24.13 通过不代表 CI Node 22.19 通过。下载并核对官方 SHA-256 的便携 Node 22.19 后定向复现；阶段探针记录两次请求均抵达、第一次取消已返回、两个 8 秒信号均已触发，但第二次正文读取仍挂起。因此不更换 CI 版本、不增大期限、不跳过用例。
- 修复：RemoteRepository 私有 readBody 显式把取消/超时信号传给 reader.cancel，唤醒挂起 read；finally 移除监听并释放锁。请求层仍负责 CANCELLED/TIMEOUT 分类，半截正文不能成为仓库结果。固定 8 秒、大小边界、权限和无自动重试均保持；只修该仓库 HTTP 消费者，不扩展为通用网络重构。
- 单元选择与结果：在 Node 22.19 下运行 `node node_modules/vitest/vitest.mjs run tests/repository-connection-http.test.ts --reporter=verbose`，5 用例通过，原真实超时约 8.3 秒返回；包含新增的 fetch 不转发取消时显式取消正文并释放锁回归。直接消费者 `repository-connection-service.test.ts`、`repository-tools.test.ts`、`chat-material-imports.test.ts` 同版本定向验证 23 用例通过，覆盖授权/撤销、工具读取和聊天资料捕获。调用 node 为 test-results 中的便携 22.19 可执行文件，不更改全局环境。
- `pnpm typecheck`、`pnpm check:architecture` 通过（0 类图差异、0 循环、0 边界违规）；同步 resource-http.ts 文件头/私有生命周期注释、资源 CONTRACT.md 及 ARCHITECTURE.md 的 readBody 成员和行为说明。后续完整 CI 使用新的精确提交；未打包、未发布新客户端。

## 2026-11-13：CI 按变更分流、耗时均衡与公共检查去重

- 来源：用户授权三项 CI 优化并要求一次真实 CI 验证效果，独立工单 [#68](https://github.com/nan023062/cbim/issues/68)。基线 `bff94f9bdb2914b26e668ef819d0e0493f571a94`，原工作区网页读取、架构与任务图修改保留，使用独立检出。本步只改开发验证，不修改产品运行逻辑、分支保护或发布新客户端。
- 分流：PR 依据 base/head 的 merge-base 差异，解析 NUL 分隔状态并同时检查重命名/复制的新旧路径。仅 README、发布记录与官网静态文件白名单可走轻量；业务资料、配置、空/未知差异一律完整。轻量核对空白及新增本地链接，涉及官网运行原 14 场景。新增范围与入口说明见 [CI 验证说明](task/ci-validation.md)。
- 分片：Vitest 从真实发现全集按历史耗时确定性分配四片，保持 fileParallelism=false 和原超时。权重来自两轮已通过 CI，435 个已有文件均保留；新/改名测试自动以默认耗时纳入。每片输出发现全集和分配清单，汇总 job 对照实际执行报告核验无遗漏、无重复。未知权重不是跳过条件。
- 去重：公共类型/架构/品牌/官网检查独立一次，与四片并行；各 runner 自身的依赖复制、Electron 身份和临时路径检查仍分别执行。固定汇总严格区分所选路径、预期跳过与异常跳过；手动诊断保留独立名称。网站预览使用随机回环端口及自有子进程 IPC 回执，避免误测其他正在运行的预览实例。
- 本地验证：`pnpm exec vitest run tests/ci-validation.test.mjs --reporter=dot` 最终 34 用例通过；同文件 `--shard=1/1` 通过，证明真实 Vitest 分片入口接入。`pnpm typecheck` 通过；`CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/ node scripts/ci-website-smoke.mjs` 14 场景通过、0 页面错误。两份 YAML 解析、git diff --check 及三个宿主入口/引用的一致性检查通过。没有 src 变化，不生成源码类图；原架构检查仍在真实 CI 执行。
- 补充核实：Vitest list --filesOnly 枚举 436 文件，但该入口不调用分片；最初尝试读分片清单得到 ENOENT，未把枚举误计为执行证据，改用真实 `run --shard=1/1` 与 CI 产物校验。仅验证相关控制逻辑，本地不运行产品全量；真实完整 CI 的精确提交、全部用例覆盖与前后耗时追加到 #68/对应 PR，避免为结果回填再跑同一全量。
- 维护范围：同步 AGENTS 验证范围、开发/发布说明三入口及发布 runbook。后续调整从 ci-scope.mjs 白名单、ci-test-shards.ts 分配策略、ci-test-coverage.mjs 覆盖核对入手；状态汇总与实际执行均不因优化而放宽。
- 首轮真实 CI：run 43398193028 用时 13 分 10 秒，436 文件实际执行，2999 通过、1 失败、2 个既有跳过；不能报告验证成功。失败为 repository-connection-http 独立夹具被原有 15 秒外层期限终止，原始日志未展示 execFile 附带输出；本地定向运行同文件 4 用例通过（超时用例约 8.3 秒），未复现，尚不能确认卡在启动、请求还是清理。补充退出码、信号、子进程输出诊断，不改变 8 秒业务期限、15 秒进程期限、18 秒用例期限、断言、重试或跳过；修订后再次验证，不把本地通过当成远端失败已修复。

## 2026-11-13：C 0.1.15 / R4 公开升级通过与官网收尾

- 来源：用户明确要求提交 PR 并发布；[产品 PR #66](https://github.com/nan023062/cbim/pull/66) 已正常合并为 `b00f6928c7e110ec204326d9cceaaf228d6ec74f`，完整树等同冻结 source `ae6deee959cec22db2daff8abc75aa90439e7825`。完整四片 CI [43386158632](https://github.com/nan023062/cbim/actions/runs/43386158632) 为 435 文件 / 2966 通过 / 0 失败 / 2 跳过；跳过均因 runner 缺真实历史 EXE，未新增 skip。
- R4 覆盖等待补充续接、按可观察进展续期、具体中断原因、同一目标累计三次成员异常停止自动接续、候选审阅及工具输入诊断；主轮明确阻塞/等待后不再启动继承待办。本机未提交的任务历史折叠工作继续保留，不在本版。
- 第二候选隔离验收 [43387124145](https://github.com/nan023062/cbim/actions/runs/43387124145) 通过后，`pnpm publish:runtime build/runtime/c0.1.15-r4-B5kpQx` 完成公开写入，最终回读因 CDN 短时缓存 R3 退出 1；未重复发布。按 ID 与匿名地址只读复核，`2026-11-13T07:59:16.251Z` 正常地址已返回原 C 公钥验签通过的 R4。公开 ZIP 3904698 字节，payload digest `0689c8595085967921937d439ef29135defd36e29a353d2134bff2027b1898ec`，原 C/E 与 Python latest 不变。
- 在线验收 [43389737725](https://github.com/nan023062/cbim/actions/runs/43389737725) 通过：真实 C 0.1.15 / R1 匿名发现、后台准备 R4，普通退出不升级，显式 UI 点击后重启到 R4；六类数据保留、无历史重放、确定性模型请求 1 次、0 页面错误。此证据不冒充 R3 起点或用户在线模型质量测试。
- 官网与 README 使用真实 R4 清单资产时间，保留原安装包摘要、未签名说明及 SEO；`pnpm check:brand`、`CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/ pnpm build:website`、独立本机预览和 `node scripts/website-smoke.mjs` 均通过，14 场景 / 0 页面错误 / 无横向溢出。仅官网/报告变更，不重复本地产品测试；收尾 PR 依照原流程跑完整 CI、正常合并与 Pages 六文件回读。
- 详细冻结范围、首轮失败、缓存恢复、源码与后续报告副本差异见 [R4 发布验证](verification/runtime-c0.1.15-r4-20261113.md)。后续部署/双分支实际回执继续记录于收尾 PR 和 #65，不为回填记录改写已公开制品。

## 2026-11-13：R4 完整 CI 暴露的显式停止与消费者回归修正

- 来源：用户已授权 PR/发布，[#66](https://github.com/nan023062/cbim/pull/66) 首轮完整 CI [43382151440](https://github.com/nan023062/cbim/actions/runs/43382151440) 在四片中失败 37 用例；关联开放 #65。首轮冻结候选留在草稿，未投放。本步修复发版阻塞，不纳入原任务历史折叠未提交改动。
- C1/L2：协调层 AutoCollaboration.advance 在当前主轮结束后先读取正式目标审阅；只有同 runId 的 blocked/awaiting_user 才退役批次并走原 finishCycle/parkScope 门禁。未启动待办不再重试或再回注，旧审阅不拦截明确恢复的新主轮；异步读取后重新检查取消。状态仍由目标和任务图持有，未新增重试存储或改变执行层终态。
- 消费者同步：真实 Pi 的九类依赖测试显式调用 cbim_dispatch_review 并核对精确候选回执，每个前置经过 inspect/review/end 后才启动原后继；保留全部 HTTP 请求、原任务/实例/信封及重启不重放断言。服务测试使用真实主运行日志和合法审阅命令；条件断言同步 reviewRequired。Workflow 错误断言读取结构化 code 与人类可读 message，waiting 普通输入按续接语义验证。长对话模型 fixture 单独接收 Pi 原生摘要请求，不再把摘要误报为成员重放，保留独立摘要日志。
- 验证选择：先运行 auto-collaboration、workflow-condition-pi、owner-execution-pi、active-goal-input-pi、queue-insertion-view，覆盖实际调度及新显式停止边界；85/86 通过，唯一剩余为摘要 fixture。补齐后定向运行 CI 涉及的 12 个消费者文件（abandoned-checkpoint-dependency-pi/service、active-goal-input-pi、checkpoint-handoff-pi、member-checkpoint-chain-pi、member-checkpoint-pi、member-pause-pi/service、queued-dependency-addition/replacement/revision-pi、queued-task-cancel-pi），10 个文件通过；两个服务文件因测试命令未使用 candidate-review- 前缀被持久化不变量正确拒绝，改正原调用身份后单独复验 2 文件 / 16 用例通过。本步共 135 个不同用例最终通过，不累计重复运行。完整命令与 JSON 结果保存在 test-results/release-r4/affected-fixtures.json、service-fixtures-fixed.json；不放宽生产保护、不跳过失败场景。
- 实际命令：
  - `pnpm exec vitest run tests/auto-collaboration.test.ts tests/workflow-condition-pi.test.ts tests/owner-execution-pi.test.ts tests/active-goal-input-pi.test.ts tests/queue-insertion-view.test.ts --reporter=dot`
  - `pnpm exec vitest run tests/queued-dependency-addition-pi.test.ts tests/queued-dependency-replacement-pi.test.ts tests/queued-dependency-revision-pi.test.ts tests/abandoned-checkpoint-dependency-pi.test.ts tests/member-checkpoint-pi.test.ts tests/member-checkpoint-chain-pi.test.ts tests/member-pause-pi.test.ts tests/checkpoint-handoff-pi.test.ts tests/queued-task-cancel-pi.test.ts tests/abandoned-checkpoint-dependency-service.test.ts tests/member-pause-service.test.ts tests/active-goal-input-pi.test.ts --reporter=dot --reporter=json --outputFile=test-results/release-r4/affected-fixtures.json`
  - `pnpm exec vitest run tests/abandoned-checkpoint-dependency-service.test.ts tests/member-pause-service.test.ts --reporter=dot --reporter=json --outputFile=test-results/release-r4/service-fixtures-fixed.json`
- 静态：pnpm typecheck、pnpm check:architecture 通过（1377 文件、6996 依赖、0 循环/违规，含保留的前端工作）。同步协调器文件头、分支说明、dispatch/CONTRACT.md 及 ARCHITECTURE.md。类型初检指出 ES 目标不支持 findLast，改为复制后反向查找；未为测试扩大产品编译目标。
- 发布边界：新源码须重新冻结并构建第二候选；隔离升级验收器增加受约束的数字候选后缀，保持原草稿与附件不覆盖。当前未合并/公开，完整四片及候选/在线升级仍由后续流水线验证。下一次修改从 advance 当前轮审阅与 finishCycle 统一收尾入手，复用已有门禁；未引入治理规则或未验证的稳定性承诺。

## 2026-11-13：C 0.1.15 / R4 发布准备

- 用户明确要求提交 PR 并发布。以已提交 `10d1f0f9` 为功能基线，纳入 #65 七项独立修复；原任务图折叠未提交改动保留，使用独立干净检出构建。
- 沿已有 C/R/E 通道发布 R4：C 0.1.15 与三个 E 保持不变，原资源签名身份已核实匹配。版本说明见 [R4 日志](releases/runtime-c0.1.15-r4.md)，阶段证据见 [R4 发布记录](verification/runtime-c0.1.15-r4-20261113.md)。此时尚未创建候选或公开，完整 PR 四片和隔离升级由本轮发布执行，已有定向单元不冒充全量验证。

## 2026-11-13：阻止成员异常后反复终止与重新派发

- 来源与基线：用户在超时策略修复后要求“避免无限死循环的任务终止、重启”；关联开放 [#65](https://github.com/nan023062/cbim/issues/65)。基线 `4a87768c`；开始时已有任务历史折叠相关前端修改，本步未改动或纳入提交。现有每目标 32 次主调度、最多 3 次验收返工及单轮重复工具失败保护已有总界限，但成员中断后换新任务继续派发可以长时间消耗这些额度。
- 方案与状态归属：C1 / L2 范围为协调层。新增纯策略 `memberFailureStopReason`，读取同 scope 已启动且结算为 failed/interrupted 的任务，累计达到 3 次停止自动接续。选择累计而非按名称/错误/连续次数计量，防止换任务、运行、负责人或穿插其它成功任务清零；代价是三项独立异常也会触发人工核实。取消、求助、检查点和未启动任务不扣额度。使用已有持久终态，不新增计数状态或迁移日志。
- 调用与交付：AutoCollaboration 在成员启动/结果回注、验收返工及无待回传成员的最终收尾前核实；触发后退役批次、撤销容量等待，持久保存 goal.blocked 并暂停用户队列，现有在途按原停止/排空/结算流程收尾。任务卡保留原具体 waitReason，目标卡收到明确的自动接续停止原因。AutomaticReturnService 使用同一策略覆盖异常已落盘而 blocked 尚未保存的退出窗口。用户明确发起新目标才形成新的目标额度；原有 32 轮主调度和验收返工上限继续保留。已并发启动的成员仍须收尾，不宣称所有并发场景总共只会启动 3 个成员。
- 受影响验证与依据：`pnpm exec vitest run tests/member-failure-limit.test.ts tests/auto-collaboration.test.ts tests/member-execution.test.ts tests/goal-repair.test.ts tests/automatic-return.test.ts --reporter=dot`：5 文件 / 77 用例通过。覆盖纯策略、受控主调度每轮换新任务的连续 interrupted/failed/混合异常（均只启动 3 次、回注 2 次）、迟到通知不复活、未启动后继不领取、最终返工不绕过、既有正常协作，以及真实 MemberExecutionManager/LoopRuntime/FileDispatchStore 三次异常落盘后复制到隔离目录重开、保留公开阻塞且不再执行。
- 重启窗口补测：新增“第三次异常已保存但尚无 blocked”的 AutomaticReturnService 用例；`pnpm exec vitest run tests/automatic-return.test.ts --reporter=dot`：3 用例通过。首次补测后的类型检查发现 fixture 缺必需的 withConfigurations 模型端口；补齐为禁止意外调用的测试实现，再跑该文件 3 用例通过。自查增加最终收尾读取期间取消优先的保护；`pnpm exec vitest run tests/auto-collaboration.test.ts -t '读取异常历史期间用户取消' --reporter=dot`：选定 1 用例通过。共 79 个不同相关用例，不累计重跑。
- 静态与资料：最终 `pnpm typecheck` 通过；`pnpm check:architecture` 通过（1376 文件 / 6982 依赖，0 循环/违规；含原有前端未提交文件）。同步新策略及两个消费者的文件头/接口说明、dispatch/CONTRACT 和生成的 ARCHITECTURE，新增模块、方法和依赖方向已核对。完整变更以本步独立提交为 review 入口，未声称人工 review 已接受。
- Review 导航与四问：先读 dispatch/CONTRACT 的异常接续上限 → member-failure-limit → AutoCollaboration.advance/finishCycle → AutomaticReturnService.inspect，再读受控循环与真实日志重开测试。Q1 保护原任务终态、权限、未知操作和租约排空；Q2 可调异常策略与稳定执行机制分开，两个实际消费者共用一个纯规则；Q3 不用模型文案或全局计数猜测目标，测试只覆盖变更消费者；Q4 后续阈值/分类修改从策略入口进入，存储及引擎无需连带变更；Q5 无新增治理规则候选，变化频率未作无依据承诺。
- 验证边界：未运行全仓、完整桌面、打包安装或在线模型验收，后续由 PR/发布流程覆盖；未发布、未重启本机安装版、未改用户运行数据，现有运行仍使用旧版本。#65 其余问题保持开放。

## 2026-11-13：有进展续期与成员任务具体中断原因

- 来源及基线：用户明确要求“只要有进展就续期，并把具体中断原因传到任务卡”；关联开放 [#65](https://github.com/nan023062/cbim/issues/65)，已读取正文及最近讨论。基线 `30d264dc`；开始时任务历史折叠相关前端改动未提交，本步原样保留且不纳入提交。只读核实本机 webfps：E2 在 13:00:24–13:30:24、E2b 在 13:30:44–14:00:44 均触发整轮 30 分钟超时，终止前仍在浏览器验证。另有事件过大及输出限额错误，本步只补公开原因，不修改这两种限制。
- 边界及方案：C1 变更检查、L2 交付；三种引擎各自的整轮定时器是同一技术机制，改为组合 `engines/run-inactivity.ts`。`turnTimeoutMs` 名称与原持久化结构保留，解释为连续无可观察进展的毫秒数（缺省 30 分钟）。新模型文本/推理/参数增量、工具开始/完成及变化的非空工具输出续期；空输出、重复工具快照、状态刷新、重试通知不续期。Codex 排除旧 thread/turn；推理不存正文。无输出的长命令仍可能静默超时；单次 RPC、工具自身及资源排空期限不被替代。
- 失败与状态：正常结束、异常、停止及 close 释放计时器，到期后迟到事件不复活。超时继续走原关闭/排空/未决副作用记录，不重放工具。成员结算从本轮原日志末条 `run.interrupted/run.settled(failed)` 取得错误，通过 Core `publicRunFailure` 重建已识别的具体诊断，同事务写入 `task.waitReason/run.error`；公开运行事件也用同一转换。未知原文、凭据、路径不进入任务图，原 canonical 保留；历史任务节点不批量重写，历史详情按读取时投影。候选、租约、权限及用户取消规则不改。
- 受影响验证：`pnpm exec vitest run tests/engine-inactivity.test.ts tests/run-failure.test.ts tests/member-execution.test.ts tests/member-events.test.ts tests/pi-cancellation.test.ts --reporter=dot` 首次 48 通过、1 失败；失败为新增 Codex 协议夹具漏提供 `proxy.error`，补齐后对应文件随下一组通过。覆盖默认 30 分钟、长时进展、重复/空输出、并发独立、噪声/旧轮、停止释放、终态诊断脱敏、真实派发存储到任务图及原事件分页消费者。
- 原生验证：`pnpm exec vitest run tests/engine-inactivity.test.ts tests/engine-inactivity-pi.test.ts tests/claude-engine.test.ts tests/codex-engine.test.ts tests/codex-lifecycle.test.ts --reporter=dot`：5 文件 / 24 用例通过。新增真实 Pi 进程 + 本地 HTTP 流跨过 1.5 秒窗口持续约 3 秒后正常完成，静默场景按窗口中断且两种情况各仅发一次请求；保留真实 Claude SDK、Codex EXE 的启动/停止/恢复及预算门禁回归。两组共 61 个不同相关用例最终通过，不累计重跑；没有使用用户模型账号。
- 静态与资料：首次类型检查指出新增诊断测试夹具缺 `moduleIds/acceptance`，补齐后 `pnpm typecheck` 通过。`pnpm check:architecture` 通过（1374 文件 / 6967 依赖，0 循环/违规；统计包含原有前端未提交文件）。同步 5 个既有源码文件头、2 个新模块说明，以及 Core execution、engines 根/三个适配器、scheduler members/runtime 共 7 处 CONTRACT 和 ARCHITECTURE；无前端生产代码变更。
- Review 导航及四问：先读 engines/CONTRACT → RunInactivityTimer → 三引擎原生事件映射，再读 publicRunFailure → MemberExecutionManager.settle → projectRunEvent → 既有任务卡 waitReason 显示。Q1 保护原权限、原生身份、未知结果及关闭结算规则；Q2 计时机制独立于原生协议识别，公开错误分类独立于运行状态修改；Q3 验证仅选择这两个变更的真实消费者，未扩展全仓；Q4 新进展类型从对应引擎映射修改，新的公开故障分类从 run-failure 修改；Q5 无新增治理规则候选。共用计时器仍属稳定候选，没有虚构频率统计；完整变更以本步独立提交为 review 入口，未声称人工 review 已接受。
- 交付边界：未运行全量回归、全套桌面/安装升级或在线供应商验收，留待 PR/发布自动化。未发布、未重启安装版、未修改用户运行数据；当前已在运行的旧进程保持原规则。#65 其它问题保持开放。

## 2026-11-13：等待用户补充时普通发送续接原目标

- 来源：用户截图反馈“准备好后回复继续”，输入却进入暂停队列且不能插入，形成原目标等待输入、队列等待原目标结束的互等。基线 `465f94a9`，开始时 develop 干净；开放清单仅 [#65](https://github.com/nan023062/cbim/issues/65)，本步补充其对话恢复相关进展，不关闭其它未完成项。
- 根因与边界：Conversation 原先把所有开放目标的发送统一当队列消息，已有安全补充入口藏在目标卡。仅修前端发送策略和显式草稿转交，后端继续持有等待身份、两个预期版本、权限、受理回执和队列准入；不放开暂停队列、不插入已结束运行、不以文本“继续”冒充人工验收。所有补充正文均按等待状态路由，不靠关键词识别。
- 实现：conversationExecutionState 在 waiting 时关闭 shouldQueue；Conversation 的 Enter/发送调用 useScopeContinuation.submitInput，先持久化正文及有序附件，再使用原控制器冻结和发送。与目标表单已有不同草稿冲突时保留双方并提示核对；本地保存失败不清输入。结果未知或明确拒绝时在输入区显示原补充表单，查询/修正/重试沿用原机制；未知请求禁止再次普通发送。历史选择必须先返回当前等待详情，不能向历史周期补写。按钮显示“补充并继续”，按下/释放间动作改变不误发。
- 已误排队消息：不自动删除或重放；等待提示说明删除误排队的补充后重新发送，其它未来任务保留。等待期间 Skill 新任务入口禁用。当前安装版和用户运行数据未改动。
- 受影响验证：状态投影与发送标签、补充控制器、共享附件入口三组单元覆盖正文/附件保存、身份隔离、冲突草稿、未知回执、重复请求以及原功能消费者。`pnpm exec vitest run tests/conversation-waiting.test.ts tests/scope-continuation-view.test.ts tests/continuation-source-view.test.ts --reporter=dot`：3 文件 / 35 用例通过。首次类型检查发现新增测试回执夹具缺 async，补齐后 `pnpm typecheck` 通过。
- 界面专项：`node scripts/waiting-chat-ui-smoke.mjs` 使用真实 App/Conversation + 隔离确定性 IPC，Edge 无头验证两组：已有暂停队列时 Enter 只发送一次 loop.goalContinue 且身份/正文/引擎正确；发送按钮遇到 IPC_TIMEOUT 后保留原记录、显示查询入口且禁止重复普通发送。0 page errors，0 意外 IPC；报告 `test-results/waiting-chat-ui-report.json`、截图 `test-results/waiting-chat-recovery.png`。这是界面接线测试，不是在线模型或真实运行验收。
- 维护：同步 conversation/tasks 注释、CONTRACT 与 2 份 ARCHITECTURE；`pnpm check:architecture` 通过（1367 文件 / 6944 依赖，0 循环/违规）。完整 review 范围为上述基线至本提交；阅读顺序 conversation-state → Conversation.send → useScopeContinuation.submitInput → ScopeContinuationController.submitInput → ScopeContinuationForm/SendButton。保护原有受理协议，变化局限于前端输入意图和可靠草稿转交。
- 验证边界：未运行全仓回归、打包、安装升级、真实供应商续接；未发布，也不将单元或界面夹具等同人工代码审阅。后续集成/发布仍沿既有门禁。

## 2026-11-13：Issue #65 缺参提示、当前身份缺省与执行前拒绝展示

- 来源：用户要求缺参明确字段、自动取得当前工作区身份，不展示原始校验 JSON 和副作用核实入口，并保留可选/default 语义。基线 `8061ae74`，本步开始工作区干净。读取开放清单只有 [#65](https://github.com/nan023062/cbim/issues/65)，本步对应正文第 6 项及身份获取体验，不关闭整单、不修改当前安装或历史日志。
- 状态与边界：KnowledgeTools 身份查询和缺省身份共用当前绑定实例读取；仅 undefined 使用 Schema 默认，显式其它工作区/旧实例/null/空值仍拒绝。注册表保留实际 optional/default 解析，不自动补 revision/requestId/planId、目标或权限。其它派发/岗位等工具身份不借此被改写。预检只取得当前实例，不启动业务、切换工作区或重试未知写入。
- 审计链：只在工具服务内部补身份会导致原 proposed 缺少知识事务身份，因此 loop-engine 将本实例知识工具的 normalizeInput 注入 Runtime。可信同步预解析在 proposed 前冻结生效 input；只有有差异时追加 originalInput 保存模型原值。授权、回执与原事务观察继续使用同一生效 input，执行端仍断言绑定实例。实际 Pi 回归验证缺身份的请求在 read 下拒绝，ask 下需批准，execute 下成功，并可由 originalKnowledgeWrite 从 canonical 参数重建原引用。
- 错误与 UI：Core input-validation 复用无原值的字段说明；Runtime 在执行前将 ZodError 转为 TOOL_INPUT_INVALID 并保留 Fault 码，普通执行异常仍为 unknown。Bridge 仅公开纯字段格式化；ToolTimeline 只有真实 tool.denied 且没有 allowed/started/updated 才隐藏核实插槽。旧嵌套校验 JSON 以只读投影显示字段，不改日志；已放行或仅正文声称 rejected 的错误不隐藏核实能力。
- 维护者阅读：input-validation/registry → KnowledgeTools 注册及 normalizeInput → assembly/loop-engine → Runtime.beforeTool → tool-failure-view/ToolTimeline。变化限于输入准备与拒绝展示；原领域 Schema、权限、事务、旧事件不迁移，批准或执行后失败不进入“尚未执行”说明。没有增加自动重试策略。
- 验证选择及结果：`pnpm exec vitest run tests/tool-registry.test.ts tests/knowledge-tool-contracts.test.ts tests/knowledge-tool-view.test.ts tests/loop-engine.test.ts --reporter=dot`：22 通过，覆盖默认/可选/null、缺字段、错误身份、权限及历史提示。`pnpm exec vitest run tests/knowledge-tool-output.test.ts tests/unified-tool-policy.test.ts tests/workflow-runtime.test.ts --reporter=dot`：23 通过，覆盖原输出/权限/Workflow 消费者。
- 审计补充验证：加入规范化后，`pnpm exec vitest run tests/unified-tool-policy.test.ts tests/loop-engine.test.ts --reporter=dot`：16 通过，其中真实 Pi 配本地 HTTP fixture，非在线供应商；将执行前失败细分为 describe/normalize 后，`pnpm exec vitest run tests/loop-engine.test.ts -t '执行前' --reporter=dot`：2 通过、8 未选中。共 46 个不同相关用例通过，不累计重复。
- 静态与资料：首次 `pnpm typecheck` 暴露前端 JSON parse 后 unknown 失去字符串收窄，改用保留的字符串变量后通过；规范化接口增加后的类型检查发现返回 unknown 不能赋给工具对象输入，收紧为 ToolCall['input'] 后复核。`node scripts/source-architecture.mjs` 同步受影响类图；`pnpm check:architecture`：1366 文件、6943 依赖、0 循环/违规。同步 Core tools/runtime、assembly/tools、Bridge、execution-view 的注释与契约及 7 份架构文档。
- 边界：未运行全量回归、桌面打包、安装升级、真实供应商请求或人工代码 review；截图网页抓取的空正文/搜索配置错误分类是另一项问题，本次未处理。尚未发布，后续集成和发布沿现有门禁；#65 其余事项保持开放。

## 2026-11-13：候选审阅阶段说明与依赖批准关口

- 来源：用户直接要求“交付待审阅时展示完整阶段说明，并加审阅通过后才放行的依赖关口”；基线 `4bfc2b39`，开始时工作区干净。2026-11-13 拉取开放 Issues，只有 #65；本次为直接新增要求，不虚构关联工单，不关闭 #65，不修改安装版或用户正在执行的任务。
- 语义与边界（C3 / L2）：候选交付、主调度接受、最终目标审阅、人工验收是不同事实。新增 `TaskNode.candidateReview`，当前主运行以 `cbim_dispatch_review` 显式接受/拒绝精确任务版本、结果、原运行与计划，事务追加一次不可改判的审阅及理由。接受只放行后继；拒绝不能被目标审阅当成完成证据。拒绝后撤销相关未启动后继并新建返工链，不扩展现有失败来源替换语义。
- 真实调用链：主运行工具 → ScopeGoalService 核实目标/主身份/原成员证据 → DispatchStore 原子追加 → Core 校验绑定、命令指纹和不可变性 → AutoCollaboration / MemberExecution 共用 dependenciesReady → 领取事务再次检查。保护原候选、执行租约、权限、文件/知识与人工验收机制；只将批准策略放在新依赖和候选审阅协议中。此策略变化频率尚无统计，不增加通用审批框架。
- 调度变化：前置交付而后继仍在等待审阅时，先回主轮；member-results 轮次继承同周期尚未启动的任务。主 Agent 审阅并结束主轮后沿原身份继续，避免“主等所有成员、后继等主”的互等。任务图、内联卡、详情复用阶段说明，显示待审阅、接受、拒绝及理由，不把 scope 活动伪装成“主 Agent 正在审阅”。完整路径说明包括集成与按目标要求用户验收。
- 兼容：派发、追加、替换、修订产生的新边带 `reviewRequired:true`；旧边保持原义，不能补写或清除审阅标志。三个依赖事务验证器兼容旧日志与新要求；原运行数据不迁移。自动重启回传仍沿原有“全部成员可靠交付”限制，含未启动后继时不自动恢复模型。Pi 超大结束事件中断是先前诊断的另一问题，本提交未处理。
- 验证选择：成员执行与真实存储覆盖批准/拒绝/精确结果/重复命令/重开持久记录/错误主运行/拒绝证据；协调器覆盖回主审阅和原后继跨轮保留；图规则覆盖旧边、新关口及错结果；目标审阅覆盖消费者；依赖增删换边覆盖持久校验和历史兼容；视图静态渲染与主工具/指引覆盖 UI 和入口。不以模拟模型结果声称真实供应商验收。
- 实际验证：初次 `pnpm exec vitest run tests/auto-collaboration.test.ts tests/dispatch-graph.test.ts tests/member-execution.test.ts --reporter=dot` 为 68 通过、1 失败（旧测试假定候选直接放行）。更新回归后，定向执行 `tests/member-execution.test.ts -t '依赖任务等待精确'` 发现 canonical 日志未结算时 status 不是 running，改为实时调用闭包加可靠事件终态核验后通过。
- 联合验证：`pnpm exec vitest run tests/member-execution.test.ts tests/auto-collaboration.test.ts tests/dispatch-graph.test.ts tests/scope-goal.test.ts tests/queued-dependency-addition-service.test.ts tests/queued-dependency-replacement-service.test.ts tests/queued-dependency-revision-service.test.ts --reporter=dot` 为 99 通过、13 失败；失败均为原子边校验尚未接受新标志。修正兼容校验后，`pnpm exec vitest run tests/queued-dependency-addition-service.test.ts tests/queued-dependency-replacement-service.test.ts tests/queued-dependency-revision-service.test.ts tests/queued-dependency-addition-core.test.ts tests/queued-dependency-replacement-core.test.ts tests/queued-dependency-revision-core.test.ts --reporter=dot`：50 通过。
- UI/工具验证：`pnpm exec vitest run tests/candidate-review.test.ts tests/dispatch-tools.test.ts tests/agent-role-instructions.test.ts tests/member-help-view.test.ts --reporter=dot`：34 通过。补充存储重开、错误主身份、拒绝候选最终证据保护后，`pnpm exec vitest run tests/member-execution.test.ts -t '依赖任务等待精确' --reporter=dot`：2 通过、14 未选中。所有已选受影响用例最终通过，不累计重跑次数。
- 静态与维护：类型检查首次发现新协调器测试的模拟回执缺 workspaceId/taskId，补齐后 `pnpm typecheck` 通过；`node scripts/source-architecture.mjs` 同步 7 份目录类图，`pnpm check:architecture` 通过（1364 文件、6936 依赖、0 循环/违规）。同步 Core tasks、调度 dispatch/goals/members/tools/conversation、前端 tasks 的注释与 CONTRACT/ARCHITECTURE。
- Review 入口：完整差异从上述基线到本独立提交；建议依次读 candidate-review.ts → graph/dispatch-invariants → ScopeGoalService.reviewCandidate → AutoCollaboration → member-review-state/MemberTaskDetail。后续改批准策略从 Core 协议及主审阅服务进入，阶段文案留在前端只读投影。未运行全量回归、桌面打包、安装升级、真实模型或人工代码 review；本步未发布，后续 PR/发布沿既有门禁。

## 2026-11-13：Issue #65 剩余路径修复与长写入中断验证

- 来源：用户要求继续修 [#65](https://github.com/nan023062/cbim/issues/65)，基线 `e5989abd`，开发前工作区干净，已读取工单正文及两条现有进度。复核原 Codex 运行事件及对应原生目录，原事件仅保存“请求未完整完成”，没有供应商具体原因，不能追溯断言为输出上限。
- Windows 确定性缺陷：授权侧用工作区根解析 `/tmp/...`，Pi 独立工具 SDK 却用进程当前盘符解析。`engines/native-tools.ts` 在受管文件工具边界将单根分隔符路径按工作区补成完整路径；保留原输入、UNC、显式盘符及其它平台语义，不猜 Bash/MSYS 挂载表。纯 Windows 解析测试覆盖 D 盘与六种文件工具，实际 SDK 覆盖写/读/编辑。该变化仅用于 Codex 受管工具，不修改其它引擎自带文件工具。
- 中断诊断：`transport/request-budget-usage.ts` 区分 Responses 的输出上限、内容过滤、原因未知、供应商失败；只输出本地固定文本，以 Fault 穿过预算代理已有可信错误通道。已发出但不完整的请求仍保留未知用量、阻断后续请求，不放宽结算屏障，不重试或补全参数。
- 长写入验证：真实 Codex EXE 对本地确定性 HTTP 服务，26 万字符（UTF-8 34 万字节）写入完整成功；content 类型错误保留原文件，返回工具失败并可完成下一模型轮；长参数生成中途收到 incomplete 时不执行工具、不覆盖原文件，关闭前登记真实会话，随后显式续接原线程成功且不重放。已有“工具执行后中断”及真实应用恢复测试继续通过。这里只验证模型生成中断和错误参数，不声称文件系统写入过程中断电具有原子保障。
- 验证依据：路径工具直接变化、流解析/预算传输为诊断消费者，Codex 中断与写入测试覆盖执行屏障及会话恢复。首轮 `pnpm exec vitest run tests/native-tool-paths.test.ts tests/model-request-budget-usage.test.ts tests/codex-write-recovery.test.ts tests/codex-interruption.test.ts --reporter=dot`：26 通过、1 失败（新增测试误用 SDK 旧 edit 参数）；按真实 edits[] 协议修正夹具后，`pnpm exec vitest run tests/native-tool-paths.test.ts tests/model-request-budget-transport.test.ts --reporter=dot`：17 通过。新增预算通道回归、将可信诊断改为 Fault 后，`pnpm exec vitest run tests/model-request-budget-usage.test.ts tests/model-request-budget-transport.test.ts tests/codex-write-recovery.test.ts tests/codex-interruption.test.ts --reporter=dot`：29 通过。最终共 37 个不同相关用例通过，不累计重跑。
- 同步维护：两处源码文件头/接口说明，engines 与 transport 的 CONTRACT/ARCHITECTURE；生成器更新两份类图。`pnpm check:architecture`：1360 文件、6908 条依赖、0 循环及违规；`pnpm typecheck` 通过。未运行全量回归、打包、发布、真实供应商调用或人工 review，未改用户安装及历史数据。
- 剩余边界：Windows 已证实缺陷已修；长写入没有复现额外执行层缺陷，诊断和恢复得到验证。旧日志已丢失的具体供应商原因不能补造，Issue 保持开放等待使用新版时的原始复现证据，不把本地 HTTP 测试等同真实 DeepSeek 验收。

## 2026-11-13：Issue #65 多轮失败的日志核实与确定性修复

- 来源：[Issue #65](https://github.com/nan023062/cbim/issues/65)，开放清单只有此项，基线 `bf63b3a9`。用户确认 Codex 和 Claude Code 均出现问题，并授权只读本地 CBIM 对话日志；读取 webfps 对应运行事件及 dispatch 记录，未修改已安装应用、工作区或会话数据，原始日志与私有诊断未提交仓库。
- Claude 根因：本地 `9ed3dad6` 运行的 assistant 原文记录 API 400，`cbim_dispatch_cancel` 的 `#/anyOf/0/properties/expectedGraphCursor` 指针失效。`engines/claude/tools.ts` 顶层联合投影前保存原定义图并重定位引用，保留递归与转义指针，不改原领域校验。真实取消工具目录和实际 Claude SDK 发出的本地 HTTP 请求均验证可编译。
- 原生误拦截：`.cbim_write_probe` 被子串规则误判；两条管道 grep 仅过滤 ls/curl 输出也被当作递归搜索。`main/platform/tool-guard.ts` 按完整路径段判断，已知文件工具仅检查定位字段；仅允许可确认的标准输入 grep，文件参数、递归、重定向及展开仍拒绝。现存链接与显式知识路径保护保留；该规则不是 OS 沙箱。
- 参数与目标：反馈 Skill 缺身份曾产生原始 Zod 错误；`core/tools/registry.ts` 现返回字段和身份获取入口，不回显正文、不自动填身份。`conversation/main-agent.ts` 指引每轮核实例、继续正式业务先核当前目标。日志证明普通发送开启新 scope，原 plan 未删除；旧版本审阅失败后 goal-repair 已重新规划。此次未改调度状态机，也未降低计划覆盖全部验收条件或人工验收要求。
- 验证选择：门禁、注册表、角色指引是直接变化单元；知识工具与统一策略覆盖调用方；Claude Schema 与真实 SDK 请求覆盖本次 400 的实际目录路径。`pnpm exec vitest run tests/native-tool-guard.test.ts tests/tool-registry.test.ts tests/agent-role-instructions.test.ts --reporter=dot`：18 通过；`pnpm exec vitest run tests/knowledge-tool-contracts.test.ts tests/unified-tool-policy.test.ts --reporter=dot`：9 通过；`pnpm exec vitest run tests/claude-schema.test.ts --reporter=dot`：2 通过；`pnpm exec vitest run tests/claude-tools.test.ts -t 'real Claude internal tool receives' --reporter=dot`：1 通过、8 未选中。补充 shell 分隔符保护后仅重跑 `tests/native-tool-guard.test.ts`：5 通过。共 30 个不同用例通过，不把重跑计成新增。
- 同步维护：上述四处源码文件头/关键行为说明、各目录 CONTRACT 与 ARCHITECTURE；`node scripts/source-architecture.mjs` 更新四份，`pnpm check:architecture` 通过，1358 文件、6904 依赖、0 循环/违规。`pnpm typecheck` 首次发现新测试夹具含多余身份字段，按真实 MainToolOutputBinding 修正后复跑通过；对应两个 Schema 用例复跑通过。
- 验证边界与剩余：未运行全量回归、打包、安装升级、真实供应商请求或人工代码 review。Codex `3c2256e2` 的请求未完整完成没有对应长写入失败证据；后续 3202–12495 字符写入实际成功，不能据此虚构长度阈值。Windows `/tmp` 在 Bash 与原生工具解析到不同盘符，明确 D 盘绝对路径已在原记录成功，本次未改路径适配。Issue 保持开放追踪这些剩余项，不把局部修复报告为整单完成。

## 2026-11-13：C 0.1.15 / R3 公开与真实升级通过

- 用户追加授权自动提交 PR 并发布。[PR #63](https://github.com/nan023062/cbim/pull/63) 正常合并，冻结源码 `98b7caf9`，merge `e85a81f0`；准确 head 完整 Windows 四片通过：427 文件、2886 通过、0 失败、2 个因缺专用历史 EXE 的既有跳过。
- 原签名身份生成 R3，沿用固定冷壳、公钥与三个引擎。候选安装与失败恢复通过；公开 R/E 字节校验后切换清单，立即回读遇到 CDN 旧 R2 缓存，保留失败日志，未重复发布。随后普通匿名 URL 返回准确 R3 并验签通过。
- 真实线上 R1→R3 验收通过：后台准备、普通退出不升级、真实侧栏按钮重启到 R3；工作区/知识/模型/任务/文件/localStorage 保留，确定性模型请求 1 次，无重放、无页面错误。Windows 冷包仍未签名；没有测试用户真实 API Key 或承诺完整模型能力。
- 官网依据公开回执更新 R3，构建和 14 个响应式/离线场景通过。部署和双分支最终状态由收尾 PR 的合并、部署和匿名回读回执记录，不提前认定通过。完整命令、来源、摘要、跳过理由与失败恢复见 [R3 发布记录](verification/runtime-c0.1.15-r3-20261113.md)。
- 本次收尾只修改官网与发布记录，没有修改产品源码或已发布 ZIP；未重复本地产品单元、类型和架构检查，收尾 PR 仍走既有完整 CI。

## 2026-11-13：一份供应商凭据按引擎选择兼容接口

- 来源：用户要求实施“常见供应商预设、自定义兼容接口、按引擎匹配模型”，并询问改动文件。基线 `e38ddb70`，`nan023062/cbim` 开放 Issues 查询为空，按直接需求开发，未创建工单。
- 行为：旧 DeepSeek 官方配置无需复制或迁移，Pi 保持原接口，Claude Code / Codex 在需要时选择 Anthropic Messages / Responses。增加 DeepSeek、Kimi 国际 API、MiniMax 国际 API、OpenAI、Anthropic 预设；地域、套餐及代理地址不模糊匹配，供应商明确限制的型号也参与筛选。自定义供应商可保存另外两种协议地址及适用型号，所有接口只共用原供应商一份加密 Key。新增或改动自定义凭据目标仍需重输 Key；读取、切换和预览不联网。
- 职责与 review 入口：先读 [接口选择契约](../src/logic/budget/rules/CONTRACT.md) → `provider-presets.ts`（已核对官方资料的可变地址策略）→ `provider-connections.ts`（纯选型）→ [LlmProfiles 契约](../src/logic/models/service/CONTRACT.md)（配置锁与延迟解密）→ `ProviderConnections.tsx` / `ModelSettings.tsx`。运行只冻结选中的 api/baseUrl，候选接口及自动识别不进入任务/岗位快照；主会话、Agent 编辑、岗位和模块负责人入口共用解析，保持原引擎、型号、权限与运行生命周期。今后增加供应商预设只改策略数据及其验证，不修改原生引擎或请求传输。
- 完整产品改动范围（16 个代码/样式文件）：`src/backend/core/models/{config.ts,ports.ts,provider-presets.ts,provider-connections.ts}`；`src/backend/main/models/llm-profiles.ts`；`src/backend/main/ipc/settings-handlers.ts`；`src/bridge/contracts/{models.ts,model-actions.ts}`；`src/frontend/settings/{ModelSettings.tsx,ProviderConnections.tsx,models.css}`；`src/frontend/components/EngineModelPicker.tsx`；`src/frontend/conversation/Conversation.tsx`；`src/frontend/knowledge/ArchitectureEditor.tsx`；`src/frontend/team/WorkspaceMemberForm.tsx`；`src/frontend/workspace/inline-module-ownership.ts`。相关文件头/关键说明与上述涉及的 10 个目录、以及 main/settings 的契约和 11 份架构文档同步；未调整其他业务行为。
- 单元选取依据：纯接口解析和 UI 筛选、加密保存/HTTP 测试、旧快照兼容、主 Agent 保存、岗位配置锁、IPC 及模块登记是实际消费者。`pnpm exec vitest run tests/provider-connections.test.ts tests/llm.test.ts tests/engine-configuration.test.ts tests/main-agent-settings.test.ts tests/owner-model-configuration.test.ts tests/model-actions.test.ts tests/inline-module-ownership.test.ts --reporter=dot` 首批 7 文件 / 60 项通过。补齐模块卡片实际采纳 Anthropic 接口及调整设置控件后，`pnpm exec vitest run tests/provider-connections.test.ts tests/inline-module-ownership.test.ts --reporter=dot` 23 项通过；去重现行覆盖 61 项。随后 IPC 改走已有公开重导出，`pnpm exec vitest run tests/model-actions.test.ts --reporter=dot` 3 项通过。
- 界面验证：`node scripts/provider-connections-ui-smoke.mjs` 使用真实 React 设置组件和确定性 IPC，6 组检查通过、0 页面错误：旧供应商跨引擎可选、显式测试目标、失败保留目录、取消草稿、自定义地址/型号范围保存、预设填写及 390px 布局。初次两次在新增预设控件的精确标签定位处失败，保留失败报告并补齐明确 aria-label 后通过；未掩盖页面异常。结果位于 `test-results/provider-connections-ui-report.json` 与 `provider-connections-mobile.png`，失败记录为 `provider-connections-ui-failure.json`。真实 HTTP 路径、鉴权头和失败不降级由 `llm.test.ts` 的本地 HTTP 服务验证。
- 静态检查：`pnpm typecheck` 通过；`pnpm check:architecture` 首次发现 model-actions 直接导入引擎契约不符合已有 IPC 逻辑边界，改用 `bridge/contracts/models.ts` 的既有公开入口后通过，未放宽检测规则：87 目录、687 代码/样式、1357 文件、6902 依赖、0 循环/违规。`git diff --check` 通过。
- 验证边界：没有读取用户 Key、调用在线模型、运行全量回归、打包、安装升级或发布；HTTP 短文本成功不代表供应商完整工具/推理/流式能力验收，运行失败不会自动换协议重发。本轮保留本地独立提交供 review，未推送；后续 PR 全量与发布验收仍独立。

## 2026-11-13：C 0.1.15 / R2 公开与真实升级通过

- 用户授权发布及提交、推送全部改动；[PR #61](https://github.com/nan023062/cbim/pull/61) 正常合并，冻结资源源码 `e5e7fc47`，合并提交 `f3b8cf69`。准确 head 完整 Windows 四片通过：426 文件、2,866 通过、0 失败、2 个缺少指定历史 EXE 的原有跳过。
- 签名 R2 已投放既有 `runtime-c0.1.15` 通道，沿用 C 0.1.15 安装包、公钥与三个 E；首次目录大小观察不准确和随后旧清单缓存回读均如实记录，未覆盖不可变 ZIP 或重复切换清单。
- 真实旧安装版通过默认公开通道准备 R2、普通退出保持 R1、实际 UI 点击后重启到 R2；工作区/知识/模型/原任务/文件/localStorage 保留，模型请求 1 次、页面错误 0。Windows 冷包仍未签名，资源清单已签名。
- 官网改为明确 C 安装版与 R2 资源版，品牌、构建和 14 个响应式/离线场景通过。官网部署与最终分支回执通过独立收尾 PR 记录；本条不冒充该 PR 之后的部署验收。完整来源、命令、失败恢复、公开回执和线上 Actions 链接见[发布记录](verification/runtime-c0.1.15-r2-20261112.md)。

## 2026-11-12：R2 发布 CI 的返工消费者测试对齐

- 用户授权发布并提交、推送全部本地改动；当前开放 Issues 为空，未新建工单。PR [#61](https://github.com/nan023062/cbim/pull/61) 的完整 CI 暴露 5 组旧确定性供应商未处理新增的有界返工回合，合计 8 个失败。
- 仅调整 9 个测试文件：负向供应商持续返回无效结论，验证两次无进展后停止；保留人工主体、输入版本、原任务和队列、重启不重放的断言，没有降低产品验收门槛或修改产品。
- 依据失败消费者选择 `scope-wait-pi`、`human-continuation-pi`、`queued-task-cancel-pi`、`active-goal-input-pi`、`goal-review-pi`，两次定向运行合计 5 文件 / 28 项通过，`git diff --check` 通过；不重复已通过且未变的产品类型、架构和候选验收。新的完整 PR CI 待完成。
- 候选隔离验收已通过，公开与真实在线升级仍未完成。冻结来源、原失败与修正、验证命令和资料副本边界见[发布记录](verification/runtime-c0.1.15-r2-20261112.md)。

## 2026-11-12：准备 C 0.1.15 / R2 资源发布

- 用户要求发布新版本并将本地全部改动提交、推送；本地成果提交 `013eb98a`，合并远端既有 0.1.15 发布修复为 `b3122016`，develop 已推送一致。开放 Issues 为空，无新工单。
- 选择兼容 R2，复用现有冷包、公钥和三引擎，未改变安装身份。合并消费者 11 项、类型、架构、品牌、官网构建通过；新增隔离资源升级验收，独立脚本严格类型检查通过。
- 候选构建、完整 CI、公开、真实升级及官网回执见[本轮发布记录](verification/runtime-c0.1.15-r2-20261112.md)，以实际结果回填，不将准备等同发布。

## 2026-11-12：重启后自动接收可靠成员成果

- 来源：承接用户依次完成剩余缺口的直接授权；先完成返工，再实施恢复。没有开放 Issue，未新建或回填；既有工作区改动保留。
- 完成：主轮结束后冻结待回传批次；重启仅接收完整已完成成员结果，核原日志、模型、当前声明证据和未消费信封，沿原权限与预算启动新主接收轮。旧成员不重跑，未知启动意图不补发，停止/等待/旧记录不自动复活。
- 验证：独立宿主真实写入交付后被强制终止，重启自动完成验收；损坏日志、未确认启动意图、已停止、模型变化均不续跑。配套预算、主轮跟踪、成员等待与公开详情消费者 27 项通过。两个缺口合计覆盖 20 文件、164 个现行用例通过，无未解决失败；测试使用真实引擎和本地确定性模型响应，不代表在线模型自主完成真实项目。
- 静态与资料：`pnpm typecheck`、`pnpm check:architecture`、`git diff --check` 通过，依赖零循环。同步受影响源码注释、架构图、任务契约与旧审计现状链接；具体命令、分段结果、失败修正及 review 入口见[专项验证记录](verification/automatic-rework-recovery-20261112.md)。本轮未跑全量、桌面实测、打包或发布，未提交/推送。

## 2026-11-12：最终验收失败后的有界自动返工

- 来源：用户要求依次完成剩余两个缺口；查询当前开放 Issues 为空，按直接授权实施，保留既有未提交改动。
- 完成：可修复的最终验收失败经原日志核实后回到主调度；独立 `goal-repair` 系统来源保持原权限、预算与运行上限，最多三次、同问题无进展最多两次。业务拒绝可精确引用有效旧候选，后续新候选仍独立验收；原历史与人工条件不改写。
- 验证：`goal-repair`、`application-collaboration-pi`、`auto-collaboration`、`scope-goal` 首批 64 项通过，包含真实 Pi 漏审阅后自动补审阅关闭。随后上述协调器/目标测试及 `continuation-source-core`、`continuation-source-view`、`claude-engine`、`codex-engine`、`public-run-events` 共 86 项暴露 1 项业务拒绝的持久化规则遗漏；修正后 `scope-goal`、`human-continuation-core`、`human-continuation-service` 38 项通过。报告保存在 `test-results/goal-repair-{initial,boundaries,rejection}.json`，原失败报告保留。负向覆盖无进展、预算耗尽、未知和停止；新候选仍受人工条件约束。
- 后续验证：真实 Pi 执行失败命令，系统自动返工写入修复并重测成功，原失败回执保留；停止与返工准备竞争已修正并定向复测。后续恢复已在上方条目完成，实际命令和边界统一见[专项验证记录](verification/automatic-rework-recovery-20261112.md)。
- 阅读入口：`core/tasks/CONTRACT.md` 的有界返工约定、`dispatch/goal-repair.ts`、`ScopeGoalService.repairContext`、`AutoCollaboration.finishCycle/advance` 与系统接续入口。同步源码说明和受影响目录类图；本步没有运行全量、打包或发布。

## 2026-11-12：通用代码检查后的全量回归

- 来源：用户明确要求运行全量测试；承接本地未提交实现，没有新增或回填 Issue。
- 范围与结果：按现有 Vitest 配置核对全部 421 个测试文件。上一轮中断前 54 文件、313 项已通过，本轮续跑其余 367 文件；唯一失败为旧边界测试遗漏已存在的 `backend/bootstrap` 层。同步测试规则后定向复测 2 项通过，最终去重合计 2839 项通过、0 项未解决失败、2 项历史 EXE 用例按原条件跳过。
- 修正：仅在 `tests/layer-boundaries.test.ts` 补齐与正式依赖检查器一致的冷壳依赖规则及说明；没有修改产品源码或放宽其他层。此遗漏已存在于当前 HEAD `2187842f`，与本次通用代码检查实现无关。
- 实际命令、分段证据、文件覆盖核对与跳过原因见[全量验证记录](verification/full-code-check-20261112.md)。新机制 `tests/code-check.test.ts` 的 9 项也在本轮通过。修正只影响边界测试，未重跑其余已通过用例；本轮未重复类型/架构检查，未构建、打包、发布或提交。

## 2026-11-12：通用代码检查接入成员交付

- 来源：用户直接要求实现缺口 1 并运行相关测试；开放 GitHub Issues 查询为空，未创建工单。保留此前文档清理等未提交改动。
- 实现：Workflow 冻结命令、cwd、超时及成功判据；成员授权后运行整组真实进程，保存可信检查事件。交付与历史重算核对命令要求、知识版本和最终完整源码集合。零测试、失败、超时及检查期间源码变化拒绝通过。
- 阅读入口：[验证契约](../src/logic/evidence/rules/CONTRACT.md)。范围复用 artifactScope，支持显式输入集合，不声称覆盖未声明依赖或环境；受原完整清单容量限制。测试适配脚本负责输出结构化摘要。
- 验证：`pnpm exec vitest run tests/code-check.test.ts tests/workflow-contract.test.ts tests/workflow-evidence.test.ts tests/workflow-runtime.test.ts tests/complete-output-runtime.test.ts tests/task-progress.test.ts tests/member-tool-output-core.test.ts` 首轮 72 项通过；新增真实运行到持久日志重算用例后，`pnpm exec vitest run tests/code-check.test.ts` 9 项通过，共 73 个相关用例。覆盖平台执行、失败判据、新交付链及原 Workflow 消费者；未运行全量、桌面模型实测、构建或发布。
- 静态检查：类型检查发现并修复新增测试回执缺字段及公开证明类型遗漏；最终 `pnpm typecheck`、`pnpm check:architecture` 通过，依赖零循环。同步相关源码说明、证据契约和八个受影响目录架构图。
- 本次仍需人工代码 review；未实现自动返工或自动恢复，未推送。

## 2026-11-12：收敛到本地全自动 AI Native 团队开发

- 用户明确不需要 Cindy；CBIM 面向单人或少数人，不需要联网和大型团队使用，当前全力打通全自动 AI Native 团队开发工作流。其他能力延后，不因已有分析或方案自动继续建设。
- 更新 [核心模型](team-workspace-network.md)：本地目标→分工→执行协作→自动 review/验证→返工→交付→沉淀是当前主线；增加完成判据，明确无需人逐步骤派工/批准，普通故障自动处理，真实阻塞才请求介入。工作区网络先表达本地业务关系，跨服务协议收敛为本地状态与副作用恢复。
- Cindy 承载分析（已停止路线，分析草案于本轮清理删除） 标为当前不采用的历史讨论，从当前 design 导航移除；同步概念文档 01/02。联网协作、跨设备、大型组织及分布式基础设施均移出当前范围，不据此删除既有功能或声称已有完整离线运行能力。
- 本次只调整方向、方案与验收基准，核对文档引用、锚点和差异格式；未修改产品源码、运行测试或实施新的开发闭环，不宣称自动开发已经打通。开发清单仍以 Issues 为准，不在方案中维护实时待办。

## 2026-11-12：0.1.15 公开升级验收与官网收尾

- 用户明确要求完成官网 0.1.15、发布记录和双分支同步；账号/仓库仍为 `nan023062` / `nan023062/cbim`，开放 Issues 为空，按直接需求收尾，未创建工单。使用现有独立工作树，保留主工作区未提交的概念/边界文档。
- 公开版为 C 0.1.15 / R 1，冻结 source `ca0f75992b17b918302a8c066af9afcd8e547e96`，Release `442863050` 于 `2026-11-12T12:30:19Z` 公开；产品 PR #59 已合并。完整四片 CI `43214483203` 为 2839 通过、0 失败、2 个既有固定历史 EXE 场景跳过，候选全新/覆盖安装 `43212888739` 通过。初始 R 清单匿名验签及三个独立 E 的公开字节核验通过；Windows 安装包仍为未签名发行。
- 0.1.14 首次在线 `43218619687` 在读取列表阶段失败，未开始下载，具体网络原因未知，原现场保留。相同制品和验收条件的独立复验 `43219727847` 通过：安装包有效传输 2.68 MiB，相对完整 106.65 MiB 减少 97.48%，13 次 Range、零全量回退；缓存复用阶段零安装包请求，普通退出不安装，显式重启后原工作区、模型、主 Agent 配置、自动化、知识、业务文件及会话保留，无重放，1 次模型请求、0 页面错误。统计不含元数据、协议开销和 E 下载。
- 历史 0.1.0 原设置页在线升级 `43218707122` 通过，实际自然选择最高稳定版 0.1.15；没有把它写成 0.1.0 → 0.1.1 或差分下载验收。该旧版没有主 Agent 配置/自动化，相关项明确不适用。详细来源、失败与限制见 [0.1.15 发布报告](verification/desktop-release-0.1.15-20261112.md)。
- 官网首页、下载页、`website/release.json` 和 README 直接采用公开回执；已有 `pnpm check:brand`、`pnpm build:website`、`node scripts/website-smoke.mjs` 的 14 个页面场景通过，网页输入未变化，沿用已有结果。本轮只补报告、记录和导航，核对事实、链接及已验证字节；未重复执行产品单元、类型/架构检查、打包或安装。完整 PR 自动化仍按现有流程执行，官网部署与远端分支最终回执在收尾 PR 中记录，不以本地页面或旧 CI 替代。
- 冻结 Builtins 复核已通过：24 个白名单条目、正文与运行入口保持一致；发布后验证文档不追补进旧安装包。未改产品源码、运行契约或类图，也未覆盖公开附件、移动标签或改变旧 Python latest。

## 2026-11-12：准备 0.1.15 冷壳迁移发布

- 用户要求发布后重新验证在线升级。核实当前公开最高桌面版为 0.1.14、Python latest 为 `v1.0.2`，账号与仓库为 `nan023062/cbim`；历史 0.1.0→0.1.1 不再是当前通道自然选择的跨度，已单独澄清测试意图，没有改写历史附件或标签。
- 使用独立冻结工作树，保留主目录未提交文档；合并 UI `95458460`、C/R/E `2187842f` 及已在远端 develop 的中断恢复 `34afe7c7`，保留各提交。两个冲突仅为说明/记录，保留双方业务行为及历史记录。合并后针对 Codex 生命周期、E 绑定和前端恢复运行 5 文件/13 项，全部通过。
- 准备 C 0.1.15 / R 1，沿用此前明确的 Windows 未签名发行。首次建立长期 Ed25519 资源签名身份，保存在本机仓库外、仅当前 Windows 用户及 SYSTEM 可访问的目录；构建引用该已有身份，不生成临时生产密钥。公开 SPKI SHA-256 为 `378c827bf38efb6724466bbb39d3e39ee4ef2dc1de2576fa1fde760443145c49`，私钥未进入源码、日志、制品或远端。
- 验收器补齐 0.1.14 的旧界面、缓存与新增持久数据；目标 C/R 图标、后台工程恢复、首次真实 E 下载与调用分别核验。`pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs --reporter=dot` 最终 42 项通过；首次发现“未支持未来版”断言仍以 0.1.14 为例，更新为尚未支持的 0.1.15 后复跑通过。
- `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:brand`、`pnpm build:website` 通过；架构 87 目录/681 源码样式、1343 文件/6805 依赖、0 循环/违规。官网仍保留公开 0.1.14，未提前改为候选版。新验收脚本通过 Node 语法检查；脚本本身待隔离安装运行，未把适配完成当作安装或线上升级通过。
- 本条仅记录候选准备；完整 PR 四片、真实打包/隔离安装、公开附件及在线升级均须取得本次证据后另行回填。资源签名不替代 Authenticode；初始 E 先核验、独立投放，正式冷包仍经安装与 CI 门槛。

## 2026-11-12：接通 C/R/E 分层桌面更新

- 来源与基线：用户明确要求先完成侧栏优化，再按桌面更新设计重构；在 UI 独立提交 `95458460` 后继续。开放 Issues 查询为空，按直接需求实施，没有创建或回填工单。旧 0.1.14 公开更新保持原状，本次不发布、不安装用户客户端。
- 完成：固定 bootstrap 负责 C 身份、资源验签、选择日志与恢复；R 包含编译后的 TS 业务、preload/worker/renderer 与资源，后台下载、解压并完整校验，ready 后由用户点击排空业务、授权、短重启。同 C 按 R 递增，C 改变继续复用 NSIS；普通退出不激活。移除固定两秒等待，窗口先显示再恢复工作区，只有真实页面与 IPC 就绪才确认新 R。
- E 从整包拆为三个预编译闭包，第一次使用按固定清单下载/校验，不在用户机器编译或安装 npm 依赖；窗口启动不等 E。保留已验证版本、原权限和会话约束，Codex 显式准备 Pi 工具依赖。原生会话旁路记录 E 摘要，跨 E 不静默续写旧历史。侧栏补充 E 准备进度/错误但不授予应用安装资格。
- 可信边界：Ed25519 公钥随 C 固定；清单绑定 C/指纹/平台、有效期和完整文件表；固定 GitHub 附件源、路径/链接/大小校验、内容寻址不可变目录。激活日志与下载缓存分离；坏候选只有在明确未访问数据时可回退，接触数据或状态不明时进入独立恢复界面。缓存根纳入工程、资源仓库及受控文件边界。
- 构建工具：新增 R/E 制作、验证及手动投放入口；普通 R 只编译 JS，不打 Electron/NSIS，不复制引擎。冷指纹拒绝原生/固定入口变化冒充 R。新 C 继续原发布流程并检查初始 E 已公开；资源投放先不可变附件回读、最后清单。没有内置完整发布 CI/人工门禁，正式发布仍走原验收授权。
- 验证按清单/缓存/激活、真实引擎、更新生命周期、路径消费者、UI 与依赖检测分批指定受影响文件，最终通过；命令、选择依据、修正和范围见[专项记录](verification/desktop-runtime-20261112.md)。最终 E 装载/打包补测 4 文件 5 项通过。真实 App 浏览器 11 组通过；真实 Electron 隔离 R1→R2 10 项通过、0 页面错误，证明后台准备、普通退出不安装、显式重启切换和用户数据标记保留。样本 R ZIP 约 3.82 MiB，不作为生产耗时/下载量承诺。
- `pnpm typecheck`、新增 CLI 专项类型检查、`pnpm check:architecture` 通过；后者 87 目录/681 源码样式、1340 文件/6799 依赖，0 循环/违规。同步全部受影响源码注释、契约、类图和父层导航，以及架构维护/发布三入口。新增冷壳动态装载也纳入源依赖审计。没有运行全仓回归、正式冷包、安装升级、合并、推送或公开投放。
- 交接：从 [bootstrap 契约](../src/bridge/server/bootstrap/CONTRACT.md)、[更新契约](../src/logic/updates/service/CONTRACT.md)、[引擎契约](../src/logic/execution/engines/CONTRACT.md) 到[构建/发布运行说明](task/desktop-runtime-release.md) review。保护低频 C 及原数据，将日常需求/BUGFix 限制到 R、外部引擎变化限制到 E。旧用户仍需一次冷更迁移；生产资源签名身份需发布者配置。首版不含文件级增量、主进程 HMR、旧 E 自动选择/跨 E 会话迁移和缓存自动回收，不把目标设计中的扩展写成已实现。

## 2026-11-12：团队与工作区网络核心模型及 Cindy 承载边界

- 用户明确 CBIM 是 Agent 团队与业务工作区网络，工具/MCP/连接器/插件属于能力或业务扩展；本轮直接要求先写核心模型和运行规则，再对齐 Cindy。范围为方案文档，不启动源码迁移、插件开发或发布。核对基线 `95458460`，工作区既有更新器/运行包改动保持原样。
- [核心模型](team-workspace-network.md) 定义能力、组织、业务架构、网络、执行与成长六个视角；明确跨工作区关系、权威状态、委托/认领、业务与运行状态分离、未知结果、并发预算及资产版本采纳。以背包扩容跨程序/美术/QA 工作区的场景串联，并区分已有代码基础与目标设计。
- 承载边界（已停止路线，分析草案于本轮清理删除） 区分 CBIM 业务调度与 Cindy 执行运行管理，列出宿主需求契约和故障验证场景。公开文档描述、当前工具发现、目标宿主实测分级；本轮只有前两类证据，没有实际接入回执。未将 Orca 的规划、插件能力目录或会话结束等同于 CBIM 目标能力已实现。
- 用户进一步指出执行引擎虽重要但来自 Cindy 外部；据此区分模型、上游 Agent 引擎、Cindy 宿主整合和 CBIM 业务四层，撤回默认优先 Cindy 的判断。新增直接复用引擎与经 Cindy 接入的同条件对照，平台选择依据宿主增量价值，不把上游引擎能力计作 Cindy 独有收益。
- 同步概念文档 01/02 的产品定位及 design 导航；未改产品内置规则、Schema、源码类图或开发任务清单。纯文档核对本地链接/锚点、Mermaid 语法和内容边界，不运行产品测试、类型检查、构建或完整架构生成。材料交付不等于人工 review 或迁移路线已获批准。

## 2026-11-12：侧栏更新图标与就绪安装交互

- 来源：用户截图指示将菜单“版本与更新”移到用户栏右侧原主题按钮位置，要求版本/进度 tooltip、仅就绪点击安装、满环呼吸；随后明确先完成此优化，再按桌面更新设计重构后端。基线 `d8d965b2`，完整开放 Issues 查询为空，按直接需求实施，未创建或回填工单。
- 完成：新增 `SoftwareUpdateButton` 与纯派生 `updateButtonState`，复用标准箭头图标和唯一窗口更新 controller。主题仍在菜单内；移除重复菜单更新项和头像绿点。未知进度转动、下载最多 99、已验证 ready 满环呼吸；请求提交后立即进入忙碌态，鼠标与键盘都只在 ready 时发一次 install。tooltip 包含当前/目标版本、进度及错误，支持键盘、Escape、视口避让与减少动态效果。
- 为后续架构预留可选 C/R 展示字段，旧版本仍显示原单版本；提醒的隐藏身份同时包含 C/R，避免同一冷包的下一次资源更新被错误隐藏。详情继续从新版提醒打开，原设置/会话保持挂载；后端下载、安装和数据所有权本步不变。
- 验证选取：状态规则直接决定安装资格，运行 `pnpm exec vitest run tests/update-button-state.test.ts`，4/4 通过；实际 App 的图标、菜单、controller、详情和草稿均受影响，运行 `node scripts/desktop-updates-ui-smoke.mjs`，最终 10 组浏览器检查、0 页面错误。中间发现请求提交到后端回执之间仍短暂呼吸，修正 pending 呈现后补跑相关单元和浏览器，通过。
- `pnpm typecheck`、`pnpm check:architecture` 通过，依赖含类型无环且无边界违规。同步更新 shell / updates 注释、契约、类图和父层导航、settings 入口说明、bridge 更新契约类图；生成器只修改目录描述。源码阅读顺序：更新契约 → update-button-state → SoftwareUpdateButton → UserMenu/App；完整变更以本条对应独立提交为准。
- 界面证据：`test-results/desktop-updates-ui-report.json`、`update-icon-ready-light.png`、`update-icon-ready-dark.png`、`update-icon-narrow.png`。浏览器使用隔离 IPC fixture，没有执行真实安装。更新旧的打包验收脚本选择器但未运行制品验收；未运行全仓回归、构建、安装、合并、推送或发布。
- 交付边界：此步只完成 UI；后端冷壳/资源/独立引擎重构仍按用户已授权的[桌面更新设计](task/desktop-hot-update-design.md)继续，不能将基础草稿或此处通过结果当作热更链路已实现。

## 2026-11-12：中断会话登记与界面恢复入口

- 来源：用户本机 0.1.14 在工具交互后收到“请求未完整完成”，原生文件存在，但 `session.bound` 仅记录线程 ID，空闲会话发送按钮持续禁用。用户明确授权补齐登记、增加恢复入口并推送 develop，本步不发布。开放 Issues 查询为空，按直接需求实施，未创建或回填工单。基线 `05920e81`，使用独立工作树，保留主工作区正在进行的更新功能改动。
- 实现：CodexEngine 在 close 关闭代理、等待原生进程和回调排空后，对回执指定且真实存在的文件补做身份校验与登记；Runtime 仍在引擎关闭后封存终态。成功绑定和关闭屏障去重，异常保留原原因，不重放工具、不回写旧日志。修正同一校验器的目录后代判断，包含 Windows 分隔符，拒绝目录外同名文件。
- 界面：发送资格与 `threadRecoveryReason` 共用阻断判断，解释缺运行头、缺原生文件、部分日志及未决工具；输入区提供“查看原运行”和“新建对话继续”。前者只定位主 Agent 详情中的既有核实入口，后者创建空对话，原历史、草稿和附件保留，不自动转交上下文或启动原操作。旧已封存记录不会自动补写，不能将此入口描述成旧 native 修复。
- 验证选择：引擎生命周期和路径校验、主会话真实运行/停止/重发、跨引擎和成员身份直接受影响；前端检查实际 App 的发送资格与恢复操作。`pnpm exec vitest run tests/codex-interruption.test.ts tests/thread-recovery-notice.test.ts tests/conversation-retry.test.ts tests/codex-lifecycle.test.ts tests/codex-engine.test.ts --reporter=dot` 首轮发现新夹具漏填模型名称及旧断言仍要求缺失路径；修正后运行 `pnpm exec vitest run tests/codex-interruption.test.ts tests/conversation-retry.test.ts tests/runtime-failed-retry.test.ts tests/engine-session.test.ts --reporter=dot`，23 项通过；增加真实应用主动停止用例后仅运行 `pnpm exec vitest run tests/codex-interruption.test.ts -t '真实应用' --reporter=dot`，选中 2 项通过，另 3 项未选中；正常跨引擎及成员消费者 `pnpm exec vitest run tests/codex-application.test.ts --reporter=dot`，2 项通过。合计 8 文件、35 项唯一相关用例通过，不累加重复执行。
- 实际结果：工具执行后响应不完整和主动停止均能在封存前登记，续接同一原生文件与主会话实例，旧 CBIM 日志事件不变、工具未重放；首次 HTTP 400 后继续 Codex 或切换 Pi 均通过。身份不符、目录外文件和尾行不完整仍拒绝。模型服务为确定性本地 HTTP，Codex/Pi/Claude 为真实引擎，不代表用户供应商在线验收。
- `node scripts/interrupted-chat-ui-smoke.mjs`：真实 React App/Conversation 与隔离 IPC 夹具，5 组检查通过、0 页面错误、0 发送/恢复启动请求；验证可继续的中断、三类不可靠历史阻断、查看原运行、新建可发送对话、原草稿保留。夹具最初对禁用发送时 Enter 的换行预期错误，已按既有编辑行为修正。证据保存在本工作树 `test-results/interrupted-chat-ui-report.json` 和 `interrupted-chat-recovery.png`。
- `pnpm typecheck`、`pnpm check:architecture` 通过：86 目录/668 源码样式，1308 维护文件/6703 依赖，0 循环/边界违规。同步 codex 与 conversation 的文件头、关键接口说明、CONTRACT 和 ARCHITECTURE；依赖方向不变。阅读顺序：CodexEngine.close → readCodexSession → ThreadHistoryNotice → Conversation；完整 diff 为本条对应独立提交相对 `05920e81`。
- 边界：未修改用户安装目录或会话数据；未运行全仓回归、PR 四片 CI、打包、安装升级验收或公开发布，等待其他功能统一集成。代码自查和上述验证已完成，人工 review 与后续正式发布验收仍独立。

## 2026-11-12：0.1.14 发布与真实增量更新通过

- 用户授权推送 develop 并发布测试增量；两项对话修复随 0.1.14 公开，冻结 source 216a15e225dd646420afcd3e3cc618ef10f0391b，Release 442699257，PR #57 合并 bf283752f9f79d9a2bdd193e40729f5ac833688b。未扩大发布范围、未修改既有附件。
- 完整四片 CI 43187108306 为 2805 通过、0 失败、2 个原有固定历史 EXE 跳过；真实打包隔离六项、候选全新/覆盖安装 43187754941 通过。
- 在线升级 43189315943 严格差分通过：0.1.13 → 0.1.14 实测安装包有效数据 1.74 MiB，对比完整 374.37 MiB 减少 99.54%，9 个 Range，零全量回退。 完整包摘要正确，重开零安装包请求；普通退出不安装，实际 UI 重启和十项数据保留通过，1 次模型请求、0 页面错误。
- 官网及 README 依据本轮回执更新，源码注释/契约/架构同步沿用两个修复提交；收尾检查和部署见对应 PR。完整事实与限制见 [0.1.14 发布报告](verification/desktop-release-0.1.14-20261112.md)。

## 2026-11-12：准备 0.1.14 对话修复版与增量发布

- 用户明确要求推送 develop 并发布测试增量更新；已推送两项独立修复 `dc3d21b8`、`92189dd6`，开放 Issues 为空，未创建新工单。当前公开最高桌面版为 0.1.13，本轮采用 0.1.14，沿用已确认的未签名个人开发发行、原应用身份与通道。
- 保留前两步 54 个相关单元及类型/架构检查证据，产品源码未再修改。按实际上一版补齐验收器的 0.1.13 输入、准确旧包缓存摘要和十项持久状态保留；验收输入消费者 `pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs --reporter=dot` 40 项通过，品牌检查与保留公开 0.1.13 快照的官网构建通过。
- 发布入口与步骤的三个宿主副本同步；版本说明如实描述两项修复及严格恢复边界。完整 Windows 四片、唯一候选打包隔离、全新/覆盖安装和真实 0.1.13 → 0.1.14 在线增量将在本轮取得独立证据，当前尚不宣称通过。保持旧 Python latest，不覆盖任何旧附件。

## 2026-11-12：修复首次请求失败后的对话重发

- 用户截图同时报告 Codex 供应商失败后，再次发送出现“原生会话身份记录与恢复文件不一致”。开放 Issues 仍为空，本步基于 `dc3d21b8` 修复第二个独立原因。真实 Codex + 本地 HTTP 400 复现：首次 `session.bound` 只有线程 ID，RunJournal 把缺失路径转成字符串 `"undefined"`；运行时随后把它当恢复文件检查。首次新增运行时夹具有括号错误，修正夹具后才确认真实失败，未将语法错误计作产品复现。
- 日志读取保持可选原生路径，非法已记录路径拒绝且旧日志不回写。会话选择器持有文件/ID 校验与跨引擎历史选择；只对完整封存、没有回复/工具调用的普通主聊天失败，允许用户显式重发时转交原输入并寻找可靠旧文件，否则新建原生上下文。保留逻辑对话、旧失败和权限；未决工具、坏身份、不完整日志、已发生交互、成员/系统回注/正式新上下文事务仍不走该降级。统一历史说明准确标明失败输入，不称其已执行完成。
- UI `Conversation.operate` 已在每次发送前清空操作错误；重复 tips 来自真实恢复拒绝，本步不隐藏历史错误或放宽恢复保护。应用级测试同时核对前端调用的 `loop.threadView` 能返回正确续聊头、没有历史问题。
- 按真实影响选取日志完整性、会话选择、失败重发、运行时授权/取消和引擎消费者。实际命令：`pnpm exec vitest run tests/runtime-failed-retry.test.ts tests/run-journal-integrity.test.ts tests/conversation-retry.test.ts tests/engine-session.test.ts --reporter=dot`（21 项）；历史提示及保护条件补齐后运行 `pnpm exec vitest run tests/engine-session.test.ts tests/conversation-retry.test.ts tests/loop-engine.test.ts tests/runtime-continuation.test.ts tests/codex-application.test.ts --reporter=dot`（30 项）；新增正式上下文拒绝及 threadView 断言后只复跑前两文件（15 项）。`pnpm exec vitest run tests/main-session-instance-pi.test.ts -t 'rejects unsafe main conversation native recovery' --reporter=dot` 选中 2 项通过，另 2 项未选中。合计 8 文件/47 项唯一相关用例通过，与前一步共 54 项；没有以重复执行累加数量。
- 真实 Codex 首次请求失败后，继续 Codex 或切换 Pi 均完成下一轮，保持原 task/主实例绑定、转交原输入且旧日志字节不变。已有 Pi → Codex → Claude → Codex → Pi 链、成员 Codex、外来原生文件与缺 ID 拒绝、停止与租约释放均通过。模型服务为确定性本地 HTTP，不代表用户供应商在线验收；未操作用户现有安装/数据。
- `pnpm typecheck`、`pnpm check:architecture` 通过：86 目录/668 源码样式、1305 维护文件/6697 依赖，0 循环/违规。同步 execution、execution/runtime、main/run-storage 的文件头、契约和架构说明；未新增反向依赖。阅读顺序：RunJournal 可选路径 → selectEngineSession 恢复决策 → LoopRuntime 调用 → engineInstructions 历史资料边界。
- 两项修复分别提交到本地 develop，尚未 push、全量 CI、打包、安装升级或发布。当前公开 0.1.13 附件未改变；人工 review 与后续发布验收仍独立，完整 diff 从 `98e08760` 查看。

## 2026-11-12：修复统一查询工具的嵌套 Schema 引用

- 用户直接报告发送对话时 `cbim_state_inspect` 返回 400；开放 Issues 查询为空，按截图修复，未新建工单。基线 `98e08760`。实际负责人 Schema 单独有效，嵌入统一查询的 oneOf/input 后仍保留原根引用，复现与截图相同的 `expectedReadBasis/memberRegistryCursor` 悬空路径。
- 在 CoordinationTools 组合目录处按实际已装配分支重定位本地 JSON Pointer，保留原工具目录及原参数/权限校验；不是供应商特例。同步工具文件头、契约和所在目录类图。
- 选择 `tests/coordination-schema.test.ts tests/coordination-tools.test.ts tests/coordination-pi.test.ts`，分别覆盖真实 Schema 编译与参数约束、统一读取语义、真实 Pi HTTP 请求目录。新增三项在修改前失败；修复后 `pnpm exec vitest run ... --reporter=dot` 为 3 文件/7 项通过。`pnpm typecheck`、`pnpm check:architecture` 通过，1303 文件/6691 依赖、0 循环/违规。
- 本步只修复发送前工具定义错误，失败后重发的会话文件问题另行处理。未运行全仓回归、打包、安装升级或发布；未把确定性本地 HTTP 供应商当作用户在线服务验收。完整变更在本步独立提交，阅读顺序为组合目录 → 原负责人工具 Schema → Pi 出站目录回归。

## 2026-11-12：0.1.13 公开与真实增量升级通过

- 用户要求直接发布新分支并测试增量；0.1.13 同一冻结制品完成正式 CI、真实打包隔离及候选安装后公开。source 9195e3a2c9cc9a8340c12e50b1375a9743d6de81，validation 02eb66c5f6a0bea4bc0ea45417a9ddcc7569691e，Release 442619832。原架构整理提交保留；未修复或承诺范围外问题。
- [公开升级 43179146943](https://github.com/nan023062/cbim/actions/runs/43179146943) 严格差分通过：0.1.12 → 0.1.13 实测安装包有效数据 3.10 MiB，对比完整 374.37 MiB 减少 99.17%，12 个 Range，零全量回退；重建摘要正确，重开零安装包请求，实际 UI 重启安装及十项数据保留通过，1 次模型请求、0 页面错误。
- 首轮旧架构断言失败及纠正后的 30 项回归记录保留；准确 head 完整四片 43177142009 为 2781 通过、0 失败、2 个固定历史 EXE 跳过。没有将全量回退算作差分通过。
- 官网及 README 基于真实发布和传输证据更新，后续官网检查/部署与分支回执见收尾 PR。[本版完整报告](verification/desktop-release-0.1.13-20261112.md) 给出所有制品、CI、安装和限制。本轮只回填资料和官网，没有改变已公开包。

## 2026-11-12：修正发布 CI 中遗漏的旧架构断言

- 0.1.13 首轮完整 CI `43175821413` 的第 2 片在 `tests/core-domains.test.ts` 失败：旧测试只允许调度依赖自身/Core，未同步已落地的 assembly → engines 装配契约。原失败报告保留，不把它归因于网络或产品随机失败。
- 仅调整测试：允许 assembly 目录选择具体引擎，其余调度仍不得绕过装配；同时让 Core 的禁止反向依赖列表明确包含 engines。与已有模块契约、依赖检测器和负向边界夹具保持一致，没有给整个调度层开放新依赖。
- 运行 `pnpm exec vitest run tests/core-domains.test.ts tests/layer-boundaries.test.ts tests/dependencies.test.ts --reporter=dot`：3 文件/30 项通过，选择依据是实际失败及相同边界的允许/拒绝消费者。产品、构建配置、版本日志和唯一候选不变；新增准确 head 的完整 CI 作为公开门槛，旧运行的失败/取消状态如实保留。

## 2026-11-12：准备 0.1.13 并验证 0.1.12 的真实增量升级

- 用户直接要求发布已变化的分支并测试增量更新；开放 Issues 为空，当前公开最高桌面版 0.1.12。以远端 develop `6aef77785369f0da15549c161114eda7ce99be19` 为基线，纳入已提交的源码模块整理和审阅归档，不扩大到尚未实现的架构治理或隔离恢复修复。
- 新版采用 0.1.13，保持既有未签名个人开发发行、应用身份、数据和更新通道。补齐验收器对真实上一版 0.1.12 的预下载流程及十项数据保留，先核对 NSIS 实际生成的准确旧包缓存，再严格要求公开更新的 Range 传输、零全量回退和最终摘要；不手工填充缓存。
- 本轮直接修改验收输入契约，运行 `pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs --reporter=dot`：38 项通过，含 candidate/online 的 0.1.12 支持及未来版本拒绝。`pnpm typecheck`、`pnpm check:architecture` 通过：86 目录、668 个源码/样式文件、1302 维护脚本、6689 条依赖，零循环/违规。品牌与保留公开 0.1.12 快照的官网构建通过。
- 本次未重新修改 src，沿用目录整理提交已同步的注释和类图；发布入口及配套步骤在三个宿主中同步。接下来对本次冻结制品执行完整 PR CI、真实打包 EXE 隔离、草稿全新/覆盖安装和公开 0.1.12 → 0.1.13 升级；当前尚不声明这些验收或增量节流已通过，最终事实记录在本版报告与 PR。

## 2026-11-12：提交剩余资料并同步远端 develop

- 用户明确要求提交所有改动并 push；剩余 7 份架构审阅/隔离诊断资料提交为 `5e7baf0b`，包含既有目录整理提交 `aeddea26`。正常合并远端 `4b29a65b` 的 17 个新增提交，不改写双方历史。
- 唯一冲突是本日志顶部新增记录，完整保留目录整理和 0.1.12 发布两段；README 自动合并，源码无冲突。远端版本、发布工具及其验证资料保留，未重新发布制品或执行安装。
- 合并后的 `pnpm check:dependencies` 通过：1302 个维护脚本、6689 条依赖，零循环/越界。因远端新增发布工具改动，运行 `pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs tests/desktop-signing.test.mjs tests/desktop-update-network-evidence.test.mjs --reporter=dot`，3 文件/76 用例通过；未重跑全仓、打包或安装升级。

## 2026-11-12：按 V&B 模块归属整理源码

- 用户直接授权重新整理项目；开放 Issues 为空。基线 `63497206` 的产品源码与上一轮 V&B 快照一致，复用已有映射，迁移 185 个源码文件并同步真实消费者、Forge 平台入口、源码定位注释和类图。
- Core 持有执行/模型契约，具体 SDK 与传输归 backend/engines；仅调度 assembly 选择引擎。预算、证据、派发、知识读模型和本机存储按职责集中；已有事务、状态、权限与运行数据不变。运行内核、目标服务与共享 Store 的高依赖密度仍保留。
- 621 个源码脚本除引用路径/JSDoc 外无语法差异，3075 条源码引用对应不变。类型、架构和依赖检查通过；23 个定向测试文件/152 个用例通过。选择依据及首次夹具旧路径失败/修正详见报告；未运行全仓、全部 UI、原生制品/安装或发布，未获得人工 review。
- 同步 86 个代码目录的现状类图、相关契约与三份维护入口；[模块导航](../src/logic/BOUNDARIES.md)、[迁移清单、四问与验证边界](verification/source-reorganization-20261112.md)。历史 V&B 快照、发布和恢复资料保留原样；本次不修复隔离恢复竞争。

## 2026-11-12：0.1.12 缓存修复正式发布

- 用户明确授权公开已验收的 0.1.12；开放 Issues 为空。本轮无产品改动，复用同一冻结源码 1217c972a764c0fef59dc105d79b3981f06e1b02 与既有完整 CI/候选安装证据，重新核验后公开 Release 442510655，标签和四附件一致。
- 真实在线升级 [43165384460](https://github.com/nan023062/cbim/actions/runs/43165384460) 通过后台预下载、正常退出不安装、重开复用缓存、UI 重启安装及全部十项数据保留；1 次模型请求、零页面错误。旧 0.1.11 全量下载 391424689 字节，0 Range，明确未通过本轮差分节流；新版本实际旧包缓存归属/摘要正确。
- 官网基于公开回执更新；品牌、正式网址构建和 14 个浏览器场景通过。资料及官网收尾沿正常 PR/CI/master 部署；最终回执见收尾 PR。未重建或覆盖公开包，未修改 src、无需类图变更，主工作区并行改动保留。
- [版本报告](verification/desktop-release-0.1.12-20261112.md) 记录来源、签名、附件、检查、在线安装和后续增量未实测的边界。

## 2026-11-12：版本 B（0.1.11）与不改公开通道的本地升级测试

- 用户直接要求制作 B 并提供不改公开通道的 A → B 测试方法；开放 Issues 为空。本地冻结 `3197b0e6978d1b005bd963ad1bdc0eb7e059b122`，相对 A 只改版本和日志。原公开 0.1.9、A 制品及主工作区已有审阅/诊断资料保持原样。
- B 的 `pnpm make:desktop --unsigned`、`pnpm verify:desktop <候选> --unsigned` 通过；指定准确 B EXE 的隔离验证六项通过，交付五文件副本摘要一致。已有同产品源码验证复用，未运行全仓/CI/本机安装或推送发布。
- 新增外部本地测试网络夹具、已安装 A 的人工启动器、真实制品下载联调脚本及便携工具打包。仅在测试启动的进程中转接 Release fetch 和附件 net.request；默认阻止安装器，独立机器上显式参数放行后仍需用户点击安装。测试资料专用、服务仅 loopback、附件白名单/摘要校验，不改产品源、hosts、代理或 TLS。
- 受影响验证为真实 A/B 字节 + Electron 网络 + 锁定下载器：8 个 Range 响应传输 1,723,719 字节，零全量回退，重建哈希等于 B（391,409,091 字节），HTTP 越界/非白名单拒绝通过。首次测试 executor 初始化失败保留，修复夹具后通过。便携工具由 A 自带 Node 加载通过，未安装目录门禁拒绝通过；`pnpm check:dependencies` 1300 文件/6685 引用、0 循环/违规。
- [B 制品、操作命令与验收边界](verification/desktop-update-b-local-20261112.md)；证据 `test-results/update-b-0111-20261112/`。真实 NSIS 安装、安装版 UI/数据保留仍需独立 Windows 机器按说明执行；下载器联调没有伪造已安装态，不代表公开 GitHub 分发通过。外部工具不涉及 src 注释或类图变更。

## 2026-11-12：V&B 第一轮模块总图与源码映射

- 用户直接要求只读架构 review；以 `3f249cf8` 源码取证，交付核对 `d4f753cc` 的 src 清单/哈希及依赖规则、构建入口未变化。保留既有发布、恢复及体验版本资料，不改变产品实现、目录或生效规则。
- [交互总图](verification/cbim-vb-architecture-review-20261112.html)与[审阅报告](verification/cbim-vb-architecture-review-20261112.md)按职责组织 74 个 review 单元、11 项业务能力和共享组；668 个源码/样式文件唯一映射，保留 3075 条源码引用、450 对跨单元依赖、离线全文及行号证据。分组是现状分析，不冒称全部已有独立模块契约。
- 标出 6 个边界/依赖热点和 5 组聚合互达，区分事实、判断与已有正面边界。运行内核的成员能力、共享事务契约和派发/目标协调为优先阅读入口；装配根与基础原语的高连接不直接判为缺陷。
- 只读 AST 取证覆盖 1296 个维护脚本、6682 条引用，现行循环/分层/逻辑检查未发现违规；页面按 320 浅色、390 深色、900 浅色核对全部节点映射、依赖计数、筛选、证据、源码定位和导出通过。首次验证误等折叠节点可见、初版 SVG 箭头表现及修正记录保留在报告中。
- 本次只验证图、映射和页面；未运行产品测试、类型检查、构建、安装或全量回归，未重构、创建工单、提交或发布。原始取证与页面结果在 `test-results/vb-review-20261112/`；完整交付快照已内嵌证据，不依赖临时目录或外部 CDN。

## 2026-11-12：生成更新体验版本 A（0.1.10）

- 用户直接要求打包 A 并交付 A → B 安装体验测试方法；开放 Issues 为空。以 `3f249cf8` 为产品基线，在独立 `build/a10/` 工作树冻结版本/日志提交 `09b63afb970a0a656504c1d1e18a647e56e5288d`，保留主工作区原有未提交资料，未改产品源码和依赖。
- `pnpm check:brand`、`pnpm build:website`、`pnpm make:desktop --unsigned`、`pnpm verify:desktop <候选> --unsigned` 通过；指定本次打包 EXE 的 `pnpm exec tsx scripts/isolated-node-smoke.mts` 六项通过，自有资源全部回收。沿用已有同源码 41 项单元、22 项界面及类型/架构检查证据，未重复运行。
- 安装包 391,408,787 字节，四附件及回执复制到 `build/update-experience/A-0.1.10/` 后摘要逐项一致。实际回执、校验值、A → B 前置条件与用户步骤见 [版本 A 测试说明](verification/desktop-update-a-0.1.10-20261112.md)；原始证据 `test-results/update-a-0110-20261112/`。
- 本次未安装本机客户端、生成 B、公开 Release、推送提交、触发 CI 或部署官网。B 仍需更高公开稳定版；A 的准确旧安装包缓存/blockmap 是差分前提，现有正式通道不支持仅本地测试，NSIS 安装耗时未优化。打包与隔离 EXE 验证不代表 A → B 已通过真实安装/网络验收。

## 2026-11-12：按测试说明复验预下载与增量下载

- 用户直接要求重新运行源码验证，基线 `3f249cf8`；沿已确认范围复验，不选择新工单或修改产品源码/测试。
- 执行测试说明中的 5 个明确测试文件，共 41 项全部通过；真实 React + 模拟 IPC 的界面脚本 22 项通过、零页面错误。`pnpm typecheck` 与 `pnpm check:architecture` 通过：58 目录说明一致、1296 文件/6682 依赖、0 循环/违规。
- 实际命令、结果与边界追加于 [测试说明的本轮复验记录](verification/desktop-update-prefetch-differential-20261112.md#2026-11-12-1057-源码复验)；本轮原始证据独立保存于 `test-results/update-source-validation-20261112-105726/`，保留此前界面报告。未执行全仓回归、打包、安装、公开升级或外部写入。

## 2026-11-12：启用安装包增量下载与回退验证

- 用户直接授权的第二项更新优化，前一步预下载提交 `4621d3b4`；开放 Issues 为空，未新建或回填工单。`NsisUpdateInstaller` 启用锁定的 `electron-updater@6.8.11` 差分下载，固定 GitHub generic 源使用单段 Range，保留清单版本/文件名、SHA-512、缓存、全量回退及显式安装边界。未增加更新服务、依赖或网络源。
- 新增 `tests/nsis-differential-download.test.ts`：只替换宿主和 HTTP 传输目的地，真实下载器执行差分、缓存和校验。64 KiB 样例只传输两段共 16 KiB，最终内容逐字节匹配；另覆盖旧标签、旧索引缓存、重开复用、缺缓存/索引、坏旧包/Range、无 Range 支持、损坏全量拒绝及缓存篡改重验。该比例仅是确定性夹具，不是公开安装包实测。
- 按适配器变化选取 `pnpm exec vitest run tests/nsis-updater.test.ts tests/nsis-differential-download.test.ts --reporter=default --reporter=json --outputFile=test-results/update-differential-unit.json`：其中 NSIS 配置/门禁 3 项通过，HTTP 夹具首次初始化失败保留为历史。修复测试导出展开触发 autoUpdater getter、transport 注入晚于 Provider 创建，以及 Node 测试传输共享 socket 后，仅复跑受影响新文件 `pnpm exec vitest run tests/nsis-differential-download.test.ts --reporter=default --reporter=json --outputFile=test-results/update-differential-http-final.json`，10 项通过且无监听器警告。本步共 13 项唯一测试通过；与前一步合计 5 文件 41 项。
- `pnpm typecheck`、`pnpm check:architecture` 通过，1296 文件/6682 依赖、0 循环/违规。同步 NSIS 文件头/关键行为注释和 updater 契约/类图；未重跑已通过且不受影响的界面和预下载状态机。
- [测试方法与验证边界](verification/desktop-update-prefetch-differential-20261112.md) 包含可立即运行的受影响单元/界面命令，以及含改动版本 A → 更高版本 B 的安装版验收。旧客户端升级到 A 仍走旧逻辑；增量不改变缓存完整包大小或 NSIS 安装方式。未打包、发布、全量回归、真实在线升级或人审，现有安装客户端未被操作。


## 2026-11-12：后台预下载与显式重启安装

- 用户直接授权“先做后台预下载和增量下载”，本步完成预下载；基线 `c46ea7e7`。已查询 `nan023062/cbim` 开放 Issues，清单为空；未虚构或新建工单，不合并、不发布。
- `DesktopUpdates` 在原定时检查后自动下载并校验，成功停在 ready。下载与安装授权分开：手动 download 同样只准备包，只有 ready 后的明确 install 才排空业务并重启。在途合并、关闭取消、就绪候选冻结及数据保留保持；下载失败五分钟后自动重试，手动重试／发现另一版本无需等待。
- 更新弹窗、横幅区分“已就绪”和“安装未完成”；同步 updater、Main、bridge/contracts、frontend/updates、shell 的注释、契约和类图，以及架构生成器的更新器定位。修改入口依次为公开状态契约 → DesktopUpdates → SoftwareUpdates，NSIS 校验/业务排空端口保持。
- 按真实状态机、Main 关闭和 IPC 消费者选择 `pnpm exec vitest run tests/desktop-updates.test.ts tests/desktop-update-lifecycle.test.ts tests/ipc-desktop.test.ts --reporter=default --reporter=json --outputFile=test-results/update-prefetch-unit.json`：3 文件 28 项通过。`pnpm typecheck`、`pnpm check:architecture` 通过；后续仅注释／契约同步后 `node scripts/source-architecture.mjs --check` 与 `git diff --check` 通过。
- `node scripts/desktop-updates-ui-smoke.mjs`：真实 App React + 模拟 IPC 的 22 项界面检查通过，含后台预下载无安装授权、用户重启、关闭弹窗保留下载、未提交草稿、深浅色和 320px；报告 `test-results/issue19-ui-report.json`。修复测试入口别名目录重复 React、横幅入口焦点断言与新增 web.settings 夹具，保留原业务断言；此前失败报告保留。
- 未运行全仓测试、打包、真实 NSIS 安装或公开升级；本步验证不代表已发布或用户已升级。完整 diff 由本步独立提交 review；工作区原有隔离诊断与发布记录未纳入。


## 2026-11-12：隔离恢复失败根因诊断

- 用户直接要求查清 0.1.9 收尾 CI 的隔离恢复失败，基线 `c46ea7e7`；当前开放 Issues 为空，关联 PR #50，不新建工单，不扩展为产品修复或发布。
- 只对 `tests/isolation-recovery-crash.test.ts` 做有上限、首次失败即停止的定向复现。原样第 4 次、路径探针第二轮第 62 次自然失败，捕获 `runtime/executor.exe` 的 `ISOLATION_RECOVERY_OPEN / win32Code=32`；进程与 Job 退出检查已通过，同文件约 117.592 ms 后可取得原删除权限句柄。两次真实句柄控制实验进一步核实共享冲突机制，释放句柄即可锁定原树，文件/日志不变、业务未重跑，实验资源已按原身份清理。
- 根因是将“进程退出”视作“执行器立即可清理”的时序假设，崩溃恢复路径只尝试一次锁定；正常收尾已有删除重试。首次 CI 原始错误已被旧 finally 覆盖，无法还原当时占用进程。本轮未改源码、测试断言或已发布制品，也未跑全仓测试/CI/打包安装。命令、原始证据、确定性边界与未实施修复建议见 [诊断报告](verification/isolation-recovery-rootcause-20261112.md)。

## 2026-11-12：0.1.9 集成发布与 0.1.8 在线升级

- 纳入 #36–#45 十项独立提交，PR #48 合入 develop，再经 PR #49 的准确 head 完整 Windows 四片验证正常合入 master。保留原始 37 项集成失败及其根因，修复测试对旧回执/隐藏回复/固定 IPC 数量的依赖、原生摘要误分类及分块中文解码；产品冻结输入没有改变。
- 制品核验、真实打包六项隔离、架构 UI、隔离全新安装和 0.1.8→0.1.9 候选升级通过；公开后真实 UI 下载/校验/自动安装、普通退出取消、十项数据保留及无重放通过。官网按公开回执同步并经 14 场景验证，详情与准确提交、摘要和 Actions 见 [0.1.9 发布报告](verification/desktop-release-0.1.9-20261112.md)。
- 发行继续为未签名个人开发版。真实 Brave 账号联调未运行；确定性模型不代表在线模型质量。原本机用户安装未被操作，无关分支保留。
- 官网收尾 CI 出现一次隔离崩溃恢复单元失败，旧 finally 覆盖了原始原因。补齐原始错误和资源记录归档，保留原断言及失败目录；仅定向运行 `pnpm exec vitest run tests/isolation-recovery-crash.test.ts --reporter=default --reporter=json --outputFile=test-results/desktop-release-019-20261112/crash-diagnostic-local.json`，1 项通过。类型检查通过；未重复本地全仓回归或安装验收，最终收尾 CI 见 PR #50，原始偶发根因尚未复现。

## 2026-11-12：#42 侧栏标题去除重复品牌

- [Issue #42](https://github.com/nan023062/cbim/issues/42)，基线 `c002b57a`。展开侧栏只保留收起按钮与“团队空间”文字，移除其前的 CBIM/BrandMark 和无消费者的标题样式；窄宽度也不再隐藏标题。欢迎页品牌资源、侧栏伸缩与工作区导航保持原实现。C1/L0。
- 这是可逆的局部展示修改，不新增镜像单元测试，也不跑无关产品测试。`node test-results/issue-batch-20261112/sidebar-title-check.mjs` 从实际 App 提取标题 JSX 并加载实际样式，在隔离Chrome的320px核对纯文字、无重复品牌、收起回调和无标题溢出；报告42-title-ui.json、截图42-sidebar-320.png。核对过程中清理样式时发现选择器残留，已按原规则精确删除并复查差异，导航样式未被误改。
- `pnpm check:architecture` 通过，0循环/违规；最终样式修正后 `node scripts/source-architecture.mjs --check` 与 `git diff --check` 通过。外壳注释/契约/类图同步。类型/公共接口无变化，不重复类型检查；此为标题局部渲染核对，整包交互、安装、全量CI、人审、合并发布未执行。下次修改入口为 App.sidebar-top 与 shell.css.sidebar-title，Q5候选无。

## 2026-11-12：#45 单一树根与右上角视图图标

- [Issue #45](https://github.com/nan023062/cbim/issues/45)，基线 `ab1ce70e`。移除业务树上方重复的工作区“项目根”按钮，以“业务模块”为唯一树根；团队已有单一“团队架构”根，不额外改动层级。根行菜单保留新建/传输入口，内置projectRootModuleId语义不变。共用树右上角改为展开/折叠图标，title/aria-label和键盘可达保持；只修改本地查看状态。
- 受影响树和团队消费者：`pnpm exec vitest run tests/knowledge-file-tree.test.ts tests/team-model.test.ts --reporter=json --outputFile=test-results/issue-batch-20261112/45-tests.json`，2文件10项通过。`node test-results/issue-batch-20261112/tree-ui-check.mjs 45` 在隔离Chrome的320px实际组件中验证右上角两个纯图标、展开折叠、菜单/键盘与无溢出，证据45-tree-ui.json/45-tree-320.png。
- `pnpm check:architecture` 通过，0循环/违规；两处契约/类图、组件/样式注释同步。未改变类型/公共接口，不重复类型或全量检查；未打包安装、合并发布或人审。下次从 KnowledgeFileTree 的局部closed状态、knowledge-files.css与BusinessArchitecture根入口修改；稳定数据/事务保持，Q5候选无。

## 2026-11-12：#37 业务/团队树行尾操作

- [Issue #37](https://github.com/nan023062/cbim/issues/37)，基线 `ab4ffff7`。C1/L1，复用 KnowledgeFileTree，名称后紧跟独立展开箭头，目录行末竖向更多菜单。动作由业务/团队宿主按真实路径注入，模块/Agent/Skill 的编辑、删除、传输与历史仍调用原入口；普通文件不获得对象操作，内置角色不伪装节点。图标有 title/aria-label，Escape 关闭回焦点，点击外部关闭；未提交草稿先保护。
- 主 Agent 配置/历史角色/项目岗位与 Skill/Workflow 详情操作统一图标。保留原负责人选择和知识预览/删除确认；树本身不写知识。同步6份受菜单移动影响的桌面脚本入口及共享 knowledge-tree-actions.mjs，脚本语法转换通过，未以语法通过代替整包验收。
- 根据共用树、真实团队消费者及负责人入口选择 `pnpm exec vitest run tests/knowledge-file-tree.test.ts tests/team-model.test.ts tests/inline-module-ownership.test.ts --reporter=json --outputFile=test-results/issue-batch-20261112/37-tests.json`：3文件18项通过。更新旧“整个DOM没有Agent编辑”断言为根行没有编辑/删除，真实Agent行拥有动作，未放宽根保护。
- `node test-results/issue-batch-20261112/tree-ui-check.mjs 37` 在隔离无头Chrome渲染实际组件/样式，320px验证箭头位置、行末菜单目标、不改变选择、Escape回焦点、折叠、无横向溢出；报告37-tree-ui.json和截图37-tree-320.png。此为组件交互验收，未冒称真实整包知识事务验收。
- `pnpm typecheck`、`pnpm check:architecture` 通过，1294文件/6678边、0循环/违规。三处契约/类图和源码注释同步，删除已失效GraphViewControls说明。下一次按 KnowledgeFileTree/RowActions → TeamView/BusinessArchitecture → 原编辑器阅读；保护既有事务，视图变化限制在前端，Q5候选无。全量CI、打包安装与人工review未运行，未合并发布。

## 2026-11-12：#43 剪贴板图片与本地路径附件

- [Issue #43](https://github.com/nan023062/cbim/issues/43)，基线 `93bac767`。原 preload importFiles 只解析系统磁盘路径，截图因此失败；保留其拖放行为，新增输入框图片字节导入与严格路径入口。Core 视觉/等待契约不改，快照仍由 ChatInputs 拥有。C1/L1。
- 纯绝对路径列表变为引用，Main 先核全选路径存在、文件/目录、禁止UNC/设备/.cbim，再保存原文本/首层目录快照；失败保留原粘贴文字。截图保存5 MiB内原字节与原名称、唯一clipboard来源、采集时间；12项与单批20 MiB限制，模型视觉预检保持。图片卡片自动显示快照缩略图，点击预览原图/来源，发送前可移除，不自动发消息或改源文件。预览在工作区切换/卸载后丢弃迟到回包。
- 按受影响输入/快照/预览/等待消费者运行 `pnpm exec vitest run tests/chat-clipboard.test.ts tests/chat-inputs.test.ts tests/continuation-chat-inputs.test.ts tests/chat-chrome.test.ts --reporter=json --outputFile=test-results/issue-batch-20261112/43-tests.json`：4文件15项通过。涵盖真实图片File编码、真实Application IPC、原字节视觉与等待清单、文件源变化、跨工作区、全选存在性、坏格式/大小拒绝，以及预览/移除可访问入口。
- `pnpm typecheck` 与 `pnpm check:architecture` 通过：1293文件/6672边，0循环/违规。五处源码契约/类图、输入组件/样式及协议注释同步。未执行系统剪贴板实际快捷键、完整桌面/安装、全量CI、合并或发布；不把SSR/IPC测试冒称整包交互验收。
- 四问：保护原视觉输入和快照隔离；剪贴板字节适配在前端、路径/签名校验在Main；实际证据覆盖已保存字节的消费；下次从 Conversation/pasted-images → ipc-chat → ChatInputs → ComposerAttachments 阅读。Q5候选：无。完整diff按本Issue独立提交review，未宣称人审接受。

## 2026-11-12：#39 公开网页正文与可配置搜索

- [Issue #39](https://github.com/nan023062/cbim/issues/39)，基线 `02ee67af`。C1/L2，读取 Main/IPC/配置/主 Loop 与已有聊天来源导入，保留原来源证据和引擎工具目录；新增 Core 小协议 → Scheduler 只读工具 → Main 网络与设置。Application 共用缓存/限速，密钥沿既有 SecretCipher，只在主进程固定 Brave API 请求使用。
- 实现 `cbim_web_fetch` 和 `cbim_web_search`。抓取核全部 DNS、固定连接地址、逐跳公网与 robots，默认每域1秒并遵守 crawl-delay；5分钟同URL缓存，返回原采集时间、来源、Markdown、截断与不可信标记。请求15秒/1 MiB、抓取整体30秒/最多5跳；登录、挑战、4xx/5xx、网络、编码和限流分别报告。正文 parse5 不执行脚本，按段落/Unicode截断。Brave 固定 API 只返回标题/URL/摘要，设置页开关、加密密钥保存/移除和版本冲突已接通。不开浏览器，不绕过 robots/验证码，不跟随携密钥的 API 跳转。
- S6 根据边界选择网络解析与传输、内容转换、设置持久化/真实IPC、真实Pi工具回包，最终去重3文件34项通过：`pnpm exec vitest run tests/web-service.test.ts tests/web-settings.test.ts tests/web-tools-pi.test.ts --reporter=json --outputFile=test-results/issue-batch-20261112/39-retest.json` 当时33项；新增crawl-delay/API跳转覆盖后 `pnpm exec vitest run tests/web-service.test.ts --reporter=json --outputFile=test-results/issue-batch-20261112/39-network-final.json` 31项通过。最初无Electron安全存储默认注入和HTTP类型选项失败已修正，旧失败证据保留39-tests.json。主Pi实际调用拒绝内网并返回未配置搜索提示；HTTP字节/取消用真实本地服务器，DNS固定用可信测试传输核验，未冒称外网搜索账号联调。
- 新增公开 Core 配置契约须在 IPC 精确导入表登记（不放开目录或 Main），因此执行 `pnpm exec vitest run tests/dependencies.test.ts tests/layer-boundaries.test.ts --reporter=json --outputFile=test-results/issue-batch-20261112/39-boundaries.json` 24项通过。总计5文件58项；`pnpm typecheck`、`pnpm check:architecture` 通过，1291文件/6666边、0循环/违规。10处契约/类图及源码注释同步，锁文件仅新增三项直接依赖及对应解析依赖。
- S7 四问：保护原运行授权与已有材料导入；公网读取策略停在 Main，后续供应商改适配器及配置契约；证据覆盖网络拒绝、真实调用、取消、密钥存储；下一次按 web-tools → WebTools → WebService/PublicHttp → WebSettings/WebSettings界面阅读。Q5候选：无。首个供应商仅Brave；UTF-8/公开静态页面支持，robots跳转保守拒绝。未进行真实付费搜索账号、整包界面/安装、全量CI、人审、合并或发布。
- API依据：[Brave官方接口](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started)，解析依赖：[parse5](https://parse5.js.org/)、[robots-parser](https://github.com/samclarke/robots-parser)、[ipaddr.js](https://github.com/whitequark/ipaddr.js)。同步纠正旧#41记录标题位置，历史事实保留。

## 2026-11-12：#40 统一状态读取、闭包预览与失败停止

- [Issue #40](https://github.com/nan023062/cbim/issues/40)，基线 `8c92d7f9`。S1–S4 按真实主运行链核实目标/图已有同次 Store 读取、撤销/等待已有严格规则，缺口是可用投影和失败指引；C1/L2，保护原 Store、CAS、领域校验、引擎目录与停止排空。#36 的能力重新采纳直接复用。
- S5 `cbim_state_inspect` 汇总 goalRevision/planRevision/graphCursor、全部任务版本和当前周期候选；其他 target 分别读任务/负责人/岗位/治理，未宣称跨知识存储原子性。`cbim_receipt_inspect` 路由四类原回执，旧族标兼容，不改历史命令。撤销 includeClosure、awaiting_user 的 memberPause.includeClosure 仅生成完整清单及 issues，确认后仍走原完整提交，版本和已领取任务继续拒绝。
- 所有引擎的调用结果共用 outcome（status/retryable/terminal/reconcileTool/reconcileArgs/nextStep）；成功元数据在 details，原领域正文保持；错误 JSON 进入模型文本。unknown/FORBIDDEN 禁止相同请求盲重试，无领域账本明确 null。主写错误附可信原命令查询地址。按调用提出顺序对同工具同参数连续三次失败熔断，记录 state=blocked 并停止排空；安全收尾 RunStatus=failed，有未决副作用仍 interrupted，不覆盖 completed 为业务成功。界面显示核实建议与熔断原因。
- 主周期规划与运行内步骤明确职责；对象知识优先 object_preview/commit，底层文件事务标兼容。产品业务执行正文列明六项条件能力及其它成员工具的实际注册前提；未注册不自动补权限或绕过。
- S6 基于实际 diff 选择领域规则/Store、工具适配、三引擎真实调用和界面投影，去重 18 文件 92 项通过。各命令共同附 `--reporter=default --reporter=json --outputFile=test-results/issue-batch-20261112/40-<名称>.json`：
  - `pnpm exec vitest run tests/coordination-tools.test.ts tests/queued-task-cancel.test.ts tests/queued-task-cancel-tools.test.ts tests/goal-tools.test.ts`：read-tests，25 项。
  - `pnpm exec vitest run tests/tool-failure-control.test.ts tests/loop-engine.test.ts tests/engine-tools.test.ts tests/claude-tools.test.ts tests/codex-tools.test.ts tests/pi-loop.test.ts`：failure-tests，30 项。
  - `pnpm exec vitest run tests/coordination-pi.test.ts tests/workspace-member-tools-pi.test.ts tests/inline-conversation.test.ts`：integration-tests，14 项。
  - `pnpm exec vitest run tests/tool-failure-control.test.ts tests/module-ownership-tools.test.ts tests/main-governance-tools.test.ts tests/workspace-member-tools.test.ts`：recovery-tests，20 项。
  - 依赖检查发现目录层不应依赖结果协议，未放宽规则，将包装归还引擎适配层后执行 `pnpm exec vitest run tests/coordination-pi.test.ts tests/tool-failure-control.test.ts tests/tool-results.test.ts tests/tool-result-pi.test.ts tests/claude-tools.test.ts`：boundary-retest，17 项。熔断通知改为实际事件分发后 `pnpm exec vitest run tests/loop-engine.test.ts`：event-retest，8 项。首次类型检查的测试文本联合缩窄已修正。
- `pnpm typecheck`、`pnpm check:architecture` 最终通过：1281 文件/6636 依赖，0 循环/违规。相关注释、九处契约/类图及运行正文同步。未运行全仓 CI、打包/安装和人工交互验收，未合并发布。
- S7 四问：保留原事务/停止机制；变化限制在纯预览、只读组合与传输适配；测试由实际调用链及失败证据选择；下次从 CoordinationTools → ScopeGoalService/coordination-preview，或 outcome → 三引擎 → RepeatedToolFailures/LoopRuntime 阅读。Q5 候选：无。材料可 review，不宣称人审接受。

## 2026-11-12：#36 主 Agent 岗位治理与能力重新采纳

- [Issue #36](https://github.com/nan023062/cbim/issues/36)，基线 `396acf5c`。S1–S4 核实原 WorkspaceMembers 已有登记事务，但主工具未接入；本片 C1/L2，新增窄工具协议和可信运行装配，保留唯一 DispatchStore、预览依据、版本门禁与桌面旧指纹。OWNER_CAPABILITY_CHANGED 通过岗位能力采纳修复，owner adopt_source 仍只负责模块来源。
- S5 新增 inspect/preview/commit/receipt 四项岗位工具，支持登记、名称/职责/适配编辑、能力采纳、停用和退役。登记继承静态 Agent 已有模型，拒绝模型选择/模型采纳和自报 actor；主身份由运行闭包及原日志核实。读权限可预览，写权限沿统一知识门禁。提交一次，坏回包、取消或未知保留稳定命令，只读核实原回执；跨根会话拒绝，重启不重放。
- S6 按调用链选择岗位纯规则、服务、Application、真实 Pi 和统一权限消费者。首次 31 项中原有 28 项及新协议 1 项通过，2 项真实 Pi 暴露工具权限范围分类遗漏；补齐固定分类后 `tests/workspace-member-tools-pi.test.ts tests/unified-tool-policy.test.ts` 共 10 项通过。新增 `tests/workspace-member-tools.test.ts` 2 项通过；加强回包身份/版本核对后再跑 Pi 3 项通过。去重共 6 文件 40 项通过。完整命令均为 `pnpm exec vitest run <上述明确文件> --reporter=default --reporter=json --outputFile=...`，对应证据 `test-results/issue-batch-20261112/36-{tests,tools-policy,wire-tests,final-pi}.json`；原失败另存 `36-initial-failure.json`。
- 实际选择器依次为 `pnpm exec vitest run tests/workspace-member-service.test.ts tests/workspace-member-application.test.ts tests/workspace-member-core.test.ts tests/workspace-member-tools-pi.test.ts`、`pnpm exec vitest run tests/workspace-member-tools-pi.test.ts tests/unified-tool-policy.test.ts`、`pnpm exec vitest run tests/workspace-member-tools.test.ts`、`pnpm exec vitest run tests/workspace-member-tools-pi.test.ts`，均附前述 JSON reporter 参数。`pnpm typecheck` 与 `pnpm check:architecture` 通过，0 循环/违规；同步 Core team/tasks/policy、Main workspace/装配、Scheduler tools/execution 的注释、契约和类图，以及团队治理流程第 4 步。未运行全仓 CI、打包/安装或人工交互验收。
- S7 四问：保护原岗位事务与权限规则；岗位能力变化限制在独立协议和适配器；验证覆盖真实消费者与未知恢复；下次从 workspace-member-tools → main-workspace-member-tools → WorkspaceMembers → workspace-member-invariants 阅读。Q5 候选：无。代码与证据可 review，尚未人工接受、合并或发布。

## 2026-11-12：#41 对话最终反馈

- [Issue #41](https://github.com/nan023062/cbim/issues/41)，修复空完整消息擦除流式正文，保留反馈提交后的真实最终答复。主提示与两项反馈流程同步为正文简短收尾，提交不等于开发完成，未知操作不重放。
- ConversationTurn 通过共享纯投影读取本轮交付声明及限制；没有声明也没有最终正文时，在流中明确显示缺失事实、工具数量和核实建议。提示标为运行记录，不冒充 Agent 消息，不读旧轮继承交付，不修改持久日志、不额外调用模型；运行中不提前总结。
- 因实际消费者涉及对话、反馈工具和主提示，执行 `pnpm exec vitest run tests/conversation.test.ts tests/inline-conversation.test.ts tests/github-feedback-tools.test.ts tests/github-feedback-pi.test.ts tests/agent-role-instructions.test.ts --reporter=default --reporter=json --outputFile=test-results/issue-batch-20261112/41-tests.json`：5 文件 36 项通过，含真实 Pi、本机确定性反馈服务及渲染验证。`pnpm typecheck`、`pnpm check:architecture` 通过，0 循环/违规。
- 同步三处源码注释/契约/类图及两项产品运行文档。阅读入口：mainInstructions → transcript/completionFeedback → ConversationTurn；后续完整 CI 与打包界面验收未运行，未合并发布，未宣称人审通过。

## 2026-11-12：#38 手动终端中文编码

- [Issue #38](https://github.com/nan023062/cbim/issues/38)，仅修改 Main 平台终端适配器：子 PowerShell 的 Console 输入/输出与 OutputEncoding 统一 UTF-8，stdout/stderr 独立持续解码，保持工作区、页签和进程所有权。未改变机器全局编码或 Agent 执行策略。
- 实际进程验证 `pnpm exec vitest run tests/terminal.test.ts --reporter=default --reporter=json --outputFile=test-results/issue-batch-20261112/38-tests.json`：3 项通过，涵盖中文命令、emoji、原生命令分块输出、stderr、非零退出和会话隔离。初次补测发现 EncodedCommand 会输出 CLIXML，已保留 -Command 文本错误语义，失败记录在同目录 `38-clixml-failure.json`。
- `pnpm check:architecture` 通过，0 循环/违规；平台注释、契约与类图同步。公共接口/依赖未变，不扩大类型和全量测试。明确指定其他编码的旧程序需自行配置 UTF-8；尚未打包、安装或合并发布。

## 2026-11-12：#44 Claude Code 模型选择与连接诊断

- [Issue #44](https://github.com/nan023062/cbim/issues/44)，基线 `86e82164`。当前已按协议而非品牌筛选；补齐未配置/协议不兼容/未启用三类空态，明确非 Claude 模型可用但端点必须兼容 Anthropic Messages。
- 模型设置显式探测返回安全端点、HTTP 状态及鉴权/权限/端点/限流建议，不回传供应商正文，不修改目录。状态仍归 LlmProfiles，选择器只消费公开配置，没有引入跨协议转换或自动联网。
- 按配置→选择器→引擎消费者执行 `pnpm exec vitest run tests/engine-configuration.test.ts tests/llm.test.ts tests/claude-engine.test.ts --reporter=default --reporter=json --outputFile=test-results/issue-batch-20261112/44-tests.json`：3 文件 28 项通过。真实 Claude SDK 对本机确定性服务透传 `vendor/qwen-custom-2026`，会话恢复及取消通过；不代表第三方在线供应商已验证。
- `pnpm typecheck`、`pnpm check:architecture` 通过，0 循环/违规；同步组件、设置存储注释/契约/类图。阅读顺序：EngineModelPicker → LlmProfiles.request → claude-engine 测试。全量 CI、打包与安装升级本步未运行，尚未合并或发布。

## 2026-11-12：0.1.8 公开发布与真实在线升级

- 用户直接授权核对草稿并发布，沿用已确认的未签名模式；安装器/应用均实际 NotSigned、0.1.8，四附件重新核验一致。补齐准确 EXE 的六项进程隔离，零网络请求，自有资源全部回收。
- PR #46 的准确 head `69bce86d` 完整 Windows 四片 run 43083159447 全部成功：396 文件、2686 用例、2684 通过、0 失败、2 项缺少更早历史 EXE 的跳过。正常 merge `b104305c4f2edebdcc8416af92b530c4f59c088b`，没有 squash 或绕过检查。
- Release 441899473 于 `2026-11-11T19:17:56Z` 公开，标签 peeled source 为 `23faa8bf73235793482cb615e4ef95de2a84c867`，安装包 SHA-256 `170d53bd03122efb5684dade60217c6290497e082c222ed84335f2fc92154883`；旧 Python latest 327801733/v1.0.2 保留。匿名更新清单与安装地址已核实，未重新生成或替换附件。
- 在线 run [43085968933](https://github.com/nan023062/cbim/actions/runs/43085968933) 完成真实 0.1.7 发现→UI 下载→缓存校验→自动安装/原数据目录重启；普通退出取消场景通过。十项数据/无重放检查通过，全程 1 次原模型请求、0 页面错误；本机用户安装未改动。
- 官网快照与文案来自实际公开回执，沿现有 master Pages 发布；报告与完整证据索引见 [0.1.8 发布验收](verification/desktop-release-0.1.8-20261112.md)。本轮无产品源码改动，不新增架构或类图关系，后续官网 PR/部署回执关联最终提交。
- 官网品牌/构建检查与 14 场景测试通过，0 页面错误；官网源文件按既有属性保持 LF，六份最终静态文件摘要已保存，部署后按相同字节核验。

## 2026-11-11：对齐正式 0.1.7 与整改，重建 0.1.8 候选

- 用户直接请求，保留原 1,690 个维护文件快照；合并提交 `23faa8bf` 同时包含原整改快照 `ae779840` 和正式 0.1.7 `f18c2fe9`。不是把旧 0.1.5 仅改版本号；保留自动化、主 Agent 共享设置、隐式负责人和文件树。
- change_reason：发布基线偏离；scope：Core 读取/预算/引擎端口、Main 装配/IPC、Bridge 类型契约和共享展示；稳定能力为原事务、权限、身份和重放语义。治理保留窄端口，将新增业务接入统一 172 项 IPC，移除重复机制。
- 定向 121 项通过；类型与架构通过，0 循环、0 违规。真实主配置界面、最终 EXE 的运行/自动化/架构资源专项通过；全量 2,686 项首轮 10 失败已定位并修正测试口径/夹具，6 文件 25 项复测通过，去重后 2,684 通过、2 个缺少历史 EXE 的跳过，见 [本次报告](verification/desktop-018-alignment-20261111.md)。
- 0.1.8 未签名安装包来自干净提交 `23faa8bf`，SHA-256 `170d53bd03122efb5684dade60217c6290497e082c222ed84335f2fc92154883`。后续仅修正当前文件树/负责人文案的验收定位与性能夹具，不改产品输入，重新核验同一包通过。候选安装升级新增主 Agent/自动化/知识/业务文件保留断言；不能把直接启动 EXE 当 NSIS 升级。
- 同步相关源码注释、契约和 28 份类图，三宿主入口一致。维护入口：`ipc-call.ts` 的完整映射、`automation-actions.ts` 的身份投影、`knowledge/read-models.ts` 公共读取、`engine-tools.ts` 稳定能力和 `execution-view` 展示边界。
- 2026-11-12 补入正式 0.1.7 发布后收尾（`87429538` 合并 `0c752c52`），产品/依赖/构建配置/运行白名单资料不变，包内维护记录保留冻结副本。用户明确批准临时分支、草稿和隔离 Windows 验收；Release 441899473 保持草稿。首次 run 43053266990 已真实升级到 0.1.8，但自动化内存回执的 undefined 属性与落盘 JSON 比较失败；改用旧版实际持久读取作为完整基线，保留失败现场。
- 同一安装包的独立复测 [43054938501](https://github.com/nan023062/cbim/actions/runs/43054938501) 成功，head `ed1914c8`，构建源码仍为 `23faa8bf`。全新安装及真实 0.1.7→0.1.8、原工作区/完整模型/主配置及修订/手动自动化定义/6 份知识文件及版本/业务文件/同一已完成会话/localStorage/标记文件均通过；全程 1 次原模型请求，零重放、零页面错误、NotSigned。发布后夹具的类型复检通过；无本机安装、公开发布、远端主分支合并或官网部署，公开在线更新链尚未测试。

## 2026-11-11：0.1.7 公开、在线升级与官网

- PR #34 正常 merge 为 ef84d1b1bd1e475ee220f91814858349e9537e71，parents 是 7fad631e 与 12ac487f；没有 squash。冻结源码 f18c2fe9 仍是祖先。相对验证 head 只有测试和本记录，未重建候选。
- Release 440782281 于 2026-11-11T01:50:02Z 公开。tag desktop-v0.1.7 的注解对象 835bf6c1，peeled commit 为 f18c2fe9。make_latest=false；旧 Python latest 仍是 327801733 / v1.0.2。四附件 ID/摘要未变。匿名 latest.yml 与 SHA256SUMS 一致，安装地址总长度 391247521；未整包重下。
- 在线验收 run 42941852527，workflow SHA ef84d1b1，mode=online，previous_version=0.1.6。旧版自动发现后经真实按钮下载，缓存摘要匹配；普通退出取消后仍是 0.1.6；再次下载自动安装。新进程带 --updated 与原用户目录。六项保留、1 次模型请求、0 页面错误、NotSigned。
- 官网按该公开回执更新。pnpm check:brand 通过；CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/ 时 pnpm build:website 通过；node scripts/website-smoke.mjs 为 14 场景、0 错误。Pages 部署和双分支同步留在官网 PR 回执，不为此连续提交。报告：design/verification/desktop-release-0.1.7-20261111.md。

## 2026-11-11：0.1.7 完整 CI 的测试前置修正

- 原四片 run 42880217010 保留：384 文件、2633 用例，2626 通过、5 失败、2 原有历史 EXE 跳过。四个失败共享 knowledge-contract-provider 的旧目录数量 29；#28 增加两个治理 Skill 后实际为 31，现断言准确数量及两个真实名称，原版本、副作用、审批、幂等和坏输出检查均保留。
- 剩余 abandoned-checkpoint-dependency-pi 的 bad-output 本机复现：真实请求 system 明确为 context summarization assistant，64K 模型在完整检查点/回执长链后触发原生摘要，确定性测试供应商误归类为额外成员。仅本用例组配置 128K，并保留错误堆栈；共享 seed 默认 64K，产品摘要开关、重试、预算、超时和调度均未修改。真实摘要另由 pi-runtime-config/model-request-budget-pi 覆盖。
- 依据失败范围执行 pnpm exec vitest run tests/knowledge-contract-pi.test.ts tests/knowledge-effect-pi.test.ts tests/abandoned-checkpoint-dependency-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/desktop-017-ci-diagnosis.json：知识两文件六用例通过，长链坏输出仍失败；进一步诊断报告 desktop-017-bad-output-diagnosis.json 保留。修正后 pnpm exec vitest run tests/abandoned-checkpoint-dependency-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/desktop-017-bad-output-fixed.json：四用例通过（36.92s）。pnpm typecheck 通过。无源码/导入变更，不重复架构检查；完整新 head CI 继续由 PR 执行。
- 候选 source f18c2fe9b2a189c1dc31f63d60de83a7b6d6833f 不变：打包 EXE UI 与六项隔离通过；candidate 安装 run 42881228441 成功，全新安装及真实 0.1.6→0.1.7、六项数据保留/一次模型请求/零页面错误。此次仅测试与维护记录变化；包内 design/development-log 保留冻结副本，运行白名单资料、源码、依赖和构建配置未变。草稿 Release 440782281 尚未公开。

## 2026-11-11：0.1.7 发布准备（#27 / #28 / #29 与架构切片）

- 当前公开桌面版 0.1.6；默认 develop 与 master 同为 7fad631e8692ff2b5845e899ed49915c72d0faa4，仓库 nan023062/cbim、发布账号 nan023062；旧 Python latest ID 327801733/tag v1.0.2 保持独立。用户已授权完成、PR、合并和发布，沿用先未签名、日后更高版本切换签名的个人开发决定。
- 独立工单提交：#27 21d46da2、#28 db961c97、#29 642dd350；架构切片保留原独立提交。此前三个引擎与主 Agent 共用设置已在 0.1.6 发布，本次保持其行为。未把架构试点写成全部宽接口/运行时职责已经治理完毕。
- package 0.1.7 与内置说明已准备，官网仍指向公开 0.1.6。比较 desktop-v0.1.5..desktop-v0.1.6 的 updater 与更新界面无差异，验收输入新增实际旧版 0.1.6 automatic 流程，25 用例通过（test-results/desktop-017-inputs.json）；未来未知旧版仍拒绝。三宿主发布入口/引用同步。
- 类型检查、品牌摘要、官网构建通过；本次实际产品代码的架构检查复用 #29 已通过结果。新增 automation-ui-smoke.mts，计划在准确候选 EXE 和独立用户目录核实三引擎、固定自动化表单/实际运行、文件树与自动校验；尚未执行，不将脚本存在当作验收证据。候选构建、完整 PR 四片、隔离安装/在线升级与公开待本次后续流程。

## 2026-11-11：#29 当前工作区自动化与窗口标题

- Issue：https://github.com/nan023062/cbim/issues/29。对话新增固定自动化页签，任务列表、设置与运行历史参考 [Cindy scheduler](https://github.com/makecindy/cindy/blob/main/apps/desktop/help-knowledge/scheduler.md) 和 [运行生命周期](https://github.com/makecindy/cindy/blob/main/packages/maker-scheduler/src/engine/attemptLifecycle.ts)，独立实现当前工作区绑定，不提供自选路径。支持默认主 Agent/已采纳启用岗位、模块、自身 Workflow、有效 Skill、提示、权限及手动/间隔/每天/一次日程。窗口标题为 CBIM，EXE、应用 ID、用户数据和更新通道未改变。
- 分层：Core automation 只含纯协议/日程；Scheduler 只依赖存储/执行端口；Main 装配私有原子记录、当前知识/模型和真实协作；六项 IPC 强类型映射，前端无后端实现依赖。默认主 Agent 直接执行，岗位首任务经真实 scope/plan/dispatch 后由原协作批次领取，未绕过权限/预算/岗位门禁。临时岗位选择不写模块责任，显式/继承责任冲突拒绝。
- 生命周期：意图先保存，模型前 bind 真实 taskId/runId；同项不重叠，未知不重放。暂停/删除先冻结未来并取消准备，再停原任务；历史保留。重开跳过过去时刻并只观察原任务，关闭取消准备后排空。运行冻结定义，编辑只影响未来；执行完成与业务验收区分，历史经外壳打开原会话并保留原草稿。
- 影响测试依据：新日程/版本/持久化/取消、实际 Application 的实例拒绝及重开、真实 Pi 主与岗位配置；受影响消费者为原主运行/协作及对话入口。新增两文件 9 用例最终全部通过（分次验证）。初次真实 Pi 失败因未选 Workflow 传空数组违反原非空显式选择契约，改为缺省后通过；同时保留启动错误，不被后续无说明状态覆盖。失败证据 issue-29-new/start-diagnostic/start-error.json，修复证据 test-results/issue-29-workflow-fix.json（真实 Pi 1 用例通过，选择器排除已通过的存储用例）。
- 回归命令：pnpm exec vitest run tests/automation-scheduler.test.ts tests/auto-collaboration.test.ts tests/application-runtime.test.ts tests/application-collaboration-pi.test.ts tests/conversation.test.ts tests/chat-chrome.test.ts tests/main-agent-settings.test.ts --reporter=default --reporter=json --outputFile.json=test-results/issue-29-related.json：7 文件 63 用例通过，20.54s。加新增 Application 两用例，共 8 文件 65 个独立用例通过。真实进程使用本地确定性 HTTP 响应，仅证明路由、生命周期和模型身份，不代表在线业务质量。
- pnpm check:architecture 通过：58 目录/630 代码样式、1227 文件/6278 含类型依赖，0 循环、0 文档差异。源码注释、相关 CONTRACT 与 13 份类图同步。pnpm typecheck 通过（先修正测试诊断中的 DispatchState 字段引用）。全仓四片 CI、实际桌面交互和安装升级留在本次后续集成/发布阶段。

## 2026-11-11：主 Agent 与模型设置 IPC 契约试点（架构审计 A07）

- 公开 model-actions 定义九个动作的请求 Schema 与返回值，Main 独立 handler 表委托原服务；Bridge/preload 共用 IpcCall。已迁移动作不落回旧重载，错误请求和未知新动作均有编译期反例；未知字节仍在 Main 校验，未把类型当授权。
- LegacyAction 枚举当前真实旧操作，禁止任意字符串；旧返回保留兼容形状，尚未完成其余 IPC 类型迁移，不宣称全部路由已消除 any。主 Frame、退出、工作区实例、主配置 revision、引擎兼容和凭据存储归属不变。
- 类型检查发现通用操作字符串与轮询闭包未固定的 instanceId，改为对应能力的动作联合、模板字面量和固定身份；InlineOwnerCall 同时包含测试装配复用的真实提交/回执动作。最终 pnpm typecheck 通过，新增 @ts-expect-error 反例全部生效。
- 验证依据：实际 Application 请求拒绝、主设置共享/重开、模型保存、岗位调用消费者及资料适配。命令 pnpm exec vitest run tests/model-actions.test.ts tests/main-agent-settings.test.ts tests/llm.test.ts tests/inline-module-ownership.test.ts tests/continuation-source-view.test.ts --reporter=default --reporter=json --outputFile=test-results/model-ipc-contract.json：5 文件、27 用例通过（12.87s）。
- pnpm check:architecture 通过：56 目录/614 代码及样式、1208 文件/6207 含类型边，0 循环、0 文档差异。同步 bridge/contracts、preload、main/ipc 和相关前端目录契约、注释及十份类图；全仓集成和发布检查未运行。

## 2026-11-11：共享执行展示与页面控制单向依赖（架构审计 A08）

- 建立 execution-view：公开消息投影、Markdown、工具轨道/状态、提问、附件和队列由真实主对话、成员任务、团队履历消费者共享；任务域保留原命令核实、影响观察和恢复控制器。WorkStatus/ToolTimeline 只接运行投影及可选展示插槽，不接 ExecutionRecoveryContext。
- tasks 不再依赖 conversation；team 的履历及 Markdown 不再加载主对话模块。静态规则阻止共享展示反向引用页面/任务状态，阻止任务模块反向导入主对话或外壳。首次检查发现 FlowView 经纯状态标签依赖 shell，已将标签移到 components 后通过，未放宽规则。
- 保留原消息/回执顺序、失败提示、显式查询、复制/受控链接、附件快照和队列回调。成员默认轨道不装配主来源操作；主对话及任务历史通过 ToolActivity 插槽保留原查询入口。原恢复草稿和控制器归属不变。
- 按共享渲染和直接界面消费者选择：pnpm exec vitest run tests/agent-history-view.test.ts tests/chat-chrome.test.ts tests/command-verification-view.test.ts tests/conversation-progress.test.ts tests/conversation-waiting.test.ts tests/conversation.test.ts tests/dependencies.test.ts tests/human-continuation-view.test.ts tests/inline-conversation.test.ts tests/markdown.test.ts tests/member-event-state.test.ts tests/repository-tools-view.test.ts -t '^(?!all maintained code)' --reporter=default --reporter=json --outputFile=test-results/shared-execution-view.json：12 文件、74 用例通过（6.46s）；重复静态用例由 check:architecture 覆盖。pnpm typecheck 通过。最终 pnpm check:architecture：56 目录/611 代码及样式、1204 文件/6193 含类型边，0 循环、0 文档差异。
- 同步共享展示、任务、主对话、团队、公共组件契约及受影响类图和边界注释。未运行全量后端回归、桌面打包和发布验收；仅因改动导入路径的在线/引擎消费者由类型与依赖检查覆盖，最终 PR 集成再覆盖原完整用例。

## 2026-11-11：三个引擎改用通用运行工具目录（架构审计 A06 / G06）

- EngineContext 的九个具体业务类槽位改为 RuntimeToolsPort 目录；独立稳定文件定义目录/调用契约，引擎只枚举并路由。真实 toolCallId、停止信号、重名/非法名拒绝、未知工具拒绝保留。nativeTools=disabled 独立禁用全部原生文件/命令；求助、停泊和产物验证指引由业务装配产生。
- brain/index 不再重导出 PiEngine，生产装配及真正使用 Pi 的测试直接导入适配器；新增静态约束防止公共入口和目录重回具体工具依赖。未移动三家 SDK 实现或更改原门闩/日志/停止排空顺序。Runtime 的成员生命周期仍为下一步治理边界，此片只完成引擎能力输入与公共入口解耦。
- 既有运行回归通过仅测试用窄视图访问真实装配对象，保留坏回包注入、并发和停止断言。测试选择覆盖所有修改的业务工具消费者、主/成员调度和真实 Pi 受限执行，未重复跑无关业务或发布测试。
- 实际命令：pnpm exec vitest run tests/artifact-runtime.test.ts tests/artifact-transition-runtime.test.ts tests/complete-output-runtime.test.ts tests/controlled-file-runtime.test.ts tests/csv-validation-runtime.test.ts tests/dependencies.test.ts tests/engine-tools.test.ts tests/human-decision-service.test.ts tests/json-validation-runtime.test.ts tests/loop-engine.test.ts tests/member-checkpoint-runtime.test.ts tests/member-checkpoint-service.test.ts tests/member-execution.test.ts tests/member-help-runtime.test.ts tests/member-help.test.ts tests/output-manifest-runtime.test.ts tests/pi-loop.test.ts tests/png-validation-runtime.test.ts tests/queued-dependency-replacement-service.test.ts tests/scope-goal.test.ts tests/scope-replan.test.ts tests/scoped-execution-pi.test.ts tests/scoped-execution-runtime.test.ts tests/workflow-runtime.test.ts -t '^(?!all maintained code)' --reporter=default --reporter=json --outputFile=test-results/engine-capabilities.json。24 文件、208 用例通过（114.58s），重复全仓静态用例由架构检查覆盖。真实 Electron/Pi 使用本地确定性供应商；Claude/Codex 本片验证目录禁用，不代表真实在线服务验收。
- 初次类型检查仅新增测试的联合数组推断失败，显式标注目录类型后 pnpm typecheck 通过；生产类型无错误。pnpm check:architecture 通过：55 目录/610 代码及样式、1203 文件/6191 含类型依赖，0 循环、0 文档差异。同步能力/运行装配注释、四份契约和五份类图；未运行全仓产品回归或发布验收。

## 2026-11-11：预算业务改用专用事务端口（架构审计 A05）

- ModelRequestBudgetService 不再依赖 DispatchStore/DispatchState；Core 新增 ModelRequestBudgetStore/视图/阶段回执契约，Main 适配器显式投影隔离副本，只能写单条预算变化。ScopeBudgetService 的请求预检仅接预算附录；运行级准入的原职责保留。
- 同一原 Store 的事务中读取余额、决定并保存预留/拒绝，不拆事务、不建第二个账本、不迁移旧日志。原命令指纹、重放、未知消耗、发送前核实和关停所有权保持。其他业务仍待按真实变化点迁移，不宣称整库已完全拆分。
- 验证依据：预算服务和阶段适配、运行级准入、实际 Main/Pi 请求与成员共享额度、新逻辑边界。执行 pnpm exec vitest run tests/model-request-budget.test.ts tests/scope-budget-service.test.ts tests/model-request-budget-pi.test.ts tests/dependencies.test.ts -t '^(?!all maintained code)' --reporter=default --reporter=json --outputFile=test-results/budget-port.json：4 文件、38 用例通过（29.65s）；重复全仓静态用例由架构检查覆盖。实际 Pi 使用本地确定性供应商，不代表在线模型质量。
- pnpm typecheck、pnpm check:architecture 通过：55 目录/608 代码及样式、1199 文件/6154 含类型依赖，0 循环、0 文档差异。同步新增端口及适配器文件头、三个目录契约、四份类图。未运行全量回归、全套桌面或发布验收。

## 2026-11-11：历史索引存储与工作区装配分离（架构审计 A09）

- 范围：FileAgentHistoryStore 只依赖 Core 存储契约和 Foundation；createAgentHistory 移入 workspace，通过窄 AgentHistoryOwner 组合运行日志与调度查询服务。Application 为唯一生产装配入口，持锁启动、只读身份检查、观察与排空顺序均保持。
- 保护稳定能力：索引文件布局、原子写入、损坏诊断、原日志身份和符号链接防护不变；之后调整工作区装配不再修改文件存储模块。新增静态边界拒绝存储反向引用 Workspace 或调度服务（含类型）。
- 验证选择：历史服务、文件存储、持锁启动三个直接消费者和修改的依赖检查器。实际运行 pnpm exec vitest run tests/agent-history-store.test.ts tests/agent-history.test.ts tests/workspace-history-startup.test.ts tests/dependencies.test.ts -t '^(?!all maintained code)' --reporter=default --reporter=json --outputFile=test-results/history-boundary.json：4 文件、27 用例通过（12.24s），重复全仓静态用例跳过，由 check:architecture 覆盖。
- pnpm typecheck、pnpm check:architecture 通过：55 目录/606 代码及样式，1197 文件/6145 含类型边，0 循环、0 文档差异。同步 main、persistence/tasks、workspace 三份类图与相关文件头、契约。未运行全量产品回归、桌面构建和发布验收，留待最终集成。

# CBIM 开发记录

## 2026-11-12：本地 AI 团队开发闭环审计与失效资产清理

- 用户直接授权核实架构缺口、删除死代码/死文档及同步过期说明；查询时没有开放 Issue，未创建工单或实施新调度功能。完整证据见 [本轮审计](verification/local-ai-workflow-audit-20261112.md)。
- 复用依赖图检查 634 个 src 脚本及实际入口，核实目标→派发→成员结果→自动接续→验收链。主要缺口是通用代码验证证据、最终验收失败后的有界返工、无人值守恢复；整合交付和经验复用还需真实闭环证据。
- 删除 49 个工作区文件：4 个退出的 src 文件、41 个旧 Python/预览/Skill 工具链及配套文件、旧预览启动器、花名册 Schema、重复 Connector 摘要和未跟踪的 Cindy 承载草案。保留当前运行白名单、兼容协议及历史验收记录。
- README、概念设计 01–04、模型导航和连接器说明对齐本地小团队方向。同步 workspace、components、tasks 三处源码类图、组件契约和旧输入回归注释；不改变运行许可、验收裁决或失败恢复行为。
- 验证依据：`dispatch-context` 核实旧输入兼容，`builtins` 核实保留的运行资产；`pnpm exec vitest run tests/dispatch-context.test.ts tests/builtins.test.ts` 通过 5 个用例。`pnpm typecheck`、`pnpm check:architecture` 通过（1336 文件/6793 边、0 循环/违规）；清理后 631 个 src 脚本在已核实入口集合下均可达；变更及删除相关文件链接检查和 `git diff --check` 通过。
- 未运行全量回归、打包安装、公开升级或真实模型端到端验收。本轮只是分析和清理，不表示全自动开发能力已补齐；后续开发范围和实时进度仍从 Issues 获取。

## 2026-11-11：两份旧桌面脚本修复与同制品补测

- 来源：用户直接要求修复全量验收报告中的两份旧桌面脚本；已核实开放 Issues，无直接对应工单，未创建或更新无关 Issue。保留 `develop` / `a5938170` 及全部既有未提交工作。
- 变化边界：仅修改 `scripts/runtime-smoke.mjs`、`scripts/architecture-ui-smoke.mts`，新增共用的 `desktop-dispatch-fixture.mjs` 并更新报告／索引。夹具经公开 IPC 登记岗位与模块责任，经真实 Pi 工具发现负责人、规划目标；不改产品源码、权限或周期门禁，不手写运行日志。
- 运行时专项：保留排队、前置等待、增量、隔离、幂等和重启覆盖，新增缺周期拒绝、每任务独立实例及停止结算断言。重启核验已结算图和原回执，不复活旧队列、不重放模型；真实主运行及已释放成员按当前统计契约核对。
- 架构专项：使用现行静态模块表单与独立岗位登记。两个真实源周期各创建一项待办；四类资源导入导出前后源图／责任／任务／压力不变，源身份不泄露，目标无岗位或动态运行且默认主 Agent；预览取消、Skill 继承、窄布局、深浅色和业务文件不变覆盖保留。
- 验证：显式设置 `CBIM_TEST_EXE` 为 `unsigned-20261111-223155-e1207aa6/CBIM Assistant-win32-x64/CBIM Desktop.exe`，分别运行 `node scripts/runtime-smoke.mjs` 和 `node --import tsx scripts/architecture-ui-smoke.mts`（实际使用绝对路径、独立证据工作目录）；两项退出码均为 0，22:57:38 +08:00 完成。实际本地模型请求为 3／6 次，无外部模型或成员执行；页面／协议错误为空。
- 静态范围：新共用夹具带来导入变化，`pnpm check:dependencies` 通过：1,237 文件、6,429 条含类型依赖，循环／边界违规 0；两份 `.mjs` 语法检查通过。源码未改，本轮不重复全量单元、类型／类图、打包和其他已通过专项。
- 证据与交接：[更新报告](verification/full-acceptance-20261111.md#61-两份旧脚本的专项补测)、[补测回执](../test-results/desktop-followup-20261111/followup-results.json) 和[脚本 diff](../test-results/desktop-followup-20261111/smoke-fixes.patch)。EXE／`app.asar` 匹配原构建回执；首次失败和适配失败日志保留。实际安装／升级、两项指定历史制品迁移及云端 CI 仍未补齐。本轮未提交、推送或发布。

## 2026-11-11：全量回归与本地打包验收

- 来源：用户明确要求全量回归、打包安装验收；随后选择未签名验收包和只做本地验收。保留 `develop` / `a5938170` 上已有未提交工作，核对 1,682 文件字节基线后回填本轮修复。
- 全量初跑：386 文件、2,637 项，2,629 通过、6 失败、2 个固定历史 EXE 迁移用例因缺少指定制品跳过。修正后 7 文件 49 项定向复测通过；去重证据 2,636 通过、2 跳过，不冒充第二次全量运行。
- 修复：对象 Schema／DTO 从 Node.js 事务实现分离，修复浏览器打包失败；派发保留历史缺省 scope 的原回执查询与新命令拒绝；队列插入保留 `QUEUE_INSERT_STALE`；修正测试夹带字段及侧栏、对话定位断言，新增浏览器构建回归。同步三个源码目录的注释、契约和类图。
- 静态检查：typecheck、check:architecture、品牌检查和本地官网构建通过；1,236 文件、6,427 条含类型依赖，无循环／分层违规，56 目录资料漂移 0。
- 制品：独立本地冻结提交 `122af557d55ae5a65c9c8b4b60b982714e71231a` 生成 0.1.5 未签名 NSIS，391,272,716 字节；摘要／资源／更新清单再核验通过，实际签名 `NotSigned`。最终同一 EXE 的侧栏、扩展、完整对话、便携运行、品牌及 6 项 Windows 进程隔离专项通过。
- 缺口：`runtime-smoke.mjs` 的无周期派发夹具和 `architecture-ui-smoke.mts` 的旧真人维护表单仍失败；未放松产品门禁、未删除断言来伪造通过。本机现有 0.1.7 保持；未运行实际安装／升级、云端 CI，未推送／合并／发布。原工作区修复保持未提交，独立快照提交仅用于构建追溯。
- 详细命令、首次失败、剩余问题、最终包与回执见[全量回归与本地制品验收报告](verification/full-acceptance-20261111.md)。


## 2026-11-11：剩余 160 项 IPC 类型化完成并复扫

- 来源：用户直接授权继续处理 P2 剩余 IPC 并复扫；HEAD a5938170，开始时 1,664 个维护文件字节基线。开放 Issues #36–#39 无直接对应，未修改工单；保留此前未提交成果，本轮未提交、推送、合并或发布。
- 实施：九组请求／响应契约覆盖剩余160项，加角色历史共164项（含退役 loop.start）。153项应用入口改为受类型约束的业务处理器，11项原生操作逐项解析并配对成功值；旧通配清单退出。前端动态输入按Schema配对，缺失身份和联合回执显式处理；workspace-view独立纯DTO，避免类型循环。
- 行为边界：保留主Frame、安装／关闭门禁、受理前错误码、服务权限、CAS和未知结果不重放；治理回执、附件JSON和选择器公开投影核实。原持久化格式和产品内置Skill不变。
- 验证：41个不同测试文件、231项不同用例通过，1项固定旧版EXE专项按原条件跳过；类型检查通过。首次旧扫描断言及反馈测试夹带字段的失败已修正并定向补跑，原始失败证据保留。未运行全仓回归、真实桌面、打包或安装升级。
- 复扫：1,234个代码文件、6,424条含类型依赖，0循环／物理或逻辑违规；13个逻辑边界覆盖37文件。56目录、631源码／样式，类图漂移0；586源码脚本AST及文件头通过。详见[整改、命令与认知交接](verification/ipc-typing-20261111.md)。
- 当前调用契约全量完成，不代表所有领域JSON递归消除any或全通道响应运行时Schema。维护者人工review尚未完成；历史P2报告保持原快照。

## 2026-11-11：完成 P2 三项最小整改与全工程复扫

- 来源与基线：用户明确要求继续处理 P2 并复扫。HEAD `a5938170`，以包含规范、Skill、P0/P1 的未提交工作区为基线，保留此前成果。开放 Issues #36–#38 与本轮无直接对应，按用户直接授权实施，未创建或回填工单。逐项验收和回退见 [P2 整改与复扫](verification/architecture-p2-20261111.md)。
- A07：Bridge 使用联合元组关联操作、请求和响应，先迁移四项角色历史查询；Main 在服务查找前严格解析，客户端去掉响应断言。其余 160 项操作仍保留明确旧名单及宽响应，未宣称全量类型化；主 Frame、错误信封和未知结果语义保持。
- A08：六个公共展示／投影文件迁到 run-view，不再依赖任务恢复 Hook；RunToolDetails 在页面层显式组合原核实与恢复面板。迁移源码、测试和性能探针引用，恢复、刷新、选择仍归原控制者。
- A09：文件历史索引只保留适配类，Main 独立工厂用最小工作区能力装配服务与 canonical 读取。AST 对照确认原存储类、读取函数体、Application 生命周期保持；原 Main 权限入口字节一致。
- 定向验证：新边界 5 文件 31 项通过；消费者 23 文件首轮 127 通过、1 个旧隐式面板装配测试失败，修正后只补跑该文件 8 项，全部通过。累计 28 个不同文件、159 项不同用例通过。最终 typecheck、check:architecture、性能脚本语法／探针锚点及 diff --check 通过。未运行全仓回归、桌面性能、打包或安装升级。
- 复扫：1,213 个代码文件、6,282 条含类型依赖，循环、物理／逻辑违规、未解析和未批准动态加载为 0。13 个逻辑边界覆盖 27 文件；56 目录、612 源码／样式，资料漂移 0；567 源码 AST 和文件头核对通过。同步 8 份 CONTRACT、16 份目录类图及相关源码注释，原审计/P0/P1 报告未改写。
- 交接：按原报告最小验收完成 A07–A09；160 项 IPC、其他共享状态与 Runtime 准备逻辑仍是后续扩展范围，不自动成为新任务。本轮未提交、推送、合并或发布，尚未获得人工 review 结论。

## 2026-11-11：完成 P1 四项最小整改与全工程复扫

- 来源与基线：用户明确要求继续处理 P1 并复扫。HEAD `a5938170`，以包含此前规范、Skill、报告及 P0 的未提交工作区为基线；开放 Issues 为空，按直接授权实施，无关联工单。此前内容保持，本轮未提交、推送、合并或发布。逐项验收、回退及失败证据见 [P1 整改与复扫](verification/architecture-p1-20261111.md)。
- A03：统一 Team/Auto 的主 Agent 默认直接执行指引，保留 read/ask/execute、知识保护及主角色不得成为独立成员的约束，清理现行源码与说明矛盾。A04：KnowledgeQueries 只接收 snapshot；刷新独立为四项端口服务，原版本、幂等及权限保持。
- A05：请求预算迁到 RequestBudgetStore/Admission；Main 在原 DispatchStore 串行事务中投影窄状态，拒绝夹带其他领域变更，不拆可靠落盘或跨域原子操作。A06：EngineContext 九类专用字段合并为通用 capabilities，业务工具／指引在显式装配中提供，验证器启动检查移到 RunValidation 所属模块；三个引擎统一消费原生工具关闭策略。
- 验证按实际接口和测试夹具消费者选择。首批端口／规则 26 通过、1 个新增测试 await 错误；55 文件 407 通过、1 个旧私有端口注入失效。修正测试迁移后定向补跑，另核两个引擎的实际能力目录和执行；累计 58 个不同文件、431 个不同用例全部通过。最终 typecheck、check:architecture、diff --check 通过，未运行全仓回归、打包、桌面或安装升级。
- 复扫：1,201 代码文件、6,249 条含类型边；循环、物理／逻辑违规、未解析及未批准动态加载均为 0。10 个逻辑边界覆盖 16 文件；55 目录、605 源码／样式，资料漂移 0；560 源码 AST 和文件头核对通过。同步 22 个相关源码文件的注释／接口、契约及 17 份目录架构文档。
- 交接：请求预算和验证是原报告要求的真实治理切片，不代表整个共享状态／Runtime 全拆分；其他跨域协调仍明确保留。A07 IPC、A08 前端共享展示、A09 历史存储装配仍待后续授权，G06 其余出口作为待核查点。维护者人工 review 尚未完成。

## 2026-11-11：完成 P0 逻辑边界试点与测试隔离，复扫通过

- 来源与范围：用户授权先修复架构扫描报告中的两项 P0，再扫描验证。仓库 `nan023062/cbim`，基线 `a5938170`；实施前查询开放 Issues 为空，按直接授权处理，未创建／更新工单。上一轮规范、Skill 和报告的未提交内容全部保留；本轮未提交、推送、合并或发布。完整证据见 [P0 整改与复扫记录](verification/architecture-p0-20261111.md)。
- A01／G01：新增六个已核实逻辑边界，检查公开入口、允许方向和外部依赖，包含类型、重导出、别名及动态字面量。新增 read-models 公共入口，迁移真实查询／上下文／负责人消费者，保留原物理层和文件无环检查；没有目录豁免。六个边界是试点范围，其余层内职责继续随 P1／P2 治理，不报告为全仓逻辑治理全部完成。
- A02／G02：分离纯数据、知识端口适配与完整 Application 夹具，迁移 114 个测试／脚本调用点。119 个迁移文件除导入和说明外的代码 token 相同；三个数据导出及应用 fixture 定义保持。领域读取测试改用固定快照，原完整应用关闭后仍可读快照的场景独立保留；真实依赖图证明数据辅助和该领域测试不再可达 Main／Scheduler／完整夹具。
- 验证选择与结果：对检查器、类图生成、领域读取、知识输出／刷新、派发上下文、负责人及工作区执行明确的 12 个测试文件，72 项通过。自查补齐相对路径进入 node_modules 的外部依赖识别后，只重跑检查器 18 项，全部通过；去重共 12 个文件、73 个不同用例通过。最终 `pnpm typecheck` 和 `pnpm check:architecture` 通过：1,192 文件、6,186 条含类型依赖、0 循环／越层／逻辑违规／未解析引用／未获准动态加载；55 目录、601 源码／样式文件、类图差异 0。没有重复运行未受后续检查器修改影响的业务测试。
- 资料与认知：同步九个源码文件（含新入口）的文件头、知识 CONTRACT 和七份 ARCHITECTURE；报告列出完整 diff 阅读方式、六个新增文件、六类边界、四问及退出／回退条件。原报告保持为整改前快照；复扫明确列出七项 P1／P2 与 G06 复核范围，未把前置改善记成它们已经完成。
- 限制：未运行全仓产品测试、打包、安装升级、真实桌面或在线模型验收。检查通过、实现完成、人工 review、合并和发布分别记录；本轮尚未人工接受。

## 2026-11-11：按两份架构规范进行全工程只读扫描

- 来源与范围：用户直接要求扫描整个工程并列出问题；代码基线为 `a5938170cf9675b69960dde6a9bb535eb845bdd8`，保留上一轮规范与 Skill 的全部未提交修改。按 C2 保存[架构扫描报告](verification/architecture-audit-20261111.md)，没有关联或创建 Issue，没有实施整改、提交或推送。
- 覆盖方式：扫描开始于 2026-11-10，对 1,631 个维护文件建立清单，对 1,186 个 JS／TS 系列文件执行依赖与 AST 定位；精读 IPC、工作区、知识查询、调度存储、运行时、引擎、前端会话及测试夹具的关键链路。29 个历史 Python 和 11 个 JSON 只做语法／格式解析；其余资产按入口抽样核对，不声称逐文件完整语义验证。
- 发现与交付：报告归纳 9 项有代码依据的问题，覆盖逻辑边界检查、测试辅助耦合、主 Agent 指引矛盾、知识查询、共享状态、运行能力、IPC、前端展示和历史服务装配；逐项记录优先级、规范对应、影响、最小整改和目标验收。G06 已有 `AgentEngine` 与工厂注入，单列剩余复核，未重复判定为全缺失。目录聚合双向引用与文件循环分开说明；目标验收不冒充已执行结果。
- 实际检查：通过 `node --input-type=module -` 调用现有 `auditDependencies()`，1,186 文件、6,107 条含类型依赖，循环、现行越层、未解析引用及未获准动态加载均为 0，已登记外部动态加载 7 项；`node scripts/source-architecture.mjs --check` 返回 55 目录、600 源码／样式文件、文档差异 0。AST／文本扫描未发现缺少要求关键词的源码文件头；Python／JSON 解析无错误。报告正文的 31 个本地链接有效，9 个问题编号完整，行尾格式检查通过；`git -c core.safecrlf=false diff --check` 通过，src、tests、scripts、构建依赖及 CI 文件无本轮变更。
- 验证边界：只做静态与资料核实，未运行产品单元／全量测试、类型检查、构建、真实模型、桌面或安装升级验收。主 Agent 最终提示中的职责冲突已静态确认，模型行为影响未复现。尚未人工接受、整改、合并或发布；后续实施仍按当时真实代码、Issues 与用户授权确定。

## 2026-11-10：分离架构设计规范与治理流程，并绑定项目 Skill

- 来源与范围：用户直接要求将已讨论的架构原则和治理机制提炼为两份规范，并要求开发 Skill 遵守文档 1、架构治理 Skill 遵守文档 1 且按文档 2 执行。仓库为 `nan023062/cbim`，基线 `a5938170`，无关联 Issue；本次没有创建或推进工单，也没有实施 G01–G09 源码整改。
- 文档交付：[文档 1](project-architecture-standard.md) 规定十二条设计原则、职责依赖、模块最小契约与验证／维护交付；[文档 2](architecture-governance-process.md) 规定 S1–S7、检查与认知分级、变更证据、抽象退出、四问及规则候选、验收与记录模板。G01–G09 的原编号、优先级、前置与验收保留为文档 2 的 CBIM 附录，属于方案基线，不维护实时进度。原本轮未交付的合并草稿已替换，未新增 docs/05 或平行待办。
- 强制关系：三个宿主的 `cbim-development` 明确先读并遵守文档 1；`architecture-evolution` 明确作为项目架构治理入口，先读两份规范并执行 S1–S7；`architecture-maintenance` 遵守文档 1，在治理中承接 S6–S7 和认知验收。同步 AGENTS、CLAUDE、根 README 与 design 导航；产品内置业务 Skill、运行资产和代码未修改。
- 设计理由与边界：稳定设计约束和治理执行过程分别维护，Skill 引用同一正文。保留既有硬约束；影响判断不限于依赖图；只读巡检可归档报告；已授权迁移不逐状态审批；规则候选需明确批准才生效。普通开发不机械启动全套治理，只读评估不自动实施，日常仍按真实影响验证。
- 本次验证选择：改动仅为文档与 Skill，核对新规范及被改入口的引用、格式和多宿主一致性。执行 `python -X utf8 -` 内联文档校验：15 份变更 Markdown 的 203 个本地链接目标、14 个标题锚点有效；9 个 Skill 入口的元数据与强制引用检查通过，三组入口逐字节一致；12 条原则、7 个流程阶段、9 项整改及 P0／P1／P2 对应关系完整；无残留草稿引用或占位符，`docs/` 仍为四份概念设计。此统计在追加本条记录之前产生；追加后另行核对本条 2 个新链接和两份新规范的行尾空白，并扫描维护文本中的原合并草稿引用，均通过。`git -c core.safecrlf=false diff --check` 通过。
- Review 入口：完整变更相对 `a5938170`；先读文档 1，再读文档 2 的通用流程和 CBIM 附录，最后核对各 Skill 顶部强制引用及项目入口。实现验证、人工接受和后续治理效果分别记录；未运行产品单元／全量测试、类型检查、依赖／架构检查、构建、桌面或发布验收，不将文案校验视为模型执行效果验证。

## 2026-11-11：统一主会话直接执行与独立成员边界（审计 A03）

- 用户授权继续完成全部，本片先消除审计确认的运行指引冲突。集成分支基于 `2af774c5`，已保留原作者移植文档清理提交 `a5938170` 为 `d5af4cd4`；冲突仅涉及历史记录、旧 roadmap 和已退役 docs，保留新旧验证事实，docs 回到四份概念设计。主工作区未提交规范仍保留，不随本片擅自提交。
- Team/Auto 指引统一为主会话可按权限直接执行，`cbim:main` 不能作为独立成员 assignee；主目标可用 main-execution 引用真实业务回执，知识、成员 Workflow 和人工验收保持独立。同步 README、Team 与 Conversation 契约和主指引文件头；没有修改运行权限、目标审阅实现或旧历史。
- 选择提示组装、默认执行者、目标工具、统一工具权限四文件验证声明的边界；同时因移植提交改变内置资源路径，运行 builtins、knowledge-tool-output、knowledge-tool-contracts。命令：`pnpm exec vitest run tests/agent-role-instructions.test.ts tests/default-executor.test.ts tests/goal-tools.test.ts tests/unified-tool-policy.test.ts tests/builtins.test.ts tests/knowledge-tool-output.test.ts tests/knowledge-tool-contracts.test.ts --reporter=default --reporter=json --outputFile=test-results/main-role-and-resources.json`；7 文件、35 项通过，18.69 秒。真实 Pi 测试使用确定性本机响应，不声称在线模型质量验收。
- 原权限、实例身份、版本与独立成员拒绝是稳定边界，变动只在当前指引和现行说明；以后职责提示从 main-agent.ts 与两个最终模式入口修改。未新增通用规则候选，尚未人工接受；未运行全仓回归、类型检查、打包或安装升级。已同步 Team、Conversation 两份类图；pnpm check:architecture 和 git diff --check 通过，55 目录/605 代码及样式、1196 文件/6145 含类型边、0 循环及文档差异。

## 2026-11-11：知识查询单向边界与局部测试隔离

- 来源为用户直接指定的架构优先开发。查询 `nan023062/cbim` 开放 Issues 得 #27、#28、#29 共 3 项；本片是知识/团队/工作区查询边界的前置治理，没有新建架构工单，也不把这三个业务需求标为完成。
- 基于已发布 0.1.6 的 `7fad631e` 在 `refactor/query-boundaries` 独立工作树实施；主工作区的并行规范与 `a5938170` 保留。C3 有限切片、L2 认知交付，不宣称全仓治理完成。
- 查询组合移到 Scheduler Context，Core 只保留快照契约、固定领域视图与独立刷新用例；查询端口只暴露 snapshot，刷新端口只暴露原身份/版本/回执/提交所需能力，状态和原子事务仍归原 Workspace/KnowledgeStore。两处直接消费者迁移，旧入口退出。检测器新增已迁移模块的单向出边约束，含类型和重导出。
- 纯数据与 Rules 领域环境从完整 Application fixture 分离；迁移 core-domains、rules，保留源目录真实校验和原断言。旧应用测试继续使用兼容重导出，没有批量改动所有测试或放宽验证。
- 验证按查询、规则、刷新、工具输出、任务准备与检测器实际影响选择 7 文件。首轮 35 通过、3 个新增样本 UUID 错误失败、1 个重复扫描用例未选择；修正样本后仅重测这 3 项并通过，累计 38 个不同用例通过。原报告和重测报告分开保留。实际命令、选择依据和完整 review 导读见[专项记录](verification/architecture-query-boundaries-20261111.md)。
- `pnpm typecheck`、`pnpm check:architecture`、`git diff --check` 通过：55 目录/605 代码及样式、1196 文件/6145 含类型边、0 循环、0 类图差异。同步涉及文件头、端口说明、5 份 CONTRACT 和 8 份 ARCHITECTURE；四问与剩余范围见专项记录。
- 未运行全量行为回归、桌面全套、真实供应商、打包、安装升级或发布；尚未人工 review、合并或发布。未改变现有 CI/发布检查。其他逻辑模块、完整测试辅助迁移以及 #27–#29 的业务验收仍各按实际需求推进。

## 2026-11-10：三引擎与主 Agent 配置修复随 0.1.6 公开

- 用户 BUG，未关联新 Issue：三引擎内置，供应商只管理统一模型；对话栏与 Agent 页等效，前者配置工作区主 Agent。
- 完成范围：协议兼容筛选和运行前校验；主 Agent 唯一配置、两处入口与多主对话同步；岗位独立引擎及旧快照兼容。复用既有权限、预算、审计和原生执行，不修改正在运行或已受理队列的快照。
- 验证按真实消费者选择：配置/菜单、岗位登记与派发、主配置持久化和原生运行。累计 99 项不同受影响用例、9 项真实浏览器交互、类型与架构检查通过。具体命令与边界见[修复验证](verification/engine-model-separation-20261110.md)；同步源码注释、契约与 16 份架构资料。
- 发布：修复提交 ca31e017，经 [PR #32](https://github.com/nan023062/cbim/pull/32) 正常合并；完整 Windows 四片 376 文件/2599 项，2597 通过、0 失败、2 原有历史 EXE 前置缺失跳过。同一 EXE 六轮引擎执行与六项隔离检查通过。Release 440090082 / desktop-v0.1.6 已公开，四附件匿名下载摘要一致，未签名与旧 Python latest 不变。
- 真实候选安装 42780830205、0.1.5→0.1.6 在线升级 42782241422 通过；普通退出取消、六项保留、1 次确定性模型请求和 0 页面错误均核实。官网与 README 按公开回执修正引擎/模型说明；品牌、正式域名构建与 14 个界面/离线场景通过，0 页面错误。收尾 CI、master 部署和远端同步回执统一附在 PR #32。完整依据见[发布验收](verification/desktop-release-0.1.6-20261110.md)。本机 develop 的并行文档/资源整理 a5938170 保留，不混入发布。

## 2026-11-10：0.1.5 公开与真实在线升级，官网收尾

- 主 Agent 默认执行与 Pi / Claude Code / Codex 三引擎随 0.1.5 公开。PR #30 正常合并，准确 head 完整四片 375 文件/2587 项：2585 通过、0 失败、2 原有真实历史 EXE 前置缺失跳过；独立失败/修正及冻结制品证据保留。
- Release 439994358 / desktop-v0.1.5 公开，保持未签名与旧 Python latest；候选全新安装 42764972516、真实 0.1.4 在线升级 42768158030 通过，普通退出取消、下载摘要、自动重启与六项保留均核实，模型请求 1、页面错误 0。使用确定性模型响应，不等于在线模型质量验证。
- 官网版本快照来自公开回执，同步三引擎、独立岗位配置和主 Agent 执行说明；README、引擎维护说明、发布指南与路线图同步实际交付状态。按用户明确选择一并合入 812bec16 开发规范文档，保留其作者和提交。
- 实际 pnpm check:brand、正式域名 pnpm build:website、node scripts/website-smoke.mjs 均通过：14 个手机/桌面/深浅色/离线场景，页面错误 0；11 份 Markdown 的 404 个本地链接、围栏与 Skill 三入口一致性通过，四附件匿名下载摘要一致。没有源码变化，不重复本机产品单元、类型/架构或安装构建。收尾 PR 仍经完整 Windows 四片，master 部署与匿名六文件回执随后附于 PR。完整证据、源码导读和维护清单见[发布验收](verification/desktop-release-0.1.5-20261110.md)。

## 2026-11-10：从 Issues 获取开发清单，清理 docs 与全局引用

- 来源与范围：用户直接要求维护开发流程及文档，仓库为 `nan023062/cbim`，本次没有关联 Issue。开发、发布入口改为核实当前 Issues／PR 和相关历史证据，保留每个 Issue 独立开发、验证、提交与代码 review 交付；没有读取后自动开工、创建／关闭工单、推送或启动发布。
- 清单归属：同步 AGENTS、CLAUDE、README、design 入口和三个宿主的开发／发布 Skill；roadmap 原阶段、剩余项和接续清单全部清除，仅保留迁移说明。开发记录与旧方案保留历史事实，不再作为当前任务队列。
- 文档清理：`docs/` 只保留 01–04 四份设计，删除其余 24 份说明。实际内置规范 `shared-skills-workflows.md` 移至 `design/runtime/`，Cindy LICENSE／NOTICE 移至根 `legal/`；三份迁移资源与移动前文件的 SHA-256 全部相同。四份保留文档仅修正导航和已删除文档的引用，相关方案转向 design，当前实现说明回到 src 契约。
- 运行边界：`Builtins` 的标准 ID、只读语义和正文保持，来源路径改为运行资源目录；Agent／Module 规范的相对引用同步修正。目录版本包含来源路径，因此可以正常变化。Forge `extraResource` 增加 `legal`，保留原 `design`／`docs` 资源声明；本次没有生成或替换发布制品。
- 维护同步：修正九份源自 Cindy 文件的许可注释及 Builtins 文件头；同步 `core/knowledge`、`core/runtime`、`core/tasks`、`core/brain/pi` 和 `frontend/conversation` 的 CONTRACT 与五份 ARCHITECTURE。`node scripts/source-architecture.mjs` 更新五份文档，未改职责关系或虚构依赖。
- 全局引用：扫描全部已跟踪及非忽略新增文本文件，并检查 335 份 Markdown 的本地内联链接、引用式链接和 HTML 资源目标（跳过代码围栏），没有失效文件目标。历史报告中指向已删除文档的链接改为带原路径的历史标注；原文可用 `git show 812bec16:<原仓库相对路径>` 查阅。旧本机 ZIP 链接改为历史路径，保留原大小事实。测试夹具中的虚拟 docs 路径、上游 NOTICE 原文及历史路径文字有意保留，不作为现行读取入口；本次未验证外网链接可达性。
- 单元选择与结果：资源路径影响内置目录读取、正文版本、引用解析及知识工具输出契约；增强既有用例，要求 Agent／Module 两份规范均解析到可用的同一标准 ID。执行 `pnpm exec vitest run tests/builtins.test.ts tests/knowledge-tool-output.test.ts tests/knowledge-tool-contracts.test.ts`，3 个文件、12 项测试全部通过。纯许可注释不改变界面或 Pi 行为，未额外运行对应行为测试。
- 静态与 Skill 验证：`pnpm check:architecture` 通过（55 个目录、600 个源码／样式文件，架构差异 0；1186 个检查文件、6107 条含类型依赖、循环 0）。以 `python -X utf8` 调用 `skill-creator/scripts/quick_validate.py` 检查 12 个入口，全部有效；四项 Skill 及全部配套引用共 7 组文件在三个宿主逐字节一致。`git diff --check` 通过。
- 资源验证边界：首次通过 `pnpm exec tsx` 直接导入 Forge 配置时，依赖模块的顶层 await 与 CJS 加载冲突，返回 `ERR_REQUIRE_ASYNC_MODULE`；未调用打包钩子。随后用 TypeScript AST 解析实际配置（语法诊断 0），核实 `design`、`docs`、`legal` 均在资源数组且三份迁移文件存在；这是配置与文件检查，不声明打包或安装通过。
- Review 与后续：完整改动相对本步基线 `812bec16` 查看；先读开发 Skill 与根入口，再沿 Builtins → 两份规范 → 定向用例核对资源迁移，最后看许可与历史引用修正。没有类型／公共接口变更，未运行类型检查、全量回归、构建、桌面或安装升级验收；这些仍由后续 PR／发布阶段承担。本次检查不代表人工代码 review 已接受。

## 2026-11-10：开发 Skill 增加语义建模与代码 review 交付

- 范围：同步 `.agents/skills/cbim-development/SKILL.md`、`.claude/skills/cbim-development/SKILL.md`、`.codex/skills/cbim-development/SKILL.md`，并更新开发者说明（历史文档：`docs/developer-skills.md`，已清理）与路线图；没有修改产品源码或实施此前架构分析中的重构候选。
- 设计理由：原流程已有架构原则，但开发步骤缺少可直接核对的业务语义与代码认知入口。本次以业务对象、权威状态、真实调用链和变化点组织开发前分析，复用已核实上下文；共性判断保留权限、事务、未知结果、重试和资源生命周期差异，以实际同类扩展检查变化传播，不将共享存储直接等同于领域边界。
- review 交付：补充完整 diff 的基准、范围、全部变更文件及职责、调用链阅读顺序和下一次修改入口；测试、功能验收与人工 review 分别陈述。保留用户已有审阅约定，不新增逐步批准，也不停止已授权连续开发。小修只核对相关边界，纯文档不触发产品测试。
- 实际验证：以 `python -X utf8` 调用 `skill-creator/scripts/quick_validate.py`，分别检查三个入口目录，均返回 `Skill is valid!`；Node 内联检查三个 `SKILL.md` 逐字节一致、UTF-8 内容及 Skill／开发者说明中的 39 个本地链接目标，全部通过；`git diff --check` 通过。人工对照只读分析、小范围缺陷修复、同类能力扩展和纯 Skill 维护四种请求核对范围及流程，不将此文案审查记作独立 Agent 行为验证。
- 阅读入口：先看[开发 Skill 第 2 节](../.claude/skills/cbim-development/SKILL.md#2-梳理业务语义与交付切片)的语义说明，再看第 3 节共性判断和第 4 节 review 交付。未运行产品单元／全量测试、类型检查、构建、桌面或发布验收；原发布接续不变，后续实际使用效果仍需由真实开发与人工 review 检验。

## 2026-11-10：发布 CI 原命令读取时序修正

- 第二轮完整 CI 第三片新增 1 项队列依赖测试失败：HTTP 已收到下一轮并不证明流式 stdout 文本已写入 canonical，报告可能跨越日志追加而拒绝给出 committed。测试改为等待真实保持文本落盘，再核同一原命令；保留变化期间拒绝的产品行为。
- 明确运行 queued-dependency-revision-pi 与 command-verification-service 两文件，21 项通过，包含四种真实依赖修订与并发变化拒绝。仅测试及发布记录变化，无源码、公共接口和类图变化，不重跑类型/架构或重建已验证候选。
- 冻结候选 f9c2892dc71dec38c9c214308257fc4fca996970 已重新 verify 并通过真实 EXE 三引擎/六项隔离；唯一草稿 439994358 四附件一致，隔离安装 42764972516 执行中。当前等待其他完整 CI 分片结束，再推送此独立修正重跑准确 head；公开仍等待完整检查与安装通过。详见[发布记录](verification/desktop-release-0.1.5-20261110.md)。

## 2026-11-10：修复主执行的证据核证占用回归

- 完整 PR CI 首轮 2505 通过、78 失败、2 原有跳过。修正旧主调度禁写测试，保留只读恢复与成员专属工具边界；主/成员 ask 审批以真实拒绝、后续独立批准验证。回执断言包含实际 nativeSessionId。
- 产品修复：人工接续、目标审阅与业务重新规划的核证在主运行占用内派生独立读占用，父先释放仍阻止后续写入。桌面预览、决定及 preflight 继续独立申请；不移动持久受理到执行锁之前，不改变原证据和失败历史。
- 30 个受影响文件、156 个不同用例最终通过；其中首批 118 通过/2 失败，分别追加 44 项和 7 项定向验证。真实 Pi 长重审触发摘要，提供器按摘要协议单独处理，不关闭原生能力。类型检查通过，架构 55 目录/600 源码、1186 文件/6107 含类型边、0 循环。命令、选择依据及原失败见[发布验证记录](verification/desktop-release-0.1.5-20261110.md)。
- 同步 main 装配与 scheduler-engine/execution 的文件头/接口注释、CONTRACT 和两份 ARCHITECTURE。新变化限制在运行占用与核证端口，原知识事务/工具授权保持；下一次类似运行内核证从 acquireReadWithin 与可信端口接入。
- 发布继续：前两轮包保留原证据但不上传，当前提交重新冻结唯一候选；新 head 的完整四片、隔离安装及公开升级仍待执行，未将本机定向通过当作发布通过。

## 2026-11-10：发布前桌面三引擎验收与协作提示修正

- 首轮 0.1.5 打包成功；发现主对话协作提示仍描述已退役默认执行者，修正为主 Agent 默认执行并同步文件头、契约与类图。仅文案，不新增状态分支。
- 新增真实 EXE 三引擎验收脚本，经公开只读 IPC 观察实际运行。6 轮会话切换/复用、Team 主写入、静态 Agent 与岗位独立模型、禁用选项和重启无重放通过；模型请求 2/1/4、页面错误 0。前两次验收断言错误和第三次 Playwright 观察连接异常保留原失败，详见[发布记录](verification/desktop-release-0.1.5-20261110.md)。
- pnpm typecheck 与 pnpm check:architecture 通过。首轮包不上传；提交本次提示和验收后重新冻结构建，完整 CI、隔离安装与公开升级继续待验。

## 2026-11-10：0.1.5 发布准备

- 用户授权完成全部需求后提交 PR、合并、发布。功能提交 a4472ecb，源码注释、契约和架构文档随功能交付；本步准备版本 0.1.5 和内置日志。
- 真实上一公开版为 0.1.4，保持其自动安装 UI，验收输入新增明确支持；候选/线上模式均检查实际旧版本与同版拒绝，未知未来旧版仍拒绝。三个发布入口与运行说明同步。
- 实际命令 pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.5-20261110/acceptance-inputs.json：21 项通过。pnpm check:brand、正式域名 pnpm build:website 通过，官网保持上一公开版。
- 本步选取 tests/desktop-acceptance-inputs.test.mjs，因改动仅影响安装前版本与流程选择；已有功能类型/架构及定向测试可复用，完整回归交给本次 PR 四片 CI。后续真实制品与安装不以单元测试替代，结果见[本次记录](verification/desktop-release-0.1.5-20261110.md)。

## 2026-11-10：Codex 第三引擎

- 完成范围：参考 Cindy 的 App Server 接法接入固定 Codex 原生进程；模型供应商、静态 Agent、岗位和主对话共用用户配置的引擎/模型菜单，Codex 锁定 OpenAI Responses。旧 Pi 配置、Claude 配置和岗位冻结规则保留。
- 关键调用链：App Server thread/turn → 宿主动态工具 → 原 Runtime 授权/证据；模型代理固定地址、模型和输出上限，复用请求账本，等待可靠结算后才执行工具。线程 ID 来自实际回执，首次成员绑定与后续恢复分开；跨引擎选择目标引擎自己的 ID/文件。本轮用量按实际请求求和，恢复不重复累计。
- 受影响验证：新增 Codex 协议、工具、生命周期、Application 和资源测试；回归配置/下拉、排队、历史选择、主新链/续接、成员领取/检查点、自动协作、Claude 装配及复制器。最终 16 文件、130 个不同用例通过；类型检查通过；架构 55 目录/600 代码与样式、0 差异，依赖 1185 文件/6101 条含类型边、0 循环。实际命令、初轮失败与定向修正见[专项记录](verification/codex-engine-20261110.md)。
- 维护交付：同步新 codex 目录与相关源码的文件头/接口注释、CONTRACT、15 份架构文档；更新配置规范、Loop/应用架构、源码导航、路线图和Codex 维护入口（历史文档：`docs/codex-engine.md`，已清理）。稳定调度与知识事务未复制进引擎。
- 未运行：全仓回归、完整桌面交互、在线供应商、完整打包、安装升级和发布。真实二进制使用本机确定性响应，不代表模型质量或业务验收；资源复制通过不代表发布制品通过。当前改动未提交，保留前两项需求工作区内容。

## 2026-11-10：Claude Code 第二引擎与 Agent 引擎/模型选择

- 完成范围：新增与 Pi 并列的 Claude Code AgentEngine，模型供应商配置增加引擎；静态 Agent 默认配置、项目岗位与主 Agent 输入栏支持来自用户启用模型的引擎/模型下拉菜单。岗位继续使用独立冻结快照，主对话切换不会覆盖成员配置。旧配置缺省 Pi，跨引擎各用原生文件并转交缺失公共上下文。
- 架构与维护：共享工具目录、指引和请求预算从 Pi 适配层提取；Claude 的 SDK 协议、工具参数及原生会话格式留在 core/brain/claude。首轮实际文件延迟核实绑定，权限与证据仍由原运行服务持有。同步相关源码注释、CONTRACT、架构类图、运行说明与配置入口；维护者修改位置见双引擎说明（历史文档：`docs/claude-code-engine.md`，已清理）。
- 实际验证：按模型配置、真实引擎/工具、主/成员装配、历史接续、岗位界面、资源导出、独立运行资源及共享 Pi 消费者选择受影响单元。分批累计 26 文件 / 198 个不同用例通过；最终工具/引擎 2 文件 / 12 项通过。pnpm typecheck、pnpm check:architecture 与 diff 格式检查通过：54 目录、593 个代码/样式文件，0 文档差异；1172 文件、6054 条含类型依赖、0 循环。命令、选取理由、失败修复与验证边界见[专项记录](verification/claude-code-engine-20261110.md)。
- 关键修复：真实调用暴露成员模型白名单、Anthropic 顶层联合 Schema、表单标签和动态加载边界问题，均已定向修正。额外验证发现 Claude 会在 SSE 终态前启动工具；现在授权前等待请求可靠结算，结算失败即停止，真实 Write 成功/失败用例分别验证延迟放行与无副作用。
- 未运行：全仓回归、完整桌面 UI、线上模型、完整打包、安装升级及发布。独立资源复制/加载通过不代表安装包验收；不据引擎 completed 声称业务验收。当前改动未提交，上一项主 Agent 默认执行的工作区改动保留。

## 2026-11-10：主 Agent 默认执行，退役内置默认执行 Agent

- 完成范围：模块创建后不再要求先登记岗位。未指定自定义负责 Agent 时，隐式由主 Agent 在原会话按本轮 read/ask/execute 执行，团队树和模块卡片不必把这个默认关系展示成独立岗位。已配置自定义岗位仍按 ownerSelection、岗位模型和证据派发。Auto 与 Team 都给主 Agent 执行能力。内置 cbim:executor 不能新建、登记或新派发；历史记录保持可读，恢复 builtin 执行快照返回 AGENT_RETIRED。
- 涉及模块：调度上下文与执行周期、岗位发现、目标计划/审阅证据、派发工具、主会话提示、模块责任界面、团队模型。删除 src/backend/scheduler-engine/context/default-executor.ts。主执行证据使用 main-execution，只引用本轮成功的原生业务工具回执。
- 受影响单元：主运行权限与占用、模块责任发现与选择、岗位派发、目标证据、知识工具输出、团队模型和统一工具权限。选择这些文件是因为行为从“缺省派给 cbim:executor / Team 主会话不执行”改成“未配置则主会话执行”。
- 实际验证：首轮 pnpm exec vitest run 覆盖 37 个受影响测试文件，247 通过、4 失败。失败来自新建自定义岗位的摘要/能力不符合知识校验，以及 Team 主会话仍被断言为不能执行。修正夹具和断言后，定向复跑 agent-history、module-governance-tools-pi、unified-tool-policy、knowledge-source-core、goal-tools、workspace-member-view、command-verification-core：66 通过、1 失败。该失败是测试函数内 summary 遮蔽了导入的摘要常量。改名后 actual executor 用例 1 通过、同文件其余 4 项跳过。pnpm typecheck 通过。pnpm check:architecture 通过：53 目录、585 个代码/样式文件，0 份架构差异；1158 文件、5984 条含类型依赖、0 循环。
- 未运行：全量 pnpm test、桌面冒烟、打包和安装升级。单元通过不代表合并或发布通过。
- 注释与架构：受影响 CONTRACT 与 scripts/source-architecture.mjs 的目录定位已按当前规则更新，并重新生成 11 份 ARCHITECTURE.md。当前概念说明同步到任务循环、派发、成员执行、模块负责人和产品定位；历史验证报告保留当时结论。

## 2026-11-10：0.1.4 合并、公开、真实自动升级与官网收尾

- 收尾补充边界：Forge 会复制整份 design/docs，候选内开发记录仍为冻结快照；前述“构建输入一致”仅适用于运行代码/规范、依赖、品牌、版本日志及构建配置，不代表全部维护副本字节相同。实际 Builtins 读取的 22 项与当前目录完全一致，证据 desktop-0.1.4-runtime-catalog.json；未修改公开附件。

- PR #25 在准确 head 5c378437 的完整四片 CI 42697531710 通过后正常合并为 d96244bd，2528 通过、0 失败、2 项原有历史 EXE 前置缺失跳过。首轮 12 失败、独立测试修正和中间取消 run 均保留；冻结候选 6ba2d64f 的产品/依赖/构建输入与合并结果一致。
- 显式未签名构建、发布前重新核验、真实 EXE 六项隔离及隔离 runner 全新安装/0.1.3 覆盖升级通过。Release 439619815 于 2026-11-09T21:07:47Z 公开，标签 desktop-v0.1.4 指向冻结源码；四附件匿名大小/摘要一致，旧 Python latest 327801733/v1.0.2 不变。
- 线上 run 42699632244 通过真实 0.1.3 UI 下载、安装前普通退出取消、独立重开再下载及自动重启至 0.1.4。原工作区/模型/completed task-run/localStorage/标记保留，无重放；模型请求一次，页面错误零，最终更新状态 current。未操作用户真实安装。
- 官网 release.json、首页、下载页/FAQ、README 依据公开回执更新；品牌和正式域名构建通过，独立无头浏览器 14 个深浅色/手机/桌面/离线场景通过，错误零。旧报告已归档，本次 test-results/branding-website/website-report.json 保留原结果；Search Console、canonical/robots/sitemap 保持，没有重复申请收录。
- 发布恢复/证据说明同步三宿主入口，4 文件 × 3 入口一致；本次仅测试适配、官网和外部维护资料变化，无 src 变化，功能注释/契约/类图随原独立提交维护，不因文档重跑本机产品测试或打包。
- 官网/收尾资料经 develop → master PR 完整检查和正常合并、既有 Pages 部署，再核实匿名六文件与本地/远端双分支；最终 PR/部署/身份回执集中于 PR #25。详见[发布验收](verification/desktop-release-0.1.4-20261110.md)。未签名及原反馈现场未复现异常保留限制，未宣称所有用户已升级。

## 2026-11-10：发布 CI 的旧任务真人说明兼容断言

- 首轮完整四片最终为 364 文件/2530 项：2516 通过、12 失败、2 原有历史 EXE 跳过。第四片最后一项旧断言仍要求不存在的真人标识触发 PERSON_NOT_FOUND，与用户要求退役花名册冲突；改为确认该字段只保留历史说明，知识版本不变、不生成 people.json，正式岗位派发拒绝仍由相邻用例验证。
- `pnpm exec vitest run tests/team-workflow.test.ts --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.4-team-workflow.json`：3 项通过。全部已发现失败对应的定向测试累计 28 通过、2 原有历史 EXE 跳过；无产品代码/构建输入变化。
- 首轮完整报告保存在 `test-results/desktop-0.1.4-ci-initial-42694782113/`，不覆盖原失败。中间 head f7ed56fe 的 run 42697185690 由最终推送触发的同 PR 完整检查替代，不能作为合并证据；新 head 的四片必须完整通过。

## 2026-11-10：发布 CI 的对象预览版本断言对齐

- 统一工具权限测试的 v2 清单遗漏本轮已升级的 cbim_object_preview；仅补齐明确版本预期，保留逐调用知识授权、身份/版本拒绝、真实 Pi 路由和回执检查。
- `pnpm exec vitest run tests/unified-tool-policy.test.ts --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.4-tool-policy.json`：6 项通过。此次只改测试断言和外部记录，无 src、接口或导入变化，不重复类型/架构检查。
- 候选安装原始报告已核对：真实 0.1.3 → 0.1.4、全新安装、isPackaged=true、NotSigned，六项数据保留、模型请求一次、页面错误零。来源和责任消费者修正分别独立提交；等待首轮其余片结束并以最终 head 重跑完整 CI，候选保持冻结源码身份。

## 2026-11-10：发布 CI 的独立派工缺口消费者对齐

- 责任主工具与 Application 的旧断言只允许 OWNER_UNASSIGNED，与本轮一次列出缺口的行为不符；现在同时要求 OWNER_MODEL_UNRESOLVED，保留无能力正文/凭据泄露、无模型执行、责任绑定及独立岗位配置的原断言。
- 依据失败用例及同一 discover 消费者，分别执行 `pnpm exec vitest run tests/module-ownership-tools.test.ts --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.4-owner-tools.json`（9 通过）与 `pnpm exec vitest run tests/owner-execution-application.test.ts --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.4-owner-discovery-application.json`（2 通过）。没有产品、类型接口或依赖变化，不重跑已通过的检查。
- 候选安装 run 42695642991 已成功，报告待下载核对；完整 CI 第一片还发现 cbim_object_preview v2 的旧版本断言，下一步单独修正并重新检查 PR。尚未合并或公开。

## 2026-11-10：发布 CI 的知识来源夹具适配

- PR #25 首轮完整 CI 第三片暴露两个来源生命周期用例仍向当前架构接口提交已退役的 peopleUpserts/maintenance。当前夹具改用无真人维护字段的真实公开契约；两个固定历史 EXE 入口显式保留旧输入，不按失败自动重放或降级。
- 架构包替换用例直接核实新模块没有 maintenance，保留同字节目标、真实兄弟变化、来源换代、明确采纳和回执幂等断言，移除不再有差异的清理事务。
- 按共享夹具的实际消费者选择 application/fault/process 与 legacy：`pnpm exec vitest run tests/knowledge-source-lifecycle-application.test.ts tests/knowledge-source-lifecycle-fault.test.ts tests/knowledge-source-lifecycle-process.test.ts tests/owner-execution-legacy.test.ts --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.4-source-fixtures.json`，8 项通过，2 项因真实历史 EXE 缺失维持原有跳过；类型检查通过。
- 仅测试与外部开发记录变化，无产品/依赖/内置日志/构建变化；保留冻结 6ba2d64f 的已验证候选。完整 CI 原失败保留，下一步修正另一个工具消费者旧断言后重新运行 PR 完整检查；没有合并或公开。

## 2026-11-10：0.1.4 发布准备及自动安装旧版验收

- 用户授权合并、发布本轮四个修复，沿用未签名发行；上一桌面版为 0.1.3，旧 Python latest 保持 v1.0.2。版本与内置日志更新为 0.1.4，官网在公开前仍保持 0.1.3。
- 发布验收按明确旧版选择 0.1.1/0.1.2 两步或 0.1.3 自动安装，独立验证普通退出取消与真实线上重启；未知旧版仍拒绝。同步工作流和三宿主发布资料。
- 19 项受影响输入测试、脚本语法、类型、架构/依赖（1159 文件、6006 依赖、0 环）、品牌和官网构建通过。仅 scripts/配置/文档变化，无 src 类图变更。命令与后续证据见[发布记录](verification/desktop-release-0.1.4-20261110.md)。
- 冻结后创建 develop → master PR 跑完整 CI，构建唯一候选；安装、公开与线上升级仍待实际回执。

## 2026-11-10：实例恢复指引与反馈/提问现状核实

- Workspace.assert 保留原身份与运行状态门禁，分别说明工程选错和实例变化，给出当前 instanceId、cbim_workspace_identity 及重新读取/预览指引；未知提交先核原回执。源码注释及 main/workspace CONTRACT/ARCHITECTURE 同步。
- 定向 `pnpm exec vitest run tests/workspace.test.ts tests/github-feedback-status.test.ts tests/github-feedback-lifecycle-pi.test.ts tests/question-tools.test.ts tests/question-tool-contract-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/instance-feedback-question-20261110.json`：5 文件/39 项通过，覆盖真实重开旧身份拒绝、空项目反馈连接后新轮装配、选择卡答案/取消/坏回包/停止。
- 原现场反馈三工具缺失、fetch failed 和实例重启原因尚无版本/日志，未复现，不宣称已修复；当前主会话的只读反馈诊断和授权后的双工具行为通过。没有创建线上测试反馈。
- 架构同步及 diff 检查通过；最后一步没有类型或依赖变化，不重复静态检查。未跑全量、完整桌面、打包/发布。参见[本轮总记录](verification/empty-project-feedback-20261110.md)。四项保持独立提交到 develop，公开版本不变。

## 2026-11-10：责任重复绑定提示与独立派工缺口

- 预览与事务共用责任预期诊断：同岗位无需重设、已有记录需 inspect、非空旧版本是真实冲突，不再统一提示原样重试。前端将新增 OWNERSHIP_ALREADY_EXISTS 归为明确未受理；原回执优先和并发检查保留。
- discover 独立检查模块/Workflow、岗位责任/来源、能力和模型，缺少岗位时说明桌面“团队架构 → 项目岗位 → 登记项目岗位”入口及未核实项。无缺口才调用原完整 resolve 产生 selection，不通过诊断放宽派发。
- 选择责任 Core/服务/前端状态及岗位执行 Core/服务：`pnpm exec vitest run tests/module-ownership-service.test.ts tests/module-ownership-core.test.ts tests/module-ownership-view.test.ts tests/owner-execution-service.test.ts tests/owner-execution-core.test.ts --reporter=default --reporter=json --outputFile=test-results/ownership-discovery-20261110.json`，首轮 53 项中 51 通过。新增夹具的空解除与同岗位变更先被输入 Schema 拒绝，能力元数据变化也不等于已采纳执行原则变化；修正夹具为合法换岗请求与真实原则正文变化，未放宽产品校验。
- 两失败文件复测报告 `test-results/ownership-discovery-20261110-fixed.json` 中执行服务全部通过；最终仅复跑责任诊断失败用例：`pnpm exec vitest run tests/module-ownership-service.test.ts -t 已有同岗位 --reporter=default --reporter=json --outputFile=test-results/ownership-diagnostics-20261110-final.json` 通过，其余 8 项按选择器未重跑。累计 5 文件/53 项通过。
- 类型与架构检查通过，1159 文件、6006 依赖、0 环。四处注释/CONTRACT/ARCHITECTURE 同步；未跑全量、打包或发布。接续：实例失效提示及反馈/选择卡的当前实现核实。

## 2026-11-10：空项目对象 Schema 与正文模板诊断

- cbim_object_preview 升为 v2，data 以 kind 判别；实际字段与公开 Schema 共用 objectDataSchemas。模块 name 来自 slug，中文名明确写正文 H1；Agent 不再公开 purpose。
- 新增纯 module-outline 契约，规则诊断与桌面编辑复用精确章节/模板，有源模板包含直属内容虚拟节点。规范示例明确无序号的标题原文。模板须按事实填写，不自动编造业务内容。
- 按字段协议、规则、桌面消费者与真实工具发现选择：`pnpm exec vitest run tests/object-crud.test.ts tests/rules.test.ts tests/architecture-service.test.ts tests/knowledge-tool-contracts.test.ts tests/knowledge-contract-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/object-schema-template-20261110.json`，5 文件/18 项通过；包含公开 JSON Schema 与实际入参一致、空/有源模板复验、预览无写入、真实 Pi 提交和取消。
- `pnpm typecheck`、`pnpm check:architecture` 通过（1159 文件、6006 依赖、0 环），源码注释及五处 CONTRACT/ARCHITECTURE 同步。未跑全量、打包或发布。接续：负责人绑定提示、一次性缺口与工具发现。

## 2026-11-10：废弃真人花名册与独立维护门禁

- 新项目不生成花名册，对象/桌面不再登记真人，移除人员查询工具与内置 Schema；旧文件和任务字段仅兼容历史，不阻断岗位负责人派发。岗位、模型、权限、Workflow 及知识版本保护保持。
- 清理运行指引、资源导入和 Python 维护脚本的旧要求，源码注释与受影响 CONTRACT/ARCHITECTURE 已同步。
- 受影响 TypeScript 16 文件/97 项、Python 26 项通过；类型、架构/依赖无环检查通过。原 4 项失败、工具夹具中止和 Python 导入错误及修正均记入[验证记录](verification/retired-human-roster-20261110.md)。未跑全仓、完整桌面或发布验收，未改变公开 0.1.3。
- 本项独立提交；继续处理本轮空项目反馈中的 Schema、正文模板、责任提示、派工缺口和工具发现。

## 2026-11-09：PR #23 合并，0.1.3 公开与真实线上升级完成

- 初轮 CI 最终 19 项失败、2 项跳过，保留完整证据；Team 主轮读占用与知识契约夹具修复后，冻结 `11c2a76` 完整四片 364 文件／2521 项，2519 通过、0 失败、2 项原有真实历史 EXE 跳过。PR #23 正常合并为 `952dff7`，11 个提交完整保留。
- 正式候选 `unsigned-20261109-231430-791acb01` 构建／重校验和六项真实 EXE 隔离通过，草稿候选安装 `42643415710` 全新安装及真实上一版升级通过。唯一 Release `439290012`／`desktop-v0.1.3` 于 2026-11-09T15:28:16Z 公开，标签指向准确冻结源码；四附件匿名摘要一致，旧 Python latest 保持 v1.0.2。
- 线上 run `42645170393` 通过真实 0.1.2 发现、UI 下载、普通退出不安装、重新下载并确认重启到 0.1.3；工作区、模型、已完成对话、本地标记保留，无重放，页面错误 0。未安装或重启真实用户客户端。
- 官网快照取自公开回执；首页、下载日志／FAQ、README、发布说明及三宿主 runbook 同步新旧版交互。品牌、官网构建与 14 个界面／离线场景通过，既有证据归档保留。官网收尾走 develop → master PR 和既有 Pages 部署；最终部署、匿名六文件及双分支回执回填原 PR，避免为自身 SHA 重复提交。
- [完整发布记录](verification/desktop-release-0.1.3-20261109.md) 保存源码、制品、所有 CI／安装／线上 run、摘要与已知限制。下一版先适配 0.1.3 的自动安装旧版路径；本机只做受影响检查，产品全量回归由 PR 自动化承担。

## 2026-11-09：PR #23 完整 CI 发现的恢复占用冲突

- 初次完整 run `42639651567` 的前三片发现知识工具旧版本断言，以及 Team 主轮执行占用与人工／成员恢复短读占用冲突；后者也使影响核实后的重规划证明变化。原日志保留在 `test-results/desktop-0.1.3-pr23-job1.log`、`job2.log`、`job3.log` 对应文件；第 4 片尚未完成，不将初轮写成通过。
- 主轮按真实协作模式领取：Team 使用业务读占用，Auto ask／execute 继续独占；恢复及成员回注优先读取原周期冻结模式，旧记录缺省 Team。同步 execution.ts 注释、main CONTRACT 与 ARCHITECTURE。知识契约夹具对项目根引入的模块查询 v2 保持明确版本断言。
- 类型、架构／依赖检查通过；知识契约 1 文件／3 项通过，恢复与 Auto 直接执行定向 6 文件／28 项通过，保留文件变化拒绝、预算拒绝、未知结果不重放和 Auto 写审批并发拒绝。
- 首个 0.1.3 候选 `unsigned-20261109-230433-379e5844`（源码 `6dd5547`）已构建、校验及 6 项真实 EXE 隔离验证通过，但不包含本次产品修复，保留为废弃候选，不上传或公开。下一步冻结修复提交、重新构建，并让 PR #23 对新 head 完整检查。

## 2026-11-09：0.1.3 发布准备与真实上一版验收参数

- 用户授权 PR #23 全部 CI 通过后合入 master 并发布新版，沿用明确选择的未签名发行。当前公开桌面版 0.1.2，旧 Python latest 为 `v1.0.2`／Release `327801733`；本版纳入 #14、#17–#22 与开发／发布流程更新。
- 版本更新为 0.1.3，新增内置日志，区分旧 0.1.2 的下载后显式重启与新版下载后自动安装。验收工作流增加必填 previous_version，旧包、标记、重开与报告均使用相同值，输入层拒绝缺失、降级和未支持的旧版交互。
- 定向执行 `pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.3-inputs.json`：1 文件／16 项通过；脚本语法、工作流输入、`git diff --check` 通过。`pnpm check:dependencies`：1158 文件、6004 条依赖、0 环。同步三宿主发布说明和故障指引，没有修改 src，不需更新源码类图。
- PR #23 的四片完整 CI 正在运行；本机不重复执行全量测试。候选构建、隔离安装、公开、真实 0.1.2 → 0.1.3 在线升级和官网仍待后续回执，见[本版记录](verification/desktop-release-0.1.3-20261109.md)。

## 2026-11-09：日常开发改为受影响单元验证

- 用户指出每次开发跑全量测试影响效率。本步将日常验收改为按 diff、行为变化和真实调用方选择受影响单元／契约，相关检查通过后直接记录并提交；只因新变化、失败或新增影响证据补跑。
- 静态检查按类型、依赖或结构变化选择，取消每次源码修改固定跑整套检查及广泛重构必跑全量的要求。每个 Issue 独立开发、测试、提交，以及源码注释和受影响类图同步规则继续保留。
- 全量回归集中在后续面向 `master` 的 PR 自动化中运行；完整桌面、打包、安装升级验收留给集成／发布阶段。只读核实了现有 `validate.yml` 的 master PR 触发和完整四片测试，本次未修改或启动 CI／发布流程。
- 同步 `AGENTS.md`、`CLAUDE.md`、README、开发入口说明，以及 `cbim-development`、`architecture-maintenance`、`architecture-evolution` 的三宿主副本。历史测试记录保留，但不再充当下一步开发的必跑清单。
- 本步仅涉及文档和 Skill，未运行产品测试、类型检查或构建。通过 PowerShell 内联 Node 检查三项 Skill 共九份副本逐字节一致、frontmatter 名称、新增本地链接／规则锚点和旧的固定检查要求清理；`git -c core.safecrlf=false diff --check` 通过。后续产品全量验证仍由合并／发布阶段提供，不将本次文档检查视为产品验收。

## 2026-11-09：Issue #22 流式对话与内联调用

- 移除独立进展框和底部成员列表；文字/工具/系统交接按真实关联排列，成功派发旁显示原任务状态，成员过程按需读取，任务详情与核实入口保留。
- 真实桌面测试发现 HTTP 工具门禁与 stdout 文字可交错落盘；Pi 仅保留公开回复内的原调用 ID，投影据此恢复本段因果顺序，不改原日志或权限。纯派发 DTO 从含后端哈希的核实模块分离。
- 类型/架构、20 文件 / 138 项通过；8 组真实 React/模拟 IPC 界面与 5 组长对话输入检查通过。最终便携构建 `20261109-223513` 的真实 Pi 派发、读取证据、成员回传、详情导航、续聊/排队独立目标及完整重启通过；本地 SSE 13 次请求，页面与传输错误 0。
- 原失败与修正均保留；迁移旧进展/手工派发测试入口。同步注释、五处 CONTRACT、六份 ARCHITECTURE 与成员执行说明。[验证和维护交接](verification/issue22-inline-conversation-20261109.md)。本轮 Issue 逐项独立提交至 develop，未合并 master、发布新版或操作真实用户安装。

## 2026-11-09：Issue #21 单句反馈与自愿补充

- BUG/需求仅需类型和简述，缺失主栏目显示“用户未提供”；同步两个内置流程、主 Agent、菜单和工具描述，不再逐项追问。完整旧正文和原授权/防重/核实机制保持。
- 类型/架构、8 文件 / 67 项通过；真实 Pi 单句提交、只读拒绝、缺工具诊断及重开防重通过。便携构建 `20261109-215503` 五组真实桌面流程通过，两个包内 Skill、两条单句输入、静默和重载保留均验证；本地 SSE 8 次请求、模拟 Issue 2 条，线上 0 条。
- 桌面夹具的四次失败及修正保留，未修改产品保护。同步六处源码注释/CONTRACT/ARCHITECTURE、产品 Skill 与使用说明。[验证与维护交接](verification/issue21-optional-feedback-20261109.md)。本项独立提交回填后继续新增 #22；未发布或操作正式用户实例。

## 2026-11-09：Issue #20 长对话输入性能

- 将逐键草稿与未变历史轮次、Markdown 和计量分离，完整保留图/模型恢复依赖与实时输出；没有延迟草稿保存或裁剪历史。
- 100 轮 / 400 条 Markdown、4 倍 CPU 降速的同条件 6 键对照，输入到下一帧中位数从 4052.7 ms 降至最终复验 142.1 ms，历史三类计算均为 0。首轮 26 键基线超时及初次复验保留，不以小样本保证所有设备时延。
- 类型/架构通过，9 文件 / 58 项测试、5 组输入/流式界面及 8 组任务进展通过。便携构建 `20261109-214416` 的真实 Pi 队列插入、模型/权限、草稿和重开无重放通过；本地 SSE 2 次请求，页面错误 0。
- 同步源码注释及两处 CONTRACT/ARCHITECTURE。[验证与维护交接](verification/issue20-input-performance-20261109.md)。本项独立提交并回填后继续 #21；未发布或操作真实安装版。

## 2026-11-09：Issue #19 统一更新入口与用户发起的自动安装

- 合并版本/日志菜单，显示检查时间、新版高亮和用户栏绿点。正式版每分钟静默检查；点击下载后由同一后端流程完成校验、可见提示、业务排空和自动安装重启，失败明确重试，普通退出先取消。
- 类型/架构通过，8 文件 / 52 项通过；真实 Application 的关闭与重开保留项目和用户标记。21 组真实 React/模拟 IPC 界面检查通过；便携构建 `20261109-212347` 的三组真实 Electron/IPC 检查通过，页面错误均为 0。
- 同步源码注释、6 份架构文档及 5 份目录契约，README/发布指南和三宿主发布 Skill 区分公开旧版与尚未发行的新流程。安装脚本兼容两个日志入口，真实 NSIS 跨版本升级留待下一次正式发行的隔离 runner 验收，未操作当前用户安装。
- [验证、初次类型错误与维护交接](verification/issue19-update-flow-20261109.md)。本项独立提交闭环后继续新收到的 #20 输入延迟与 #21 反馈字段简化。

## 2026-11-09：Issue #18 图内操作与自定义组织树

- 业务页移除顶部重复入口，项目根保留新建和责任记录图标；四个展开/折叠/字号图标放入图内右上角。团队树只显示项目定义，节点左对齐逐层缩进，内置角色的完整模型、Skill 继承和岗位选择保持。
- 类型/架构通过，5 文件 / 33 项通过。便携构建 `20261109-210117` 的六组真实桌面检查通过，页面错误和模型请求为 0；含键盘、字号边界、深浅色、320px、重载与无知识/运行写入。
- 同一构建复跑 #14 的三组和 #17 的五组桌面流程通过；仍保持未知保存只查询、不重放。首个行为命令的无效文件名不计作执行，实际文件与数量见[验证与维护交接](verification/issue18-graph-controls-20261109.md)。
- 同步相关源码注释及 components、team、workspace 三处 CONTRACT/ARCHITECTURE。独立提交本 Issue 后继续新收到的 #19；未发布、安装或重启真实用户客户端。

## 2026-11-09：Issue #17 模块卡片一级负责人选择与图标操作

- 负责人在卡片一级下拉中选择即保存，包含自定义与内置执行 Agent；无需额外说明或二级页面。新增/编辑/删除使用带可访问名称的图标，保留原预览与删除确认。
- 新岗位使用已选默认模型，已有岗位不改采纳；复用原岗位/责任服务和共享命令池，部分成功保留、未知只查询，切换视图不继续后续写入。
- 类型/架构通过，7 文件 / 53 项通过；便携构建 `20261109-205205` 的真实桌面五组检查通过，页面错误和模型请求为 0，覆盖回包丢失、重载、取消及 320px 面板。测试脚本前三次失败原因及原证据保留，未放宽产品保护。
- 注释、4 份架构文档及三个目录契约同步。[验证与维护交接](verification/issue17-inline-owner-20261109.md)。下一项为 #18；未发布新版。

## 2026-11-09：Issue #14 Auto 直接工作与始终存在的项目根

- Auto 可直接实现、验证，项目根独立于正式模块清单始终可查；治理按实际开发成果渐进开展。Team 和正式委派仍核负责人、Workflow、目标与证据。
- 主轮按实际权限取得占用；知识提交不再迫使 Auto 创建团队目标，已有正式计划与未知副作用继续走原收尾门禁。
- 类型/架构通过；18 文件 / 142 项通过，真实便携 EXE `20261109-203222` 的根显示、创建子模块、重载三组检查通过，页面错误 0。
- 已同步源码注释、11 份架构文档、受影响 CONTRACT 和三份执行概念说明。实际模型回复为本地确定性 SSE，不宣称在线模型自主质量或已发布新版。
- [验证与维护交接](verification/issue14-direct-main-20261109.md)。下一项按顺序独立处理 #17，再处理 #18。

本文件保存已实施步骤的事实与证据，最新记录在前。当前开发清单与进度统一从 [GitHub Issues](https://github.com/nan023062/cbim/issues) 获取；历史记录中的“下一步”和 roadmap 维护说明仅代表当时交接，不自动成为当前任务。已清理旧文档的原文可用 `git show 812bec16:<原仓库相对路径>` 查阅，不从历史记录推断当前能力，也不把尚未实施的计划写成成果。

每条记录包含日期、对应阶段/步骤、完成范围、涉及模块、实际验证及证据、剩余限制与交接点。无需记录每次工具调用；提交号和构建号仅在确实存在时填写。引用旧报告的记录会注明历史证据，不能当作本步重新测试。

## 2026-11-09：发布 Skill 与故障恢复指引

- 新增项目级 `cbim-release`，包含主入口及发布步骤、故障恢复、证据清单三份资料；同步 `.agents/skills/`、`.claude/skills/`、`.codex/skills/`。按本次实际流程覆盖签名／未签名、冻结候选、完整 CI、草稿恢复、真实安装与线上升级、官网和 master/develop 收尾。
- 核实并明确当前工具限制：一体 publish 没有暂停验收或 resume；安装脚本固定旧版 0.1.1、0.x 与 NotSigned；官网冒烟固定输出目录。要求下次发行按真实旧版／模式先适配验证，不把已有证据冒充新版本通过。保留原 CI、权限、回包丢失、部分安装等失败的诊断与不重复执行边界。
- 三入口格式检查 3/3 通过；各 4 文件共 12 文件逐字节一致；20 个 Markdown 文件、233 个本地引用及代码块检查通过，17 组只读决策场景已走查，`git diff --check` 通过。详见[本次验证](verification/cbim-release-skill-20261109.md)；0.1.2 发布报告仅作为历史依据，没有重建、安装、发布、派发 Actions 或部署官网。
- 同步 AGENTS、CLAUDE、README、开发者导航、发布指南和 roadmap；无产品源码变更，源码注释与类图不受影响。本次没有新增发布 helper，也没有扩大发布授权或将 Skill 加入产品内置清单。未来签名迁移仍须真实证书和新版本验收。

## 2026-11-09：0.1.2 公开发行及真实线上升级闭环

- [desktop-v0.1.2](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.2) 已公开，冻结源码／标签 `5ebe82a`，发布 ID `438932418`。用户明确选择未签名发行；四附件摘要核对通过，旧 Python latest 保持，未替换旧附件或移动旧标签。
- [PR #15](https://github.com/nan023062/cbim/pull/15) 完整检查头 `89dfdf0` 经 [Windows CI](https://github.com/nan023062/cbim/actions/runs/42601920926) 验证后合并为 `c9bb679`：358 文件、2472 项，2470 通过、2 项原有历史 EXE 跳过。缓存硬链接问题由 CI 复制导入修复，产品保护及原断言保持。
- 候选全新安装、0.1.1 升级、当前打包 EXE 六项隔离场景通过；[公开通道验收](https://github.com/nan023062/cbim/actions/runs/42605748518) 实测自动发现、人工下载、普通退出不安装、显式重启升级及原数据保留。模型请求 1 次，无重放，页面错误 0；使用独立 runner，未触动真实用户安装。
- README、官网版本快照、发布指南和 roadmap 已同步，具体制品摘要、失败原因与限制见[发布验收记录](verification/desktop-release-0.1.2-20261109.md)。本轮没有修改产品源码，注释和目录类图无差异。未来签名使用更高版本，真实证书迁移另行验收；更新通道可用不表示每个用户已收到或安装。
- 官网品牌摘要、构建及 320／390／1280 px 深浅色、独立离线两页共 14 场景通过；页面错误 0，真实下载地址与摘要匹配。首页、下载日志、FAQ 和分支说明同步更新；公开部署由本次记录 PR 合入 master 后触发，结果以 Actions 与匿名页面回执为准。

## 2026-11-09：0.1.2 候选安装验收与云端运行程序诊断

- 源码冻结在 `5ebe82a`，显式未签名构建及制品核验通过；安装包 SHA-256 为 `ae0b18cad81114e1dc9c8b03644bbec940a537699829ecb4bcb923d75548f675`。唯一草稿 Release `438932418` 的四个附件已核对大小与摘要，尚未公开，未改动旧 Release。
- 为避免安装验收影响正在运行的用户客户端，新增隔离 Windows runner 验收。首次缺少草稿读取权限、随后 PowerShell 版本混用均已保留失败记录并修正测试环境；最终 [42594569712](https://github.com/nan023062/cbim/actions/runs/42594569712) 验证全新安装、真实 0.1.1 升级、六项数据保留、唯一一次确定性模型请求及 `NotSigned` 通过，页面错误为零。
- 当前候选真实打包 EXE 六项隔离执行场景通过，包含文件、禁网、超时、取消、非零退出和输出限制；全部自有资源回收，报告 `test-results/desktop-0.1.2-isolation-packaged.json`。
- 全仓 [42594576718](https://github.com/nan023062/cbim/actions/runs/42594576718) 的终端超时与隔离运行程序校验失败均保留；相同两项本机通过。独立全仓 [42597751602](https://github.com/nan023062/cbim/actions/runs/42597751602) 中终端原样通过，但隔离程序仍返回 `RUNTIME`，故不能判定偶发。对失败测试补充真实文件类型、大小和硬链接数诊断，并增加独立名称的手动诊断入口；PR 仍要求完整四片，未修改产品保护或原断言。本机带诊断两项通过。
- 首次全仓的失败重跑请求停留在 GitHub 尚未排入队列状态，取消及强制取消均返回 409；没有把请求标为已取消，也没有继续反复重试。发布、PR 合并和线上更新验收仍待完整检查通过。
- 独立诊断 [42599879043](https://github.com/nan023062/cbim/actions/runs/42599879043) 已确认：缓存恢复后 Electron 的 `nlink=2`（测试前后均相同），文件类型及 213976576 字节大小正常；本机和打包 EXE 的 `nlink=1`。原因是 pnpm 默认将缓存安装产物硬链接回项目；CI 改用 `--package-import-method=copy` 并预检可执行器和数据文件的单链接身份，产品拒绝硬链接的保护不变。诊断报告及日志保留于 `test-results/desktop-0.1.2-runtime-diagnostic/` 与同名 `.log`；等待更改后的完整 CI 验证。
- 复制导入后的同缓存诊断 `42600508914` 核实 Electron 及数据文件均为单链接，原两项测试通过；全仓 `42600457181` 的隔离执行和其余三组通过，但终端测试再次在十秒时仍为 running。该用例检验真实输出、退出码及会话隔离，没有产品启动时限要求；补充十秒状态和真实结束耗时证据，将进程等待设为有界三十秒，仍要求实际退出 0、输出与隔离断言全部成立，失败时仍回收自有进程，不重试命令。新完整检查结果待确认，未将该修改先记为通过。
- 最终全仓 `42601920926` 四片通过：358 文件、2472 项，2470 通过、2 项原有跳过；终端实际 2300 ms 正常退出。PR #15 合并为 `c9bb679` 后，按冻结源码 `5ebe82a` 推送唯一标签并公开 Release `438932418`。两次公开请求返回 404 后核实草稿仍私有，根因为 CLI 凭据缺少 workflow scope；核实同一账号既有 Git 授权具备权限后仅在单次进程复用，最终附件、标签、匿名更新清单和旧 latest 核验通过，没有重建 Release 或改写附件。
- 线上升级首轮 `42604954985` 已真实自动发现 0.1.2，模型请求 1、页面错误 0；脚本误把“软件更新”标题当作 region 名称，尚未点击下载即超时。对照真实 0.1.1 与当前组件后改为定位“版本与更新”dialog 内的下载按钮，并补充失败状态／截图；未修改产品或公开制品。原失败 artifact 保留，下载及安装继续在新独立 runner 验收。

## 2026-11-09：0.1.2 未签名发行入口与发布准备

- 用户授权发布最新版并投放现有更新通道，候选版本升至 0.1.2，补齐 #9、#11、#10、#12、品牌和 Windows 隔离启动修复的版本说明；#14 未纳入本轮发布。
- 类型、架构检查通过；更新与签名发布相关 5 个文件 55/55 通过。此时未修改产品源码；原完整分支 CI 和真实打包 EXE 检查作为已有证据引用，没有重复记作本轮测试。
- 正式构建入口最初返回 `SIGNING_NOT_CONFIGURED`：本机构建账号无代码签名证书，配置为空，GitHub 未配置签名 Secrets／Variables；SignTool 已安装。用户随后明确选择“先发布未签名版”，日后通过更高版本切换签名。
- 在构建、校验与发布命令新增显式 `--unsigned`，仍以签名为默认，不继承残留未签名环境选择、不自动降级。未签名回执和内置元数据明确标识模式，禁止冒充签名或混用签名候选；保留文件清单、资源摘要、SHA-256／SHA-512、草稿和远端附件核对。运行时、应用标识、用户数据目录和更新交互均未修改。
- 变更后再次通过类型与架构检查（1136 文件、5936 依赖、0 环）；7 个相关文件 76/76 通过，覆盖签名原规则、显式未签名发行、混用拒绝和制品篡改。源码均在 `src/` 之外，架构文档无差异；同步发布与签名指南。
- 尚未创建 0.1.2 安装包、标签或公开 Release；未向用户更新通道投放，README 与官网继续指向实际公开的 0.1.1。事实、证据和限制见 [发布准备记录](verification/desktop-release-0.1.2-20261109.md)，实时接续见 roadmap。

## 2026-11-09：完整分支集成中的 Windows LPAC 标准流兼容

- 云端 `42581681800` 第一片 622/624 通过、1 失败、1 原有跳过；第二片 686/687 通过、1 失败；第三／四片因 Electron 官方下载 HTTP 504 未开始测试。详细回包确认 Electron 在 LPAC 内额外读写 NUL 被拒绝，启动以 `2147483651` 退出；原始日志保留于 `test-results/pr-ci-a6858e9-scope.log`，不是任务或脚本业务失败。
- `isolated-node.ts` 仅为当前宿主的同一 Electron 二进制添加 `--no-stdio-init`，使用 Win32 启动时已经明确提供的只读输入与输出管道；普通 Node 不加此参数，ACL、capability、Job 限制及未知结果保护不变。同步文件头、关键原因注释及 platform 的 CONTRACT／ARCHITECTURE。
- 后代回收夹具改为继承标准流，避免额外依赖系统 NUL 的可写权限；Electron 后代显式使用对应启动参数。保留 detached 后代、真实存活 PID、超时／取消／宿主崩溃收束与无重放断言，正常退出场景额外核实实际创建至少两个进程；没有新增跳过。打包 EXE 冒烟沿用相同前置条件。
- CI 对锁定依赖安装最多重试三次，持续失败仍中止；测试断言和执行不自动重试。YAML 与 PowerShell 语法检查通过，类型、架构和 14 项依赖／分层测试通过（1136 文件、5936 依赖、0 环）。Node 22.19.0 下 9 个相关文件 42/42 通过，覆盖实际 Electron/Pi 隔离写入、后代超时／取消／宿主崩溃和可靠记录清理（`pr-isolation-stdio-final.json`）。打包验证、最终全仓及合并结果在 [PR #13](https://github.com/nan023062/cbim/pull/13) 集中回填。
- 新发现的 #14 涉及产品职责边界，保留为独立任务；本次仅处理已确认完整分支的合并及其检查暴露的问题。

## 2026-11-09：完整开发分支集成与 Windows PR 验收入口

- 用户确认全部 81 个待合并提交的范围，包含 77 个历史开发提交及 #9、#11、#10、#12 四项独立修复。`a438dd0` 无冲突合入 master 的四条历史记录；合并后的产品树与 `8864583` 完全相同，官网、品牌和 Search Console 文件与 master 一致。另一 Copilot 分支不在本次范围。
- 补齐 `.github/workflows/validate.yml`：master 目标 PR 与手动入口使用锁定依赖、Node 22.19.0 和 Windows，执行类型、架构／依赖、品牌、官网构建及全部 Vitest 测试。四个独立 runner 分片，每片内部保持原串行配置；失败不取消其他分片，JSON 报告保存为 Actions artifact。此流程不签名、发布或安装客户端。
- 本地类型、架构、品牌和官网构建已通过（53 目录、1136 文件、5936 条依赖、0 环）。首轮全仓运行中，检查点交接测试的一次原命令查询返回 `unverifiable`；原断言未记录细分原因。核实发现测试只等 HTTP 请求到达，未等暂停文本持久化，服务本来允许并发变化时拒绝给出已提交结论。测试补上真实 `message.delta` 日志等待，不修改产品安全判定；相关 2 文件 21/21 复验通过，包含原查询变化保护测试。初次运行日志和诊断报告保留于 `test-results/pr-local-validation.log`、`pr-command-diagnostic*.json`、`pr-command-synchronized.json`。
- 首轮本地全仓结束：358 文件、2465 项，2460 通过、3 失败、2 跳过，1567 秒。另两处旧断言分别漏了 #10 新增的周期选项参数，以及仍期待 #12 之前的英文工具名／隐藏失败提示；现核对可信选项和独立成员模型，并要求中文失败动作在折叠外可见。三处修正后的相关 5 文件共 68 项通过；初次全仓报告 `test-results/pr-full-suite.json` 保留。两项跳过都需要未提供的历史 EXE（来源生命周期与旧岗位迁移），没有新增跳过或削弱产品门禁。
- 首次 GitHub 检查 `42576103856` 在行为测试前失败；本地干净检出复现 52 份架构文档差异，原因是 Windows Git 自动转换 CRLF。`.gitattributes` 为 `src/**/ARCHITECTURE.md` 与 `CONTRACT.md` 固定 LF，并清理三份已提交文档的残留混合换行；无文字或类图关系变化。干净目录重取文档并校验后为 0 差异、1136 文件／5936 依赖／0 环。报告原失败保留，没有跳过架构检查。
- 第二轮云端 `42577367763` 通过静态检查后暴露 runner 默认临时目录的 8.3 别名：`C:\Users\RUNNER~1` 与真实 `C:\Users\runneradmin` 不一致，测试夹具构造的路径因而被工作区身份／文件保护正确拒绝。本机独立临时目录别名对照复现 4/6 失败，使用真实目录后 6/6 通过（`pr-temp-alias.json`、`pr-temp-canonical.json`）。CI 改用 `${{ runner.temp }}`，入口核对 `realpath` 并预建诊断目录；产品路径校验及测试断言不变，原云端报告保留。
- 临时目录配置最初放在不支持 runner 上下文的 job env，导致 `42579079935` 在工作流预检失败、未启动测试；已改为预检和测试步骤各自的 step env，保持真实路径断言。该失败不计作行为测试结果。
- 云端 `42579315324` 的第一／四分片分别暴露 1 项范围执行回包失败和 3 项 detached 后代回收失败；另外两片因 Electron 官方下载 HTTP 504 未运行行为测试。隔离断言补充原始回包与 stdio，保留失败标准；本机以校验 SHA-256 的官方 Node 22.19.0 复跑对应 2 文件 22/22 通过（`pr-isolation-node22-diagnostic.json`），尚不能把本机通过代替 Windows runner 结果。
- 最终 GitHub 分片结果、候选 SHA 和合并回执在 [PR #13](https://github.com/nan023062/cbim/pull/13) 集中记录，以上定向结果不冒充最终全仓通过。已有四项 Issue 的真实 UI／EXE 验证继续引用各自报告；本步未改产品源码，注释语义保持，架构文档只有上述换行修正。正式桌面版本仍另行安排。

## 2026-11-09：Issue #12 独立完成对话执行反馈

- 在 #9 `70dfc26`、#11 `5bb7c08`、#10 `8ab9da0` 分别开发、测试、提交、推送并关闭后实施。主对话复用原图和目标详情，直接展示目标分工、派发、成员状态／前置候选、交付证据与审阅／等待；成员卡公开步骤直接可见，候选和可靠完成分开。
- 类型／架构通过，1136 文件、5936 依赖、0 环；10 文件 65/65、8 组界面场景通过。真实 EXE `20261109-142131`、Pi 与隔离项目 Team 场景通过：计划／派发／运行／两份候选／审阅／重开均可见，主请求 9、成员各 5，重开无新增请求，原记录字节不变，错误 0。详见[验证与维护报告](verification/issue12-conversation-progress-20261109.md)。
- 同步 frontend/conversation、tasks 注释、契约和类图及 frontend 导航；未增加后台写入或轮询。按 Issue 单独提交，公开安装包未更新。最终清单为 #9、#10、#11、#12；#8 标记删除并 NOT_PLANNED 关闭。

## 2026-11-09：Issue #10 独立完成自动／团队模式

- 基于 #9 `70dfc26` 和 #11 `5bb7c08` 分别验证、提交、推送及回填之后，单独恢复并交付本项。输入区模式与权限分开，可信周期冻结 Auto/Team；缺负责人和完全无模块分别生成明确兜底绑定，不写入虚构岗位或模块，Team 保持人工确认要求。
- 类型／架构通过，1129 文件、5916 依赖、0 环；26 文件 192/192 通过，含真实 Pi 的 read/ask/execute、同会话切回 Team、持久化及原边界回归。9 组浏览器界面场景和真实 EXE `20261109-134943` 岗位路径复验通过；所有初次失败及修正原因见[验证报告](verification/issue10-collaboration-modes-20261109.md)。
- 同步受影响源码注释、11 处 CONTRACT／目录架构和模式概念说明。按本 Issue 独立提交，公开客户端未更新；在线模型自主分工质量不在本次确定性验证范围。

## 2026-11-09：Issue #11 独立完成对话条目与工作区菜单

- 在 #9 独立提交 `70dfc26` 之后恢复本项，未包含 #10 模式变更。历史与侧栏共用重命名／移除，刷新不复活移除项，运行灯基于真实运行归属；工作区折叠箭头、竖三点、气泡及点击位置浮动菜单落地。删除只改变本机展示。
- 独立类型／架构检查通过，1124 文件、5868 依赖、0 环；6 文件 29/29 通过，真实 React App + 模拟 IPC 的 7 组界面场景通过，页面错误和执行写入 0。结果见 `test-results/issue11-isolated.json` 及[本项报告](verification/issue11-conversation-ui-20261109.md)。
- 同步 shell、conversation、components 注释、CONTRACT、架构及 frontend 导航，更新界面说明。按 Issue 单独提交；公开客户端尚未发布本项。

## 2026-11-09：修复 Issue #9，新项目从 Agent 登记模块负责人

- 单独交付复核：隔离本 Issue 后类型／架构通过，13 文件 108/108 通过；产品、相关测试及冒烟脚本与已验收构建指纹完全一致。按用户要求单独提交，后续 Issue 另行开发与验证。#8 已在 GitHub 标记“已删除”并以 NOT_PLANNED 关闭。

- 阶段五 / Step30–31 控制面修复：[Issue #9](https://github.com/nan023062/cbim/issues/9) 的下拉列表原来只展示持久岗位，新项目只有静态 Agent 时没有可选岗位，也没有就地登记入口。业务架构现可选择自定义 Agent 或内置执行 Agent，复用原岗位表单明确模型、预览并保存，返回原模块核实并预选真实启用的 memberId，再分别确认负责人。
- 修改仅限 frontend 的 shell、team、workspace 组合；原岗位／责任控制器、后端版本门禁和事务服务继续复用。取消不登记，未知结果保留原命令核实入口，查询旧命令不触发新登记回调；空列表和读取失败分别提示。同步 5 个源码文件注释及三处 CONTRACT／ARCHITECTURE，维护说明见[验证报告](verification/issue9-module-owner-20261109.md)。
- 类型及架构检查通过，53 个目录无文档差异，1120 文件／5860 依赖、0 环；11 文件相关行为 94/94、依赖与分层 14/14 通过。分层测试原有 SVG 资源误判已按真实非代码资源修正，首次 13/14 失败报告保留。
- `pnpm package` 构建 `20261109-130841`；真实 Windows EXE、隔离项目和真实 IPC 的正常／回包丢失两种场景通过。每场景登记 2 岗位、保存 3 次负责人关系，取消与重启写入 0、模型请求 0、页面错误 0，知识文件与已有运行文件不变。丢回包场景首次因查询成功后记录折叠、测试读取可见文本而超时；只修正测试状态断言，保留失败后复验通过，未修改产品恢复逻辑。
- 本步交付源码、回归脚本和本地验证；未全仓回归、发布／安装正式更新或操作用户真实项目。公开 0.1.1 未包含该修复，后续交付范围仅在 roadmap 维护。

## 2026-11-09：Search Console 验证通过，提交 sitemap 并申请两页收录

- 在现有 Google 登录和官网网址前缀资源下完成所有权验证，设置页明确显示“您是经过验证的所有者”。公开验证元标记长期保留在首页 head；同站点 README 补充维护流程与项目子路径 robots 的适用边界。
- 网站专用提交 `091b319` 已推送 master，Actions `42556389558` 构建／部署成功，deployment `7646268245`；开发树与发布树构建内容一致，匿名首页、下载页、sitemap 均为 200 且 SHA-256 与本地一致。没有合并整个桌面开发分支或放宽部署保护。
- sitemap 单次提交已受理，详情确认地址为 `/cbim/sitemap.xml`，但读取报告仍失败、发现页数 0。Google 实际测试在 11:43:05 抓取成功，XML 命名空间和两条完整 URL 检查通过，人工处置报告无问题；失败根因未确认，没有把可访问当作已解析，也没有反复重提。
- 首页及下载页的已有索引均为“尚未收录／Google 无法识别此网址”；11:36、11:37 实际测试均可编入索引，分别一次请求均已加入优先抓取队列。是否正式收录仍取决于 Google 后续处理。
- 同步 roadmap、[核实报告](verification/search-console-20261109.md)及本地回执；网站构建、XML 结构、文档链接和差异检查通过。未改 `src/`，无受影响源码注释或目录类图，未运行无关桌面回归或发布客户端。后续复查时间和验收条件只在 roadmap 维护。

## 2026-11-09：统一产品品牌并上线官网与下载页

- 完整名称统一为 CBIM Assistant、简称 CBIM；新增原创 SVG 图标及可复现的多尺寸 ICO／PNG 构建，供侧栏／欢迎页、窗口、EXE、安装器／卸载器和网站共用。保留原应用 ID、数据目录及更新兼容身份；原生图标与发布文案分开维护，不向稳定运行服务增加网站依赖。
- 新增自包含官网首页、Windows 下载页、更新日志与使用须知。真实发布快照只指向 desktop-v0.1.1，显示未签名及新品牌尚未进入公开安装包；下载文件大小和 SHA-256 已复核。加入 canonical、社交元数据、结构化数据、robots、sitemap 与 master 限定的 Pages 发布流程。
- 类型／架构通过，1119 个维护文件／5851 条依赖、0 环；相关 39 项和签名 29 项通过。便携构建 20261109-105132 的真实窗口与品牌资源通过，Windows 从 EXE 提取的 32 px 图标与 ICO 完全一致。官网 14 个响应式／深浅色／独立文件场景通过；实际方法修正及初次失败均记录在[验证报告](verification/product-brand-website-20261109.md)，未运行全仓回归。
- XD Sites 仅支持公司网络，因此沿用项目既有公开 GitHub Pages。网站专用 17 文件提交 `90b8d68` 从 master 基线独立推送，没有合并客户端开发分支；Actions `42554310278` 构建与部署成功，deployment `7645969655`。官网、下载页、robots、sitemap、图标匿名返回 200 且字节与本地一致，保留原仅允许 master 的环境规则。
- 同步 main／components／shell 注释、三处目录架构和两处契约，新增[维护说明](task/product-brand-website.md)。当前公开客户端仍为未签名、旧品牌的 0.1.1；没有新建正式安装包、替换 Release、修改用户安装或申请证书，不把搜索收录与商店上架写成已完成。

## 2026-11-09：Windows 签名流程接入，签名版待证书

- 用户要求应用代码、安装器签名并重发 0.1.1，随后确认尚无证书。独立 `scripts/desktop-signing/` 接入证书库选择、SHA-256／RFC3161、PE 应用／原生模块签名及 NSIS 安装器／卸载器 hook；针对 Forge prepackaged 跳过应用签名的真实路径显式补齐签名顺序。Forge 写入公开发布者供后续更新验签，未修改 `src/` 运行时代码。
- 增加 `verify:desktop` 和 `publish:desktop`，缺配置或签名无效即停止；新候选目录保留旧产物，发布前复核真实签名、清单与摘要。同版本替换先备份、临时草稿中换附件、核对后公开，既有标签与旧 latest 保留，未知结果记日志并阻止重放；不可变 Release 拒绝替换。
- 类型／架构与依赖检查通过：1111 文件、5844 依赖、0 环，53 目录类图无差异。原相关 34 项和最终新增 29 项通过；修正 Vitest 仅发现 `.test.ts` 的入口后实际运行 `.mjs` 签名测试，不把未发现用例计作通过。真实构建／发布入口缺证书均非零退出，原安装包摘要保持；真实 Authenticode 确认旧包 NotSigned。26.18.0 builder 配置 Schema 与脚本语法通过。详细证据见[报告](verification/windows-signing-20261109.md)。
- 同步[签名配置／恢复指南](task/windows-signing.md)、桌面发布指南与 roadmap。未申请／购买证书、未改信任库、未真实签名、未安装签名包、未发布／替换线上附件、未全仓回归；原公开 0.1.1 仍未签名。真实正向验收等待可信证书与 SDK 配置，已经安装同版本的用户需手动重装，后续范围只在 roadmap 维护。

## 2026-11-09：0.1.1 正式发布与在线升级完成

- [Windows x64 正式版 0.1.1](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.1) 已公开；源码／标签提交 `15ab1f4`，含反馈诊断修复 `c66f1ab`。账号菜单、版本与最近一次更新随本版交付；旧 Python latest 保持 `v1.0.2`。四个附件大小及 GitHub SHA-256 与本地一致。
- 构建 `20261109-021333`；冻结的 1001 个产品输入及构建、真实安装、在线升级后的 app.asar 指纹一致。版本 0.1.1 的 NSIS 安装、真实账号菜单与内置日志、实际 Pi 的两项 Skill 和只读反馈状态通过。源码相关 134 项、模拟 IPC 界面 17 项通过；未运行全仓回归。
- 正式 0.1.0 自动发现 0.1.1，下载包与发布摘要一致；正常退出／重开仍为旧版，显式安装后新进程携带原用户目录。最终原工作区、task/run、模型配置和本地标记保留，原运行未重放，新版检查返回 current。
- 首次升级验收在新窗口加载期间发出关闭，随后加载中断并超时；保留失败回执，未重复安装。精确核实、关闭提示后，使用相同更新参数补验已安装版本，待页面就绪后正常退出通过。原受干扰窗口不记为完整界面验收。发布草稿标签查询的 404 也经原草稿 ID 核实后继续，未重复创建。
- 完整身份、附件摘要、验证过程、注释／架构维护范围与限制见[发布验收报告](verification/desktop-release-0.1.1-20261109.md)。本轮使用独立测试目录，未读取真实 GitHub 凭据、未新增线上 Issue、未将本机通过写成 NAN-LI 复验通过；本次发布工作结束，不继续旧开发计划。

## 2026-11-09：0.1.1 正式版候选冻结前验证

- 按用户授权准备 Windows x64 `desktop-v0.1.1`，纳入账号菜单更新与已提交的反馈提示／独立诊断修复；版本升为 0.1.1，发布说明写入 [本版日志](releases/desktop-v0.1.1.md)。继续使用原桌面通道，不改变旧 Python latest，也不额外创建反馈 Issue。
- 实际验证：`pnpm typecheck`、`pnpm check:architecture` 通过；53 个目录、566 个源码／样式文件类图同步，1101 文件／5812 含类型依赖无环。依赖与分层 14/14，反馈／Pi／预算／更新相关 22 文件 120/120，真实 React App／模拟 IPC 17 项界面检查通过，页面错误为 0。
- 证据：`test-results/desktop-0.1.1-boundaries.json`、`test-results/desktop-0.1.1-targeted.json`、`test-results/desktop-updates-ui-report.json`。这些是源码与本机相关验证，未运行全仓回归；本条记录时正式构建、隔离安装、线上发布与 0.1.0 升级仍未执行，完成后另记实际结果。

## 2026-11-09：账号菜单的版本更新与最近一次更新

- 将设置页的版本更新迁到左下角账号菜单，展示当前版本、检查／查看更新及最近一次更新。没有新版时直接显示当前安装版的内置日志；有新版时区分新版说明与当前版本日志，未登录也可查看。
- 菜单与新版提醒打开同一原生弹窗；外壳持有一份更新快照，不切换全局页面或卸载原草稿。前端更新呈现独立归入 `frontend/updates`，后端 `backend/updater`、公开协议与安装流程保持原归属。
- 实际验证：类型、架构与依赖检查通过，1101 文件／5812 依赖无环；依赖与分层 14/14，更新相关 23/23，真实 React App／模拟 IPC 的 17 项界面检查通过。设置表单草稿与 DOM 节点保留、深浅色及 320 px 弹窗、失败重试、无隐式下载和单独安装均有证据；原生弹窗焦点测试的初始假设及修正如实记录。
- 同步 App／UserMenu／SettingsView、更新组件与 hook 的注释，以及 frontend、shell、settings、updates 的架构文档和相关 CONTRACT；更新目录说明与发布使用指引。完整范围和机器记录见[验证报告](verification/account-updates-20261109.md)。
- 本步是源码界面迁移，未打包、发布、真实下载安装、运行全仓回归或跨设备验收。后续交付范围在 roadmap 维护。

## 2026-11-09：反馈工具缺失的提示修正与独立诊断

- 将用户在 NAN-LI 0.1.0 的复测补入[缺陷与验证报告](verification/feedback-tool-availability-20261109.md)：已授权、writeEnabled 为 true，原会话仍缺 submit／receipt。明确这证明不能凭缺工具要求重新登录，不把原设备现象推广为所有连接后都不能注入；原设备本机连接回执及运行日志尚未取得。
- 沿 Application → 桌面反馈服务 → 每轮主运行 → Pi 真实工具清单核实调用链。修改前本机真实 Pi 的 BUG／需求空项目测试均能在登录后继续原会话取得两项工具。报告按当前可复现条件定性：本机授权结果未落盘时两项工具缺失；同一运行不刷新；保存连接后继续原会话装配正常。真实 Pi 与状态单元测试分开记录，不把这些条件追认为 NAN-LI 当时的状态，也不将通用注入故障记为已证实。
- 修正两份产品 Skill 与主 Agent 的误导降级；新增严格只读 `cbim_feedback_status`、本机公开连接／pending／代际检查及精确权限描述。新增宿主 prepared 与 Pi active 名称清单、明确缺项码，设置页提示等本机显示已连接。诊断不读取提交历史，不更换原授权，不向执行成员开放；提交成功静默及未知防重保持。
- 同步受影响源码注释、九组 CONTRACT／ARCHITECTURE、反馈配置指南与入口说明。诊断规则归反馈适配，认证归资源服务，通用 Pi 桥仅核名称；原提交账本和独立更新子系统不承担诊断文案变化。
- 实际验证：最终 `pnpm typecheck`、`pnpm check:architecture` 通过，1100 文件／5808 依赖无环；依赖／分层 14/14，18 文件相关行为 94/94。首次扩展回归 82/84 暴露新增清单路由未加入预算启动器的问题，修正固定本机桥白名单后全部通过；保留原失败和最终报告，不改松预算断言。文档链接及差异检查通过。
- 边界：真实 Pi／本机持久化、确定性模型 HTTP 与 GitHub 夹具，不是新一轮线上发单或 NAN-LI 验收。未全仓回归、打包、安装或发布；正式 0.1.0 尚无新增诊断，原提问 `fetch failed` 未确认同源。本次按用户要求交付修复代码及复现报告，发布与原设备正式包验收另行推进；后续范围只在 roadmap 维护。

## 2026-11-09：合并开发者 Skill 入口

- 按用户 review，将 `reuse-evolution` 纳入 `architecture-evolution`，统一负责架构演进与共性沉淀；将 `project-understanding` 纳入 `architecture-maintenance`，统一负责源码资料与项目认知维护。保留 `cbim-development` 的推进和接续职责，更新其协作引用。
- 保留低变化频率稳定系统目标、按业务变化点与频率划界、单一职责、开闭原则和单向依赖；合并抽象选择、真实消费者验证、渐进迁移与维护者交接，去除重复流程。认知资料交付仍不等于维护者已经理解或确认。
- 同步三个宿主的 9 个入口，移除两个旧 Skill 的 6 个独立目录；保留已有 architecture-maintenance 目录联接。更新 AGENTS、开发者说明（历史文档：`docs/developer-skills.md`，已清理）、索引与 roadmap，历史记录保留原阶段事实。
- 实际验证：3 种 Skill 的 9 个入口格式通过、3 组副本字节一致；每个宿主只发现这 3 种项目 Skill，退役入口均不存在；相对链接和差异检查通过。见[验证记录](verification/developer-skills-20261108.md)。仅修改本地 Skill 和说明，未运行产品测试、源码重构或独立模型行为评测。

## 2026-11-09：按业务变化点与频率明确封装边界

- 按用户追加要求，模块和类按业务变化点划分，变化频率不同的代码分别封装；低频机制与高频策略通过稳定契约协作。5 种 Skill 分别接入评估、提取、源码说明、实施验收与认知交接，要求记录变化点、频率依据和所属边界，排除非业务提交噪声及按频率机械合并的做法。
- 同步 AGENTS、三个宿主入口和开发者说明（历史文档：`docs/developer-skills.md`，已清理）。15 个入口格式、5 组副本字节一致性、相对链接及差异检查通过；新增 3 个场景的指令推演，见[验证记录](verification/developer-skills-20261108.md)。只修改本地 Skill 与文档，未实施源码重构或重跑产品测试。

## 2026-11-09：以稳定系统为目标补充架构原则

- 按用户要求，将分层与抽象的目标明确为低变化频率、隔离常规业务变化和持续复用；系统、模块、类遵循单一职责与开闭原则，实际层、模块、文件和类型引用遵循单向依赖，作为渐进治理的硬约束。
- 更新 AGENTS、5 种项目 Skill 及开发者说明（历史文档：`docs/developer-skills.md`，已清理），分别评价契约和实现的稳定，要求说明稳定核心、变化点、扩展方式和影响传播；无环之后仍检查过密依赖及共享状态，不用长期未提交代替成熟证据，也不将开闭原则解释为禁止修复真实缺陷。
- 实际复核：15 个 Skill 入口格式通过、5 组宿主副本字节一致、相对链接无缺失、差异检查通过；新增 5 个原则场景的人工推演，见[验证记录](verification/developer-skills-20261108.md)。本次仍仅本地 Skill 和文档变更，没有修改产品源码或重跑产品测试。

## 2026-11-08：开发者可持续维护 Skill 配置

- 按用户关于全局分层、解耦、共性业务／工具沉淀和认知保障的要求，在当前 Cindy 项目工作区新增 `architecture-evolution`、`reuse-evolution`、`project-understanding`。通过真实语义、契约与消费者判断工具函数、领域封装、组合、继承及多态的适用性，不以减少行数替代可维护性判断。
- 与 `cbim-development`、`architecture-maintenance` 协作，同步 AGENTS、三种宿主入口及使用说明（历史文档：`docs/developer-skills.md`，已清理）。保留原业务开发范围，只交付本地 Skill 与开发说明，没有启动源码重构或岗位自动化。
- 实际验证：5 种 Skill 的 15 个入口均通过 `quick_validate.py`，各入口字节一致，相对链接检查及 `git diff --check` 通过。完成 7 个触发／决策场景的人工推演；未将其当作独立模型行为评测，未重跑产品测试。完整范围与本机证据见[验证记录](verification/developer-skills-20261108.md)。

## 2026-11-08：正式桌面发布、在线升级与唯一 Issue 验收完成

- 源码 4d3bc19 和 desktop-v0.1.0 标签已推送；2026/11/8 23:02:37 CST 实际公开 [0.1.0](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.0)，4 个附件的大小／摘要均与本地一致，旧内核 latest 未改变。
- 真实安装包完成 0.0.9 测试基线 → 公开 0.1.0：软件提醒、显式下载、普通退出不安装、再次显式重启安装、原用户目录及登录／测试数据保留通过。Windows 安装确已完成；验收脚本 close 事件超时后只读核对原新进程，没有重放安装。
- 正式 APP 的真实 BUG Skill／Pi 创建唯一 [Issue #8](https://github.com/nan023062/cbim/issues/8)，原操作 0ad43d96-77ee-4046-82e5-19a7ad2796e4；持久回执、GitHub 账号／正文和重开静默验证通过。模型是本机确定性服务，GitHub 真实；匿名查询限流后仅用已登录账号 GET 核对，不重复 POST。
- 同步发布指南、源码独立 updater 边界、roadmap 及[完整桌面报告](verification/desktop-release-20261108.md)、[反馈报告](verification/github-feedback-online-20261108.md)。源码保持发布标签版本，后续提交仅记录验收事实；未签名／Windows 单平台／全仓非全绿等限制如实保留。本步骤收尾，不继续原剩余计划或部署岗位自动化。

## 2026-11-08：正式桌面安装包与独立更新子系统（发布前验收）

- 按用户要求将更新程序独立到 `src/backend/updater/`，拒绝其反向依赖运行时；主程序只装配固定入口。新增每用户 NSIS 安装、desktop-v 通道、新版提醒、手动下载与显式重启安装、离线本版日志，并预置公开 OAuth 配置。
- 构建 20261108-224822 的 0.1.0 最终候选已真实安装、自动重启及正常关闭重开；原用户目录和 GitHub 连接保留，页面错误 0。类型／架构通过，最终相关 75/75；全仓 2396 通过、1 清理失败、2 跳过，测试清理有界重试后单独复验通过。保留未冻结树与未全绿的真实边界，见[验收报告](verification/desktop-release-20261108.md)。
- 同步源码注释、相关 CONTRACT／类图、架构 Skill、依赖规则、指南及发布步骤。正式 Release、线上下载升级及唯一 Issue 尚未执行，本条不预写发布或线上提交成功。

## 2026-11-08：OAuth App 注册与正式桌面发布范围调整

- Cindy 扩展连接后核实 GitHub 当前账号为 `nan023062`，实际创建 `CBIM Feedback` OAuth App（`4002869`），启用 Device Flow，公开 Client ID 为 `Ov23liSMDZneBd3gSyTo`；没有生成 Client Secret。测试包已取得设备授权码，但尚未完成授权，没有创建 Issue。
- 用户要求先发布正式 APP，并选择“软件内下载并重启安装”；据此将线上发单移至正式包验收，记录[发布方案](task/desktop-release.md)。实际读取远端 Release 发现旧 Python 内核 `v1.0.2`，桌面采用独立通道。
- 开始前核实未提交反馈改动并保留；依赖基线为 1081 文件、5770 条依赖、0 环。此条仅记录已完成的注册、范围调整与基线，正式安装／更新／线上反馈尚未验收。

## 2026-11-08：GitHub 线上验收续接与浏览器连接调整

- 用户确认退出 Chrome 后续接，原文件锁不再是当前错误，但 Windows 返回 `APP_BOUND_ENCRYPTION_UNSUPPORTED`，不能使用复制的登录状态。用户明确选择「我的浏览器」并指定 `xd.com` 个人资料；Cindy 模式已保存为 `user-browser`，实际 Chrome 窗口资料核对一致。
- 扩展仍未连接，桌面工具拒绝后台回车（`background_unavailable`）。已停止该输入路径，请用户在所选资料中安装／启用 Cindy 扩展，补充[配置指南](task/github-feedback-setup.md)中的两类故障及官方扩展入口，保存[实际记录](verification/github-feedback-online-20261108.md)。未进入 GitHub 注册／登录页面，没有真实授权或 Issue 创建，不将浏览器设置成功当成业务验收通过。
- 本次仅同步说明和证据，不修改功能源码或生成新包；旧 CBIM 实例未关闭，未复制 Cookie、借用其他账号或绕过拒绝输入。

## 2026-11-08：GitHub OAuth 配置指南与线上验收准备

- 按用户要求补齐[操作指南](task/github-feedback-setup.md)：OAuth App 注册字段、公开 Client ID、Device Flow 开关、回调占位用途、过期后重新授权、CBIM 设置与重启核验，以及只创建一张测试工单的固定上下文和验收标准。明确产品成功静默与开发验收证据分开。
- 真实只读预检：GitHub API 返回 `nan023062/cbim` 的 ID `1240750134`，公开、Issues 开启、未归档。Cindy 浏览器尚未进入 GitHub 页面，启动／页签读取返回 `PROFILE_LOCKED`；已请求用户完全退出 LINAN-XDT 上的 Chrome 后续接，未终止用户进程或替换登录环境。当前旧 CBIM 包实例保持未操作。
- 实际验证：5 份说明的 38 个相对链接无缺失；`git diff --check` 通过，已核对设置文案、授权协议和构建信息。未修改本次功能源码，未重跑上一轮 124 项回归，也未重新打包。
- 同步开发计划入口、任务目录索引、反馈方案和路线图。线上登录与 Issue 创建均尚未执行，具体阻塞与恢复条件见[线上验收记录](verification/github-feedback-online-20261108.md)。没有创建测试 Issue、提交／推送、合并或发布；不将操作指南或已有夹具测试计作线上验收成功。

## 2026-11-08：反馈 Skill 接入 GitHub 直接提交与成功静默

- 按用户要求，接入公开 OAuth Client ID 的 Device Flow、本机安全存储、固定 GitHub 账号／仓库以及两项 Skill 的自动 Issue 创建；成功不追加结果、编号、链接或进度。首次连接由桌面明确授予自动提交许可，read 仍拒写，不改变知识、业务文件和命令权限。
- 主会话实际装配独立工具，严格使用用户格式字段。先保存意图再 POST，同工作区相同内容跨会话／重启去重；未知阻止新提交，只读核实原标记与完整身份，不自动重发。软件不建立自有反馈服务器或结果回访。
- 实际验证：类型与架构／依赖通过；17 文件 124/124 通过；4 组真实组件交互通过。Pi 为真实子进程＋本机确定性模型，GitHub 为 HTTP 夹具，未冒充线上服务。Windows 构建 `20261108-201655` 与真实 EXE 的设置／IPC／系统加密检查通过，包内主程序和两项 Skill 哈希匹配；测试脚本问题及边界见[验证记录](verification/github-feedback-20261108.md)。
- 同步公开协议、外部写副作用、持久化／权限／静默显示注释，受影响目录类图、CONTRACT、两项产品 Skill、入口方案、管线和 roadmap。用户确认尚未注册 OAuth App，正式 Client ID 与线上授权／发单仍待配置验收；本次未创建真实 Issue，未提交／推送新改动，未合并或发布，原剩余计划不启动。


## 2026-11-08：对话加号菜单接入 BUG 反馈与需求许愿 Skill

- 按用户进一步明确的交互要求，在对话“+”菜单新增两项入口，分别请求产品内置 `bug-feedback`／`feature-wish`。主 Agent 先读取对应 Skill，再按复现／场景格式引导用户在当前对话补充上下文；取消此前建议的网页手动填单路径。
- 菜单调用沿用模型、权限和发送／排队规则，不带出或清空已有草稿与附件，不插入或恢复等待中的任务。两项 Skill 只收集并整理上下文，未接入 GitHub Issue 创建，不把愿望视为开发授权或承诺排期。
- 实际验证：类型、架构／依赖检查通过，相关 8 文件 34 项及另 1 文件 3 项知识工具 Pi 回归通过；真实前端组件在隔离浏览器中通过 6 组交互检查，IPC 为夹具，Pi 使用本机确定性服务，未宣称在线模型或 GitHub 端到端验证。见[验证记录](verification/feedback-skills-20261108.md)。
- 同步：会话菜单、会话发送、内置清单、主 Agent 指引注释；三组 CONTRACT／ARCHITECTURE 及父层导航；管线、入口方案和 roadmap。未打包、合并或发布；原 Step55 终点和其余未实施计划保持。

## 2026-11-08：反馈方案精简为 GitHub Issue 与更新日志（仅文档，网页入口建议已被后续 Skill 方案替代）

- 用户明确直接对接 GitHub Issue，无需反馈服务器或结果回传，只在软件更新日志查看修复和功能变化。已重写[入口方案](task/user-feedback-intake.md)，同步管线、目录入口和 roadmap；下方初稿中的接收服务、我的反馈及回传设计已被本次要求覆盖。
- 首版建议通过系统浏览器打开预填 Issue 页面，由用户使用 GitHub 账号提交；内部 `cbim-triage` 直接处理 Issue，`cbim-ready` 准备待发布日志。发布时按真实版本打包日志供软件离线展示，不把 PR 就绪或合并视为已发布。
- 检查文档引用、差异及当前方案的一致性；未修改产品源码、安装 Skill、创建 Issue 或启用自动化。

## 2026-11-08：软件内 BUG／需求反馈接入开发管线（初稿，已由后续要求调整）

- 根据用户新增要求，补充[反馈入口方案](task/user-feedback-intake.md)：软件内 BUG／需求表单、我的反馈、诊断预览、可靠回执、补充材料、重复关联及用户进度。
- 在[管线方案](cindy-development-pipeline.md)前增加 `cbim-triage`，区分原始反馈、已采纳工单、开发授权和 PR 交付；用户无需 GitHub 账号，仓库写入由服务端适配器处理。保留人工合并／发布边界，按真实发布版本回传，旧意见和未知提交结果不伪造成功。
- 只读核对现有用户菜单、设置、诊断和治理反馈，尚未找到产品用户 BUG／需求入口；账号登录仍未接入。反馈服务、适配身份和新界面均为待实现条件。本次检查文档链接与差异，不运行产品测试，不创建外部服务或工单。

## 2026-11-08：Cindy + Git 岗位开发管线方案

- 用户选择以现有 CBIM 工程试点、自动推进到 PR 就绪并人工合并。已整理[管线方案](cindy-development-pipeline.md)，包含七类岗位入口、工单交接、提交绑定、返修与停止条件、实际验收和分步落地。
- 已读取项目脚本与 Git 状态，并通过 Cindy 能力发现核实独立任务/worktree、运行查询、定时自动化与 PR 跟踪接口；当前伙伴例行任务入口不可用。仓库尚无已跟踪的 `.github` 工作流，远端默认分支为 `master`。
- 仅设计交付，尚未创建 Skill、自动化、Issue／PR、CI 或分支保护；不启动新的产品功能步骤。文档引用与差异检查，不重跑产品测试。

## 2026-11-08：本轮开发收尾总结（仅文档）

- 按用户要求整理[收尾总结](development-closeout-20261108.md)，汇总截至 Step55 的能力、R01–R17 完成与保留范围、R18–R20 后续计划、最终本地提交及 Windows 成品。
- 区分 Step46 历史全仓 2068/2068 与 Step55 相关 203/203；引用已有报告，不计作本次重跑或最终全仓结论。
- 同步开发入口与 roadmap 的总结链接；检查本次新增引用、成品位置和原有独立修改的保留情况。仅文档整理，不改变功能代码、构建或结束条件，不启动下一开发步骤。

## 2026-11-08：原隔离执行核实与清理，本轮开发结束

- 对应步骤：Step55 / R12-B2，承接fada1b6。可信原授权/创建时间/目录身份可靠保存；桌面显式核实与固定原对象清理，未知收尾阻断写入/交付并保留原占用，原任务失败不改。
- 验证：最终相关33文件203/203，0失败/跳过，284秒；源码/脚本类型、架构/依赖通过，51目录549源码/样式、1071文件5722依赖0环。本片未重跑全仓。
- 真机：EXE 20261108-172018正常6/14、崩溃重开3/5；原Job主/后代确已退出，owner变化和旧实例拒绝，显式清理回包丢失后只核实。原业务日志、状态和文件保持，隔离账本只追加原命令两帧，重开无重放，页面错误0。8图生成3图目检。
- 原失败保留：测试同步拒绝/进程夹具/关闭查询及最小类型夹具已修；两次make遇HTTP504后，用已安装官方校验表严格核同版本缓存后构建成功。首次桌面脚本误把清理新审计要求不变，修正断言后同EXE通过；产品/内置指纹不变，脚本变更前后分开记录。
- 同步维护：中文文件头/接口、10组CONTRACT/ARCHITECTURE、支持矩阵、roadmap及[验收报告](verification/isolated-execution-recovery-20261108.md)。Windows当前登录会话/可信本地私有记录边界，历史无记录或身份变化拒绝清理；不证明在线自主质量。
- 结束：按用户2026-11-08最新要求，当前步骤验收并独立本地提交后结束本轮开发，不推送；R09-C及其它未完成包只保留计划，不再实施，不将本轮结束称为全部开发目标已完成。

## 2026-11-08：冻结范围的成员隔离执行

- 对应步骤：Step54 / R12-B1，承接e1a410c。全部模块冻结文件／目录与最严Node预算，关闭范围模式原生工具；Win32读取、LPAC执行、受控写／删除移动、产物和只读检查点共用原授权与范围。未知写阻断命令与交付，物理收尾未确认保留占用。
- 验证：相关28文件178/178，0失败／跳过，259秒；源码／脚本类型及架构通过，51目录542源码／样式，1057文件5661依赖0环。本片未重跑全仓。
- 真机：EXE 20261108-163324正常、逐次批准及实际LPAC主／后代存活后界面停止三场通过；主／成员分别6/14、6/14、3/5。原文件和草稿、重开记录保持，无重放，页面错误0；6张最终图生成、4张目检。实际Pi使用本机确定性服务，自动化批准不代表真人认知验收。
- 原失败：开发Electron的koffi路径已修正；初次停止探针误用Windows启动器PID，导致漏识别后超时，独立诊断后改读真实主进程PID，同EXE复测通过。产品／内置树始终一致，停止脚本修正前后指纹分别记录，旧报告与失败现场保留。
- 同步与接续：24源码中文注释、9份CONTRACT、10份ARCHITECTURE及生成器职责说明同步。[报告](verification/scoped-member-execution-20261108.md)、[计划](task/scoped-member-execution.md)、[R12矩阵](task/execution-isolation-support.md)。R12仍缺原身份孤儿核实与清理，下一片R12-B2，之后R09-C；第1–8组继续，第9组仅计划。独立本地提交，不推送。

## 2026-11-08：Windows LPAC/Job 隔离执行平台

- 对应步骤：Step53 / R12-A，承接7b7fae5。私有输入/执行器/输出分权，固定registryRead且零网络capability，挂起进程创建时绑定Job；核原Token与Job后启动，后代/停止/超时/宿主崩溃收束，内存和进程正反预算及严格有界输出。原工程不扩ACL，任务及模型工具接线仍待后续。
- 验证：最终相关12文件130/130，0失败/跳过，87秒；类型/脚本类型/架构通过，51目录538源码/样式，1046文件5597依赖0环。包含22项隔离/崩溃、6场现有真实Electron utility/Pi。本片未重跑全仓。
- 真机：最终EXE 20261108-155211六场平台验收通过，使用自身Node和打包模块；实际后代存活后停止，最终自有目录/profile清理。另仓库外复制完整包、PATH无Node/Python真实桌面启动与内部CRUD通过。没有新增截图或在线模型质量结论，原用户进程未操作；548源码/配置、21内置和542测试/脚本在最终四类验证同指纹。
- 原失败：零能力Node初始化、指针读取与执行器数据文件的探索问题已核实；首轮冻结127/128的映像EBUSY改为有界清理重试、owner最后删除。初包固定延时停止未稳定观察后代，改为真实ready/存活核实。旧报告/失败现场保留，不把初包写成全部通过。
- 维护与接续：三份源码中文注释、platform CONTRACT及platform/main两份类图同步。[报告](verification/execution-isolation-platform-20261108.md)、[支持矩阵](task/execution-isolation-support.md)。R12保持部分完成，下一片冻结任务范围/授权及孤儿核实，再接R09-C程序验证；第1–8组继续，第9组仅计划。独立本地提交，不推送。

## 2026-11-08：静态PNG真实解码验证

- 对应步骤：Step52 / R09-B，承接a7ba217。纯冻结尺寸/通道与平台完整CRC/解压/像素还原分层；原验证器、基线/完整清单与共同出口一致，旧JSON/CSV兼容。
- 实际验证：36文件283/283，0失败/跳过；源码/脚本--noEmit及架构通过，51目录535代码/样式、1038文件5588依赖0环。EXE20261108-151047正常6/16、变化7/16、停止3/9、人工拒绝10/16，重开无重放，草稿/原记录保留，错误0；21图生成5图目检。最终同指纹，未重跑全仓。
- 同步：13源码注释、9组CONTRACT/ARCHITECTURE、内置执行说明、支持矩阵、roadmap与[本片报告](verification/png-artifact-validation-20261108.md)。实际Pi/Node生成PNG不冒充OS隔离；模型服务为本机确定性来源。
- 接续：R09仅完成JSON/CSV与明确PNG子集，下一片先验证R12平台隔离作为程序检查前置，外部输出与R13衔接；其余已授权包继续，第9组只计划。本片独立本地提交、不推送。

## 2026-11-08：真实CSV产物验证

- 对应步骤：Step51 / R09-A，承接26ac724。冻结表格声明与同字节检查、CSV类型绑定和实际能力预检，基线/完整清单贯通交付、目标与人工决定；原JSON兼容，旧rejected保留。
- 实际验证：33文件239/239；源码/脚本--noEmit及架构通过，51目录533代码/样式、1031文件5552依赖0环。EXE20261108-145110四场：正常修复6/16、变化7/16、停止3/9、人工拒绝10/16；重开无重放，草稿/日志/文件事实保持，错误0，21图生成5图目检。最终所有验证同指纹，未重跑全仓。
- 同步维护：19份源码注释、9组CONTRACT/ARCHITECTURE、内置执行说明、支持矩阵、roadmap及[本片报告](verification/csv-artifact-validation-20261108.md)。初轮夹具遗漏契约版本及类型注入已修正，失败记录保留。
- 交接：R09仍部分完成，PNG、程序/R12及外部/R13分别验收；其它已授权包继续，第9组仅计划。本片独立本地提交、不推送。

## 2026-11-08：跨等待人工意见核验与重新决定

- 对应步骤：Step50 / R08，承接d906011。实际读取旧意见主/成员日志，比较八类依据；显式清空选择并重新决定，新记录关联最新旧意见，保存与继续独立。旧接受不跨等待自动继承，原历史不改写。
- 验证：最终27文件249/249、0失败/跳过、约251秒，源码/脚本类型及架构通过，51目录532源码/样式、1025文件5516依赖0环；本片未重跑全仓。初次EXE旧接续卡错误已修并新增回归，测试共享夹具污染已改独立副本，原失败报告保留。
- 成品：最终EXE 20261108-142543实际Pi两次等待至completed，主/成员16/8；显式新选择/意见、集合新增阻断、原日志损坏、重开、接受后变化拒绝继续均验证。原候选/意见/日志/普通草稿保持；8图生成4图目检，页面/传输错误0，无重放。最终源码/内置/测试树同指纹。
- 维护与接续：9个源码注释及4组CONTRACT/ARCHITECTURE、内置说明同步；[报告](verification/human-decision-applicability-20261108.md)、[计划](task/human-decision-applicability.md)。不证明完整业务主体语义相等、真人理解或账号认证；真实Pi使用本机确定性服务，不代表在线自主质量。下一片R09先列支持矩阵及代表任务，R03/R07-C及R09–R17继续，第9组只计划。本片独立本地提交，不推送。

## 2026-11-08：真实删除移动与完整产物证明

- 对应步骤：Step49 / R07-B2，承接b787f40。冻结文件操作、真实独占句柄、先可靠阶段后副作用及完整前后集合核实；成功证明贯通JSON、交付、目标和人工决定。未知/坏wire保留本轮只读求助屏障，不重发或恢复。
- 验证：最终45文件397/397、0跳过，约312秒；源码/脚本类型及架构通过，51目录531源码/样式，1020文件5492依赖0环。本片未重跑全仓。平台初轮36/37暴露空父目录重命名问题，加入LIST_DIRECTORY后24/24；类型收窄及类型循环已修，原失败报告保留。
- 真机：最终20261108-132722自动/源重现阻断/人工三场通过，主/成员6/13、7/13、11/13；原操作及两端展示，预览/接受后变化阻止通过，重开无重放，双击无重复，原意见/候选/日志/草稿保持，错误0。13图生成、6图目检，自有成功样本和进程清理，用户原进程保留。源码540、内置21、测试/脚本524项在最终检查/回归/构建/验收同指纹。
- 维护与接续：中文注释、10组CONTRACT/ARCHITECTURE及内置执行说明同步；纯工具接口隔离引擎与运行实现。[报告](verification/artifact-transition-proof-20261108.md)、[计划](task/artifact-transition-proof.md)、[R07范围](task/complete-artifact-manifest.md)。本机NTFS普通UTF-8文件≤1MiB、最多4项；没有目录递归/未知恢复/任意进程隔离。R07-C外部输出与R13衔接，R03保留失败阶段统一适配缺口；下一片R08跨等待人工依据。第1–8组继续，第9组仅计划。本片独立本地提交、不推送。

## 2026-11-08：完整集合身份贯通交付与验收

- 对应步骤：Step48 / R07-B1，承接86609ce。显式完整出口及同一manifest身份贯通成员交付、真实JSON验证、目标审阅/完成、人工预览/提交与接受后继续；目录新增不能借旧JSON或文件未变通过。交付门闩保持到真实工具结束，旧选定文件模式与记录独立兼容。
- 验证：最终35文件283/283、无跳过，约195秒；类型/脚本类型/架构通过，51目录525源码/样式、1008维护文件5420依赖0环。本片未重跑全仓。初始Pi两处预期错误及最终人工核心夹具缺modules导致4失败均已修，失败报告保留，产品行为未为夹具放宽。
- 真机：最终20261108-123902自动/集合变化/人工三场通过，主/成员6/8、7/8、11/8；预览变化禁接受、接受后新增拒绝继续、重开无重放、恢复全集合后显式继续，双击无重复，原意见/候选/日志/草稿保持，页面及传输错误0。10图生成、6图目检，自有成功样本和进程清理。源码及内置规则检查至验收同指纹；夹具修正后的测试树回归至验收同指纹。
- 维护与接续：7组CONTRACT、受影响8份ARCHITECTURE及中文文件头/关键接口和内置规则同步。[报告](verification/complete-artifact-acceptance-20261108.md)、[本片计划](task/complete-artifact-acceptance.md)、[R07后续](task/complete-artifact-manifest.md)。仍需R07-B2真实写前及删除/移动原操作与两端证明，R07-C外部输出与R13衔接；第1–8组继续，第9组仅计划。本片独立本地提交，不推送。

## 2026-11-08：声明范围完整本地产物清单

- 对应步骤：Step47 / R07-A，承接6eb1c69。Workflow冻结观察范围、真实两次完整目录枚举、唯一授权与成功回执、显式只读报告/面板；包含空目录及缺失根，新增文件不能借旧文件哈希相同被遗漏。旧选定文件覆盖保持独立，声明本身不是交付出口。
- 验证：最终冻结相关24文件187/187，无失败或跳过，约62秒；类型/脚本类型/架构通过，51目录524源码/样式、1000维护文件5337依赖0环。本片未重跑全仓。初始Pi夹具误用记录函数导致2失败及脚本类型错误，修复后真实Pi2/2与最终回归通过，原失败记录保留。
- 真机：最终20261108-114421正常/停止/超限三场通过，主/成员6/6、3/4、6/6；真实新增/移动/缺失和超限核实，查询与重开无新请求，原canonical/native/图/调度记录和草稿不变，页面错误0、自有成功样本清理。13图生成、5图目检；533源码/配置、21内置规则和511测试/脚本在最终检查、回归、构建及验收同指纹。
- 维护与接续：中文注释、10组CONTRACT/ARCHITECTURE及内置执行规则同步；Bridge不导出Node/文件实现。[报告](verification/complete-artifact-manifest-20261108.md)、[R07计划](task/complete-artifact-manifest.md)、[下一片Step48共同验收身份](task/complete-artifact-acceptance.md)。R07仍缺共同出口、删除/移动前态因果及外部输出；本机确定性服务不代表在线自主质量。第1–8组继续，第9组仅计划。本片独立本地提交，不推送。

## 2026-11-08：逐模型请求可靠预算

- 对应步骤：Step46 / R06，承接a2868f6。显式逐请求模式、同一工作区可靠预留/发送意图/结算；主/成员、重试和真实自动摘要共用冻结周期，三种现有API严格核缓存与推理用量。终态落盘后才交付，未知/取消后未决及重启遗留保持占用，明确未发送才释放；旧运行间软限额不迁移。
- 验证：最终冻结全仓311文件2068/2068，无失败或跳过，1486秒；最终相关20文件113/113，134秒。类型/脚本类型/架构通过，51目录514源码/样式、979维护文件5232含类型依赖0环。初始摘要触发/周期断言、视图文件发现及桌面等待问题已修，失败原报告保留，不累加重叠批次。
- 真机：最终20261108-103605正常/额度阻断/用量未知三场通过。主/成员6/5、1/0、1/0；正常11次结算1920 Token，拒绝场下一请求到达供应商0，未知保留69632 Token。未来设置改变与重开均不改变旧周期/图/journal或重发模型请求；页面错误0，自有成功样本清理。最终9图生成、5图目检。真实Pi+本机确定性供应商，不代表在线账单或自主质量。
- 维护与接续：中文文件头/关键接口、11组CONTRACT/ARCHITECTURE及内置说明同步；修正task-loop过时一次检查点说明以匹配Step45。源码/配置523、内置资料21及测试/脚本500项在全仓、相关回归和构建同指纹。[报告](verification/model-request-budget-20261108.md)、[支持范围](task/model-request-budget.md)、[下一片完整产物计划](task/complete-artifact-manifest.md)。R06约定范围完成；R03和R07–R17继续，第9组仅计划。本地独立提交，不推送。

## 2026-11-08：同任务多段可靠检查点

- 对应步骤：Step45 / R05-B，承接75733ee。最多16检查点、17运行，历史预约追加保存，逐段一次消费；等待/预约/领取核全链与累计文件，最新可靠触及覆盖旧值，早期未再触及路径仍受保护。每批16文件/32 MiB，所有批次共用15秒期限。
- 验证：初轮冻结全仓306文件2023/2025，2失败、0跳过，1464秒；修复计数夹具及首次预约负责人判别后，最终相关21文件141/141，254秒，未重复全仓。类型/脚本类型/架构通过，51目录504源码/样式、961维护文件5152依赖0环。其它开发中失败、修正和原报告保留。
- 真机：最终20261108-094054继续/停止/放弃三场通过，主/成员24/27、16/12、23/12，另有1/0/1次实际自动摘要。两次等待与重启保持，早期文件变化拒绝；原身份/权限/canonical/草稿不变，历史段只读、重开与查询无新增请求。错误0，自有成功样本清理；最终31图生成、6图目检。初包三场证据另保留。
- 维护与接续：中文文件头/关键接口、8组CONTRACT/ARCHITECTURE及内置规则同步；最终511项源码/配置、21内置资料和492测试/脚本在修复后回归、构建与验收同指纹。[报告](verification/member-checkpoint-chain-20261108.md)、[计划](task/member-checkpoint-chain.md)、[R05支持范围](task/member-checkpoint-support.md)。R05约定的可靠生命周期已完成，异常和完整产物边界不扩大；下一片[R06逐请求预算](task/model-request-budget.md)。第1–8组继续，第9组仅计划。本地独立提交、不推送。

## 2026-11-08：成员检查点持久等待

- 对应步骤：Step44 / R05-A，承接b00bb0e。严格完整 memberPause 冻结可靠检查点与原未领取后继，重启仅保持等待。用户明确补充重新核实知识/岗位/模型/日志/native/文件及原权限；失败不消费，成功再重规划和预约。停止原子封存，同命令仅一份启动意图。
- 验证：首轮相关37文件291/291；桌面拒绝分类修正后最终相关8文件66/66，73秒，类型/脚本类型/架构通过；51目录502源码/样式、955维护文件5102依赖0环。新服务10项及真实Pi重启/继续/文件变化/权限/停止4场包含其中；本片未重跑全仓。初始夹具provider错误及首包错误分类已修复，原失败报告/桌面现场保留。
- 真机：最终20261108-083556完整、等待取消、继续后停止三场通过，主/成员16/22、8/7、9/7。实际文件变化拒绝，双击只一次受理；原身份/日志/草稿保持，查询与重开无新增请求，错误0、自有成功样本清理。源码配置509项与内置资料21项在修复后回归/构建/验收同指纹；确定性模型不代表在线业务质量。
- 维护与接续：中文注释、六组CONTRACT/ARCHITECTURE和运行规则同步。[计划](task/member-persistent-wait.md)、[报告](verification/member-persistent-wait-20261108.md)。R05仅完成持久等待片，下一片多段检查点；第1–8组继续，第9组仅计划。本地独立提交，不推送。

## 2026-11-08：已放弃检查点来源的候选替换

- 对应步骤：Step43 / R04-3，承接5321e78。可靠检查点明确放弃后，原完成段/证明/通道/租约及预约信封核实，换入同周期真实新候选并保留未启动后继身份。原任务仍取消、不复活；普通取消/未知/损坏或过期岗位拒绝。
- 验证：最终相关33文件240/240，无失败/跳过，260秒；服务5/5与真实Pi完整/坏回包/停止/重开4/4包含在内。类型、脚本类型、架构通过，51目录499源码/样式、947维护文件5044依赖0环。本片未重跑全仓。
- 真机：最终20261108-074927三场通过，主/成员18/20、15/10、15/10；原检查点只一轮，B/C按A2真实候选首次执行，停止场无新成员；查询/重开无新增请求，原canonical/native/草稿保持。错误0，自有成功样本清理，21图生成、6图目检，505项源码/配置同指纹。
- 初次问题：夹具严格游标、产品身份比较、缺省claim断言和测试类型已修；脚本类型漏noEmit生成304副本，核实并清理后通过架构检查。首次EXE选择器匹配两处，限定检查点卡后同包复验。原失败报告/样本保留；确定性服务不代表在线自主质量。
- 维护与接续：中文注释、5组CONTRACT/ARCHITECTURE及运行规则同步。[计划](task/abandoned-checkpoint-dependency.md)、[报告](verification/abandoned-checkpoint-dependency-20261108.md)、[R04支持范围](task/dependency-revision-support.md)。R04约定的安全依赖调整已完成；下一片R05-A持久成员等待和重启后显式继续，第1–8组继续，第9组仅计划。本地独立提交，不推送。

## 2026-11-08：未领取任务原子前置修订

- 对应步骤：Step42 / R04-2，承接908416a。同一未领取目标最多32条退役/32个新增，完整图防环、最多500任务闭包；原任务、实例、计划、信封不变。当前知识/岗位/版本及停止/真实领取竞争逐层核实，Store独立裁决精确变化，旧边和审计不可重写。
- 接线：真实主工具、严格输入输出、原命令只读核实、Auto待办及历史面板一同完成。坏回包只查原committed、原失败保持；删除最后前置重算queued不代表执行或验收。
- 验证：最终相关33文件245/245，无失败/跳过；真实Pi完整、坏输出、准备期停止、保存后停止四场含在其中。类型、脚本类型、架构通过，51目录499源码/样式、942维护文件5011依赖0环。本步未重跑全仓，早期重叠批次不累加。
- 真机：最终20261108-072613完整/停止/关闭后恢复三场通过，请求主/成员11/20、8/0、8/0；查询及重开新增0。原canonical/native/草稿保持，错误0，自有成功样本清理；21图生成、6图目检。505项源码/配置构建前后及最终验收同指纹；本机确定性服务不代表在线自主质量。
- 维护与接续：中文注释、7组CONTRACT/ARCHITECTURE及内置规则同步。[计划](task/queued-dependency-revision.md)、[报告](verification/queued-dependency-revision-20261108.md)。下一片R04-3处理显式放弃检查点来源后的真实候选替换；R04未整包完成，R05–R17继续，第9组仅计划。本步独立本地提交，不推送。

## 2026-11-08：知识刷新原事务绑定

- 对应步骤：Step41 / R03-D4，承接6d14944。refresh v2显式原版本/请求ID，仅空changes；同请求复用原成功journal。可信工具版本由Runtime授权记录，模型/引擎不补造；只有原v2可进入知识事务观察，旧v1保持未知。
- 验证：首批26/26，真实Pi三场3/3，最终相关20文件145/145（重叠不累加）；类型、脚本类型、架构通过，51目录495源码/样式、930维护文件4924依赖0环。本片未重跑全仓。
- 真机：最终20261108-065808，501项源码/配置构建前后同指纹。源码真实Pi刷新1次、索引确实改变后破坏回包，8次种子请求；EXE实际核实committed、明确处置、查询及重开，新增请求0，原failed和journal/canonical/native/草稿保持。错误0、自有样本清理，3图全部目检；确定性服务不代表在线自主质量。
- 维护与接续：中文注释、6份CONTRACT/ARCHITECTURE及内置规则同步。[计划](task/refresh-effect-verification.md)、[报告](verification/refresh-effect-verification-20261108.md)、[R03矩阵](task/recovery-support-matrix.md)。R03仍有外部及缺持久来源分支限制，下一片R04-2通用依赖修订；第1–8组未全部完成，第9组仅计划。本地独立提交，不推送。

## 2026-11-08：受控文件统一影响核实

- 对应步骤：Step40 / R03-D3，承接 a3b9f37。原成员受控五阶段与独立补偿进入统一观察/明确处置，严格核原授权、完整绑定、scope、operationId及原前后摘要；两次读取变化拒绝旧依据，旧报告兼容。Main复用原只读报告，无新进程/业务IO，补偿资格继续由独立预览核实。
- 验证：服务13/13，真实Electron/Pi6/6（含部分写、坏回包、停止和换ID对抗），最终相关15文件172/172，类型/脚本类型/架构通过；51目录495源码/样式、928维护文件4914依赖0环。没有重跑全仓，定向批次重叠不累加。
- 真机：最终20261108-064352两场通过，501项源码/配置构建前后同指纹。正常原写与补偿各1次，补偿丢回复只查询；部分写原failed/unknown保持，无补偿入口。统一观察、处置及重开无新增模型/写入，原图/周期/canonical/native/草稿保持，错误0、自有成功样本清理。18图生成、6图目检。初场脚本选择器匹配多个面板失败，修正后相同EXE复验，失败证据保留。
- 维护与接续：中文文件头/关键接口、4份CONTRACT及4份类图同步。[计划](task/controlled-effect-verification.md)、[报告](verification/controlled-effect-verification-20261108.md)。下一片核实refresh原请求绑定和剩余支持矩阵；R03与第1–8组未全部完成，第9组仅计划。独立本地提交，不推送。

## 2026-11-08：原治理与负责人保存核实

- 对应步骤：Step39 / R03-D2，承接 4db3a27。主治理 observe/propose 和负责人 commit 按原 canonical 主身份、实际严格参数、稳定 commandId 与原指纹核实；治理已校验账本和责任不可变事件/回执分开读取，原 failed/unknown 保留。公开纯摘要不带正文或私有路径，两次读取变化拒绝旧处置依据，旧报告 basis 兼容。
- 验证：最终相关19文件177/177，含原影响/知识、治理/负责人和13项依赖分层；类型、独立脚本类型与架构通过，51目录494源码/样式、926维护文件4894依赖0环。初次夹具语法、计数与测试类型问题修正并保留失败报告；本步未重跑全仓。
- 真机：最终 20261108-063249 三场真实点击通过。源码真实Pi保存后丢回包，目标原写各1次（治理场景还包含正常独立写），模型9/8/6次；最终EXE观察/处置/重开均无新增请求。原dispatch前缀、治理账本/锚、知识journal、canonical/native及草稿保持；只追加一条处置，页面/通信错误0。9图生成、6图目检，自有进程与临时目录清理；500项源码/配置构建前后同指纹。
- 维护与接续：相关中文注释、7份CONTRACT及8份类图同步。[计划](task/governance-effect-verification.md)、[报告](verification/governance-effect-verification-20261108.md)。下一片R03-D3纳入受控文件原阶段和补偿记录，旧refresh与其它异常继续按矩阵；R03及第1–8组仍未全部完成，第9组仅计划。独立本地提交，不推送。

## 2026-11-08：原知识提交事务核实

- 对应步骤：Step38 / R03-D1，承接 `ae7d7b5`。知识提交/对象提交按原 canonical、knowledge-write 授权、实际解析参数、固定计划及原 journal 核实；原工具 failed/unknown 与事务 committed 分开，旧实例只读，查无记录不作为未执行证明。公开摘要不含正文/清单/私有路径，明确处置复用原稳定请求和独立后续周期。
- 边界：两次查询核阶段稳定；查询不提交、恢复、刷新索引或修剪目录。对象事务不证明空目录清理。旧报告及处置不补字段、不改变 basis。旧 refresh 缺原内部请求绑定仍未适配，不能以当前正文推测原事务。
- 验证：相关10文件89/89；公开叶子与后端解析拆分后7文件47/47（含13项依赖/分层），相互有重叠、不累加。最终类型/架构通过，51目录491源码/样式、919维护文件4841含类型依赖0环。本步未重复全仓；前一步1915/1915为历史记录。首包公开协议间接带入Node哈希而构建失败，拆分后最终构建通过；测试泛型及两项验证配置错误修正，原失败报告保留。
- 真机：最终 `20261108-061532` 两场通过。隔离源码真实Pi实际知识/对象各提交1次后破坏回包，最终EXE真实点击查询/处置与重开；原工具failed、原事务committed保持，模型请求11/8次，查询及重开新增0次。原journal/canonical/native、周期/运行和草稿保持，页面/通信错误0；6图生成、4图目检，自有进程/临时目录清理。497项源码/配置构建前后指纹一致。
- 维护与接续：中文文件头/接口、7份CONTRACT和11份类图同步。[计划](task/knowledge-effect-verification.md)、[报告](verification/knowledge-effect-verification-20261108.md)。下一片R03-D2接治理观察/提案与负责人原命令；R03及第1–8组仍有未完成范围，第9组仅计划。独立本地提交，不推送。

## 2026-11-08：受控文件写入与独立显式补偿

- 对应步骤：Step37 / R03-C，承接 `5ccae12`。正式成员的 `cbim_file_write_controlled` 保存真实句柄 before/intended-after、原可信授权与不可变阶段；桌面明确预览并另建补偿，不改原工具/操作或业务验收。限本地 Windows NTFS 已有普通单链接 UTF-8 文件，各正文最多1 MiB；旧 native/shell 不补造备份。
- 异常边界：专用 utility 持真实目录/文件句柄，实际 IO 退出后释放占用；部分写、丢wire和终态未知不重放。受控写失败后即使换调用 ID，后续写入、命令、交付及检查点仍被拒绝；只读与暂存求助保留，最终 interrupted。只有可信原 not_applied 与实际退出可解除。补偿丢回复只查原命令，查询失败不改变先前明确拒绝。
- 验证：冻结源码全仓 289 文件、1915/1915 通过，无失败或跳过，耗时 1254 秒；494 项源码/构建配置指纹在全仓前后及最终构建一致。类型、架构和13项边界通过，Runtime/服务/UI定向42/42、真实Pi对抗2场通过（与全仓重叠，不累加）；完整回归覆盖6个真实Pi分支。旧空全仓日志没有完成回执，不计通过；旧包cwd、测试夹具及桌面探针错误修正与原失败证据均保留。
- 真机：最终 `20261108-054047` 正常与真实只读映射部分写两场通过，主/成员/独立会话请求6/11/1、6/5/1。正常原写一次、独立补偿一次，补偿已保存后丢回复不重写；partial保留unknown且无补偿入口。原图/周期/审阅、canonical/native与文件字节均核对，重开零模型/文件重放，两root草稿保持；页面/通信错误0。生成12图、已目检6张关键图，自有成功场进程/目录清理，失败现场保留。
- 维护与接续：相关中文注释、13份CONTRACT与19份目录类图同步，51目录488源码/样式、911维护文件4787含类型依赖0环。[计划](task/controlled-file-compensation.md)、[报告](verification/controlled-file-compensation-20261108.md)。R03仍未整包完成；下一片R03-D1接知识/对象原事务核实，治理、负责人及其它异常按矩阵继续。第9组仅计划，独立本地提交，不推送。

## 2026-11-08：异常影响核实与新修复关联

- 对应步骤：Step36 / R03-B，承接 `0631156`。真实主/成员来源、原授权文件当前观察、八类主控制面原回执、不可变本机处置与独立新核实/修复串联；原 unknown、原生/canonical 及人工意见不改。bash 等未覆盖作用明确保留未知。
- 接线与边界：同一 Store 有界追加处置；恢复/重规划 IO 在短事务外，最后 CAS。公共周期投影保留安全来源和处置引用、不泄漏私有上下文；unknown 裸 ID 不再恢复原 native，正常续聊及历史兼容保持。界面显式读取、共享时效及迟到响应隔离，普通草稿独立。
- 验证：冻结源码全仓 282 文件、1840 项，1839 通过、1 失败、无跳过，耗时 1179 秒。唯一失败是并发测试错误假设先调用必先提交；改为明确让后发先提交并核唯一 fresh 后，相关 4 文件 43/43 全部通过，未再跑全仓。478 项源码/构建配置指纹在运行前后及最终 EXE 一致。最终类型/架构通过；相关 Core/Store、服务、UI、真实 Pi 均有独立报告且与全仓重叠。51目录472源码/样式、882维护文件4648含类型依赖0环；中文注释、10份CONTRACT及16份类图同步。
- 真机：最终 `20261108-041426` 两场通过；完整链新增模型24次，unsupported 0次。2/1条明确处置，新只读/业务周期1/1与0/0；原4运行字节不变，重开全部10/4运行和完整journal保持、零重放，双root草稿保留，页面/通信错误0，12图目检。仅清理成功自有样本，初次失败现场保留。
- 初次问题：联调中的严格hash顺序、公开投影、Pi edit数组、历史查询/时效及缺任务轨道已修。初轮全仓1830/1835且源码变化，另行冻结跑完最终全仓；两项真机脚本定位断言纠正后最终包独立复验，未放宽门禁。
- 限制与接续：观察/处置不是业务验收，无before不回滚。下一片R03-C受控文件写与独立补偿，R03其余及R04–R17继续，第9组仅计划。详见[计划](task/effect-observation-repair.md)和[验证报告](verification/effect-observation-repair-20261108.md)。按要求本轮独立本地提交，不推送；实际hash由Git生成。

## 2026-11-08：原主命令核实与独立只读报告

- 对应步骤：Step35 / R03-A，承接 `a519dd4`。八类主写命令从真实canonical、双主通道归属、唯一周期、原事务前态与解析指纹核实；严格比原回执、提交游标和不可变派发身份，不重写旧journal。
- 入口与界面：新增只读主工具及IPC共用服务，原工具轨道显式查询；failed与committed并存，absent不当作未执行，查询不清未知或触发成员。跨身份/迟到回包拒绝，失败保留报告，普通轮询不回读。
- 验证：全仓 276 文件、1771 项全部通过，无失败或跳过；Core/Store64、服务六文件79及最终两文件20、UI12、真实Pi3分别通过（均与全仓重叠）。最终类型/架构和25项UI/边界通过；51目录460源码/样式、860文件4488含类型依赖0环。9份CONTRACT、15类图、中文注释同步。
- 真机：最终030214两场首次通过、8图目检，实际query各3次；种子请求10/5/1与5/0/1，打包端新增模型/事务均0，原canonical/native/journal、草稿、重开保持。仅成功自有样本清理，未操作用户程序。
- 初次问题如实保留：真实Pi发现主对话/任务邮箱双通道误拒已修；夹具缺字段、错误gap/scope及重开封存断言已修；独立复查补原游标/信封和日志首尾。初包功能通过后仅修卡片继承红色，最终包重新验证且有唯一样式差异指纹。
- 限制与接续：仅控制面原提交核实，不是通用副作用证明/补偿/验收，不提供旧native重启。下一片[Step36](task/effect-observation-repair.md)仍待实施；R03其余及R04–R17继续，第9组仅计划。详见[验收报告](verification/original-command-verification-20261108.md)。本步未推送，提交hash待Git实际产生。

## 2026-11-08：负责人变更后的显式存量交接

- 对应步骤：Step34 / R02-D，承接 `f94c821`。同活动周期主工具显式放弃未消费检查点及未领取预约，保留原任务、负责人、运行、证明和原生记录；旧后继明确撤销，新岗位独立任务提供真实候选与替代审阅。
- 边界：历史 canonical/原证明在事务外核实，当前知识/文件/native/模型变化不阻止结束旧待办；精确 Store 事务裁决版本、租约与领取竞争，迟到 ACK 独立保留。Auto 等待处置收口，坏回包也只读查原命令撤旧票，原错误不被改写成成功。
- 界面：主卡/图/详情区分显式交接放弃和普通封存；原岗位模型与当前责任分开。目标审阅可实际跳转原/新任务，不改派发边或草稿。
- 验证：全仓 270 文件、1716 项全部通过，无失败或跳过；Core/Store、服务/协调、UI与实际Pi定向均有报告，初次夹具错误及修正保留。类型/架构/13项边界通过，51目录451源码/样式、842文件4360依赖0环。15份目录类图和受影响注释/CONTRACT同步。
- 真机：最终 `20261108-021118` EXE及ZIP生成，正常/预约/提交后实际停止三场首次通过，24图目检；请求main/A/B为21/7/15、22/7/15、10/7/0，零页面/通信错误。原A写入1次，绑定/canonical/native不变，重开无重放，457项源码/构建配置指纹一致。仅清理自有通过样本，未操作用户旧程序。
- 限制与接续：使用真实Pi与本机可控模型，不代替在线判断或账单；没有通用异常恢复、跨重启续执行或旧native迁移。R02四片闭环完成，下一片R03-A原命令核实；R03–R17继续，第9组只计划。详见[验收报告](verification/module-owner-handoff-20261108.md)及[下一步计划](task/original-command-verification.md)。本步提交完成前不写虚构hash，未推送。

## 2026-11-08：负责岗位进入正式派发与实际领取

- 对应步骤：Step33 / R02-C，承接 `7048d3d`。实际查询负责岗位，目标和派发保存不可变 ownerBinding；领取重新核当前岗位、受控来源、逐模块责任、能力与模型，使用岗位独立模型/适配。同静态 Agent 的两个岗位仍分别创建实例与通道，无负责人或失效配置不暗回退。
- 运行与迁移：知识→模型设置→任务短事务固定先后，引擎在提交后启动；检查点预约与领取共用原绑定。旧直接业务入口拒绝，旧日志可读、旧在途按原事实收束；新存储协议拒绝降级及伪 mutation。修复 canonical/Workflow 投影遗漏绑定；人工依据取证与短事务分离，避免受控提交端口等待自身。
- 界面：主成员卡、节点详情和目标分配显示原岗位/模型/来源；主动只读比较当前配置，迟到响应按任务版本隔离。不修改旧绑定或隐式采纳。
- 验证：冻结候选全仓267文件1683项，1668通过/15失败；全部7个旧夹具文件修后定向39/39，未再跑全仓，不称单批全绿。初轮陈旧缓存诊断精确停止，未生成完整报告、不计作全仓通过。最终类型/架构与13项边界通过；51目录447源码/样式、831文件4263含类型依赖、0循环。详细失败、修正与真实Pi证据见[报告](verification/module-owner-dispatch-20261108.md)。
- 真机：最终 Windows EXE `20261108-005337` 三场首次通过。正常主/两成员请求9/5/5；A→B→A后旧A为0、B为5；真实235854旧版样本升级，新版请求0。原 canonical/native、普通草稿和历史保持，重开不重放；页面/通信错误0，13张截图检查。旧排队拒领为显式IPC、检查点历史为实际界面，分别记录；自有成功场次进程/目录清理，保留旧样本未动。
- 维护与接续：中文注释、24份类图和15份CONTRACT同步，README/Loop/成员说明清理旧无周期与主模型继承用法。453项源码/配置指纹与EXE一致，后续修正仅测试。下一片[Step34存量交接](task/module-owner-handoff.md)待实施；R02未整包完成，第9组继续仅保留计划。

## 2026-11-08：受控知识来源与明确采纳

- 对应步骤：Step32 / R02-C 前置，承接 `2f4cb66`。同 DispatchStore 记录来源代次和不可变事件；普通编辑保持代次，受控删除重建/整包替换不因同字节复活旧来源。旧岗位/责任不自动升级，能力采纳和同负责人来源采纳明确提交，改名保留旧引用。
- 事务与启动：私有知识计划保存实际操作和替换意图，先持久原journal再确认来源pending，成功后结算失败不回滚知识。恢复按原记录核实，未知不重做。工作区锁及身份确认后先初始化Agent历史，再首次读取Store，修复重开正常历史被误诊为重复的问题。
- 验证：首轮全仓257文件1624/1625，真实历史问题修后定向6文件35/35；第二轮258文件1627/1628，原历史及启动测试通过，唯一队列夹具采样修后5/5定向通过。未跑第三轮，不称单批全绿。最终类型/架构与边界通过；真实子进程终止验证知识提交后来源只补一次结算、重开不重写。
- 真机：最终包 `20261107-235854` 两场首次通过，正常场UI知识提交5次/岗位采纳2次/责任采纳1次；真实旧222611种子升级场知识提交0次/岗位操作2次/责任采纳1次，恰2条首次观察来源。重开提交、模型HTTP/运行、页面/通信错误均0；原日志和草稿保持，11张截图逐张检查。仅清理本次成功场次自有进程和目录，不操作用户旧版进程。
- 维护：中文注释、18份类图及15份CONTRACT同步，51目录436源码/样式、799维护文件3928含类型依赖、0循环。[计划](task/knowledge-source-lifecycle.md)、[报告](verification/knowledge-source-lifecycle-20261107.md)。下一片[Step33负责人派发](task/module-owner-dispatch.md)仍须接真实计划/领取和岗位模型；D存量交接未完成。组9仅保留计划。

## 2026-11-07：单模块负责人控制面

- 对应步骤：Step31 / R02-A2/B，承接 `f70a968`。同一 DispatchStore 保存稳定 bindingId、递增责任版本、独立游标和不可变审计；设置、更换、解除与岗位反查接通，引用未解除不能退休，暂停保留关系。当前模块缺失仍可解除，不据旧任务 assignee 推导岗位。
- 主工具与界面：桌面和真实主 Agent 共用预览/提交/原命令查询；主工具先发现真实岗位摘要，可信闭包注入身份，成员不安装。read/ask/execute 沿原治理权限；准确控制面回执不冒充业务证据，也不清除原目标门禁。未知请求本机持久化，重开只查原命令。
- 验证：最终24文件 **218/218**、13项边界及类型/架构通过；实际Application/Pi 2文件8/8包含 read、ask拒绝/批准、execute、停止及已提交坏回包。未重复全仓。早期真实 registry 字段读取错误已修，夹具及初轮失败证据保留，未放宽协议。
- 真机：最终 EXE `20261107-222611` 正常/丢回复两场通过，正常A→B→null→A→null共5提交；未知实际1提交/1审计，重开均0提交。知识/执行状态、登记日志字节和双工作区草稿保持，模型HTTP/运行及页面/通信错误0；成功场次自有进程/目录清理。首轮两项脚本定位/折叠可见性错误修正后同包通过，失败目录与报告保留。
- 维护：15份类图、13份CONTRACT及变更文件中文注释同步，51目录426源码/样式、778维护文件3790含类型依赖、0循环。[计划](task/module-ownership-control.md)、[报告](verification/module-ownership-control-20261107.md)。本片只完成责任控制面；下一片补受控来源及明确采纳，C实际派发/D交接仍未完成。组9仅保留计划。

## 2026-11-07：稳定项目岗位成员登记

- 对应步骤：Step30 / R02-A1，承接 `df5a609`。同一 DispatchStore 保存稳定岗位、能力与公开模型采纳、独立游标及单条不可变审计；改名、分别采纳、暂停/启用/退休均按原版本提交，退休不可复活。旧日志不自动迁移，不创建任务、实例或模型请求。
- 界面：团队页新增“项目岗位”，与静态能力树及执行历史分开。先预览再明确提交；共享本机原命令记录处理重复点击、未知及保存失败，重开只查询。实际来源差异按需读取，编辑名称不暗中采用新能力或模型；来源缺失仍保留旧快照并可停用。
- 验证：最终全仓 **244 文件1528/1528**、类型/架构及 **13 项边界** 通过。Core 定向23、Main定向44、界面最终8项全部包含在验收中；Application 丢回复首轮错误码断言与并行装配/脚本类型问题已精确修正，原报告保留。
- 真机：最终 Windows EXE `20261107-215210` 正常与已保存后丢回复两场首轮通过。正常2岗位7次真实提交，未知1次提交/1条审计；重开提交均0、原日志逐字一致。模型HTTP与运行均0，知识/执行状态及双工作区普通草稿保持，页面/通信错误0；测试进程和自有临时目录已清理。
- 维护：Core team/tasks、Main装配/IPC/模型设置/岗位服务/Store、Bridge与前端team的中文注释、9份CONTRACT及13份类图同步；51目录413源码/样式、756维护文件3655含类型依赖、0循环。[计划](task/workspace-member-registration.md)、[报告](verification/workspace-member-registration-20261107.md)。仅完成岗位登记；下一片R02-A2/B接唯一模块负责人设置、更换、解除和反查，包含桌面及真实主Agent治理工具。来源代次、按负责人实际派发与存量交接仍未完成；组9仅保留计划。

## 2026-11-07：安全等待的多来源资料快照

- 对应步骤：Step29 / R01，承接 `6276347`。Core 保留文件/图片 v1，新增严格来源 v2；Main 实际生成目录首层清单、URL 指针、有界网页摘录及已授权仓库七类静态资料，受理只读已保存快照。目录不递归，网页不跳转/执行脚本，仓库读取前后及保存后核授权和代际；资料不安装执行、不代替业务证据。
- 交互：两处等待卡共享导入/提交锁、来源预览及已受理历史；普通聊天草稿独立。原 importId 支持主动取消及会话/工作区退出撤销。真机发现隐藏会话未卸载导致旧导入仍追加，修复为 active 参与选择代次；迟到结果不能进入旧/新草稿，已受理继续不受取消影响。
- 验证：定向22文件 **177/177**，修后界面 **26/26**、边界 **13/13**、类型/架构通过；未重复全仓。真实目录/流式HTTP/仓库覆盖限额、UTF-8、撤权、变代、取消和旧v1兼容；四项真实Pi覆盖12项资料、原命令、来源改变后续跑及重开字节一致。初轮夹具和类型错误精确修正，未放宽协议。
- 真机：最终 Windows EXE `20261107-210415` 切换、完整、丢回包三场通过，主/成员请求分别6/5、13/10、13/10，页面/通信错误0；完整/未知各3次真实系统选择器，重开展开12项历史及七类仓库身份/版本，无模型/HTTP重放。隐藏切换真实取消1次、无快照，原等待/图/日志不变。最终包历史测试文案“正文/内容”不一致已精准修正脚本，同包复验通过；初包失败和两次失败目录保留，成功场次自有进程/目录已清理。
- 维护：Core tasks、Main装配/IPC/附件/资源、Bridge及前端conversation/tasks中文注释、8份CONTRACT和13份类图同步；51目录403源码/样式、741维护文件3589含类型依赖、0循环。[计划](task/waiting-source-snapshots.md)、[报告](verification/waiting-source-snapshots-20261107.md)。R01完成，R04仅单条追加片完成；下一片R02-A1岗位成员登记，模块责任与实际派发后续接入。组9仍仅保留计划，本机确定性模型不等于在线质量/计费验证。

## 2026-11-07：未领取任务追加单条前置依赖

- 对应步骤：Step28 / R04-1，承接 `3007c6d`。主工具 `cbim_dispatch_add_dependency` 接通真实服务，严格核图/目标/任务版本、当前主运行、两端及全部启用后继未领取、知识和 Workflow；拒绝环、重复、旧计划及未核实输入。单事务增加结果前置、目标等待和不可变审计，保留原任务/实例/计划/信封，既有领取链再固定真实来源候选。
- 持久与界面：完整 Core 校验后才向通用边门禁提供精确许可；旧替换、退役、撤销和正常领取继续有效。坏输出保留已提交事实，原命令幂等查询不重复加边。主对话按节点版本显示最新追加/替换，详情保留所有记录，图按真实启用依赖排序，不造执行结果。
- 验证：最终 **29 文件243/243**、边界 **13/13**、类型/架构通过，本片未重复全仓。真实 Pi 正常/准备停止/提交停止/提交后丢回复分别10/15、6/0、7/0、11/15请求；全部实际运行的原生/canonical身份与重开字节严格核对。初轮夹具目标版本、旧工具数断言、信封生命周期断言错误均保留并精准修正。独立真实 Store 的变造批次、旧周期、新周期及追加后来源失败再替换交叉验证通过。
- 真机：同一最终 Windows EXE `20261107-201817` 正常、真实停止、提交后保持时正常关闭重开三场通过，主/成员请求10/15、7/0、7/0；页面/通信错误0，草稿保留、无重放，实际日志字节相同。关闭重开不是强杀测试；首轮脚本标题定位修正后同包通过，自有测试目录及进程已清理，不触碰前序被拒绝删除的目录。
- 维护：Core tasks、调度 execution/tools/conversation、Bridge及前端tasks的中文注释、5份CONTRACT和10份类图同步，成员执行说明更新；51目录396源码/样式、726维护文件3504含类型依赖、0循环。[计划](task/queued-dependency-addition.md)、[报告](verification/queued-dependency-addition-20261107.md)。R04其它修订仍待开发；下一片R01补安全等待目录/网页/已授权仓库资料快照，不新建账号服务；组9仅保留计划。

## 2026-11-07：运行内补充的可信输入版本与目标门禁

- 对应步骤：Step27，承接 `ea680de`。发送前事务登记 pending 并预留输入/决策额度；真实 queued 与接受日志可靠保存后记录实际发送快照，提升目标/输入版本、清除旧审阅。原始目标、历史计划和人工约束保留；unknown/pending 不能沿旧审阅完成、停泊或新派发，重复 accepted 不重发、不重升版。停止保留真实接收后再取消。
- 接收与历史：运行内记录独立于安全等待继续，混合输入序列有界连续，不重置真实主轮上限。两处目标详情展示状态与快照，未知不造正文；普通无计划对话保持轻量。已关闭旧周期的 unknown 不阻止同主会话的新周期，原周期待重规划只拦新领取、不拦已有运行结算。
- 验证：独立 `ea680de` 基线真实 Pi 复现旧完成/等待审阅绕过，各7/5请求。首轮全仓232文件1425项中1423通过；两个旧返回语义断言修正后6/6。交叉审查再修正按实际新增事实而非cause判定未决门禁，最终22文件 **213/213**、边界 **13/13**、类型/架构通过；不冒称最终全仓通过。十条真实Pi覆盖新输入、混合等待、停止前后接收、日志/保存故障和重开无重放。
- 真机：同一 Windows EXE `20261107-194848` 正常、停止、确认丢失通过，主/成员请求22/5、6/5、7/5；普通草稿保留，重开原记录/日志/请求不变，页面/通信错误0。正常脚本两处异步截图/断言等待已修正，产品未因此改动；故障模式只拦截自有Pi精确真实queued ACK，不伪造业务回执。成功场次TMP已清理；首失败目录删除被自动策略拒绝，保留未重试；基线junction有意保留。
- 维护：Core brain/tasks、调度 conversation/execution/tools、Bridge与前端tasks的中文注释、6份CONTRACT、11份类图同步；51目录392源码/样式、715维护文件3415含类型依赖、0循环。[计划](task/active-goal-input.md)、[报告](verification/active-goal-input-20261107.md)。本轮按用户要求结束于剩余组8，组9仅留计划，交付包边界见[清单](task/remaining-deliveries.md)。下一片 R04-1 未领取任务追加单条前置；本机确定性供应商不等于在线自主判断或计费验证。

## 2026-11-07：队列插入绑定原主运行与独立停止

- 对应步骤：Step26，承接 `dda55f1`。两处插入口冻结原主run，Manager/Runtime拒绝旧轮和非主执行；停止穿过claim、附件及原生状态查询。queued确认后仍保留接收事实，未知及保存失败暂停原队列，独立内存屏障不阻断正常成员结果回注。运行终态前排空插入日志，迟到停止只作用原轮。
- 界面：对话与任务根停止使用独立标记，插入等待不再禁用停止；停止期间禁止新发送/插入/继续。已入队就保留保存事实，插入失败不重置草稿或自动再发；跨会话迟到回包不覆盖新状态。
- 验证：最终 **19文件154/154**、**13项边界**、类型/架构通过，未重复全仓。5组真实Pi覆盖正常、附件/状态查询等待停止、原生ACK未知和已确认后停止。早期新增夹具语法/类型错误，以及重开暂停原因断言修正均保留；产品执行事实不由测试提示文本推断。
- 真机：同一最终 Windows EXE `20261107-185053` 正常、插入中真实点击停止、真实接受后丢一次界面回复三场通过，各2请求、页面/通信错误0。停止前只延迟自有快照实际读取的返回；旧项保留暂停，明确测试IPC启动的新run不接收旧消息，普通草稿及重开记录/日志字节保持。原生ACK未知导致暂停与界面回包丢失但已消费分别验证，不混称未接受。两次桌面脚本假设错误证据保留，修正后同包通过；本轮进程/临时目录已清理。
- 维护：Core brain/Pi、调度execution、Main IPC、Bridge、前端conversation/tasks的中文注释、7份CONTRACT及12份类图同步；51目录387源码/样式、702维护文件3315含类型依赖、0循环。[计划](task/queue-insertion-boundary.md)、[报告](verification/queue-insertion-boundary-20261107.md)。下一片优先补active插入的目标输入版本治理，防止新要求之后沿旧review完成；普通问答不强制业务计划。所有模型验证使用本机确定性供应商。

## 2026-11-07：结构化提问严格回包与业务证据隔离

- 对应步骤：Step25，承接 `9a03ebe`。主/成员共用严格问题输入、原题冻结和一次性答案；列表独立副本，真实回答后仅编码一次并核对原题/顺序/补充。停止与回答先发生者生效；已消费后的坏回包保留事实、标记失败，不重新弹题或自动重问。
- 证据边界：步骤、成员候选、Workflow 和目标审阅均排除正常答案及取消回执；旧日志仍可阅读，后续真实读取仍可交付。提问不授予业务权限、不伪造人工验收，也不自动继续安全等待。
- 验证：最终 **18文件144/144**、**13项边界**、类型/架构通过，本片未重复全仓。四组真实 Pi 覆盖正常、域取消、消费后坏回包与实际停止；旧显式 Workflow 两组 Pi 回归通过。测试夹具类型问题已修正并保留记录。
- 真机：最终 Windows EXE `20261107-182341` 正常、停止、实际消费后丢一次回复三场首轮通过，主/成员请求8/7、4/1、8/7，页面/通信错误0、普通草稿保持，重开原图/周期/日志/请求不变。主两题及成员单题使用真实 QuestionCard，未知返回不补发，原问题消失，历史事实可查；目前没有持久答案回执查询接口。自有测试进程与临时目录已清理。
- 维护：Core tasks/tools、调度 conversation/execution/tools 的中文注释、CONTRACT 和7份类图同步；51目录385源码/样式、694维护文件3276含类型依赖、0循环。[计划](task/question-tool-contract.md)、[报告](verification/question-tool-contract-20261107.md)。本机确定性供应商不证明在线质量或计费；下一片修复队列插入的停止竞争和迟到主run绑定，保持原队列及权限。

## 2026-11-07：安全等待补充文件与图片

- 对应步骤：Step24，承接 `6ba9fb6`。显式补充保留原正文及有序附件身份，Main 从本工作区快照一次准备正文、图片和紧凑清单；同一模型配置在受理前复核视觉能力，预算等待后的停止再核实，已受理命令先查原回执，缺失快照不导致重执行。图片只进入本次真实用户消息，后续成员结果不会重复追加。
- 界面与恢复：主对话和任务根共享补充草稿、附件及导入锁，普通聊天草稿独立；切换或关闭丢弃迟到选择。未知请求冻结身份和顺序；已受理回执仅周期状态可更新，矛盾清单或run保留原事实。系统选择器超12项先拒绝再导入，不能静默裁剪。
- 验证：初轮全仓 **221文件1309/1309** 通过；审阅补强回执不可变与原生多选限制后，最终 **8文件61/61**、**13项边界**、类型/架构通过，未第二次全仓。真实 Pi 覆盖快照、非视觉/缺失/损坏/跨工作区拒绝、实际预算await后停止、丢回包与原命令查询；初轮类型和测试夹具失败及修正证据保留。
- 真机：最终 Windows EXE `20261107-175901` 正常与丢回包重开均通过，主/成员请求各13/10，页面和通信错误0。5次真实系统文件选择覆盖普通附件、文本和PNG及13项超量零导入；原文件改变/删除不改变实际图片字节，原生仅一条含图用户消息，两处表单和清单同步、普通草稿保留，重开图/记录/原生日志/请求不变。初次宿主set_value误识别组合框，改用同一Cindy工具的原生Edit输入后成功；未替换系统选择器或使用shell模拟输入。
- 维护：Core brain/tasks、Main装配/附件持久化、调度execution和前端任务页中文注释/CONTRACT及7份类图同步；51目录384源码/样式、687维护文件3227含类型依赖、0循环。[计划](task/waiting-attachments.md)、[报告](verification/waiting-attachments-20261107.md)。不含目录/网页/链接器补充、在线视觉理解或真实收费验证；下一片是结构化提问严格输出与完成证据隔离。

## 2026-11-07：目标与正式派发显式选择模块 Workflow

- 对应步骤：Step23，承接 `0fe0be3`。目标分配、派发与任务保存可选流程选择，按真实本模块挂载清单解析；准备、候选/人工核验、检查点与前置替换保持原选择，缺省不是通配。改选需新计划、新任务，旧记录不补字段；主角色只治理知识，不能为自己选择业务执行流程。
- 界面与兼容：目标分配显示持久指定流程，成员详情显示真实冻结绑定，旧任务不按当前知识重算。修复真实多 Workflow 保存时 Ajv 比较无原型对象的异常，仅在 Schema 边界使用兼容副本并保守拒绝异常数据，保留严格解析、重复字段和唯一性规则。
- 验证：最终冻结产品全仓 **217文件1284/1284**、类型/架构与 **13项边界** 通过。正常/停止真实Pi为6/16、3/9请求，第二Workflow贯穿计划、派发、准备、JSON要求和交付证明；原Step22五Pi在全仓继续通过。早期知识兼容缺陷及服务夹具失败保留原报告。
- 真机：同一 Windows EXE `20261107-171643` 正常与停止通过，主/成员请求6/16、3/9，页面和通信错误0、草稿保留，重开图/记录/日志字节/文件时间/请求不变。首次冒烟脚本误匹配多个详情节点，收窄定位后同包通过，产品未改。成功目录及进程已清理；首失败目录删除被自动策略拒绝，保留目录和证据，未换方式重试。
- 维护：Core tasks/knowledge、调度 context/execution/tools/conversation 与前端任务页中文注释、CONTRACT和10份类图同步；51目录382源码/样式、678维护文件3159含类型依赖、0循环。[计划](task/dispatch-workflow-selection.md)、[报告](verification/dispatch-workflow-selection-20261107.md)。本机确定性供应商不证明在线选择质量；下一片为安全waiting补充文件/图片，保持显式受理与原命令恢复。

## 2026-11-07：冻结 Workflow 的 JSON 产物结构验证

- 对应步骤：Step22，承接 `0107b86`。正式成员按冻结 Workflow 的要求 ID 与当前基线调用 `cbim_validation_run`，受限同字节读取进行哈希和严格 JSON/有界 Schema 检查。模型不能提交规则、路径或通过结论；每次检查保留原运行、调用、规则和文件身份，真实成功回执之后才形成可用证明。
- 出口与人工边界：rejected 可记录已执行事实，不能满足交付。新候选、主审阅和完成复核当前文件；人工接受复核全部必验文件，不能只选有利基线。文件变化/缺失仍可保存拒绝或补证并显式继续，历史真实性与当前接受许可分离；合并读取超限只禁止接受，不扩大范围或伪造无变化。
- 验证：修正前29文件210项通过，审阅发现人工负面交叉边界后修复；最终冻结源码 **33文件242/242**、**13项边界**、类型/架构检查通过，未重复全仓。初轮取消断言时序、错误码预期及关闭周期释放实例的测试断言问题均保留报告，最终组合覆盖修正后的新用例。
- 真机：最终 Windows EXE `20261107-164948` 正常、外部变更、停止、人工负面继续四场通过，主/成员请求分别6/16、7/16、3/9、10/16；页面与通信错误0、草稿保留、重开无重放。人工保存不启动模型，独立继续只增加主调度4次请求，原成员任务不重做。测试使用本机确定性供应商，不代表在线模型判断或计费。
- 维护：Core/Brain/Workspace、Main平台、调度、Bridge和任务详情的中文注释、CONTRACT及14份类图同步；51目录381源码/样式、670维护文件3104条含类型依赖、0循环。[计划](task/json-artifact-validation.md)、[报告](verification/json-artifact-validation-20261107.md)。当前是首种1MiB/16次有界验证器，不支持任意脚本、完整产物原子快照或通用暂停恢复。下一片补正式派发显式选择模块已挂载 Workflow。

## 2026-11-07：执行过程七工具业务输出与保存事实核验

- 对应步骤：Step21，承接 `a096a95`。进度四工具及正式成员求助/基线/检查点三工具返回同一原 JSON wire，核实际运行身份、冻结原请求与保存前事实；旧进度不补造身份，既有 `safeId` 合法格式保持兼容。
- 保存与证据：坏回包不回滚版本或自动重试；求助/检查点保持本轮交接门闩，采集只在真实工具结束释放短锁。跨运行、缺哈希、资源和内部维护回执不能进入当前业务证据；历史报告仍可读旧回执。Workflow 证明从原请求、冻结约定和当前有效回执重算。
- 验证：相关27文件 **200/200**；额外复核发现身份格式收窄后修复，Core **17/17**，最终新进程8文件 **55/55**（含13边界）、类型/架构通过，未重复全仓。真实Pi两种暂存后坏回包均失败留痕、门闩保持、无安全交接或重放。
- 真机：最终Windows EXE `20261107-160638` Workflow、求助、检查点续跑、检查点预约后停止四场通过，主/成员请求6/9、10/10、11/22、8/7；页面及通信错误0、草稿与原记录保留、重开无重放。续跑同task/实例/通道、新run、旧证据清空，真实write1次；停止封存预约。160157中间包证据另存，未作最终验收。
- 维护：Core tasks/tools/brain 中文注释、CONTRACT和4份目录类图，以及运行规范同步；51目录373源码/样式、654维护文件2988条含类型依赖、0循环。[计划](task/member-tool-output-contracts.md)、[报告](verification/member-tool-output-contracts-20261107.md)。下一片补冻结Workflow驱动的有界JSON产物结构验证；确定性供应商不代表在线模型能力，结构合法及工具成功不代表业务验收。

## 2026-11-07：主调度八工具业务输出与原调用核验

- 对应步骤：Step20，承接 `9f2e08e`。Goal/Dispatch 八工具公开严格输出及取消/恢复元数据，绑定可信 workspace/root/scope/run 与原命令；复用既有幂等键、权限和领域事务，未增加成员派工权或业务验收入口。
- 输出与一致性：目标/图来自一次权威快照；周期投影保留人工与恢复来源约束，移除私有原生上下文。领域方法执行一次后核验同一 JSON wire，拒绝缺字段、额外字段、跨身份与 Schema 改写；单任务和整图共用局部状态不变量。空值/缺数组不在批次跟踪中提前抛 TypeError，坏回包不回滚或重放已提交事实。
- 验证：首次全量 **203 文件 1183/1187** 通过（约616秒）；运行期间补入的4个空回包保护断言在该进程中失败。最终源码 **7文件67/67**，全量后新进程 **9文件77/77** 通过，覆盖原失败及撤销、依赖替换、检查点真实Pi流程；未再次全量。类型、架构及13项边界通过。四种新Pi场景包括真实提交后破坏回包，原事实保留且只提交一次。
- 真机：最终 Windows EXE `20261107-153107` 正常/停止/检查点续执行三场均通过，主/成员请求分别8/5、5/1、11/22；页面/通信错误0，草稿保留、重开无重放。检查点文件只写1次，原task/实例/通道不变而新run重新核实。中间包152723未作为最终验收，自有成功进程与临时目录已清理。
- 维护：Core/tasks、Scheduler/tools/execution 的中文注释、CONTRACT及4份目录类图；51目录370源码/样式、647维护文件2940条含类型依赖、0循环。同步[计划](task/main-tool-output-contracts.md)、[报告](verification/main-tool-output-contracts-20261107.md)、运行通用规范和路线图。下一片补执行过程7工具；测试供应商不证明在线模型质量，维护回执不证明业务验收。

## 2026-11-07：全局只读运行总览与原会话任务定位

- 对应步骤：Step19，承接 `ddbf024`。侧栏运行管理集中展示工作区、真实周期、成员、派发任务、模型轮次、准入等待、消息队列与已报告消耗；来源缺失和部分费用明确显示，不把模型一轮结束视作目标完成。
- 投影与交互：复用原事务观察器，scope-only 变更推进独立游标，同事务发布一次；旧 epoch 拒绝迟到回调。前端单次在途读取、noop 保留 DOM/引用、变化只换相关行，离页/隐藏停止订阅。同游标矛盾保留旧值并报错；完整工作区/原根/任务键隔离同号历史。只读导航核实原实例和真实聊天，再选择原周期和节点，保留草稿/附件，不启动任务或恢复执行。
- 验证：全量 **200 文件 1158/1158** 通过（602 秒），最终行身份修正另经 9 文件 58 项回归；类型/架构/13 项边界通过。最终 Windows EXE `20261107-150250` 两工作区三会话通过，主12/成员6真实 Pi 请求；5次 noop、DOM 稳定、离页停读、未启动/活动节点和 waiting 根精确定位、三草稿及重开无重放。页面/通信/弹窗错误 0，自有成功进程与临时目录已清理。本机确定性服务的部分零用量不代表在线计费验证。
- 维护：Core/调度 runtime、Main 监控、Bridge、Frontend 运行管理与外壳/对话的中文注释、契约和10份目录类图；51目录、367源码/样式、637维护文件、2863含类型依赖、0循环。同步使用与边界（历史文档：`docs/global-runtime-management.md`，已清理）、[计划](task/global-runtime-view.md)、[验证](verification/global-runtime-view-20261107.md)。初始脚本IPC解包错误及145809中间包证据保留，最终包重新全程验证。
- 接续：只读总览不提供通用重试/恢复/改派或预算许可，工作区自动化另行推进。下一片补 Goal/Dispatch 八个主调度工具的严格业务回包，保持已有权限、证据和事务语义。

## 2026-11-07：本机补证、异议与治理修订回应

- 对应步骤：Step18c，承接 `3082746`。暂缓/驳回可明确附带补证/异议及期望回应，新提案冻结最多 8 条原意见引用；真实主运行可读取反馈、重新观察并提出精确修订。本机逐项评价独立保存，未评价不补造“已回应”，批准不等于理解认证。
- 来源与事务：原意见被新决定替代后，当前视图明确过期，新的批准、评价与实施按同一串行队列拒绝；原提案、评价及已提交知识历史不被倒推改写。保留 CAS、稳定命令和原回执查询，未重放未知操作；旧记录缺省字段保持原依据。
- 界面：审阅确认绑定提案与来源版本，刷新变化后旧勾选失效；只有明确选择的评价才提交，允许部分评价和独立否定意见。治理草稿、聊天草稿及原记录在重开后保持，保存反馈不自动启动模型或实施。
- 验证：类型、架构、13 项边界通过；相关 16 文件 **111/111** 通过（含真实 Pi 三种反馈场景及已有五种治理场景），未重复上一片全量。最终 Windows EXE `20261107-143946` 正常/来源过期两模式通过，各主/成员请求 14/0，页面/通信/弹窗错误 0；独立实施及旧批准过期拒绝均核对，重开无模型重放，自有进程和临时目录已清理。使用本机确定性供应商，不代表在线模型判断或费用验收。
- 维护：Core/Main/持久治理、Scheduler 执行与工具、Bridge、Frontend 治理的中文注释和契约同步，10 份 ARCHITECTURE；50 目录、358 源码/样式、622 维护文件、2795 条含类型依赖、0 循环。[实施计划](task/module-governance-feedback.md)与[验证报告](verification/module-governance-feedback-20261107.md)。纯解释持久化和实际接管尚未完成。下一片补全局运行总览，保留目标/运行、等待/队列及已报告/完整用量的区别。

## 2026-11-07：主 Agent 的有界治理工具与真实来源

- 对应步骤：Step18b，承接 `b71d61f`。每次真实主运行独立装配获取、观察、提案和原回执四工具，不进入成员共享缓存；模型不能登记保护、签署人工决定或实施。捕获根会话、主实例、逻辑通道、run/toolCall，稳定原命令和来源进入私有账本及提案依据，旧记录不补造来源。
- 容量与恢复：严格原始输入先于任何字段剥离；原/新正文各限 16 KiB UTF-8，最终 JSON 限 128 KiB，目录最近 20 条明确标总数和截断。超长正文返回 oversized，不追加观察；保存后回复未知只查原 commandId，不重试。治理的 read/maintenance/preview 精确绑定 knowledge 范围，不作为业务、Workflow、文件基线或检查点完成证据。
- 界面：业务架构治理面板区分真实主来源、本机操作与缺来源的旧记录，可核对原根和运行；查看来源不启动任务，提案与人工决定/实施分离。
- 验证：最终类型、架构、边界 13 项通过；全量 **191 文件、1096/1096** 通过，含五种真实 Pi 场景。最终 Windows EXE `20261107-141357` 正常和停止通过，主/成员请求分别 8/0、5/0，页面/通信/弹窗错误 0，双草稿及重开记录保持，没有自动决定、实施或迟到提案。确定性本机供应商不证明在线模型质量或计费。
- 维护：50 目录、355 源码/样式、612 维护文件、2755 条含类型依赖、0 循环；中文注释、10 份 CONTRACT、13 份架构文档同步。[计划](task/module-governance-tools.md)与[验证](verification/module-governance-tools-20261107.md)。首次测试期待未脱敏错误及截图投影时序已如实记录；产品边界未因此放宽。下一片实现具体补证/异议、修订方案的来源引用和本机逐项回应评价，不把批准或发送材料当作已理解。

## 2026-11-07：模块知识保护与桌面渐进治理

- 对应步骤：Step18a，承接 `21756c0`。明确登记单个 Module 的定义、正文绑定与可见性，记录真实观察和精确正文提案；批准、驳回、暂缓独立保存，批准后仍须明确实施。普通 CRUD、对象与架构修改、资源包和索引投影不能绕过已登记保护。
- 持久边界：治理共用知识串行队列；有界账本与完整性 anchor 保留命令和不可变依据，原知识 journal 才是实施成功证明。未查到、pending、原实例退役后未提交、回滚和恢复冲突分别表达；重开不重放。已开始提交在关闭/重启时继续 drain，新调用仍拒绝。
- 界面：业务架构节点增加知识治理面板，逐份展示前后原文、取舍、不变量、恢复说明；待确认元数据先保存再发送。决定实际成功但回复丢失时，只查原命令，既不重复决定也不提前实施；新操作清除旧成功提示。本机点击不代表认证负责人或业务验收。
- 验证：初轮全量 187 文件 1065 项中 1063 通过，两项关闭/重启回归修复后 11 文件 71 项通过；最终类型、架构、边界 13 项通过，未重复全量。50 目录、351 源码/样式、601 维护文件、2691 条含类型依赖、0 循环。最终 Windows EXE `20261107-135435` 批准/暂缓/驳回三场景通过，含回复丢失、原回执恢复、独立实施及重开无重放；模型/成员和页面错误均 0。
- 维护：Core governance、Main 治理/持久化/工作区/IPC、Bridge 和 Frontend 治理/业务视图的注释、CONTRACT 与 13 份 ARCHITECTURE 同步。[计划](task/module-knowledge-governance.md)与[原始验证说明](verification/module-knowledge-governance-20261107.md)。下一片只给主 Agent 有界观察和提案能力，人工决定/实施保持独立；通用契约、业务迁移和认知接管尚待后续。

## 2026-11-07：主 Agent 资源仓库读取与精确运行回执

- 对应步骤：Step17b2，承接 `c573bc6`。主运行捕获现有就绪授权，只装配 `cbim_repository_list/get`；准备不读 HTTP，真正调用严格绑定原实例、定义、授权和共享代际。版本化分页与 Unicode 正文分块有界，完整哈希与片段完整性分开；取消/撤销不交付迟到结果，不换源、不重试。
- 边界：Core 共享 repository scope，Main 持有凭据闭包，Scheduler 负责主工具调用与真实回执；成员及未装配入口没有工具。TaskProgress、Workflow、产物与检查点拒绝用外部资料冒充业务证据。前端显示真实链接器/仓库/连接身份和回执，授权页说明资料进入所选模型上下文。
- 验证：类型、架构、13 项层级边界通过；全量 182 文件 **1034/1034** 通过。真实 Pi 五场景通过；最终 Windows EXE `20261107-130357` 正常、停止、撤销均通过，主/成员/工具 HTTP 分别为 3/0/2、2/0/1、3/0/1，重开无重放，页面/弹窗/通信错误均 0。首次停止测试时序交错的 denied 回执单独保留，调整 fixture 等终态后同包通过。
- 维护：相关文件头、接口、13 份 CONTRACT 和 14 份架构文档同步；586 文件、2640 条含类型依赖、0 循环。[验证与截图](verification/resource-repository-tools-20261107.md)。资料仍不是业务验收，在线模型质量、成员授权、外部写入、账号、通用插件及跨机器另行推进。

## 2026-11-07：工作区资源仓库连接与真实 HTTP 核验

- 对应步骤：Step17b1，承接 `01105e8`。严格区分旧 Cindy 静态映射与资源仓库身份；桌面先预览/提交知识定义，再独立授予当前工作区只读权限。共用已明确开启的生产资源服务器，专用只读令牌只允许 GET，模型与界面不接触该令牌。
- 生命周期与核实：实例、定义、授权 CAS 和共享代际在真实 HTTP 前后检查；停止/撤销拒绝迟到结果，无本地读取回退。原请求先保存到本机，切屏/重开不重放；按原知识 journal 和授权回执查结果，仅旧实例退役且无真实记录才证明未受理。复核修复了孤立授权记录及伪造提交缓存两处问题。
- 界面：链接器页明确选择工作区，分别登记、授权、核验和撤销；最多显示 20 项摘要和本次观察时间。共享、授权与资料内容不会启动模型、自动导入资源或激活 Cindy 插件。
- 维护：Core connectors/knowledge、Main 装配/IPC/资源/知识存储/工作区、Bridge 和资源视图；中文关键注释、8 份 CONTRACT、9 份类图同步。46 目录、337 源码/样式、575 维护文件、2575 条含类型依赖、0 循环，最终类型与架构检查通过。
- 验证：13 文件 76 项相关单元/集成回归和边界 13 项通过，未重跑全量。真实 Node 子进程验证先取消、再 8 秒正文超时，不重试；未改变生产超时。最终 Windows EXE `20261107-123831` 完整桌面冒烟通过，两工作区隔离、真实共享/只读读取、撤销、停止无回退、原响应丢失后查回执、重启无服务/模型重放及草稿保持。页面/原生弹窗错误 0，无模型配置和运行日志，仓库原文不变，截图已查看。
- 冒烟记录：两次脚本定位同一个侧栏完整名称失败，仅修定位后同包通过；不是产品执行失败。成功和本片失败自有进程/临时目录已清理，历史被自动审批拒绝清理的目录未触碰。见[验证报告](verification/resource-repository-connector-20261107.md)。
- 接续：Step17b2 将同一真实只读端口接入主 Loop，增加精确仓库 scope 和回执，继续用真实 Pi/最终 EXE 验证。当前只是桌面闭环，不代表 Agent 工具、跨物理电脑、账号或通用插件已完成。

## 2026-11-07：知识工具严格业务输出与按需契约查询

- 对应步骤：Step17a，承接 `df60966`。26 个现有知识工具逐项核验真实领域输出；新增知识目录和契约详情，共 28 个。合法诊断、缺失内容、冲突及 not_found 保持可见，元数据按实际取消和恢复语义说明，不授权、不宣称覆盖其他工具族。
- 一致性：执行一次，唯一 JSON 传输快照；校验副本但发出原快照，拒绝隐式剥离、补值、转换及原地变更。协议错误脱敏且说明可能已有副作用，不通用重试；真实 Pi 故障注入证明事务成功后返回损坏仍仅提交一次。
- 维护：Core knowledge/tools、Scheduler tools 的中文头注释、关键接口、3 份 CONTRACT 和 3 份目录类图同步；类型/架构通过，46 目录、329 源码/样式、560 维护文件、2525 条含类型依赖、0 循环。
- 验证：全量 173 文件 982 项中 981 通过；旧数量断言 26 更新为 28 并显式核对新入口后，4 文件 16 项复测全过，产品未变。边界 13 项及真实 Pi 3 场景通过。最终 Windows EXE `20261107-120219` 正常 11/0、审批前停止 8/0 主/成员请求，两场景页面/通信/原生弹窗错误 0，重开无重放、双草稿及日志不变。截图已查看，自有成功测试进程/目录已清理。见[验证报告](verification/tool-output-contracts-20261107.md)。
- 边界与接续：本机确定性模型不证明在线判断与计费；无损检查不提供事务回滚。接下来以显式开启共享的本机资源仓库作为首个真实只读 HTTP 链接器，凭据留在主进程、授权绑定具体工作区；不伪造账号或激活静态 Cindy 插件定义。

## 2026-11-07：Workflow 稳定条件与并发证据核验

- 对应步骤：Step16a，承接 `6d1d91f`。模块正文可显式声明严格的计划前置与工具回执要求；解析、知识对象/事务和模板共用规则，冻结每个模块自己的正文和条件。缺声明的旧流程兼容，坏声明不降级。
- 执行边界：领取前检查实际工具能力；计划门禁先于审批，审批后核同一版本。交付核当前选择的真实回执，成员结算与主目标审阅重读 canonical、原生通道和固定知识，不信任模型传入 pass。
- 并发修复：真实副作用未结束时不能交付；跨写入窗口的读回执仍记日志但不能作证，写入后须新读取。已明确失败的写入仍可后续重新验证，不把未知结果当作无影响。原生工具分类共用纯注册表。
- 维护范围：Core workspace/knowledge/tools/tasks/brain/Pi，Scheduler context/execution，Main 成员装配；同步中文文件头、接口、9 份 CONTRACT 和 10 份目录类图。类型/架构通过：46 目录、323 源码/样式、547 维护文件、2484 条含类型依赖、0 循环。
- 验证：最终全量实际 169 文件、963 项全部通过；真实 Pi 4 场景含受文件屏障控制的真实并发 bash/read。最终 Windows EXE `20261107-113836` 正常 6/9、能力缺失 6/0、停止 3/6 主/成员请求，页面/通信/原生弹窗错误 0，重开无重放，双会话草稿与原记录保持。已查看截图并清理仅自有测试资源。见[验证报告](verification/workflow-conditions-20261107.md)。使用本机确定性供应商，不代表在线判断或计费验收。
- 如实记录：修复前全量主动中止，旧包 `20261107-112857` 仅一场景通过，不用作最终验收。本步是工具事实和稳定条件核验，不证明专业测试语义、全产物覆盖或通用 Workflow 恢复。下一步补现有知识工具业务输出契约，再推进真实链接器与治理。

## 2026-11-07：按人工决定继续、重新核验与新任务返工

- 对应步骤：Step15b，承接 `1ff5fc2`。保存人工意见后明确点击继续，消费本等待每项最新意见全集；新输入版本保留原目标并要求重新规划。可信 Pi custom 消息只显示系统来源，普通聊天或排队文字不能签署意见。
- 完成与返工：接受只适用当前明确消费的决定、未变业务主体、精确候选/证据及所选文件；审阅与完成各自复核原生来源、canonical、知识及文件。拒绝/补证要求新任务和实例补做，保留旧候选、意见与记录；不混入未获接受的新候选或复用受理前旧任务冒充返工。
- 交互与恢复：双卡共享冻结配置和 commandId，先落盘再发送；未知仅查原请求，重开不执行。存储失败仍可只读核实既有意图，保存成功才解禁发送。返工新等待可显式清除旧选择、重新选择新基线及记录新决定，保存不自动继续，普通草稿和暂停队列保留。
- 维护：Core tasks/brain/Pi、Scheduler execution/tools、Main IPC、Bridge 及 Frontend tasks/conversation；同步文件头、关键接口、9 份 CONTRACT 与 9 份类图。46 目录、319 源码/样式，535 维护文件、2397 条含类型依赖、0 循环。
- 验证：全量实际 164 文件、921 项首次 920 通过；唯一失败是旧人工验收说明断言，更新后目标卡 14 项复测全过，产品未改动。新 Core 12、服务 10、真实 Pi 8，以及两份人工界面控制器共 25 项均通过。最终 EXE `20261107-105706` 同包四场景：接受 11/7 完成，拒绝/补证各 13/14 新任务后等待，停止 7/7 取消；页面/通信/原生弹窗错误 0，两次完整重开及原命令重复无重放。两种返工均记录第二次新成果决定且不自动继续。见[验证报告](verification/human-continuation-20261107.md)；使用本机确定性模型，不代表在线判断或计费验收。
- 清理：成功冒烟自有进程和临时目录已清理；首次脚本读取初始化前文件导致 ENOENT，修正等待后同包重跑。该失败临时目录清理被自动审批 `blocked by policy` 拒绝，保留证据且未绕过。
- 后续：可选 Workflow 的稳定前置、实际工具能力和交付回执要求。未覆盖人工项、跨等待接受继承、全产物/专业证据覆盖、账号身份及通用跨重启恢复仍是明确缺口。

## 2026-11-07：本机人工决定及精确依据持久化

- 对应步骤：Step15a，承接 `6d1859d`。当前安全 waiting 中明确选择人工验收项、成员候选及有界文件基线，核实后记录接受、拒绝或补证意见。保存只追加独立版本历史，不改目标、等待、任务图、成员或模型执行。
- 一致性：当前知识/canonical/选定文件复核、稳定依据指纹、独立 CAS、同命令幂等及同依据替代历史；可信桌面注入本机来源，模型不能构造批准。成功命令的范围限制与工具结果未知分开处理，不承诺工作区整体或外部原子快照。
- 界面：对话卡及任务根共享持久草稿、选定基线、冻结请求和回执；无默认文件选择、无自动文件轮询。未知提交只查或原请求重试；首次明确拒绝需重新核实。关闭重开保留草稿/历史，不启动模型或消费普通队列。
- 维护：Core tasks、Scheduler execution、Main/IPC、Bridge、Frontend tasks/conversation，中文头注释与关键接口同步；7 份 CONTRACT、12 份类图更新。46 目录、308 源码/样式，516 维护文件、2263 条含类型依赖、0 循环。
- 验证：全量 159 文件、877 项通过，新增 Core 13/服务 8/UI 11/真实 Pi 4 项。最终 Windows EXE `20261107-102528` 接受、拒绝、补证、过期依据四场景全过，各主/成员请求 6/7；页面/通信/原生弹窗错误 0，双击一条记录，原图和日志不变，两次重开无新模型请求。截图已查看，测试进程和临时目录已清理。见[验证报告](verification/human-decisions-20261107.md)。本机确定性模型供应商不证明在线判断质量。
- 后续：Step15b 接独立的按决定继续、新计划与成果再核实及拒绝后的新任务返工。本步记录不等于目标完成，不处理跨轮主知识治理证据、认证审批或跨等待自动继承批准。

## 2026-11-07：模块负责人索引设计（文档交付）

- 对应范围：阶段五设计支线。用户明确能力 Agent 与业务分离，但进入工作区后形成岗位成员，模块标记负责人成员，主 Agent 按模块负责人索引派发并支持更换。
- 交付：概念与协议（历史文档：`docs/module-owner-index.md`，已清理）、[实施切片与验收](task/module-owner-index.md)。定义稳定 memberId、工作区成员/责任登记唯一权威、模块关联投影、同事务派发/领取/换人、成员独立模型和 Skill，以及排队/在途/检查点/历史任务的不同处理。
- 审阅修正：区分成员配置、能力来源与采纳版本、外部模型 profile 版本；限定同路径重建检测的可观察范围；把检查点显式放弃及未领取 resume 信封撤销列为交接的必要新协议，未接通前保留待交接缺口。
- 同步范围：核心概念、CBIM 理论、全流程设计中原有“无持久模块负责人/按作者组选人”的表述，概念与任务目录入口、目标调度说明和 roadmap 待实施标记。既有运行 Skill、Schema 与 src 不在本次设计交付中切换，当前成员检查点工作的状态保留。
- 实际验证：新增 JSON 示例解析、修改文档相对链接检查及 git diff --check 通过；两项只读设计审阅的必要修正已写入文档。本次未运行产品功能测试、未构建、未提交，文档检查不代表负责人索引功能已实现。
- 接续：依次实施 A～D 切片，单独验证跨工作区引用、独立配置、同命令幂等、换人与领取/恢复竞争及明确交接。工作区成员登记不等于长期原生会话或跨重启恢复已完成。

## 2026-11-07：成员检查点与同周期一次续执行

- 对应步骤：Step14b，承接 `0d51df6`。执行成员沿成功文件操作提交检查点，正常关闭后核实 canonical、文件、知识和原生会话，释放执行占用。主调度显式预约；原任务、实例、逻辑和原生会话保留，原子领取新 run、下一代租约，旧证据清空，后继按原身份首次执行。
- 并发与恢复边界：预约不占运行名额也不消费检查点；领取前核实当前目标、权限、模型、前置、额度与准入，原生加载前后及发模型前复核。准备期间文件或目标变化会拒绝；停止/关闭封存预约，重启不重放。新 run 失败保留真实尝试，不还原为未消费。
- 界面：主对话、任务图及详情共用记录，明确区分保存、待续、新轮登记与封存；同一节点可以查看旧轮，旧轮不展示新候选。检查点计入全局待办压力，不算活动运行。
- 维护：core tasks/brain/Pi、scheduler execution/tools/runtime、main/platform、Bridge、frontend tasks；同步注释、关键接口、7 份后端 CONTRACT 及其他相关契约、14 份类图。类型/架构通过：46 目录、299 源码/样式，500 维护文件、2171 条含类型依赖、0 循环。
- 验证：最终全量 155 文件、841 项全通过；最终真实 Pi 四分支通过。Windows EXE `20261107-095848` 三场景通过，主/成员请求正常 11/22、预约后停止 8/7、停泊后重启 7/7，页面和通信错误 0。写入一次、原日志不变、草稿保留、重开无模型重放；截图已查看，自有进程及临时目录已清理。见[验证报告](verification/member-checkpoint-20261107.md)。本机确定性供应商不代表在线模型判断质量。
- 接续：当前仅每任务一次受限文件检查点、同活动周期一次续执行，不支持命令/动态搜索/插件影响下的通用恢复或跨重启恢复。下一步接本机明确的人工接受、拒绝、补证记录，再独立接显式继续与返工；模型审阅不代替真人决定。

## 2026-11-07：显式业务文件基线与按需复核

- 对应步骤：Step14a，承接 `ca12a79`。执行成员仅提供真实成功 read/write/edit 调用 ID 和进度版本，可信运行时推导有界文件集，采集字节与来源指纹；成功工具回执与 canonical 事件共同确认基线。
- 可见行为：成员详情手动加载列表、明确选择基线、按需检查，分别显示内容一致、变化、缺失或不可核实。加载列表不读取业务文件，不默认选择最新项，不轮询；查询不运行模型、不改变原任务、候选或日志。
- 安全边界：采集屏障拒绝在途工具/审批和后续并发调用，检查停止、知识与进度版本；普通文件最多 16 个，单文件 8 MiB、合计 32 MiB、每轮 8 份基线。路径/句柄前后核实尽力识别外部变化；未知命令影响、未覆盖写入和旧测试有效性不能用哈希相同消除。
- 维护范围：core tasks/brain/Pi、scheduler execution、main 平台/IPC、Bridge、frontend tasks；同步中文文件头、关键接口、CONTRACT 和 13 份目录类图。类型/架构通过：46 目录、286 源码/样式、477 维护文件、2008 条含类型依赖、0 循环。
- 验证：最终全量 148 文件、793 项全部通过；最终 Windows EXE `20261107-092056` 正常和采集后停止两场景通过，主/成员请求分别 6/7、3/5，页面及传输错误 0。外部修改/删除、退出重开、原日志不变、无模型重放及草稿保留均已验证并查看截图，自有进程和临时目录已清理。见[验证报告](verification/artifact-baseline-20261107.md)。真实 Pi 使用本机确定性供应商，不代表在线业务判断质量。
- 后续：这是选定文件字节观察，不是整个工作区快照、验收签署或恢复授权。下一步建立同一活动周期内一次检查点与一次续执行，额外核实完整影响范围、原生历史、知识、权限、额度和准入；旧求助、失败、取消或关闭记录不复活。

## 2026-11-07：未启动任务的单条前置替换

- 对应步骤：Step13，承接 `20beab7`。主调度明确以当前知识基线的真实 A2 候选替换 B 的失败/求助前置；原子退役旧边、新建固定候选边、追加不可变审计。B/C 原任务、角色实例、会话与计划保留，重新纳入当前批次后首次执行。
- 证据边界：核对原来源的完整结束事实、新候选的原生 Session 与完整任务/模块/验收绑定；版本、知识、未领取后继闭包及当前角色配置不符整体拒绝。替换不启动模型或提权，待主轮结束后仍经过正常权限、租约、额度和全局准入；停止/重启不复活旧批次。
- 界面与维护：主对话和成员详情展示换边原因、原来源、新候选与历史，图只绘制启用依赖；旧 A 保留真实失败/求助。涉及 core tasks、scheduler context/conversation/execution/tools、Bridge、frontend tasks；同步文件头、接口、CONTRACT 和 11 份类图。
- 验证：全量 142 文件、758 项中 757 通过；修复旧报告测试只等运行租约、未等 scope 关闭的时序后，相关 3 文件 25 项通过，未再全量。真实 Pi 可控收尾窗口验证该等待缺口，产品报告的保守规则未改。类型/架构通过，46 目录、277 源码/样式，459 文件、1926 条含类型依赖、0 循环。
- 真机：最终 EXE `20261107-085058` 正常、停止及重启三场景全部通过，主/成员请求分别 15/19、12/9、12/9，页面/传输错误 0。B/C 身份与原求助保留，已检查图和审计截图，自有进程/临时目录已清理。见[验证报告](verification/queued-dependency-replacement-20261107.md)。使用真实 Pi 与本机确定性供应商，不代表在线业务质量。
- 后续：本步仅单条未启动前置替换；原执行者不恢复，任意改派与未知副作用不能绕过。先补显式有界业务文件指纹和只读外部变化复核，再设计新的非终结成员检查点；当前工具记录哈希不等于产物基线。

## 2026-11-07：目标周期的运行间软限额

- 对应步骤：Step12b，承接 `61da15f`。用户显式配置 Token/估算美元额度，默认关闭、版本化保存，新周期冻结；主轮、成员轮和显式补充在同一周期内累计，已有运行先可靠结算再核实未来启动。
- 生命周期：用量未知不当零，Token-only 不要求价格；超限记录独立原因并阻止下一轮，不额外调用模型解释。最后一轮正常完成或安全等待仍可提交；补充拒绝不消费等待检查点、输入或意图，调高全局额度不改当前目标。
- 界面与真机修复：设置与目标卡展示冻结额度；修复仓库异步加载重挂载表单和额度拒绝误显示通信未知。首次明确拒绝保留草稿，曾超时的原请求继续冻结核实，不能误解锁。
- 维护范围：core tasks、scheduler execution、main 设置/装配/IPC、Bridge、frontend settings/tasks；同步注释、关键接口、CONTRACT、生成类图与全局运行说明。
- 验证：全量 137 文件、728 项通过；最后 UI 修正后定向 6 文件、46 项通过，未再次全量。类型/架构通过，46 目录、270 源码/样式，445 文件、1837 条含类型依赖、0 循环。最终 EXE `20261107-082820` 四场景通过，主/成员请求 3/0、3/5、3/0、6/5；页面/传输错误 0，重启不重放，测试进程与临时目录已清理。见[验证报告](verification/scope-budget-20261107.md)。
- 边界与接续：使用真实 Pi 与本机确定性供应商，费用是估算；一次 Pi 多请求、重试和摘要可能超额，不是硬账单上限。下一步仅替换未启动任务的一条前置，用新真实候选继续原 B/C，保留旧失败及求助记录；原成员检查点恢复单独推进。

## 2026-11-07：可靠周期运行归属与按需计量

- 对应步骤：Step12a，承接 `07b3ad5`。新周期原子登记主运行，结果回注和显式补充有序追加，核实/重规划独立归属；旧周期保持 legacy，成员沿用可信任务/运行绑定。
- 读取与界面：canonical 日志核实身份、起始绑定、完整性和汇总，分列主/成员及逐运行来源。已知消耗、部分值、缺失、在途和未知价格各自表达；查询不执行或修复，任务视图按需刷新、切换隔离迟到数据。
- 维护范围：core tasks/brain、scheduler execution、main IPC、Bridge、frontend tasks；同步文件头、关键接口、CONTRACT、10 份受影响类图和全局运行概念说明。
- 验证：最终全量 131 文件、698 项，类型/架构通过；46 目录、261 源码/样式，428 文件、1764 条含类型依赖、0 循环。最终包 `20261107-075735` 真实 Electron/Pi 冒烟通过：第一周期 1920 token / $0.00224，第二周期 120 token / $0.00014；刷新无写入或模型调用，重启无重放，页面及传输错误均 0。见[验证报告](verification/scope-usage-20261107.md)。
- 边界与接续：模型来自本机确定性服务，金额为估算；不证明在线业务质量或真实账单，没有预算拦截。下一步接用户明确配置、默认关闭的运行边界软限额，不把单轮多请求/重试/摘要承诺成硬上限。

## 2026-11-07：全局并发准入、可见等待及停止屏障

- 对应步骤：Step11，承接 `b85b0de`。应用唯一准入器与只读监管分离，主轮/成员轮共用默认 4 个名额，可保存为 1～32；降低上限不逐出已有运行。稳定协作票据 FIFO 等待，兼顾本地冲突与写请求防饥饿；等待不持租约、不创建运行或调用模型。
- 交互：设置显示真实占用/上限/等待；会话按 root 显示等待原因且不增长工作时长，停止仍可用。首次聊天不足明确未受理并保留草稿，普通队列暂停保留。读取共用单次在途游标，无变化保持引用，不反复扫日志。
- 生命周期：停止、关闭及旧装配代际撤票；知识准备、模型解析、持久提交和原生 active 登记窗口均有停止检查或取消信号。提交前不产生 claim/run，已提交意图保留真实取消/中断记录。重启只恢复设置与历史，不重放票据。
- 涉及模块：`core/runtime/brain`、`scheduler-engine/runtime/execution`、`main` 装配/设置/IPC、Bridge、前端设置/会话/任务；同步注释、CONTRACT、类图与概念说明。
- 验证：收尾补丁前全量 126 文件 665 项通过；最终补丁后 6 文件 57 项通过。最终类型/架构通过，412 文件 1690 条含类型依赖 0 循环。最终 EXE `20261107-073625` 三场景全部通过，页面/通信错误 0：正常 A6/5+B6/5、等待停止 A6/5+B3/0、等待重启 A3/1+B3/0（主/成员请求）。独立临时工作区与自有进程已清理；真实 Pi 使用本机确定性模型，非在线质量验收。见[验证报告](verification/global-run-admission-20261107.md)。
- 后续：当前是运行并发控制，没有 token/费用预算。先建立可信周期运行清单和去重计量，再接用户明确设置的运行边界软限额；现有 Pi 请求前扩展不能作为硬预算门禁。成员 checkpoint、依赖修订、人工验收及真实外部链接器继续沿 roadmap 推进。

## 2026-11-07：主调度显式撤销未启动任务

- 对应步骤：Step10，承接 `eaf588c`。新增主调度工具 `cbim_dispatch_cancel`；明确任务集合、节点版本、图游标和原因，检查必要依赖后继，遗漏则整体拒绝。领取与撤销共用事务屏障，重复命令不重复事件。
- 完成范围：原子保存不可变撤销记录、空闲成员待办、已处理且无领取的 assignment 和图增量；节点及原目标保留。撤销使旧审阅过期，重新审阅才可安全等待；完成仍需真实新任务候选替代，不能用取消凑成成功。同主轮派发并撤销不制造空结果回注。
- 界面与报告：主对话、任务图和详情展示“已撤销（未启动）”。真机发现报告误要求选择不存在轮次，已修复为严格核对撤销与领取事实；旧 cancelled 或异常记录仍未知，查询不启动模型。
- 维护范围：Core tasks、调度 tools/execution/conversation、前端 tasks；已同步源码注释、关键接口、CONTRACT、目录类图和概念说明。
- 验证：修正前全量 122 文件、636 项通过；最终报告修正后 4 文件、32 项通过，未再全量。最终类型/架构检查通过，395 文件、1617 条含类型依赖、0 循环。最终构建 `20261107-070515` 三模式真机通过，主/成员请求正常 23/19、停止 15/4、拒绝错误完成 13/4，页面/传输错误 0，重启不重放。见[本步验证](verification/queued-task-cancel-20261107.md)。
- 边界与接续：本机确定性模型不代表在线质量；不取消活动任务、不恢复旧实例、不签署验收。下一步增加全局运行并发配额及已受理协作的可见等待，随后独立补 token/费用预算；成员可恢复停泊、依赖修订和产物验收仍待后续。

## 2026-11-07：成员求助与安全终态交接

- 对应步骤：Step9，承接 `7536c09`。成员专属 `cbim_task_help` 将问题绑定真实运行；工具/审批在途时拒绝，暂存后禁止新工具。正常关闭后 canonical 核实，原子保存不可变 `help` 和唯一信封，释放占用再回传主调度。
- 调度与界面：主对话和任务图共用已结算事实。主调度按原目标派新任务/实例补做，或在无未执行依赖时安全等待；求助不冒充候选或授权。取消和损坏日志不产生可消费求助；修复关闭/结算期间停止、停止日志失败跳过实际中止、无效引用无法纠正等边界。
- 维护范围：Core tasks/brain/Pi、调度执行、前端 tasks；文件头、关键接口/字段、CONTRACT 和目录类图同步，概念说明与切片计划已更新。
- 验证：全量 118 文件、605 项通过；类型/架构通过，383 文件、1543 条含类型依赖、0 循环。最终构建 `20261107-063745` 四模式真机冒烟通过，主/成员请求为正常 10/10、等待 6/4、停止 3/4、坏日志 6/4，页面/传输错误均 0；重启不重放、真实追加副作用一次。见[验证报告](verification/member-help-20261107.md)。
- 边界与接续：本机确定性模型不证明在线质量；不恢复旧成员、不提权、不取消依赖、不签署人工验收。下一步由主调度显式撤销尚未领取任务及列明后继，清理待办后重新审阅并安全等待；不能用取消凑成成功。

## 2026-11-07：核实后的正式业务重规划

- 对应步骤：Step8，承接 `ed7902b`。最新已完成的核实周期可明确预览新业务条件，提交独立目标与 ask/execute 权限；重新核对全部主链/成员证据、当前知识、完整模块与原人工约束。后续已有其他周期使旧核实失效，原命令回执仍幂等可查。
- 执行与界面：同主实例、新周期/原生上下文/执行实例；只读 recovery 保持不变，未知历史和旧业务不重放。主对话/任务根共享独立草稿、版本预览和稳定提交；未知只查询或原 ID 重试，容量预留及保存失败不丢失请求。停止覆盖排队、预检、工厂及受理竞争。修正正式任务尚无计划时误显示普通问答的状态。
- 维护范围：Core tasks、调度执行、主 IPC、Bridge、前端任务/对话；同步文件头、关键接口、CONTRACT、生成类图与概念说明。
- 验证：全量 114 文件、567 项通过；最终展示文案修正后另跑 28 项定向通过，未再次全量。类型/架构通过：371 文件、1474 条含类型依赖、0 循环，46 目录、231 源码/样式。构建 `20261107-061550` 正常/停止/未知提交三条 Electron/Pi 冒烟通过，主/成员 18/15、13/8、18/15，页面/传输错误 0；旧写入仅一次，新业务按授权真实写后读验证，重启不重放。见[本步验证](verification/business-replan-20261107.md)。
- 边界与接续：确定性模型不证明在线任务质量，当前证据不是产物指纹或外部幂等证明，不签署人工验收。下一步成员结构化求助、安全终态交接及主调度新任务补做；成员原实例恢复、复杂依赖取消和修订单独推进。

## 2026-11-07：已关闭周期的再次显式核实

- 对应步骤：7b，承接 `8076b7d`。确认旧周期已关闭后，可明确准备新的只读核实；保存旧请求/回执历史成功才解锁，重新核实来源报告后才能提交新命令。准备和查询不启动模型，未知命令始终冻结原 ID。
- 持久化与交互：v2 索引保留 v1 原字节，历史有界且不静默淘汰，未决请求预留回执容量；保存失败保留旧状态。同源各视图报告同时失效，迟到响应不能恢复旧依据；草稿、旧回执及暂停队列保持。修正已关闭、未登记运行的取消节点不能发起只读核实的界面边界，不把未知状态解释为未执行。
- 维护范围：前端 tasks 状态/Hook/表单/报告、源架构生成器、领域和真实 Pi 测试及桌面脚本；同步文件头、关键接口、CONTRACT、tasks 与 frontend 类图、界面和目标循环说明。
- 实际验证：最终全量 110 文件、538 项通过；类型/架构检查通过，358 文件、1393 条含类型依赖、0 循环，46 目录、224 源码/样式文件同步。构建 `20261107-054316` 的再次核实、正常、v1 未知请求迁移三条 Electron/Pi 冒烟通过，主/成员请求分别 13/8、12/8、12/8，页面/传输错误 0；旧写入仅一次，重开及原新命令重复查询/提交不重放。见[本步验证](verification/inspection-repeat-20261107.md)。
- 边界与接续：本机确定性模型不证明在线任务质量；不修改只读权限、不签署人工验收、不重派业务任务。下一步独立实现有真实核实依据的新业务重规划，继承人工约束并继续保留旧未知事实。

## 2026-11-07：显式新建只读核实周期

- 对应步骤：Step7，承接只读执行报告 `b0a6921`；属于阶段五前移的异常核实能力，不代表正式业务恢复或整阶段完成。
- 完成范围：报告后显式填写用户观察与新核实目标；稳定命令原子保存来源、输入、只读配置及真实启动意图。保留同一主 session/主实例，新建 scope、主原生上下文及执行实例；旧周期、任务和源日志保持封存，不重放旧工具。同命令只查原回执，未知响应不换 ID，原普通消息队列保持暂停。
- 权限与历史：主知识操作、成员执行及等待补充均强制 read，持久化不变量阻止提权和首轮预算丢失。旧坏历史显示问题占位，已读和待核实计数分开；当前链缺失、截断、分叉或错绑不能退回较早可读头。新上下文包含尚未产生日志的旧意图隔离集合，重启不自动执行。
- 生命周期：停止覆盖请求尚在串行队列、预检等待、工厂准备、意图提交及原生启动；受理后读取失败按原命令核实并收束本次运行，不误停旧回执或签发重复启动。真实桌面确认取消时目标卡和活动状态一致。
- 涉及模块：`core/brain` fresh-main/当前链、`core/tasks` recovery/readonly/持久约束、`scheduler-engine/execution` 服务与协作装配、`main/ipc`、Bridge、前端报告表单与对话历史；同步源码注释、接口说明、CONTRACT、目录类图及目标循环说明。
- 实际验证：全量 109 文件、527 项通过；最后计数措辞调整后复跑 3 文件、21 项定向测试，未重跑全量。最终类型、架构和 diff 检查通过：357 个维护文件、1390 条含类型依赖、0 循环；46 个目录、224 个源码/样式文件同步。最终构建 `20261107-052330` 的正常/停止/未知提交三条 Electron/Pi 冒烟全部通过，主/成员请求为 12/8、7/3、12/8，页面/传输错误 0，旧日志不变，重启无重放；详见[本步验证](verification/inspection-cycle-20261107.md)。
- 限制与接续：使用本机确定性模型，未验证在线协作质量。核实完成不证明原任务成功、没有副作用或已经人工验收。下一步 7b 补已关闭后再次显式核实，再以独立入口实现正式业务重规划与新派发；不放宽现有只读 recovery、不复活旧实例。产物指纹、人工签署与外部幂等契约仍待后续。

## 2026-11-07：成员执行记录的只读核实报告

- 对应步骤：异常核实与显式恢复的第一步，承接显式补充提交 `742b77b`；属于阶段五前移能力，复用阶段一工具回执。
- 完成范围：按工作区、主会话、任务和明确运行核对派发事实、canonical 日志及工具授权/回执，区分未启动、在途、结算和未知。失败或取消不代表无副作用；缺失、损坏、错绑、截断尾行、矛盾及重复回执保持未知。核对真实输入/结果哈希；旧轮次不使用后来候选，候选始终未验收。
- 只读与一致性：读取不调用恢复、模型、租约、收件确认或任何日志/图修改；分页绑定基线，读取期间状态变化则返回未知而不混合证据。已知不完整日志不能用于安全续跑、完成审阅或等待；仅可信新运行零字节日志窗口允许等待首条事件，历史异常不豁免。
- 界面：任务节点详情提供按需核实、刷新、分页和过期提示，独立于可能读取失败的正文；切换节点/轮次隔离迟到响应。真机发现并修复报告与正文的兄弟 React key 冲突，运行转终态后可重新核实。
- 涉及模块：`core/tasks` 报告契约、`core/brain` 日志完整性与续跑门禁、`scheduler-engine/execution` 核实服务及完成/等待检查、`main` 日志/IPC、Bridge、`frontend/tasks`；同步文件头、关键接口、CONTRACT、目录类图与概念说明。
- 实际验证：全量 103 文件、486 项通过；最后一次 React key 修正后复跑 15 项界面定向测试、类型与架构检查，全量未在该修正后重跑。342 个维护文件、1303 条含类型依赖、0 循环；46 个目录、218 个源码/样式文件同步。最终构建 `20261107-044750` 的异常和成功候选两条 Electron/Pi 冒烟均通过，主/成员请求分别 6/3、6/5，页面/传输错误 0，图与源日志字节不变，重启无重放。详见[本步验证](verification/execution-report-20261107.md)。
- 限制与接续：模型来自本机确定性服务，异常模式的 `success:false` 是测试分支标识，不是执行失败。报告不证明产物符合业务目标，也不提供恢复、重派或人工验收。下一步显式开启新只读核实周期，保存用户观察、隔离旧上下文并保留主实例，随后独立接正式重规划重派；未知副作用不自动重放。

## 2026-11-07：显式补充原目标并可靠续跑

- 对应步骤：主目标循环第五步，承接安全等待 `9670604`。
- 完成范围：当前等待目标的纯文本补充、明确模型/权限、稳定命令和一次性启动意图；原输入不改写，旧检查点和补充原文追加归档，旧计划过期后必须重规划。重复请求只查回执，不重复执行；human 项不因文字补充获得批准，运行与决策额度跨等待累计。
- 生命周期：租约/旧日志预检后消费等待，停止覆盖工厂、事务、日志与引擎准备；初始化日志期间取消保留完整记录。提交后读失败只收束本次run，旧回执不误停；重启不重放已消费意图。普通队列保持暂停并更新真实原因。
- 界面：对话与任务根共享纯文本表单、冻结请求和回执；先本地保存再发送，未知结果只查询或原ID重试，跨窗口切换迟到回执不覆盖新草稿；聊天附件/草稿和人工验收独立。
- 维护：同步 brain/Pi、tasks、scheduler execution/conversation、main/ipc、bridge和前端相关注释、契约、类图及概念说明。
- 实际验证：类型/架构通过，329文件、1243条含类型依赖、0循环；99文件、456项测试通过。构建 `20261107-040413` 的正常/停止/本地未知提交三条真实桌面/Pi流程通过，主/成员13/5、7/5、13/5；错误0，重启无重放。详见[本步报告](verification/scope-continuation-20261107.md)。
- 限制与接续：本机确定性模型不证明在线质量；无附件补充、人工验收签署、异常执行复活或产物指纹。下一步先交付异常任务只读核实，再按实际核实依据接新周期重派，未知副作用不自动重放。

## 2026-11-07：安全持久等待检查点

- 对应步骤：主 Agent 外层目标循环第四步，承接目标状态界面 `d53a11e`。
- 完成范围：主/成员安全结算和证据核实后，将 awaiting_user 申请保存为 waiting；无模型占用但保留会话目标。冻结原输入、检查点及主运行计数，正常退出和崩溃重启只恢复占位。普通消息排队、历史启动和继续队列不能绕过等待；取消释放执行者，保留主实例与历史。
- 一致性：等待与停止竞争后再查持久占位，避免漏取消；工作区恢复失败明确标为 failed，阻止半初始化执行，重试关闭旧服务再重建。前端等待时间不增长，无执行动画。
- 涉及模块：core/tasks、scheduler-engine/execution/conversation、main、frontend/tasks/conversation；同步源码注释、CONTRACT、目录类图、目标循环与界面说明。
- 实际验证：类型/架构检查通过，317 文件、1169 条含类型依赖、0 循环；94 文件、428 项测试通过。构建 `20261107-032948`，正常及真实崩溃重启两条 Electron/Pi 冒烟通过，各主/成员请求 6/5，无重放、页面/传输错误 0。详见[等待验证](verification/scope-wait-20261107.md)。
- 限制与接续：本机确定性模型不代表在线质量；等待可保留和取消，显式文本补充并继续作为下一步。没有人工验收、产物指纹或异常工具自动恢复。

## 2026-11-07：目标状态界面与独立增量同步

- 对应步骤：外层目标循环第三步，承接目标门禁 `64272b8`。
- 完成范围：主对话/任务根显示真实目标、计划、审阅、受阻原因和周期历史；区分本轮结束、成员工作、完成申请和目标完成。等待成员时仍可排队及停止，历史选择不改变执行目标。
- 同步边界：图与目标使用独立游标、同一读取屏障；摘要与详情 stamp 降低重复传输，关闭/阻塞同版本可见。两条分页都追齐才发布，读取失败保留完整旧画面；旧周期不补造目标。
- 涉及模块：core/tasks、main/ipc 与 persistence/tasks、scheduler-engine/execution、bridge/contracts、frontend/tasks 与 conversation；同步注释、契约和目录类图。
- 实际验证：类型/架构通过，311 文件、1132 条含类型依赖、0 循环；91 文件、410 项测试通过。构建 `20261107-030854` 的正常、缺审阅、实际停止三条桌面流程通过，主/成员请求分别 7/5、4/5、3/2，页面/传输错误 0；均重启不重放。800px 浅色展开详情不挤压输入框。见[验证报告](verification/goal-status-20261107.md)。
- 限制与接续：本机确定性模型不代表在线任务质量；持久等待、显式恢复、人工验收和产物指纹仍待接入。下一步建立无活动执行的等待检查点，普通队列消息不冒充恢复或验收。

## 2026-11-07：主 Agent 目标计划、证据审阅与完成门禁

- 对应步骤：外层目标循环第二步，承接真实输入提交 `fe5e905`。
- 完成范围：增加 `cbim_goal_plan/inspect/review`，保存真实角色/模块分配、知识基线和逐项证据；重规划清除旧审阅，原输入和既有人工项不可改写或降级。派发必须匹配计划，完成需在主轮结算后复核真实运行、回执正文/哈希、知识/图版本及全部周期任务；失败或过期结果须由后续成功任务明确替代。主知识提交同样受门禁约束，普通聊天保持轻量。
- 循环边界：最多 32 次主运行和 64 次计划/审阅决策。缺有效审阅时保存阻塞、失败关闭并暂停队列；不把成员结束或主回复文本当作完成。`awaiting_user` 尚不是可恢复的持久等待，人工确认与产物指纹留待后续。
- 涉及模块：`core/tasks` 目标契约与重放不变量，`scheduler-engine/tools/execution/conversation` 工具、协调和指引，`main` 可信日志装配；同步相关注释、CONTRACT、目录类图和概念说明。
- 实际验证：类型/架构通过，305 文件、1088 条含类型依赖、0 循环；89 文件、393 项测试通过。构建 `20261107-024543`；自定义及默认执行者两条真实 Electron/Pi 冒烟均通过，主请求 8 次、成员 5 次，页面和传输错误 0。完成计划/审阅、独立目标、排队、完整重启不重放验证。详见[验证报告](verification/goal-review-20261107.md)。
- 限制与交接：本机确定性模型不代表在线规划质量；没有跨知识/调度存储原子锁、业务产物指纹、真实人工验收或 token 预算。下一步展示周期目标与受阻原因，修正等待成员时的排队/停止交互，再补持久等待和显式恢复。

## 2026-11-07：调度周期保存本轮真实用户输入

- 对应步骤：主 Agent 外层目标循环第一步，承接已提交的成员协作/角色履历基线 `34bf408`。
- 完成范围：启动钩子传本轮原文，`scope.goal` 保存固定版本输入及受管附件身份；首轮/续聊/排队各有独立目标，成员回注续用原周期。事务及日志重放拒绝输入改写/删除，同周期异参幂等重试拒绝，旧记录无 goal 不补造。
- 涉及模块：`core/tasks` 周期契约与不变量、`scheduler-engine/execution` 入口/协调/派发服务；同步文件头、接口注释、两处 CONTRACT 与目录类图。新增存储、主执行、Application/Pi 与真实桌面验证。
- 实际验证：类型/架构检查通过；298 个维护文件、1036 条含类型依赖，0 循环；86 文件、367 项测试通过。`pnpm make` 生成 `20261107-022013`；自定义/默认执行者的 `--scope-goals` 两条打包 Electron/Pi 流程通过，各主请求 5 次、成员 5 次，页面与传输错误 0。证据见[输入验证报告](verification/scope-input-20261107.md)。
- 限制与接续：本地确定性模型响应不证明在线自主规划质量；本步只冻结目标来源，未改变成功结束条件，未实施目标修订或业务验收。下一步接结构化计划、审阅及完成门禁，每步测试、桌面冒烟并单独提交。

## 2026-11-07：明确图谱驱动的主 Agent 外层调度循环

- 对应步骤：产品架构与路线维护，不是运行功能交付。
- 设计确认：主 Agent 借助 LLM 在业务图谱与团队图谱上反复分析、匹配模块/能力、派工、等待、审阅证据及重规划；目标达成才成功结束。实际业务探索、实现、命令和测试由执行 Agent 内层循环承担，主 Agent 保留受控知识治理。
- 代码核实：当前 AutoCollaboration 支持多轮派工回注，但主轮正常结束且没有新派工即可关闭周期；没有总体完成门禁。DispatchScope 只有生命周期状态；新周期的 starting 未单独接收本轮用户 message，续聊复用初次 TaskSpec，需独立保存每轮目标和验收条件。
- 文档变更：新增目标循环设计（历史文档：`docs/main-agent-orchestration-loop.md`，已清理），同步产品/应用架构、README 与概念入口；roadmap 将周期目标、评估/重规划和成功门禁列为下一步，异常恢复与完整验收随后推进。
- 验证与边界：只读核对相关代码，检查本轮文档的本地引用和 diff；未修改 src、运行提示词或状态机，未重新测试或打包。上一步 362 项与构建 `20261107-015449` 仍是已有证据，不证明新目标循环已实现。

## 2026-11-07：静态 Agent 的 Session 执行履历

- 对应阶段：按用户要求前移阶段五的角色履历入口，承接实例生命周期；只读追溯与后续异常恢复分别交付。
- 完成范围：主 Agent、默认执行 Agent、自定义 Agent 的任务记录按静态角色 → 真实独立 Session → task/run 归档，团队节点可读输入、公开回复、工具状态、计划和证据。执行实例释放后保留，定义删除后从“历史角色”进入，不重新插入静态树。保留旧日志原位置，legacy 不补造动态身份，启动日志前失败也留下已提交的执行意图。
- 存储与边界：角色/Session 摘要写本机用户数据，正文使用既有运行日志；复用工作区恢复扫描回补索引。列表分页不读取正文；选中轮次后加载公开投影，手动刷新只补增量。重复序号冲突保持故障，加载中/活动详情不被 LRU 淘汰丢事件。查询没有模型启动、审批、恢复或信封确认副作用。
- 涉及模块：`core/team` DTO/存储端口、`scheduler-engine/runtime` 历史服务、`execution` 公共事件投影、`main` 装配与监管、`main/persistence/tasks` 索引适配、IPC/Bridge、`frontend/team` 节点入口和履历。同步文件头、关键接口和 CONTRACT，以及受影响目录类图与父层导航。
- 实际验证：类型检查、架构同步和依赖层级检查通过，46 个目录、198 个源码/样式文件、298 个维护文件、1033 条含类型依赖，0 循环。全量 86 文件、362 项通过，新增测试覆盖跨主会话、释放、删除、重开、启动失败、损坏索引、身份隔离、缓存竞争、旧记录及只读无副作用。修正旧监管测试对告警顺序的依赖，同时验证两类诊断和精确损坏来源。
- 构建与界面：`pnpm make` 生成 `20261107-015449`；`pnpm test:agent-history` 与默认执行者 `--history` 场景通过。真实打包 Electron/Pi 验证主输入/回注、成员履历、删除角色后查看、应用重启及无重放；各场景主请求 3 次、成员 5 次，页面和传输错误 0。证据见[本步报告](verification/agent-session-history-20261107.md)，操作见使用说明（历史文档：`docs/agent-session-history.md`，已清理）。
- 限制与交接：使用本机可控模型响应，不代表真实供应商协作质量；公开文本未做自动秘密检测，工具原始正文不传界面。无静态身份的旧记录仅报告诊断；无角色重建代际 ID、历史保留期限/删除、主动成员聊天或异常恢复入口。本步未提交或推送，下一步按 roadmap 补异常核实与显式恢复。

## 2026-11-07：统一主实例、知识管理与用户任务调度周期

- 对应阶段：阶段五前移项；沿用统一工具授权、知识事务和真实 Pi 执行内核。
- 完成范围：每个主 session 与图根绑定同一持久主实例；用户任务开启调度周期，跨主模型调用、独立成员执行和结果回注，结束后释放执行者、保留主实例和历史。无合适自定义角色时使用内置静态 `cbim:executor`，每任务独立实例；主角色不能作为业务执行者，成员无递归派发权。
- 职责落实：主 Agent 作为具备工程、架构与结构化思维的团队技术管理者，直接经受控服务治理 `.cbim/`，按权限读取/预览/提交知识，组织任务与审阅证据；业务实现和验证统一交执行者。修正早期“主自执行”计划，知识治理不需要先派发业务任务。主业务只读租约与知识事务分别管理。
- 涉及模块：brain/Pi 身份及恢复、tasks 周期与不变量、team 实例生命周期、scheduler-engine 默认角色/指引/权限/调度、main 装配/日志/全局统计、bridge 和前端任务根详情；同步文件头、关键接口、CONTRACT 和目录类图。
- 实际验证：类型与架构检查通过，46 个目录、285 个维护文件、968 条含类型依赖，0 循环；全量 82 文件、345 项测试通过。真实 Pi 验证主知识 read/ask/execute、跨会话恢复拒绝、默认执行者证据回注、周期停止及重开，不复活已释放实例。
- 构建与界面：生成 `20261107-012333`；`pnpm test:main-instance` 与 `pnpm test:collaboration` 均通过，分别覆盖默认/自定义执行者，主/图身份一致、流式详情、原会话续跑、周期释放及刷新不重放。各场景主请求 3 次、成员 5 次，页面/传输错误 0。详见[验证报告](verification/main-coordinator-20261107.md)。
- 限制与交接：模型使用本机可控 SSE，不代表在线模型自主协作质量；默认角色仍需有效模块与维护关系。历史显式恢复、重试/改派、执行者求助/等待、公平调度/预算、正式业务验收未完成。保留旧无 scope 显式 IPC 兼容性。下一步先补异常核实与显式恢复，状态以 roadmap 为准；本步未创建提交或推送。

## 2026-11-06：主会话自动协作最小闭环

- 对应阶段：阶段五前移项，复用既有成员、任务图、权限及知识服务，不另建执行内核。
- 完成范围：真实主会话派发/查询工具；主轮安全完成释放占用后自动启动本轮成员；候选或真实失败状态以持久化来源回到原会话，Pi custom 消息不冒充用户授权；可靠启动后确认收件。用户消息队列保持原文和发送配置，成员审批独立；停止和结算异常建立续跑屏障，防止迟到结果或旧消息误启动。
- 涉及模块：`backend/core/brain` 与 Pi、`core/tasks` 证据筛选、`scheduler-engine/tools` 和 `execution`、`main` 生命周期与运行监管、`main/persistence/tasks` 日志来源、`frontend/conversation` 系统提示。相关注释、CONTRACT 和类图同步，架构生成器更新实际职责。
- 实际验证：类型检查通过；46 个目录类图同步；275 个维护文件、902 条含类型依赖，0 循环。全量 76 文件、304 项测试通过，包含真实 Pi 的 read、ask、用户排队、停止及重开场景。定向竞态测试验证故障清除 busy 后旧队列不会抢跑。
- 构建与界面：`pnpm make` 生成 `20261106-234421`；打包 Electron/Pi 的 `scripts/collaboration-ui-smoke.mts` 通过，新增命令 `pnpm test:collaboration`。成员实时卡片、任务图节点详情、系统回传、原会话续跑、草稿保持及刷新不重放均验证；页面/传输错误 0。详见[验证报告](verification/auto-collaboration-20261106.md)。
- 验证限制：模型响应来自本机可控 SSE，桌面主请求 3 次、成员 5 次，不使用用户供应商密钥或实际工作区。未据此宣称自主分工质量、业务验收或本步仓库外便携/跨电脑验证完成。
- 剩余与交接：自动批次只覆盖当前进程的主轮委派，重启不自动消费历史任务/结果。主 Agent 实例统一及正式自执行节点、递归/等待/消息、异常通道修复、全局公平调度与预算、正式验收仍待后续；下一步按 roadmap 补主 Agent 身份与自执行任务。未创建提交或推送。

## 2026-11-06：建立开发计划模块与开发 Skill

- 对应步骤：开发协作流程维护，不改变产品运行能力。
- 完成范围：路线图迁入 `design/`，该目录建立计划入口和逐步记录；原总体概念说明移至 `docs/core-design.md`。新增三个同步的 `cbim-development` Skill 入口，并接入根协作说明。
- 涉及范围：`design/`、`docs/`、`.agents/skills/`、`.claude/skills/`、`.codex/skills/` 及根 README/AGENTS/CLAUDE；既有运行规范与 Schema 路径保留。
- 验证：12 份涉及文档与 Skill 的 145 处本地链接全部有效，旧 roadmap 路径引用已清理；三个入口内容一致，并通过 `quick_validate.py`（Python `-X utf8`）；`git diff --check` 通过。本步未运行产品构建或业务测试。
- 限制与交接：不把文档整理计入成员自动协作的实现进度；下一步仍以 roadmap 的“开发接续”为准。

## 2026-11-06：静态架构编辑与资源复用

- 对应阶段：团队协作的静态定义与复用基础。
- 完成范围：团队/业务架构表单维护、预览提交、模块维护责任；完整 Team、单 Agent、单 Skill 和整套业务模板的本地发布与应用。多个主会话的动态任务图保持独立。
- 涉及模块：知识领域、工作区服务、资源仓库、IPC/公开契约及团队/业务/资源界面；详见构建验证报告（历史文档：`docs/build-test-20261106-220344.md`，已清理）。
- 已有证据：构建 `20261106-220344`；70 个测试文件、274 项通过；46 个目录类图同步，841 条含类型引用依赖无循环；真实桌面静态操作和仓库外便携启动通过。
- 验证限制：静态资源桌面测试 0 次模型调用；未验证跨物理电脑或真实账号服务器。本记录引用已有证据，没有重新执行这些检查。
- 后续交接：利用可配置的 Agent/Module 开展主 Agent 自动派发与结果续跑；显式成员执行和会话任务图已经存在，不重复作为待建功能。


## 2026-11-12：A（0.1.10）公开与 B 发布准备

A 已通过准确 head 的四片完整 CI（408 文件，2774 通过、0 失败、2 个历史 EXE 跳过）及隔离 Windows 全新安装、0.1.9 覆盖升级。PR #51 正常合并，同一冻结四附件已公开，旧 Python latest 未改变，匿名元数据核验通过。真实公开升级 run 43153427566 已派发，尚待结果；B（0.1.11）沿用已冻结包，进入单独候选/CI 门槛。详见 [A 正式发布验收](verification/desktop-release-0.1.10-20261112.md)。


## 2026-11-12：A/B 已公开，预下载通过，差分缓存缺陷确认

A 的公开升级 43153427566 通过；B 经正式四片 CI 43153778797（2774 通过、0 失败、2 个历史 EXE 跳过）和候选安装 43154244827 后公开。严格 A→B 差分测试 43155757174 失败，因 NSIS 写入 cbim-assistant-updater 而应用读取 cbim-desktop-updater，真实传输为完整 391409091 字节。显式全量回退场景 43156807720 补齐预下载、正常退出不安装、有效缓存复用、UI 点击后安装及全部数据保留，differentialDownload=false；1 次模型请求、零页面错误。构建配置已改为复用 NSIS 的 AppInfo 目录规则，原回归先失败后通过，37 项制品测试和依赖检查通过；未公开 0.1.12 修复候选另行验证，不改 A/B 原附件。详见 [B 结果](verification/desktop-release-0.1.11-20261112.md) 与 [缓存调查](verification/desktop-update-cache-diagnosis-20261112.md)。
