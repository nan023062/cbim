/**
 * 作用定位：界面工作区与工具任务状态的中文标签。
 * 设计原因：多个视图共享显示词汇，不把展示标签作为服务状态机。
 */

export const stateLabels:Record<string,string>={running:'运行中',registered:'未打开',closed:'已关闭',opening:'正在打开',closing:'正在关闭',missing:'路径失效',failed:'失败',recovery_required:'需要恢复',completed:'已完成',cancelled:'已取消'};
