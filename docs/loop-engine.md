# CBIM 内部 Loop Engine

唯一引擎为固定版本 `@earendil-works/pi-coding-agent@1.5.0`。CBIM 在应用内部管理工作区执行实例、模型配置、运行权限和工具调用。

源码分层：`src/backend/core/brain/` 是通用执行层（大脑），`src/backend/scheduler-engine/` 是管理工作区、知识和团队流程的调度引擎。目录改名不改变 `loop.*` 接口、`pnpm loop` 命令和既有 `loop-engine/` 数据目录。

调度引擎与 Core 平级，单向依赖 Core。工作区使用 `KnowledgeWorkspace` 契约，任务锁与工具策略通过 `ExecutionServices` 注入；平台实现位于 `main/infrastructure/execution.ts`。开发 CLI 位于 `main/commands/loop-cli.ts`，由 main 负责应用装配。

## 当前调用链

```text
Application / 开发 CLI
  → WorkspaceExecutionManager
    → prepareTeamTask：模块、Agent、有效 Skill、选定 Workflow、内置规范
    → LoopRuntime：任务锁、持久化事件、执行与恢复
      → PiEngine：真实 Pi 子进程、工具策略、原生会话
        → 临时能力桥 → KnowledgeService → 工作区查询与事务
```

KnowledgeService 提供领域查询与事务能力，KnowledgeTools 维护内部工具定义和参数 Schema。工具使用 `cbim_` 名称，通过可信运行绑定核验工作区身份、读取版本、幂等请求和本轮授权。

领域封装均属于 Core：`core/connectors` 管理链接器，`core/team` 管理 Team/Agent/Skill，`core/workspace` 管理业务 Workspace/Module/Workflow，`core/knowledge` 提供共用规则与对象治理。实际文件事务由 `main/workspace` 实现 `KnowledgeWorkspace` 接口后注入，Core 不反向依赖 main。

桌面与开发 CLI 装配相同的内部服务；工作区打开只管理知识、锁与执行记录，不向项目安装外部 AI 工具配置。

## 团队工作流准备

新任务明确目标、一个模块 ID、一名叶子 Agent ID、当前模块登记的 Workflow ID，以及至少一项验收要求。真人责任人可选，填写时必须存在于花名册。

程序加载模块正文、Agent 原则、自身与所有祖先 Skill、选定 Workflow、内置需求实现流程和通用规范。不继承父模块或兄弟模块的 Workflow。

知识结构错误、正文缺失、Skill 冲突、错误流程归属、未知责任人或准备期间知识变化均拒绝启动。完整正文及知识版本保存在 `TaskSpec.workflowContext`，随 `run.started` 持久化，并注入 Pi 专用系统指引。

目前实现的是可追溯的上下文装配和执行接入。Workflow 仍由模型按正文执行；没有确定性的步骤状态机、自动业务验收、结构化治理待办或多 Agent 调度。

## 工作区执行接口

通过现有 `cbim:call` IPC，显式携带工作区 `id`：

| 操作 | 参数 | 结果 |
|---|---|---|
| `loop.prepare` | `id, task` | 返回校验后的上下文，不启动或持久化任务 |
| `loop.start` | `id, task, options` | 重新准备并启动，返回 workspaceId/taskId/runId |
| `loop.stop` | `id, taskId` | 请求停止，不回滚副作用 |
| `loop.inspect` | `id, taskId, runId` | 状态、上下文、持久化事件和未确认操作 |
| `loop.list` | `id` | 从日志恢复历史，明确报告损坏记录 |
| `loop.resume` | `id, taskId, runId, message, options, reconciledToolIds?` | 继续原生会话；知识变化或未核实操作阻止恢复 |

`task` 包含 `goal, moduleId, agentId, workflowId, acceptance` 和可选 `responsiblePerson`。`options` 包含 `provider, model`、默认关闭的 `allowNativeExecution`、可选 `turnTimeoutMs`（1000～3600000 毫秒）。IPC 不接收任意子进程命令或环境变量。

主进程通过 `Application.execution(id).subscribe()` 订阅落盘事件。页面关闭不停止执行；工作区替换、移除和应用退出先排空 loop，再关闭知识服务。桌面对话已接入发送、公开文本增量展示、工具证据、停止与继续；默认供应商由 Application 解析后传给大脑。

## 权限与持久化

内部 Loop 的业务与知识工具共用本轮权限：read 拒绝业务写入、知识提交、索引刷新及命令；ask 对这些操作逐次确认；execute 自动执行，但保留平台边界与知识实例、版本及事务检查。只读查询、结构校验和预览可用，预览可能保存本地计划缓存，不修改正式知识。未提供 permission 的 CLI 保持 allowNativeExecution 的兼容映射：false 为 read，true 为 execute。

内部知识调用采用桥接 gate 的一次性授权，与业务工具共用当前运行的权限快照；不存在工作区全局 Agent 写入开关。“本次全部通过”只在当前运行有效，停止与结束清理；审批期间停止后，迟到批准不能重新放行。

运行摘要新增 toolReceipts，记录 workspaceId、taskId、runId、toolCallId、输入/结果哈希、副作用、范围与 succeeded/failed/denied/unknown。结果随事件落盘后返回，模型自带 receipt 不作为权威记录。旧日志不补造回执；Pi 在 Schema 阶段直接拒绝且未到达 gate 的调用仍保留原工具错误事件。命令范围为 unknown，不声称已完成系统级隔离；回执不是业务验收结果。

工具放行前记录提议、授权决定并 fsync，写失败拒绝执行。未收到结果的获准操作需要核实，不自动重放。`agent_settled` 才结束运行；`completed` 只表示引擎结束，验收仍为 `not_evaluated`。

记录位于 `<CBIM 用户目录>/<workspaceId>/loop-engine/tasks/<taskId>/<runId>/events.jsonl`。Pi 会话位于同工作区的 `loop-engine/pi/sessions/`。使用设置页配置时，每次运行在自己的 `provider/models.json` 生成非敏感配置，密钥仅由环境变量注入。记录可能含业务正文，不自动共享，不保存私有推理。知识目录防误操作检查不是操作系统沙箱。

## 开发调用

需 Node.js 22.19+ 和项目依赖。CLI 独立持有工作区锁，先关闭占用此工程的 CBIM。凭据通过供应商环境变量或工作区专用 Pi home 配置，不写进目标或命令参数。

```powershell
pnpm loop --root "C:/Projects/Game" --provider "<供应商>" --model "<模型>" --goal "验证资源加载" --module ".cbim/workspace/client/loading" --agent ".cbim/team/client/developer" --workflow ".cbim/workspace/client/loading/workflows/verify" --acceptance "提交结果与证据"

pnpm loop --root "C:/Projects/Game" --provider "<供应商>" --model "<模型>" --task "<taskId>" --resume "<runId>" --message "已核实产物，继续"
```

`--user-data` 指定数据根，`--person` 指定责任人，`--allow-execution` 开放原生执行。未确认操作逐个提供 `--reconciled-tool`，Ctrl+C 请求停止。

## 验证边界

测试覆盖内部知识调用、继承与流程归属、写授权、记录隔离、停止排空及恢复版本冲突。真实 Pi 子进程配合本地确定性模型响应验证上下文注入、内部工具调用、知识目录读取拒绝、会话恢复与中断。这不是实际供应商鉴权或真实模型业务判断质量测试。

`pnpm package` 将 Pi 及安装时解析的生产依赖复制到 `resources/pi-runtime/`，附带版本清单。`pnpm test:loop` 启动打包后的 CBIM.exe，通过桌面 IPC 准备团队任务、启动实际 Pi 并验证内部工具调用；模型服务为隔离的本机确定性测试服务。

## 自定义模型供应商

参考 Cindy 的供应商连接与模型目录配置方式（[连接表单源码](https://github.com/makecindy/cindy/blob/main/apps/desktop/src/frontend/components/settings/ProviderConnectionDialog.tsx)），在左下角用户栏 → 设置 → 模型供应商添加。填写名称、API 根地址、接口协议和鉴权；获取模型 ID 或手动添加，设置上下文、最大输出、推理能力、启用状态及默认模型，保存后测试连接。

支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages；鉴权为 API Key 或无鉴权。模型目录请求 /models（Anthropic 根地址补 /v1），失败可手动填写。发现不推断容量或工具支持。订阅/OAuth 登录、自动协议探测、自定义请求头与价格覆盖尚未实现。

配置保存在 CBIM 用户目录 llm.json；密钥通过 Electron safeStorage 加密，系统加密不可用时拒绝明文回退。IPC models.list/save/select/remove/discover/test 只返回公开字段，测试发送最小文本请求，可能产生费用，不发送工作区知识。编辑地址或协议时必须重新输入密钥。测试文本成功不代表完整工具调用能力。

loop.start/resume 未传供应商时使用全局默认；options.profileId 可选择供应商、options.model 可选其启用模型。新运行冻结已解析配置；编辑或删除供应商不改变已启动进程，恢复任务使用恢复时选择的配置。开发 CLI 仍支持显式 provider/model，不自动读取桌面加密凭据。

## 对话页面

对话页默认内置主 Agent，直接输入文字即可发送，不需要模块、团队 Agent、Workflow、责任人或验收表单。空工作区也能聊天，知识按需通过内部工具查询。可选模型或沿用默认模型；桌面默认采用逐次询问，业务文件、知识提交和命令共用运行权限。模式变更在下次发送时生效。

loop.chat 创建 mode=chat、agentId=cbim:main 的普通对话；loop.choices 仅保留给显式团队任务调用方，聊天页面不调用。loop.thread 按 taskId 返回全部运行轮次。页签只保存 taskId 和草稿，消息、工具、错误及执行状态从主进程日志恢复。页面每秒串行刷新，不持久化私有思维；公开文本增量随后由最终消息替换。每轮 run.started 保存本轮用户消息，历史版本无此字段时回退显示原始目标。

切换页签、关闭页签或查看其他工作区不停止任务；使用“停止执行”请求中断。可在历史选择器重新打开任务。继续对话使用最新轮次和原生会话，知识变化不阻断普通聊天；既有团队任务仍校验原始知识快照。旧轮次、缺少原生会话或未核实工具结果会阻止恢复。未确认工具需查看证据、核实产物后逐项确认。团队任务执行完成仍不等于验收通过，普通对话不展示验收状态。

长度限制诊断：模型 stopReason=length 表示输出被截断，不能显示为执行成功。界面显示配置上限和实际用量；低于配置上限时，不能据此确定是输出、上下文还是供应商侧限制，不只建议调大预算。核对后可继续原会话，不自动重放副作用工具。开启推理的低预算模型在设置页显示提示。

每轮 before_agent_start 根据 Pi 实际活动工具刷新能力指引；已提供写工具时，不能沿用历史助手的“只读”判断。业务根目录下具体文件的写入仍经权限检查，与 .cbim/ 知识保护分开；指引不代表已授予执行权限。

## 内部任务计划与交付候选

实现任务可通过 `cbim_task_plan` 保存目标、责任描述、步骤和验收要求；修改须提交 expectedVersion 和原因，历史保存在 `task.updated` 事件中。普通问答不强制创建计划。`cbim_task_inspect` 返回当前计划及本轮可引用的真实成功回执，`cbim_task_step` 用这些调用 ID 记录完成声明；伪造、失败和失效证据会被拒绝。

`cbim_delivery_prepare` 要求每个步骤都有有效证据，仅生成待审阅候选。运行 completed、步骤 reported_done、交付 awaiting_review 与业务验收是不同概念，当前没有模型或人工直接签发业务验收的接口。界面任务视图显示记录的目标、责任、修订及交付限制；不会从普通助手文本推断完成。

工具绑定当前真实运行，经相同 gate 调用，但只修改执行记录，不改项目与正式知识，故只读模式也可以规划和记录读取证据。业务写、知识写及命令放行前使旧证据失效；恢复和修改计划也要求重新核实，未知结果仍需显式确认且不自动重放。命令可能改变产物，因此即便是测试命令也保守失效旧证据；应完成修改与验证后再关联本轮有效回执。

当前未检测 Loop 外的产物修改，未按验收条目验证证据语义，未自动绑定候选模块或专业 Agent；责任描述也不代表已经派发给其他 Agent。工具真实接入不保证任意模型都会按指引调用，应在任务视图核对记录。

## Cindy Pi 运行配置对齐

来源：Cindy 56b6e9a 的 buildPiSettingsJsonContent 与启动 RPC 顺序，许可证见 docs/legal/cindy-LICENSE。CBIM 只接入当前自定义供应商和本机 Pi，不包含 Cindy Gateway、订阅登录、远端 daemon 或插件包管理。

- 模型容量：contextWindow/maxTokens 是供应商真实能力，保留用户配置。工作预算与之独立，不用较小预算覆盖模型容量；模型列表接口不返回能力时仍需手动填写。
- 思考：设置页支持 off/minimal/low/medium/high/xhigh；缺省 medium，非推理模型 off。Pi 根据实际模型能力收敛，运行日志记录请求档位和实际档位；供应商的协议映射仍由固定版本 Pi 实现，不保证未知自定义端点接受所有档位。
- 压缩：每次启动、恢复都通过 RPC 开启并读回。无预算和阈值设置时使用 Pi 默认；设置后 reserveTokens = ceil(模型容量 - 工作预算 × 阈值)，工作预算缺省为完整容量，指定预算时阈值缺省 90%。压缩由 Pi 执行，CBIM 只显示事件，不自行裁剪历史。
- 重试：SSE，enabled=true，maxRetries=6，baseDelayMs=2000，provider.maxRetries=0。只沿用 Pi 的可重试错误判断，不把 length 当作网络错误，不重放工具副作用。停止仍可取消等待。
- 生命周期：每轮独立 provider/settings.json；恢复后重新应用当前模型意图，已有运行快照不变；配置 RPC 失败拒绝发送。CBIM 切换模型在下一轮新建 Pi 进程时生效，不支持运行中热切换。

验证包含真实 Pi + 本机确定性接口；不使用用户的供应商凭据，不代表真实供应商推理质量或各档位效果。

模型能力发现现已读取 /models 的 context_window、max_output_tokens（兼容 camelCase）；已有模型由“同步已有模型容量”更新草稿，缺失字段不覆盖已有值。未知新模型不再默认为 32k。运行诊断另记录实际请求输出额度，解释 Pi 按容量、上下文估计及安全余量对输出进行裁剪的行为。
