/**
 * 作用定位：公开目标周期软限额的可序列化策略，供设置和目标卡片经 IPC 读写、展示。
 * 设计原因：前端复用同一严格契约而不依赖调度服务或文件存储；展示与保存默认值都不授予执行许可。
 */
export {scopeBudgetPolicySchema,scopeBudgetSummarySchema} from '../../backend/core/tasks/scope-budget';
export type {ScopeBudgetPolicy,ScopeBudgetSummary,ScopeBudgetReason} from '../../backend/core/tasks/scope-budget';
