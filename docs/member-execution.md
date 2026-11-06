# 成员执行与结果回传

当前接通“主会话工具派发 → 主轮释放执行占用 → 独立成员 Pi 会话 → 结构化交付候选、已核实求助或真实失败 → 原主会话自动续跑”，同时保留可信桌面的显式派发和启动接口。主对话展示成员实时动态，任务视图展示可选中节点的派发流程图。主 Agent 和自定义 Agent 使用同一大脑、工具与权限门禁，区别来自角色配置、Skill 和各模块 Workflow。

自动协作仅推进当前应用进程中、由真实主聊天运行发出的委派，不扫描所有邮箱启动任务，也不提供成员递归派发。下面的 `window.cbim.call` 示例仍是独立的桌面开发和集成接口；没有成员启动表单。操作真实项目会调用已配置供应商并产生工具副作用，由用户选择工作区、目标和本轮权限，模型不能自行升级。

## 主会话自动协作

主 Agent 是具备工程思维、架构思维和结构化思维的团队与技术管理者：核实现状、目标和约束，维护模块职责、依赖和责任，将任务组织为执行者、模块列表、目标与验收要求，审阅证据并安排后续工作。它直接通过受控知识服务增删改查 `.cbim/`、治理团队和业务架构，按证据渐进演进；业务文件实现、命令和业务验证交给执行 Agent。知识写入仍受 read/ask/execute、版本与事务控制，重要人工决定不由模型伪造。没有合适自定义执行角色时使用内置静态 `cbim:executor`，继承 Team 根 Skill，由独立任务实例执行，不把默认定义写入 `.cbim/`。

现有成员状态由可靠事务推进：依赖未就绪为 `waiting`；领取/启动意图为 `communicating`；真实引擎就绪为 `working`；终态释放后回到 `idle` 或仍有前置待办的 `waiting`。模型正文不能直接改状态。“自身思考”指独立模型上下文中的理解、规划和工具选择，不承诺导出私有思维。长期驻留自治、主动求助后的可恢复等待/唤醒和更细粒度通信状态仍需后续实现，当前执行循环在真实任务启动时运行。

1. 主 Agent 通过知识工具定位已有 Agent、模块与维护关系，调用 `cbim_dispatch_task` 提交角色、模块列表、目标、验收要求及前置依赖；`cbim_dispatch_inspect` 只读查询本会话派发图。工作区、主会话、运行和调用身份均来自后端绑定，不接受模型指定权限或发送方。
2. 派发工具只可靠入队，不在工具调用中等待成员。主轮安全完成、引擎关闭且工作区占用释放后，`AutoCollaboration` 启动可执行成员；已有占用释放时再推进，不以长时间等待占据主执行槽。
3. 成员使用主轮用户选择的模型和权限模式，独立执行冻结的团队任务上下文。主轮的“本次任务全部通过”不传给成员；ask 成员仍单独审批，前置候选未验收且不扩大权限。
4. 成员完成并释放占用后，调度读取候选、证据与限制，或者失败、受阻、仍待前置等真实状态。结果以带批次来源的 Pi custom 消息进入同一个主原生会话，明确是任务数据而非用户新指令或授权；主 Agent 再处理原目标。失败且没有结果信封的批次也可以回报。
5. 回注来源先保存在主运行日志，按 `continuationId` 和结果消息 ID 防止重复启动，再确认结果收件。前端显示系统回传提示，不生成虚假的用户消息。已有用户消息保留在原可编辑队列，协作期间暂缓，主续跑安全完成后再处理。

停止主任务会先阻止后续自动启动，再请求停止关联成员并暂停用户队列；迟到批准不能重新启动。应用关闭或重新打开工作区不会自动恢复协作批次。派发和运行事实、结果信封及回注来源仍持久保存，未知副作用需要核实。

每个新主 session 默认拥有自己的主 Agent 实例，普通对话与图根引用同一个 `agentInstanceId`。用户一轮任务开始时创建调度周期 `scopeId`，跨越主模型调用、成员执行和结果回注，最终答复或停止后关闭。执行实例随该周期的任务创建，关闭时释放；主实例及会话、任务图、证据和用量记录保留。普通问答也有周期，但不伪造业务任务；模型一次返回不等于整个调度周期结束。

主对话使用主实例的 `conversation` 通道，正式任务使用各自执行实例的 `task` 通道；执行者和主调度不共享实例或原生上下文。同一静态执行角色在新任务中创建新的周期实例，已释放实例不能再次执行。旧图保留既有引用，不重写旧日志；只有显式续聊的新轮保存绑定。知识结构异常不阻断内置主会话身份登记，正式派发仍须通过结构、模块和维护关系检查。

## 成员求助与主调度补做

执行者遇到缺信息、依赖、权限、能力或范围问题时，可调用成员专属 `cbim_task_help`。输入只有 `kind / reason / question / attemptedToolCallIds`，接收方和完整运行身份由系统绑定；不能选择其它收件人，也不产生新的执行授权。

工具先返回 `staged`，随后成员必须结束本轮。只有正常关闭、canonical 日志完整、回执和顺序核实通过，才在原任务上保存不可变 `help`，将任务记为 `blocked`、成员释放占用回到空闲，并生成独立求助信封。停止、失败或未知结果不会伪装成安全交接；主对话、任务节点和详情只展示这份已结算事实，不根据模型正文判断。

主调度收到问题后核实图谱和原目标，以新任务、新实例安排补做；成功候选可按既有规则替代旧受阻任务。确需用户补充时可申请安全等待，但有尚未执行的依赖任务仍会被门禁拒绝。这个流程没有恢复旧成员运行，也未实现对等聊天、长期驻留或任意依赖子树取消。求助理由为权限不足不等于用户同意提权。

## 启动前具备的内容

- 工作区已在 CBIM 打开，知识结构有效，设置中已有可用的默认模型。
- 使用真实叶子 Agent ID，或内置默认执行角色 `cbim:executor`；`cbim:main` 不能成为执行者。目标模块已登记并具备显式维护关系与真人维护人，默认角色不绕过这些检查。
- 每个模块使用自己的 Workflow；没有专属 Workflow 时明确采用通用执行流程，不继承父模块或兄弟模块的流程。
- 主会话使用固定 `rootSessionId`，必须等于所属主对话的 `taskId`（由 `loop.chat` 返回），不是页面页签 ID 或成员任务 ID。独立逻辑主会话不会自动创建聊天页面，也不会混入其他聊天的图。

模块、角色或维护关系缺失时，应先通过授权知识服务补齐。不能伪造注册表、直接修改 `.cbim/` 或把任务派发当作知识治理授权。

## 1. 创建成员并派发

在可信桌面调试环境中执行；将示例工作区、成员和模块 ID 换成实际查询值。`commandId` 在整个工作区内标识一次操作，网络重试应复用同一 ID 和输入；不同主会话或不同操作也应使用新的 ID，不能把去重范围理解为单张图。

```js
const call = (action, args = {}) => window.cbim.call(action, args);
const workspaceId = '从 list 返回值选择的工作区 ID';
const rootSessionId = '从所属主对话的 loop.chat 回执取得 taskId';
const identity = {workspaceId, rootSessionId};
const agentId = '.cbim/team/developer';
const moduleId = '.cbim/workspace/client/loading';

const root = await call('dispatch.open', {
  ...identity, commandId: crypto.randomUUID(),
});
await call('dispatch.memberCreate', {
  ...identity, commandId: crypto.randomUUID(), agentId,
});
let graph = await call('dispatch.graphSnapshot', {identity});
const taskInput = {
  assigneeAgentId: agentId,
  moduleIds: [moduleId],
  goal: '核实资源加载模块并给出真实验证证据',
  acceptance: [{id: 'verified', text: '指出核实依据、结果及未验证限制'}],
  prerequisites: [],
};
const dispatchCommand = {
  ...identity, commandId: crypto.randomUUID(),
  expectedParentRevision: graph.root.revision,
  task: taskInput,
};
const sent = await call('dispatch.task', dispatchCommand);
```

派发回执只证明任务、信封和图增量可靠入队，没有启动模型。上述显式 IPC 是兼容的无周期开发入口；新主会话自动派发由可信调度器注入周期，每个任务创建独立执行实例，模型不能伪造周期和实例字段。

## 2. 显式启动与观察

```js
graph = await call('dispatch.graphSnapshot', {identity});
const node = graph.tasks.find(task => task.taskId === sent.taskId);
if (!node) throw new Error('任务不存在，请重新查询派发图');
const taskIdentity = {...identity, taskId: node.taskId};
const startCommand = {
  ...taskIdentity, commandId: crypto.randomUUID(),
  expectedRevision: node.revision,
  options: {permission: 'read'},
};
const started = await call('dispatch.executionStart', startCommand);
// started 仅表示已可靠保存启动意图；不表示模型已执行完毕。
const execution = await call('dispatch.executionInspect', taskIdentity);
const delta = await call('dispatch.graphDelta', {
  identity, cursor: started.cursor,
});
const monitor = await call('runtime.snapshot');
```

`options` 支持 `profileId`、`model`、`permission` 和 `turnTimeoutMs`（1000～3600000 毫秒）。未选模型时采用已保存默认配置，未选权限时为 read。权限含义：

| 权限 | 当前效果 |
| --- | --- |
| read | 可读业务文件、查询知识、规划和记录证据；拒绝业务/知识写入及命令 |
| ask | 写入及命令等待本轮人工确认；必须有人处理审批接口 |
| execute | 本轮允许执行，但仍经过知识边界、版本、平台检查和回执持久化 |

显式启动使用调用方选择的权限；自动协作冻结派发主轮的用户选定模式。维护关系、其他会话或上轮“本次全部通过”均不授予权限。主会话对业务文件只持有读取占用，其知识写入经过独立串行事务及版本校验；执行成员的 ask/execute 因可能写业务而独占工作区。只读运行可并行，同一动态实例不能双跑。

| 观察值 | 含义 |
| --- | --- |
| run.starting | 领取意图已落盘，尚不代表进程正在执行 |
| task.running / run.running | 实际引擎就绪并提交启动事实后，允许工具执行 |
| task.result_ready | 有与派发目标一致的有效结构化交付候选，尚未验收 |
| task.blocked | 引擎结束但尚无有效候选；有 `help` 时表示已安全交接的求助，否则查看真实限制或基线问题 |
| failed / cancelled / interrupted | 失败、停止或恢复中断；需要核实实际产物 |

执行前冻结完整角色和有效 Skill、多个模块正文及 Workflow、内置规范、前置候选、公开模型参数和本轮权限；密钥只在启动闭包中提供。工作区知识及内置规范在准备、启动和候选提交时复核，变化会阻止旧基线继续交付。

## 3. 审批、问题与停止

成员审批与普通对话分开。在任务图点击正在执行的成员节点，可以看到该成员的待确认操作、选项问题和停止按钮。选择 ask 后需要操作者明确决定；打开详情不会自动批准。以下接口也供集成方使用：

```js
const approvals = await call('dispatch.approvals', taskIdentity);
// 展示选定请求的 name/input，操作者作出本次决定后再调用：
await call('dispatch.approve', {
  ...taskIdentity, approvalId: approvals[0].id,
  allow: true, allowAll: false,
});
const questions = await call('dispatch.questions', taskIdentity);
// 按 questions[0].questions 逐题展示选项与其它补充输入，收集所有回答后：
await call('dispatch.answerQuestion', {
  ...taskIdentity, questionId: questions[0].id,
  answers: [{option: 0, other: ''}], // 示例只有一题；每题必须有一个回答
});
// 主动停止，待引擎和事务收尾后再查询终态：
await call('dispatch.executionStop', taskIdentity);
```

列表可能为空，应由调用方在选定请求存在时操作。`allowAll:true` 仅表示本次成员运行全部通过；运行结束或停止即失效。选项回答不授予工具权限。停止请求不回滚已经产生的副作用，也不立即伪造 cancelled；迟到批准不能重启已停止的工作。

## 4. 读取候选并确认收件

成员必须用 `cbim_task_plan` 原样保存派发目标和验收文本/顺序，使用 `cbim_task_inspect` 的真实回执、`cbim_task_step` 记录步骤，最终经 `cbim_delivery_prepare` 形成有效候选。步骤允许修订；目标、模块范围或验收需要改变时，应报告限制并重新派发。普通最终回复不替代候选。

```js
const view = await call('dispatch.executionInspect', taskIdentity);
if (view.task.status === 'result_ready') {
  console.log(view.task.result); // summary、evidenceRefs、limitations；acceptance=not_evaluated
  const recipient = {...identity, agentSessionId: root.agent.agentSessionId};
  const inbox = await call('dispatch.messages', recipient);
  const message = inbox.find(item => item.kind === 'result' && item.taskId === node.taskId);
  if (message) {
    await call('dispatch.acknowledge', {
      ...recipient, messageId: message.messageId, commandId: crypto.randomUUID(),
    });
  }
}
```

结果信封指向 `task.result`；独立的 `help` 信封指向同图 `task.help`。`dispatch.acknowledge` 本身只把该收件人的 result/help 信封改为 processed，不领取新任务、不恢复旧成员，也不判定业务验收或用户授权。主会话自动协作另由协调器完成回注与续跑，可靠记录来源后再确认；手工 IPC 派发不自动加入该协调器的批次。

前置任务通过派发输入 `prerequisites: [{taskId, expectedPlanRevision}]` 声明。只有同图对应版本的 result_ready 才满足启动条件；启动事务固定 `resultId` 及候选完整内容，接收成员会看到摘要、证据与限制。前置结果仍未验收，不扩大权限。当前自动批次中的任务可在前置满足后推进；批次外的手工任务仍需显式启动。无法满足的前置会如实回报主会话，不无限占用等待槽。

## 恢复、监控与数据位置

自动派发的执行通道随任务隔离，不在后续周期复用。兼容的无周期成员通道仅在上轮正常 completed、无未决工具且原生身份一致时可续接；failed/cancelled/interrupted 通道暂拒续接。当前没有异常通道修复或重试按钮，不能删除日志绕开。应用重启先将未完成运行收口为 interrupted，再关闭遗留周期并释放执行实例，不自动调用模型或重放工具。

工作区用户数据中的 `dispatch/dispatch.jsonl` 保存成员、信封、任务、冻结运行及图事务；`dispatch/runs/tasks/<taskId>/<runId>/events.jsonl` 保存运行事件，原生会话位于 `dispatch/runs/pi/sessions/`。完整执行知识和原生路径只用于后端，不进入图和全局监控 DTO。

团队架构的 Agent 节点已接入只读「执行历史」，按静态角色、独立 Session、运行轮次查看公开过程；主 Agent 和默认执行角色也可查询。删除定义后从「历史角色」进入，实例释放不删除履历。索引保存在应用用户目录，原运行日志保持原位；历史页手动刷新，不启动、恢复或审批任务。操作与数据边界见 [Agent 的 Session 执行历史](agent-session-history.md)。

监管从已持久化事件更新。成员轮次通过 memberBinding 归属派发任务，不重复生成 source=loop 任务；token/cost 保留实际报告值，未知费用不算免费。pendingOutbox 只计 pending 信封，claimed/processed 保留审计但退出待消费压力。

## 当前验证与限制

测试覆盖上下文冻结、同版本复核、独立身份、真实 Pi 子进程、可靠领取与结果提交、取消、关闭恢复和用量去重。真实 Pi 测试使用本机确定性模型响应，不使用用户供应商密钥，不等同于真实模型的自主业务判断或团队协作质量。

`tests/application-collaboration-pi.test.ts` 使用真实 Application、派发持久化和 Pi 子进程，配合本机可控模型响应，验证主工具派发、真实文件读取、候选回注，以及 ask 独立审批、写入验证、用户队列顺序、停止和重新打开后不重放。`tests/member-continuation-pi.test.ts` 验证原生历史中回注为 custom 数据、普通用户续聊仍是 user。打包界面另由下述 `test:collaboration` 验证；两类证据都不宣称真实供应商自主协作质量。

尚未实现：成员启动表单、从组织节点主动发起成员聊天、执行者求助/可恢复等待工具、异常通道人工修复、自动协作恢复、跨成员公平调度和预算限额。组织节点已能只读查看 Session 历史，不提供上述主动操作。新增分工只由主调度决定，主调度不直接执行业务任务。证据有效性检查不代替验收语义判断；既有 Loop 外的文件变更也没有完整产物基线检测。

## 主对话与任务流程图

- 主对话保留原有主 Agent 流式正文，在独立署名的成员卡片显示最近三项任务；查看详情可定位对应图节点。其他任务从“查看全部任务”进入图。
- 任务视图默认展示主 Agent 根节点与正式派发的任务节点，实线箭头表示派发，虚线箭头表示前置依赖。主会话的普通执行轮次不会被伪造为成员任务。
- 点击根节点查看主会话实例、通道及调度记录；点击任务节点查看独立执行成员的公开流式正文、工具状态、计划/证据和交付候选，也可查看历史轮次。实例释放不删除这些证据；候选始终标为“尚未验收”。
- 图与成员日志分别按游标增量刷新，空响应保留引用，后台页签降低频率；页面切换和刷新不停止成员执行。图同步失败保留上次可信图，并提供重试。
- `pnpm test:members` 是既有显式派发界面验证入口；`pnpm test:collaboration` 验证主会话模型自动派发到结果续跑的打包界面链路。两者使用实际 Pi 与本机可控 SSE，不证明真实供应商下的自主分工质量。自动协作构建及本步证据见[验证报告](../design/verification/auto-collaboration-20261106.md)。

## 成员执行事件公开接口

主对话卡片和节点详情通过 `dispatch.executionEvents` 读取同一份公开流：

```js
const page = await call('dispatch.executionEvents', {
  workspaceId, rootSessionId, taskId, runId,
  cursor: previousCursor, // 首次省略；后续使用上次响应 cursor
  limit: 200, // 1～500
});
```

首次读取和游标超前返回 reset；delta 只带新事件；noop 没有 events，仍含当前 run 快照。run 状态以派发事务为准，图中的 result_ready 对应运行 completed，二者均不表示验收通过。分页 cursor 只到本页末尾；hasMore 为 true 时继续取下一页。游标不能跨 run 使用，工作区、主会话、task、run 任何一项不匹配都会拒绝读取。

每个 run 首次恢复一次日志，期间收到的实时事件按 seq 合并去重；后续查询读取内存增量，不每秒重读完整日志。序号保留为连续前缀，Session 连接等受限事件转换为公开状态占位。新运行尚未创建第一条日志时可以返回空前缀，随后正常收到增量；历史日志损坏不能被当成空运行。

后端按事件和字段白名单筛选，不返回冻结角色/模块正文、原生 Session 路径等内部字段，也不转发原生私有推理事件。工具卡保留工具名称、调用标识、状态、本轮回执及工作区内非 `.cbim` 的业务路径；原始工具输入输出、写入正文、命令参数和知识工具完整正文不会发送到前端，内部错误替换为通用文案。结果摘要会明确显示“详细正文未公开”，不能当作完整工具输出或额外验收证据。公开对话、目标/验收要求与结构化计划仍保留业务文本，未自动检测其中的密钥或个人信息；前端只排版公开投影。查看详情不会修改执行权限。
