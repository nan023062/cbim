/**
 * 作用定位：公开目标周期额度策略及只读逐请求摘要，供设置和目标卡片经 IPC 展示；不公开预留或终态写入端口。
 * 设计原因：前端复用同一严格契约而不依赖调度服务或文件存储；展示与保存默认值都不授予执行许可。
 */
export {scopeBudgetPolicySchema,scopeBudgetSummarySchema} from '../../logic/budget/rules/scope-budget';
export type {ScopeBudgetPolicy,ScopeBudgetSummary,ScopeBudgetReason} from '../../logic/budget/rules/scope-budget';
export {requestBudgetQuerySchema,requestBudgetReportSchema} from '../../logic/budget/rules/model-request-budget';
export type {RequestBudgetReport,RequestBudgetDenial} from '../../logic/budget/rules/model-request-budget';
