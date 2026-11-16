

## 知识参数默认值装配

新 Agent 工具装配经 ExecutionServices.agentTools 明确提供；仅此路径使用统一主／执行指令并不装配旧派发工具。根 Agent 对象保留主会话已有可用知识、网页和反馈授权，子对象只获得冻结指令、同权限工具与递归能力。`WorkspaceLoop.agent` 给主执行管理器和子调度使用同一 LoopRuntime 运行机制。旧未装配入口保留原运行协议，不能仅依据角色名开启递归。

统一 Agent 工具列表不套用旧 Team 的业务工具过滤；工具可见性不提供授权，执行仍通过 Runtime 的本轮权限、审批和原服务写入检查。

loop-engine 仅对 KnowledgeTools.has 命中的当前注册知识工具提供 normalizeToolInput；通过 normalizeInput 校验绑定实例和实际 Schema，在 Runtime 记录请求前补齐身份与默认值。派发、岗位、原生及其它工具保持原输入和独立校验。执行服务仍重新核对同一实例与写权限，不借规范化提升授权。

## 冻结引擎与启动预检

createWorkspaceLoop 将模型与引擎配置核实后确定的 engine 作为 RuntimeOptions.engineKind 注入，主与成员装配均不能遗漏。该声明只用于运行受理前核实历史可转交性；实际适配器和周期工具仍在 beforeRun 之后创建。Runtime 会复核实际 kind 与声明一致，不能在预检后静默改换引擎。

## 递归求助端口

loop-engine 将 cbim_agent_reply 登记为读效果工具，实际答复权仍由调度器校验。子 Agent 的 cbim_ask_user_question 指令与注入端口只面向直接调用方，主 Agent 保留用户问题端口；工具名称共用不代表交互对象相同。
### 执行选项中的模型角色

WorkspaceLoopOptions.modelRoles 仅表达 Agent 附加模型引用；实际入口在启动前通过 EngineModelProfiles 校验并冻结。当前代码引擎仅消费 primary，记忆引擎另需 embedding；未声明角色不能穿透选型校验。

### 统一工厂切片

loop-engine 不直接选择具体构造器，也不解析 Pi SDK 路径；通过 engine-adapters 的源码兼容表取得已核协议的工厂。Pi 进程准备移到其 package.ts，SDK 版本核对保留。源码兼容表仅供开发运行；正式构建改用已验证 E，安装选择与独立更新管理另由包生命周期服务承担。

### 正式 E 加载

生产 build 通过 packagedEngineBuild 将源码兼容表替换为拒绝回退的入口；loop-engine 对受管包只调用 engine-package-loader，按冷宿主给出的不可变根、适配器入口、版本和协议核对，并比较 E 编译声明与 R 静态模型/历史约束。旧 E 缺声明或不匹配时明确要求匹配版本，不启动、下载或重试。该动态加载登记实际源码依赖，不作为外部依赖豁免。开发直接运行源码时才使用兼容表。

引擎原生目录来自 R 静态声明的 storageDirectory，历史 Claude 目录保持 claude。装配不按引擎名称追加依赖；管理服务返回固定闭包，具体包选择自己声明的依赖。


## 递归调用协调

agent-call-scheduler.ts 持有父子调用关联、深度、去重、暂停答复与取消树，直接调用已准备 Runtime.start 并等待 done；finally 经 Runtime.close 确认排空后才释放已有全局准入许可。关闭失败保留原句柄，只重试排空，不重放任务。并发来自 execution/admission，预算来自根请求账本；协调器不另存 reserved 或本根额度，capacity 仅显示权威快照。Agent 对象继续归 agents，不迁入具体引擎。

### 显式业务调用与当前结果核验

AgentCallScheduler.prepare 可以返回可信 launch 及只读 verify。带 launch 调用同一个 LoopRuntime.startMember，beforeRun 仍将真实子 task/run 关联父工具；普通调用沿 start。只有 canonical 验证和当前字节复核通过，业务调用才返回 completed + verification。模型结束但验证失败返回工具错误。错误 details 保留工具 outcome，避免适配层把业务错误码二次封装丢失。

cbim_agent_result_check 仅接受当前父运行已经完成的原 callId；从闭包取得原身份与验证器，模型不能提交路径或证明。外部文件变化返回 WORKFLOW_VALIDATION_STALE；不能据此重放子运行。调用图深度、全局准入、预算、停止及排空逻辑不变。业务 Agent 暴露原产物证据工具及递归求助，旧终止交接/检查点工具仅保留给旧运行。

### 人工意见也是原调用上的工具

只有深度 0 且具备真实宿主问题队列的 Agent 公开 cbim_agent_result_review。参数只有原 callId，模型不能提交决定、文件证明或“用户已批准”。工具重新核实原交付，无法复核时只提供 reject/request_evidence；accept 在用户回答后再次检查当前字节，失败不保存接受记录。

humanDecision 通过原父运行的 tool.updated 可靠追加，绑定 callerTaskId/callerRunId/callId/reviewToolCallId、原始证明、当前核验和用户实际回答。保存后在同工具中等待第二张“继续处理意见”问题卡，此时模型不会收到返回值，子运行不会重启。明确继续仅授权处理意见；负面决定或“只保存”使本运行的新 cbim_agent_call 返回 AGENT_HUMAN_DECISION_REQUIRED。原 callId 的幂等读取仍返回原结果，不重放。新的用户执行指令进入下一运行后重新核实，不复用本轮授权。

同一评审工具 ID 只消费一次，重复身份更换 callId 拒绝；子 Agent 和跨调用者的候选不能请求直接人工评审。停止会取消等待，已可靠保存的意见保留在 canonical，重启仅展示日志，不自动恢复问题卡/模型/旧调用。新协议不使用旧 scope-goal 的 humanContinue：继续在当前普通工具内完成；中断后的新指令由主对话原入口受理，不伪造历史目标等待。


### 统一主会话归档

officeHistory 是可信主装配可选的只读归档工具，与统一 Agent 工具并存；目录、参数描述及实际调用使用同一实例。未装配时不可调用，子循环不继承。


接受意见保存后的继续仍须按原 callId 重新核验当前交付。复核失败保留原 humanDecision，仅追加 decision_released（continued=false、verification_failed）并返回原核验错误，同时禁止本轮自动创建子调用；不能把此前接受当作当前文件的证明，不恢复旧运行。

## 业务登记与异步释放

准备结果的 beforeRun 在真实父工具引用保存后执行；登记失败禁止进入子模型主体。release 可异步执行，必须等待原 Runtime.close 与业务登记封存；任何一步失败都保留 stranded 句柄和占用。close 只重试原关闭链，不重新 prepare 或执行模型。

## 递归 Workflow 能力预检

createWorkspaceLoop 在解析受管引擎包前，按当前引擎/权限的 nativeToolNames 与实际范围/验证端口调用 assertWorkflowCapabilities。显式业务调用准备阶段即拒绝缺能力，尚未登记子运行或发模型请求；审批仍留在后续每个工具执行。该纯规则与旧成员领取共用，不再只在旧派工入口保护 Workflow。
