/**
 * 作用定位：向桌面视图导出原主命令的只读核实协议和固定支持矩阵。
 * 设计原因：前端与后端共用严格报告结构，不复制命令推导算法，不把查询结果转换成执行或恢复权限。
 */
export {commandVerificationInputSchema,commandVerificationReportSchema,commandVerificationToolNames,isVerifiableMainToolName} from '../../logic/tasks/rules/command-verification';
export type {CommandVerificationInput,CommandVerificationReport,CommandResultSummary,CommandRecord,VerifiableMainToolName} from '../../logic/tasks/rules/command-verification';
