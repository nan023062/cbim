# 模型请求预算运行时

ModelRequestBudgetService 按原根运行绑定预算作用域，为每个模型冻结独立价格。递归子调用的 agentRun 只保存请求来源；不创建额外预算作用域。

forRun 的 assertCaller 是子生命周期门禁，reserve、issue 和 assertSend 同时核实根运行与原子调用存活。实际用量、明确未发送和未知结果仍按原 ticket 结算，即使子运行已经停止也不能抹除实际消耗。未知请求保留预留额度并冻结后续发送。

规则与持久化分别由 ../rules 与 dispatch/storage 拥有；本服务不切换模型或代替 Agent 调度。
