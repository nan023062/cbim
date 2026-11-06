### 全局运行监管契约（已实现）

`types.ts` 公开工作区、成员、两种任务来源、执行轮次、负载和消耗 DTO。静态 Agent 定义仍归 Team；运行索引管理器在调度层实现。

- `activityCurrent` 区分当前观察与历史活动；工作区不可用/关闭时不计活跃人员。
- `RuntimeMember.mainRootSessionId` 保留已登记主实例的会话归属，空闲时也可区分不同会话的主实例；普通成员和无归属字段的旧实例不补造值。
- 派发任务携带实例身份；成员轮次的 `RuntimeRun.memberBinding` 来自已核验的起始事件/恢复摘要，归属原派发任务，不再合成重复 Loop 任务。
- 普通主对话使用互斥的 `RuntimeRun.conversationBinding`，其 Loop 任务为 `binding=instance`，包含 `agentInstanceId/rootSessionId/agentSessionId`。不同主会话默认使用独立主调度实例，正式业务节点使用独立执行实例。旧 Loop 无绑定时保留 `binding=role-only`，禁止按角色名猜实例。
- `executionScopeId/executionTaskId/lifecycle/releasedAt` 公开执行实例的周期归属和释放事实。`members` 保留历史；`pressure.memberInstances` 仅计未释放实例，released 不再计活跃运行或排队/等待/阻塞压力。累计用量仍按真实日志保留，不因释放删除或重复计费。主调度实例随会话保留。
- `RuntimeMember.activeConversation` 仅来自本代际真实活跃的对话运行，不借用 `activeTaskId` 冒充派发业务任务。等待工具授权映射为 waiting，其余运行阶段映射为 working；运行终态移除此活动投影，工作区关闭/不可用和历史恢复均不产生假活跃。
- 邮箱负载只统计 `delivery=pending`；claimed/processed 留在权威日志用于审计，不重复计待消费数量。
- RuntimeUsage 是累计报告消费；上下文占用不计入总数，未知用量/价格有显式字段。
- `complete=false` 表示存在未加载/损坏来源，部分数字不是全系统精确值。
- RuntimeRead 无变化只返回游标，有变化返回快照。投影不签发调度、租约、权限或验收。
- 成员日志与对话日志均纳入累计消费，按 workspace/task/run/seq 去重；公开成员绑定只有身份和版本，不包含原生会话文件、知识正文或授权。

详见[全局管理设计与实际范围](../../../../docs/global-runtime-management.md)。
