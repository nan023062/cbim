

## 候选批准与最终目标审阅

ScopeGoalService.reviewCandidate 由当前主运行调用，要求活动且已规划目标、无未核实插入、精确任务版本及未审阅候选。复用原运行、工具证据、岗位、知识与产物核实，在同一 DispatchStore 事务内追加 candidateReview；相同命令返回原回执，不重新审阅，不允许改判。磁盘 RunSummary 对尚未结算日志也标 interrupted，所以活性使用调用闭包与当前主身份，可靠事件用于排除已有终态，不能以磁盘 status=running 判断。

accept 仅允许后继使用此结果；reject 的候选不能作为最终目标证据。最终 cbim_goal_review 及 human 决定仍独立。拒绝后应撤销相关未启动后继并新建返工链；不把 rejected/result_ready 当作已有 replace_dependency 所允许的失败来源。追加、替换和修订依赖的新边统一启用 reviewRequired。

## 指定话题补充与排空

`TopicInterruptionService` 负责用户指定话题补充的持久意图和排空后的等待提交，不停止引擎。prepare 检查原输入版本、剩余主轮/决策/正文额度并保存原请求；park 重核可信主轮日志完整性、原生文件身份和全部原话题成员终态。新等待不伪造 awaiting_user 审阅；ScopeContinuationService 只消费同一 commandId、原文、附件和选型，拒绝更换权限或冒充人工决定。可靠等待重启可显式查询/接续，未可靠排空不自动执行。

OfficeHistoryService 从原 DispatchStore、mainRunIds、task.scopeId 和信封生成归档目录，仅选中引用才读 canonical 正文；不另存正文。完整公开消息按版本分块，内部成员提示词、原生会话和工具正文仍走公开白名单；旧记录缺少明确归属不按时间猜测。主归档和当前模型工作窗口分开，查询不启动、复活或验收历史运行。
