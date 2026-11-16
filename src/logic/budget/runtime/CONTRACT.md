# 模型请求预算运行时

ModelRequestBudgetService 按原根运行绑定预算作用域，为每个模型冻结独立价格。递归子调用的 agentRun 只保存请求来源；不创建额外预算作用域。

forRun 的 assertCaller 是子生命周期门禁，reserve、issue 和 assertSend 同时核实根运行与原子调用存活。实际用量、明确未发送和未知结果仍按原 ticket 结算，即使子运行已经停止也不能抹除实际消耗。未知请求保留预留额度并冻结后续发送。

规则与持久化分别由 ../rules 与 dispatch/storage 拥有；本服务不切换模型或代替 Agent 调度。

# 逐角色请求预算服务

ModelRequestBudgetService.forRun 的可选 role 默认 primary；装配方只能从冻结执行快照选择已登记角色，调用请求者不能传身份、容量或价格。每个角色取得独立 RequestBudgetPort，仍使用同一 RequestBudgetStore、周期余额和 stoppedScopes 屏障。模型请求在账本事务外发送，issue 完成并同步 assertSend 后才允许 IO。

任何角色的未知结果都会封住同周期所有端口；重开从持久账本恢复未决预留，不释放额度或自动重发。缺用量、结算失败不交付成功结果。此切片只提供预算接口，向量 HTTP 和记忆引擎在后续切片消费。

## 周期用量与递归调用

ScopeUsageService 从已登记主 run 出发，沿 canonical 日志中有前置授权的首次 cbim_agent_call 关联读取子 run；各层身份与原父引用须精确一致。普通递归 Agent 不要求虚构旧任务；带业务绑定的子运行还须匹配本 scope 的 agentBusinessRuns。旧任务归属路径保留。日志端口 inspectAgent 只读指定 task/run，统计不扫描目录、不触发执行或恢复。

最多核实 532 个来源，超限拒绝整份报告；重复、环、跨根引用及缺日志不重复累计或报告完整。没有真实终态事件的递归主/子运行计入在途，即使磁盘摘要暂为 interrupted。价格、Token 和结算完整性仍复用 execution 的原计量规则。两次读取核对持久来源；未结算日志的计量仍为部分值。

递归引用格式统一消费 agents/contracts 的 agentCallReferenceSchema；预算服务仍自行核对父授权、当前周期、唯一来源及在途状态，不把结构校验当作归属证明。
