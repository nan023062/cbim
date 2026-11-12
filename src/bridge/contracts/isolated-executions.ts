/**
 * 作用定位：向桌面导出原隔离执行核实与清理的公开 DTO。
 * 设计原因：界面只提交原运行身份和报告版本，私有路径、PID、profile 不跨越桥接边界。
 */
export {isolatedExecutionReportSchema,isolatedExecutionCleanupReceiptSchema} from '../../backend/core/file-operations/isolated-execution-recovery';
export type {IsolatedExecutionRun,IsolatedExecutionReport,IsolatedExecutionItem,IsolatedExecutionCleanup} from '../../backend/core/file-operations/isolated-execution-recovery';
