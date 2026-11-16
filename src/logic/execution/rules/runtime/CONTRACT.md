

## 执行前缺参

统一 Agent 调用通过可信 `agentTools` 工厂装配，`run.started.executionModel=agent-tools-v1` 只在真实装配后记录。调用工厂提供的 `assertExclusive` 核实已获准且没有其他在途工具／审批；子调用未结束时父新工具拒绝。可信调度器通过 `tool.updated.agentCall` 保存子引用，普通引擎事件不能注入该字段。子 `run.started.agentCall` 来自后端身份工厂。

停止同时请求引擎与子工具取消；收尾 drain 必须确认后代关闭后才能释放根租约。关闭失败只重试排空，不自动重放原调用。旧运行记录不补造调用关系。

beforeTool 分类/授权之前的 Schema 错误使用 toolInputError 转为字段说明，保存原 Fault 错误码并返回 rejected。工具尚未放行，不能将其解释为未知写入。该路径不重发调用、不补业务参数；原 Workflow/权限/停止/证据失效逻辑保持，执行后的失败依然沿未知结果规则处理。

normalizeToolInput 是可信同步预解析端口：先解析缺省参数，再以相同 input 写 proposed、授权与回执，只有变更时追加 originalInput 保留模型输入。解析失败保留原请求并进入拒绝路径；不能按当前身份重新解释历史日志。知识执行服务绑定同一实例并再次断言，不跨实例切换。此安排保留 originalKnowledgeWrite 从原 proposed 核实知识事务的能力。

## 指定话题补充与排空

主轮整话题补充使用带 interruptionId 的 user-continuation。仅此分支可续接安全 cancelled；beforeRun 必须消费原持久等待，其他可信接续仍要求 completed。日志尾行、未决工具、主对话绑定和原生文件校验全部保留；运行管理器等待旧 runtime 清理完成再创建新轮。

## 受理前的引擎历史预检

产品装配通过 RuntimeOptions.engineKind 声明本轮冻结引擎。普通续聊在取得租约、核实旧任务绑定之后，先按该身份调用 selectEngineSession，再调用 beforeRun 登记持久意图；历史超限、损坏或预检期间取消不登记新 scope、不创建新运行日志或引擎，并释放原租约。成功预检的结果直接用于新上下文，不在意图提交后重复读取历史。

createEngine 仍在 beforeRun 后执行，因为周期工具依赖已登记身份；实例 kind 必须与声明一致，不一致时关闭实例、释放租约并拒绝启动，不切换到另一个引擎。意图受理后的装配失败仍是已受理失败，不能删除原意图或冒充未执行。

未声明 engineKind 的旧独立 Runtime 工厂保持创建适配器后的历史校验，兼容既有独立入口；产品 createWorkspaceLoop 始终注入声明，因此产品续聊不走此兼容路径。成员检查点仍走其冻结绑定与证明核实，新主上下文仍不读取旧历史。

## 原调用暂停的运行门禁

assertQuestionWait 要求唯一已授权问题工具且无其他在途操作。直属调用全部等待时仅放行调度器指定的答复、目录、向上求助；其他工具拒绝。引擎回合结束仍有活动子调用则以 AGENT_REPLY_REQUIRED 中断，并沿原停止路径排空，不将问题中间回包当成完成。


主 Agent 与递归执行 Agent 直接共用 LoopRuntime，调用者传入同一 AbortSignal 和 beforeRun。Runtime 唯一持有真实运行取消、工具授权、日志及引擎收尾；上层在 done 后关闭所拥有实例，关闭后禁止再次启动。不另建 Agent 循环类或重复启动状态。

### 业务 Agent 的统一启动

startMember 接受 RunStartControl.BeforeRun，供可信调用装配记录原父工具与子运行关系；它仍执行 checkedMemberRunLaunch，不能将普通 chat 冒充业务身份。有 agentTools 的业务运行保留产物/验证门禁，但不创建旧 MemberHelpTools 或 RunMemberCheckpoint；求助统一经当前调用的问答端口暂停与继续。历史无 agentTools 的业务运行维持原交接行为。

## 原运行人工意见的副作用门禁
Runtime 在通常工具授权之后、实际放行和证据失效之前应用 agentTools.guardEffects。该门禁只能收紧已有决定，不能授权原来被拒绝的调用。拒绝进入普通工具回执，未知副作用默认拒绝；没有绑定该端口的历史运行保留原行为。


### 递归工具迁移收口

RunSteerControl 的可信 activeInput 附件清单参与原输入哈希；原生 requested/accepted 日志按同 token 记录。清单由宿主会话服务冻结，不允许模型提供或替换，不重复未知发送。
