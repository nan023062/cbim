

## 失败原因与任务卡

成员结算为 `failed/interrupted` 时，从身份已核实的 `RunSummary` 最后一条匹配终态取得 `error`，通过 Core `publicRunFailure` 重建公开原因，和运行状态一起保存到 `TaskNode.waitReason` 与 `DispatchRun.error`。任务图既有原因区域直接消费此字段，不需要前端另猜错误。工具自身失败或旧轮错误不冒充本轮终态；无错误时保持原缺省说明，恢复关闭等明确原因仍优先。未决工具、候选资格、占用排空及用户取消语义不变；历史已保存的任务节点不批量重写。

## 审阅后领取

dependenciesReady 同时供自动协调器和实际成员领取使用：有候选、计划和锁定结果匹配后，reviewRequired 边还须 candidateAccepted。检查先于执行占用；事务层再检查相同约束。旧未带标志依赖保持原行为，候选审阅不会修改运行事实或替代产物核实。
