/**
 * 作用定位：定义指定调度周期的只读运行计量报告，供调度服务、Bridge 和任务视图共用。
 * 设计原因：完整运行归属、可读日志、已报告用量和已知价格是不同事实；未知记录不能计作免费，也不能据统计签发预算或执行许可。
 */
import {z} from 'zod';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const count=z.number().finite().nonnegative();
const integer=z.number().int().nonnegative().safe();
export const scopeUsageInputSchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id}).strict();
export type ScopeUsageInput=z.infer<typeof scopeUsageInputSchema>;
/** reasoning 只是 output 的子集，total 仅相加 input/output/cacheRead/cacheWrite。 */
export const scopeUsageTokensSchema=z.object({input:integer,output:integer,cacheRead:integer,cacheWrite:integer,reasoning:integer,total:integer}).strict();
export type ScopeUsageTokens=z.infer<typeof scopeUsageTokensSchema>;
export const scopeUsageIssueSchema=z.object({code:z.string().regex(/^[A-Z_0-9]{1,80}$/),message:z.string().min(1).max(1000)}).strict();
export type ScopeUsageIssue=z.infer<typeof scopeUsageIssueSchema>;
/** reported 表示已取得本轮完整原生汇总，不代表供应商账单没有额外费用；messages 一律保留部分计量。 */
export const scopeRunUsageSchema=z.object({source:z.enum(['run-summary','messages','none']),tokensState:z.enum(['reported','partial','missing']),costState:z.enum(['priced','partial','unknown']),tokens:scopeUsageTokensSchema,estimatedCostUsd:count.optional(),issues:z.array(scopeUsageIssueSchema)}).strict();
export type ScopeRunUsage=z.infer<typeof scopeRunUsageSchema>;
export const scopeUsageRunSchema=z.object({kind:z.enum(['main','member']),taskId:id,runId:id,status:z.enum(['starting','running','completed','failed','cancelled','interrupted','unknown']),logState:z.enum(['verified','missing','invalid','incomplete','identity_mismatch']),usage:scopeRunUsageSchema}).strict();
export type ScopeUsageRun=z.infer<typeof scopeUsageRunSchema>;
export const scopeUsageTotalsSchema=z.object({tokens:scopeUsageTokensSchema,estimatedCostUsd:count.optional(),registeredRuns:integer,readRuns:integer,inFlightRuns:integer,missingUsageRuns:integer,partialUsageRuns:integer,unpricedRuns:integer,tokensComplete:z.boolean(),costComplete:z.boolean()}).strict();
export type ScopeUsageTotals=z.infer<typeof scopeUsageTotalsSchema>;
/** basis 仅标识本次读取的归属基线；changed_during_read 不得作为完整周期统计，读接口不会登记或修复记录。 */
export const scopeUsageReportSchema=z.object({identity:scopeUsageInputSchema,checkedAt:z.string().datetime(),basis:id,consistency:z.enum(['stable','changed_during_read']),coverage:z.enum(['tracked','legacy']),scopeStatus:z.enum(['active','waiting','closed']),scopeOutcome:z.enum(['completed','failed','cancelled','interrupted']).optional(),totals:scopeUsageTotalsSchema,runs:z.array(scopeUsageRunSchema).max(532),issues:z.array(scopeUsageIssueSchema)}).strict();
export type ScopeUsageReport=z.infer<typeof scopeUsageReportSchema>;
