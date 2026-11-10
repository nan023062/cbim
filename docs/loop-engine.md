# CBIM 内部 Loop Engine

引擎支持固定版本 Pi（`@earendil-works/pi-coding-agent@1.5.0`）、Claude Code（`@anthropic-ai/claude-agent-sdk@0.3.322`）与 Codex（`@openai/codex@0.167.0`）。CBIM 在应用内部管理工作区执行实例、模型配置、运行权限和工具调用。

源码分层：`src/backend/core/brain/` 是通用执行层（大脑），`src/backend/scheduler-engine/` 是管理工作区、知识和团队流程的调度引擎。既有 `loop-engine/` 数据目录保留；接口名称仍存在不代表旧业务启动路径继续开放，当前限制见下文。

调度引擎与 Core 平级，单向依赖 Core。工作区使用 `KnowledgeWorkspace` 契约，任务锁与工具策略通过 `ExecutionServices` 注入；平台实现位于 `main/execution.ts`。开发 CLI 位于 `main/commands/loop-cli.ts`，由 main 负责应用装配。

## 当前调用链

```text
Application / 桌面主对话
  → WorkspaceExecutionManager
    → loop.chat / 普通对话 loop.resume
    → LoopRuntime：任务锁、持久化事件、主会话执行
      → PiEngine / ClaudeCodeEngine / CodexEngine：真实原生进程、共享工具策略、各自会话
        → 临时能力桥 → KnowledgeService → 工作区查询与事务

Application / 可信桌面 IPC
  → WorkspaceDispatchService：活动 scope、当前 goal 计划、明确 ownerSelection
  → 冻结 ownerBinding：岗位、能力来源、模块责任、岗位模型配置
  → MemberExecutionManager：领取前复核、冻结知识与前置结果、岗位模型/权限、终态事务
    → 同一个 LoopRuntime.startMember：固定成员与通道绑定、持久化事件
      → 岗位所选 PiEngine / ClaudeCodeEngine / CodexEngine：成员专属会话、同一门禁与知识服务

当前主聊天运行
  → cbim_module_owner_inspect：查询模块当前负责岗位及可用选择
  → cbim_goal_plan → cbim_dispatch_task：同一负责人选择与模块范围，可靠入队
  → 主轮安全完成并释放占用
    → AutoCollaboration → MemberExecutionManager → 独立成员执行
    → 成员终态持久化且释放占用
      → continueFromResults → 原主引擎的数据接续消息 → 主 Agent 继续处理
```

KnowledgeService 提供领域查询与事务能力，KnowledgeTools 维护内部工具定义和参数 Schema。工具使用 `cbim_` 名称，通过可信运行绑定核验工作区身份、读取版本、幂等请求和本轮授权。

领域封装均属于 Core：`core/connectors` 管理链接器，`core/team` 管理 Team/Agent/Skill，`core/workspace` 管理业务 Workspace/Module/Workflow，`core/knowledge` 提供共用规则与对象治理。实际文件事务由 `main/workspace` 实现 `KnowledgeWorkspace` 接口后注入，Core 不反向依赖 main。

桌面与开发 CLI 装配相同的内部服务；工作区打开只管理知识、锁与执行记录，不向项目安装外部 AI 工具配置。

## 团队工作流准备

`loop.prepare` 保留旧团队上下文的只读校验：输入目标、一个模块 ID、一名叶子 Agent ID、当前模块登记的 Workflow ID，以及至少一项验收要求。真人责任人可选，填写时必须存在于花名册。准备成功不创建正式任务，也不授予执行许可；`loop.start` 已拒绝新业务执行。

程序加载模块正文、Agent 原则、自身与所有祖先 Skill、选定 Workflow、内置需求实现流程和通用规范。不继承父模块或兄弟模块的 Workflow。

知识结构错误、正文缺失、Skill 冲突、错误流程归属、未知责任人或准备期间知识变化会阻止上下文准备。旧直接团队运行中的 `TaskSpec.workflowContext` 只保留历史事实，不能据此绕过当前岗位派发门禁创建新轮次。

正式成员任务使用 `prepareDispatchExecutionContext`，必须由当前活动 scope 的目标计划派发。已配置自定义负责岗位时，明确采纳能力、来源和模型配置；`ownerSelection` 是预期版本，服务重新解析后冻结 `ownerBinding`。未配置自定义岗位的模块由主 Agent 在当前会话执行。已退役的 `cbim:executor` 不能再登记，`cbim:main` 也不能被派成独立成员。

多个模块必须属于同一所选岗位；不同负责岗位拆分任务。模块各自保留维护关系和自身 Workflow，角色原则、有效 Skill、岗位名称与适配、模块正文及内置规范完整冻结。未显式选择 Workflow 时沿用本模块默认流程，不继承父模块或兄弟流程。成员使用岗位采纳的模型，不继承主会话模型。计划、派发及领取按 Knowledge → 模型配置短锁 → DispatchStore 顺序复核；新领取还冻结已满足前置任务的候选摘要、证据及限制。

成员的计划必须原样保留派发 goal、验收文本及顺序；步骤可以修订，目标、范围或负责人改变需要重新派发。Workflow 正文供模型执行，程序核验已声明的结构化条件，不能代替业务判断。安全检查点与求助不同：检查点仅支持原任务的一次受控续执行，求助不提供旧任务恢复许可。成员执行具体 IPC 及限制见[成员执行与结果回传](member-execution.md)。

## 工作区执行接口

通过现有 `cbim:call` IPC，显式携带工作区 `id`：

| 操作 | 参数 | 结果 |
|---|---|---|
| `loop.prepare` | `id, task` | 返回校验后的上下文，不启动或持久化任务 |
| `loop.start` | 原 `id, task, options` | 拒绝新业务执行，返回 `OWNER_DISPATCH_REQUIRED` |
| `loop.chat` | `id, message, options?, attachments?` | 创建主对话；业务工作由当前目标计划正式派发 |
| `loop.stop` | `id, taskId` | 请求停止，不回滚副作用 |
| `loop.inspect` | `id, taskId, runId` | 状态、上下文、持久化事件和未确认操作 |
| `loop.list` | `id` | 从日志恢复历史，明确报告损坏记录 |
| `loop.resume` | `id, taskId, runId, message, options, reconciledToolIds?` | 仅普通主对话可续聊；旧非 chat 业务任务拒绝，未核实操作仍阻止继续 |

`loop.prepare` 的旧 `task` 包含 `goal, moduleId, agentId, workflowId, acceptance` 和可选 `responsiblePerson`，与正式派发输入不同。主对话 `options` 可选择 `engine/profileId/model` 和权限模式；保留的兼容字段不构成成员模型选择入口。IPC 不接收任意子进程命令或环境变量。

主进程通过 `Application.execution(id).subscribe()` 订阅落盘事件。页面关闭不停止执行；工作区替换、移除和应用退出先排空 loop，再关闭知识服务。桌面对话已接入发送、公开文本增量展示、工具证据、停止与继续；默认供应商由 Application 解析后传给大脑。

成员任务保留 `dispatch.executionStart/Stop/Inspect`、`dispatch.messages/acknowledge` 和独立审批/选项接口。主工具先发现模块负责岗位，再以明确 `agentId/ownerSelection` 保存目标分配并派发；服务绑定真实主会话、scope 和 run。显式 `dispatch.task` IPC 同样必须携带当前活动 `scopeId`，任务与当前 goal 计划的角色、模块、Workflow 和负责人绑定一致；缺少 scope 或 ownerSelection 不创建新任务。显式 IPC 派发不会自动进入主工具的内存批次。

自动协作只沿用本轮权限模式和执行超时，不把主模型传给成员，也不从模型参数提升权限。岗位公开模型配置指纹在计划/派发时固定，领取在模型短锁下核实并解析同一配置；密钥不进入岗位绑定或运行日志。工具入队后由协调器等待主轮释放占用再启动成员，不把长期等待放进工具调用或执行槽。

主对话成员卡片与图节点详情通过 `dispatch.executionEvents` 读取公开增量，详情可操作审批、选项和停止；`Application.memberExecution(id).subscribe()` 提供已落盘事件。长期岗位 memberId 与任务执行实例、通道和 run 不同；同岗位的新任务仍创建独立执行实例。已有任务仅在真实安全检查点及一次续执行预约通过后可沿原身份继续，预约和领取都复核原岗位/模型/知识；失败、取消、中断或缺少 ownerBinding 的旧任务不能直接复活。旧日志继续可读，已运行段的历史结算不因后来换负责人而改写。

自动回注只在原主轮安全完成且没有未决工具时续接同一原生 Session。`RunInputSource` 保存 continuationId、结果 messageIds 与 taskIds，允许没有候选信封的失败或受阻任务回报。Pi 用 custom 消息、Claude Code 用明确标记的 synthetic 数据、Codex 用明确标记的系统转交资料保存成员任务结果，不将资料当作新授权；日志先记录回注尝试，再确认结果收件。按批次和消息 ID 去重不等于业务验收，也不提供失败自动重放。用户队列保留原正文和配置，在协作期间暂缓，主续跑安全结束后继续。

## 权限与持久化

主 Agent 管理团队和技术，可以通过内部知识服务查询、预览及提交 `.cbim/` 变更；read 拒绝提交、ask 请求批准、execute 仍核验版本与事务。主 Agent 不获得原生 write/edit/bash，门禁也拒绝业务写与命令，即使用户选择完全访问。执行成员沿用所选权限实现和验证业务。知识目录不允许通过原生文件/命令绕过内部服务。预览只保存本地计划缓存；开发 CLI 沿用原有权限兼容映射。

内部知识调用采用桥接 gate 的一次性授权，与业务工具共用当前运行的权限快照；不存在工作区全局 Agent 写入开关。“本次全部通过”只在当前运行有效，停止与结束清理；审批期间停止后，迟到批准不能重新放行。

运行摘要新增 toolReceipts，记录 workspaceId、taskId、runId、toolCallId、输入/结果哈希、副作用、范围与 succeeded/failed/denied/unknown。结果随事件落盘后返回，模型自带 receipt 不作为权威记录。旧日志不补造回执；Pi 在 Schema 阶段直接拒绝且未到达 gate 的调用仍保留原工具错误事件。命令范围为 unknown，不声称已完成系统级隔离；回执不是业务验收结果。

工具放行前记录提议、授权决定并 fsync，写失败拒绝执行。未收到结果的获准操作需要核实，不自动重放。Pi 仅认 `agent_settled`，Claude Code 仅认 SDK `result`，Codex 核对当前 thread/turn 的 `turn/completed`，`completed` 只表示引擎结束，验收仍为 `not_evaluated`。

主调度另有 `cbim_dispatch_command_report({runId, toolCallId})` 只读工具，桌面原工具记录的“核实原命令”通过 `dispatch.commandReport` 调用同一服务。当前支持目标计划/审阅、派发、未领取撤销、前置追加/替换、检查点续执行预约和显式放弃八类原写命令。服务核对原主实例、独立对话通道、周期归属、canonical 输入与原账本指纹；派发隐藏父版本取原事务前态，不用当前图推测。已关闭周期仍可明确查询，同名 Agent 的其它主会话不能借用记录。

报告分别说明原工具结果、事务保存事实与核实限制。因此原工具失败时也可能显示“原事务已保存”；查无回执仍然未知，不能判断没有执行。查询不重发操作、不修改原日志或未确认项、不恢复旧原生会话、不提供业务验收。其它工具暂沿各自原查询能力，不以执行入口探测回执。界面仅显式读取，普通轮询不重复核实；迟到结果按原身份隔离，读取失败保留旧报告并提示重新核实。

桌面进一步提供 `dispatch.effectObserve/effectDisposition/effectDispositionReceipt/effectDispositionList/effectRelations`：真实主或成员来源分别核对原运行与调用，当前单文件状态和旧 unknown 并存；原生 read/write/edit 可查看明确路径的存在性、大小与哈希，不读取正文。bash 及未适配外部动作明确标为未覆盖，不自动执行核实命令。

本机明确处置分为继续核实、新业务修复及保留未解决，先保存稳定命令再发送；失去回包只查询原请求。记录在同一 DispatchStore 不可变追加，观察和保存都不启动模型。具备资格时分别创建新的只读核实周期和正式业务修复周期，处置引用随新意图冻结，关联展示真实任务及结果；新修复完成不更正原失败。主来源没有原可信业务计划时只能先做只读核实，不能据此凭空创建业务计划。没有 before 正文的文件仍不能回滚，受控补偿另属下一片。

记录位于 `<CBIM 用户目录>/<workspaceId>/loop-engine/tasks/<taskId>/<runId>/events.jsonl`。Pi 会话位于同工作区的 `loop-engine/pi/sessions/`，Claude Code 位于 `loop-engine/claude/projects/`，Codex 位于 `loop-engine/codex/sessions/`。Pi 每次运行在自己的 `provider/models.json` 生成非敏感配置，Claude 使用独立配置目录及冻结环境；启用请求预算时，真实凭据仅保留在父进程代理。记录可能含业务正文，不自动共享，CBIM 公开事件不转发私有推理，原生私有文件由各引擎保存。知识目录防误操作检查不是操作系统沙箱。

成员派发与领取事务位于同工作区 `dispatch/dispatch.jsonl`；成员运行日志位于 `dispatch/runs/tasks/<taskId>/<runId>/events.jsonl`，原生会话分别位于 `dispatch/runs/pi/sessions/` 或 `dispatch/runs/claude/projects/`。Claude 首轮在真实结果时绑定实际生成文件，成员结算核对同一身份后保存路径。`starting` 意图先落盘，实际引擎就绪后才提交 running，工具不能先于启动确认执行。重启将未完成领取标为 interrupted，不重放模型或工具，也不恢复内存中的自动协作批次。主会话与成员共用工作区写入占用，每个运行的审批队列及“本次全部通过”互相隔离。停止主任务还会阻止后续自动启动、请求关联成员停止，并暂停用户队列；迟到事件不能重新拉起任务。

## 开发调用

`package.json` 仍将 `pnpm loop` 指向 [loop-cli.ts](../src/backend/main/commands/loop-cli.ts)。它复用 Application 和工作区锁，需 Node.js 22.19+、项目依赖，并先关闭占用该工程的 CBIM。

这不是当前岗位业务派发 CLI：带 `--goal/--module/--agent/--workflow/--acceptance` 的旧调用最终进入 `WorkspaceExecutionManager.start`，现在固定拒绝为 `OWNER_DISPATCH_REQUIRED`。`--task/--resume` 分支只可能继续已有普通 chat，旧业务运行仍拒绝；CLI 没有新建主对话或登记岗位、目标计划与 ownerSelection 的命令。保留的 `--allow-execution`、`--person` 等参数不能解除这些门禁。

需要执行业务时使用桌面主对话及正式调度链。保留的 CLI 显式 provider/model 模式不自动读取桌面加密凭据；若用于已有普通对话的受限调试，凭据应来自供应商环境变量或专用 Pi 配置，不能写进目标或命令参数。它不替代桌面岗位模型配置，也不授予成员业务执行权限。

## 验证边界

测试覆盖内部知识调用、继承与流程归属、写授权、记录隔离、停止排空及恢复版本冲突。真实 Pi 子进程配合本地确定性模型响应验证上下文注入、内部工具调用、知识目录读取拒绝、会话恢复与中断。这不是实际供应商鉴权或真实模型业务判断质量测试。

本步 `tests/application-collaboration-pi.test.ts` 已用真实 Application/Pi 验证主工具派发、成员读写及候选回注，并检查 ask 批准隔离、用户消息排队、停止和重开不重放；`tests/member-continuation-pi.test.ts` 验证 custom 回注与 user 续聊的原生历史。以上模型响应来自本机可控服务，不代表本步新增链路已经经过打包 UI 或真实供应商验证。

`pnpm package` 分别将 Pi、Claude SDK、Codex CLI 及其生产运行依赖复制到 `resources/pi-runtime/`、`resources/claude-runtime/`、`resources/codex-runtime/`，附带版本清单；后两者包含本平台二进制，Codex 平台包保留 npm 安装别名。`pnpm test:loop` 仍指向 [loop-smoke.mjs](../scripts/loop-smoke.mjs)，该历史脚本实际从对话页发送消息，且仍含主 Agent 直接 write/bash 的旧断言，不是当前岗位派发的可执行示例或验收依据；本次文档更新没有运行或迁移它。岗位模型与派发门禁的实际验证以对应阶段的验证记录为准，不能从旧脚本存在推断当前链路已验收。

## 自定义模型供应商

参考 Cindy 的供应商连接与模型目录配置方式（[连接表单源码](https://github.com/makecindy/cindy/blob/main/apps/desktop/src/frontend/components/settings/ProviderConnectionDialog.tsx)），在左下角用户栏 → 设置 → 模型供应商添加。填写名称、Loop 引擎、API 根地址、接口协议和鉴权；获取模型 ID 或手动添加，设置上下文、最大输出、推理能力、启用状态及默认模型，保存后测试连接。

支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages；鉴权为 API Key 或无鉴权。模型目录请求 /models（Anthropic 根地址补 /v1），失败可手动填写。发现不推断容量或工具支持。订阅/OAuth 登录、自动协议探测、自定义请求头与价格覆盖尚未实现。

配置保存在 CBIM 用户目录 llm.json；密钥通过 Electron safeStorage 加密，系统加密不可用时拒绝明文回退。IPC models.list/save/select/remove/discover/test 只返回公开字段，测试发送最小文本请求，可能产生费用，不发送工作区知识。编辑地址或协议时必须重新输入密钥。测试文本成功不代表完整工具调用能力。

普通主对话 `loop.chat/resume` 未选供应商时使用全局默认；`options.profileId/model` 可明确选型。成员使用负责岗位显式采纳的 profile/model 及配置指纹，没有负责人或配置过期时拒绝新领取，不回退主模型或全局默认。编辑模型不会回写已领取段的冻结配置；后续新任务及检查点预约/领取仍须按当前登记重新核实，不能通过恢复参数给旧任务换模型。旧 `loop.start` 业务入口已经关闭。

## 对话页面

对话页默认内置主 Agent，直接输入文字即可发送，不需要模块、团队 Agent、Workflow、责任人或验收表单。空工作区也能聊天，知识按需通过内部工具查询。可选模型或沿用默认模型；桌面默认采用逐次询问，业务文件、知识提交和命令共用运行权限。模式变更在下次发送时生效。

loop.chat 创建 mode=chat、agentId=cbim:main 的普通对话；loop.choices 只保留旧上下文选择查询，聊天页面不调用，也不提供新业务启动许可。loop.thread 按 taskId 返回全部运行轮次。页签只保存 taskId 和草稿，消息、工具、错误及执行状态从主进程日志恢复。页面每秒串行刷新，不持久化私有思维；公开文本增量随后由最终消息替换。普通轮次的 run.started 保存用户消息，旧记录回退原始目标；带 source 的成员回注轮次显示系统来源提示，不作为用户消息展示，主 Agent 回复继续正常流式显示。

切换页签、关闭页签或查看其他工作区不停止任务；使用“停止执行”请求中断。可在历史选择器重新打开任务。继续对话使用最新轮次和原生会话，知识变化不阻断普通聊天；旧直接团队任务只保留历史，不能经 loop.resume 新建执行轮。旧轮次、缺少原生会话或未核实工具结果会阻止普通对话继续。未确认工具须通过显式影响观察及独立新只读核实处理；新的 unknown 不能仅凭勾选调用 ID 恢复旧原生上下文。历史 reconciledToolIds 仅保留可读。成员业务的检查点续执行走独立预约与领取门禁，执行结束仍不等于验收通过。

负责人变更后的检查点交接走 `cbim_dispatch_abandon_checkpoint`：同一活动主周期显式放弃未消费的检查点/预约，历史核验不重开 native，精确处置保存后保留旧任务及证据。主调度必须另建当前负责人任务并审阅真实新候选。Auto 将处置纳入停止屏障，撤销原恢复的准入票据；关闭和重启不自动恢复这些待办。详见[成员交接](member-execution.md#负责人变更后的存量交接)。

长度限制诊断：模型 stopReason=length 表示输出被截断，不能显示为执行成功。界面显示配置上限和实际用量；低于配置上限时，不能据此确定是输出、上下文还是供应商侧限制，不只建议调大预算。核对后可继续原会话，不自动重放副作用工具。开启推理的低预算模型在设置页显示提示。

每轮 before_agent_start 根据 Pi 实际活动工具刷新能力指引；已提供写工具时，不能沿用历史助手的“只读”判断。业务根目录下具体文件的写入仍经权限检查，与 .cbim/ 知识保护分开；指引不代表已授予执行权限。

## 内部任务计划与交付候选

实现任务可通过 `cbim_task_plan` 保存目标、责任描述、步骤和验收要求；修改须提交 expectedVersion 和原因，历史保存在 `task.updated` 事件中。普通问答不强制创建计划。`cbim_task_inspect` 返回当前计划及本轮可引用的真实成功回执，`cbim_task_step` 用这些调用 ID 记录完成声明；伪造、失败和失效证据会被拒绝。

`cbim_delivery_prepare` 要求每个步骤都有有效证据，仅生成待审阅候选。运行 completed、步骤 reported_done、交付 awaiting_review 与业务验收是不同概念，当前没有模型或人工直接签发业务验收的接口。界面任务视图显示记录的目标、责任、修订及交付限制；不会从普通助手文本推断完成。

工具绑定当前真实运行，经相同 gate 调用，但只修改执行记录，不改项目与正式知识，故只读模式也可以规划和记录读取证据。业务写、知识写及命令放行前使旧证据失效；恢复和修改计划也要求重新核实，未知结果须核实实际影响并建立独立处置，不凭裸调用 ID 续跑，也不自动重放。命令可能改变产物，因此即便是测试命令也保守失效旧证据；应完成修改与验证后再关联本轮有效回执。

新主会话的 `run.started.conversationBinding` 记录与图根一致的真实主实例；同会话续跑不换实例，不同主会话不合并。主 Agent 只向已配置的自定义负责岗位派发；未配置时在当前会话自己执行。已退役的 `cbim:executor` 不能再登记，省略 agentId 或 ownerSelection 也不会产生默认执行者。用户任务启动一个调度周期，跨主模型调用、成员执行及结果回注；目标通过完成门禁，或失败、停止后收口并释放执行实例，保留主实例、图和证据。普通问答保留根而无业务节点，旧日志不按角色名补造岗位绑定。

计划责任文本本身不代表已派发。正式任务须经当前 scope/goal/ownerSelection 门禁创建；运行仅在目标、验收和冻结岗位与派发任务一致、存在有效结构化候选且知识版本仍一致时产生 result_ready 和结果信封。检查点和显式产物验证只覆盖其声明的范围，不保证所有外部产物变化或验收语义都已自动识别。主会话自动回注和收件确认不签发验收，工具真实接入也不保证任意模型都会按指引调用，应核对计划与回执。

## Cindy Pi 运行配置对齐

来源：Cindy 56b6e9a 的 buildPiSettingsJsonContent 与启动 RPC 顺序，许可证见 docs/legal/cindy-LICENSE。CBIM 只接入当前自定义供应商和本机 Pi，不包含 Cindy Gateway、订阅登录、远端 daemon 或插件包管理。

- 模型容量：contextWindow/maxTokens 是供应商真实能力，保留用户配置。工作预算与之独立，不用较小预算覆盖模型容量；模型列表接口不返回能力时仍需手动填写。
- 思考：设置页支持 off/minimal/low/medium/high/xhigh；缺省 medium，非推理模型 off。Pi 根据实际模型能力收敛，运行日志记录请求档位和实际档位；供应商的协议映射仍由固定版本 Pi 实现，不保证未知自定义端点接受所有档位。
- 压缩：每次启动、恢复都通过 RPC 开启并读回。无预算和阈值设置时使用 Pi 默认；设置后 reserveTokens = ceil(模型容量 - 工作预算 × 阈值)，工作预算缺省为完整容量，指定预算时阈值缺省 90%。压缩由 Pi 执行，CBIM 只显示事件，不自行裁剪历史。
- 重试：SSE，enabled=true，maxRetries=6，baseDelayMs=2000，provider.maxRetries=0。只沿用 Pi 的可重试错误判断，不把 length 当作网络错误，不重放工具副作用。停止仍可取消等待。
- 生命周期：每轮独立 provider/settings.json；普通主对话续聊应用本次选型，正式成员及其检查点续执行使用已核实的原岗位模型，不能从主对话配置换入。已有运行快照不变，配置 RPC 失败拒绝发送，不支持运行中热切换。

验证包含真实 Pi + 本机确定性接口；不使用用户的供应商凭据，不代表真实供应商推理质量或各档位效果。

模型能力发现现已读取 /models 的 context_window、max_output_tokens（兼容 camelCase）；已有模型由“同步已有模型容量”更新草稿，缺失字段不覆盖已有值。未知新模型不再默认为 32k。运行诊断另记录实际请求输出额度，解释 Pi 按容量、上下文估计及安全余量对输出进行裁剪的行为。


## 引擎与 Agent 选型

主对话增加 Loop 引擎菜单；静态 Agent 编辑和项目岗位登记/编辑共用引擎与模型级联菜单。选项只来自本机已保存且启用的模型目录。旧配置缺省保持 Pi；Claude Code 必须配置 Anthropic Messages，Codex 必须配置 OpenAI Responses。静态 Agent runtime 是新岗位的默认值，已有岗位仍使用原采纳快照。主会话换引擎时保留公开上下文，但不把另一种引擎的原生文件交给它解析。详细使用方法、维护入口与验证边界见 [Claude Code 配置](claude-code-engine.md)和 [Codex 配置](codex-engine.md)。
