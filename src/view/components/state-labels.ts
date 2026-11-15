/**
 * 作用定位：界面工作区与工具任务状态的中文标签。
 * 设计原因：多个视图共享显示词汇，不把展示标签作为服务状态机。
 */

export const stateLabels:Record<string,string>={running:'运行中',registered:'未打开',closed:'已关闭',opening:'正在打开',closing:'正在关闭',missing:'路径失效',failed:'失败',recovery_required:'需要恢复',completed:'已完成',cancelled:'已取消'};

/** 仅提供中性的状态图形；completed 使用历史标记，不把一次运行结束画成业务验收通过。 */
export const stateIconNames:Record<string,string>={
  running:'running',working:'running',opening:'running',planned:'list',queued:'queued',
  waiting:'decision',checkpointed:'pause',result_ready:'decision',blocked:'blocked',
  failed:'failed',cancelled:'stopped',interrupted:'unknown',completed:'history',
  closed:'archived',closing:'stopping',missing:'warning',recovery_required:'unknown',
  registered:'folder',idle:'person',communicating:'handoff',
};
