# 全局运行总览

只消费 runtime.read 与现有独立 admission.read，不启动或恢复模型。监管的 scope、派发 task、模型 run、成员与用户消息队列分别展示；模型轮次 completed 标为“本轮结束”，closed/completed 但没有完成审阅仅表示周期结束；实际完成审阅和周期结算同时存在才显示“目标周期完成”。这些系统事实仍不代表人工业务验收。

RuntimeFeed 持有窗口唯一在途读取与独立游标，noop 保持快照引用，变化快照重用未变行；同游标矛盾内容拒绝，错误保留旧值并明确可能过期，关闭/隐藏页面停止订阅与计时。新进程 stream 换入新快照，退订代际屏蔽迟到结果。没有轮询全部日志或正文。

统计始终为全局观察值；筛选仅作用下方列表。已报告消耗、价格缺失、未报告运行与不完整来源各自表达，不把缺失变成免费或零压力。准入与监管来自各自游标，不承诺跨快照原子一致。

原会话定位只传真实 workspaceId/rootSessionId，可附 scopeId/taskId；Shell 和 Conversation 核验既有绑定后定位，不按角色或最近运行猜测身份，不修改权限、任务或知识。独立运行的旧无绑定记录不提供伪造跳转。

派发列表与缓存键包含 workspace/root/task，逐运行键包含 workspace/task/run；不能因历史标识重名复用另一会话的行。


### 运行监管订阅边界

RuntimeFeed 的 listeners 使用前端 SubscriptionSet，通知保持同步实时遍历、按身份去重和异常原样传播。首订阅触发 refresh、末退订停止计时、generation 隔离迟到结果以及 pending 合并读取仍由 RuntimeFeed 负责。集合清空或退订不代表后端请求已取消。
