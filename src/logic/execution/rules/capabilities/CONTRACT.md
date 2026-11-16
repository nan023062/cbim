# 运行能力的在途与退出边界

RunControlledFile、RunScopedExecution、RunArtifactTransition 分别持有 utility.InFlightOperations，跟踪已经发出的原端口 Promise，drain 等待调用时快照。基础集合不改变一次性授权、原参数 hash、事件顺序、短门闩或 unknown 写屏障，也不接管取消控制器。

Promise settled 仅代表调用返回。三种能力继续执行各自平台 drain，保持物理退出未确认时的错误与占用；RunScopedExecution 的 physicalUnknown、受控写 confirmNotApplied、产物阶段及验收规则留在原能力。基础库不得自动重发、补偿或释放工作区租约。

## 未核实受控写之后的同调用求助

RunControlledFile.guard 在原写结果未知后允许 cbim_ask_user_question，沿既有 Agent 问答端口交给直接调用方；回答不清除 unverified 集合，也不授予新写入、命令或交付。原生只读与旧 cbim_task_help 保留原语义，最终仍记录 run.interrupted 及原 unverifiedControlledCalls。
