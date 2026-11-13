# 运行能力的在途与退出边界

RunControlledFile、RunScopedExecution、RunArtifactTransition 分别持有 utility.InFlightOperations，跟踪已经发出的原端口 Promise，drain 等待调用时快照。基础集合不改变一次性授权、原参数 hash、事件顺序、短门闩或 unknown 写屏障，也不接管取消控制器。

Promise settled 仅代表调用返回。三种能力继续执行各自平台 drain，保持物理退出未确认时的错误与占用；RunScopedExecution 的 physicalUnknown、受控写 confirmNotApplied、产物阶段及验收规则留在原能力。基础库不得自动重发、补偿或释放工作区租约。
