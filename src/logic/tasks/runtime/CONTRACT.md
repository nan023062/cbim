

## 候选批准与最终目标审阅

ScopeGoalService.reviewCandidate 由当前主运行调用，要求活动且已规划目标、无未核实插入、精确任务版本及未审阅候选。复用原运行、工具证据、岗位、知识与产物核实，在同一 DispatchStore 事务内追加 candidateReview；相同命令返回原回执，不重新审阅，不允许改判。磁盘 RunSummary 对尚未结算日志也标 interrupted，所以活性使用调用闭包与当前主身份，可靠事件用于排除已有终态，不能以磁盘 status=running 判断。

accept 仅允许后继使用此结果；reject 的候选不能作为最终目标证据。最终 cbim_goal_review 及 human 决定仍独立。拒绝后应撤销相关未启动后继并新建返工链；不把 rejected/result_ready 当作已有 replace_dependency 所允许的失败来源。追加、替换和修订依赖的新边统一启用 reviewRequired。
