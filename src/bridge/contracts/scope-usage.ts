/**
 * 作用定位：向桌面任务视图公开周期用量的严格查询与报告契约。
 * 设计原因：界面只读取指定主会话周期的已报告消耗，不接触日志路径、计价凭据或后端调度实例，也不通过统计签发执行权。
 */
export {scopeUsageInputSchema,scopeUsageReportSchema} from '../../backend/core/budget/scope-usage';
export type {ScopeUsageInput,ScopeUsageReport,ScopeUsageRun,ScopeUsageTokens,ScopeUsageTotals} from '../../backend/core/budget/scope-usage';
