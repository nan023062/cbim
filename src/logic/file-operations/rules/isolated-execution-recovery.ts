/**
 * 目录归属：logic/file-operations/rules/file-operations；受控文件与隔离协议。
 * 作用定位：隔离执行的可信调用授权与桌面核实、清理公开协议。
 * 设计原因：界面只能选择原运行和执行记录，不能传入路径、PID、profile 或重新执行参数。
 * 职责边界：清理只回收已核实的私有资源，不修改原业务结果或签发重试许可。
 */
import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const scopedExecutionAuthorizationSchema=z.object({toolCallId:z.string().min(1).max(128),inputHash:digest,allowedSeq:z.number().int().positive()}).strict();
export type ScopedExecutionAuthorization=z.infer<typeof scopedExecutionAuthorizationSchema>;
export const isolatedExecutionRunSchema=z.object({workspaceId:digest,rootSessionId:id,taskId:id,runId:id}).strict();
export type IsolatedExecutionRun=z.infer<typeof isolatedExecutionRunSchema>;
export const isolatedExecutionItemSchema=z.object({executionId:z.string().uuid(),toolCallId:z.string().min(1).max(128),revision:z.number().int().positive(),phase:z.enum(['prepared','started','settled','cleaned','cleanup_requested','cleanup_complete']),host:z.enum(['live','exited','reused','unknown']),job:z.enum(['not_observed','active','empty','absent','unknown']),files:z.enum(['present','absent','changed','unknown']),state:z.enum(['active','cleanup_available','cleaned','unverifiable']),basis:digest,cleanupAllowed:z.boolean(),cleanupCommandId:z.string().uuid().optional(),cleanupBasis:digest.optional(),issues:z.array(z.string().max(256)).max(8)}).strict();
export type IsolatedExecutionItem=z.infer<typeof isolatedExecutionItemSchema>;
export const isolatedExecutionReportSchema=z.object({identity:isolatedExecutionRunSchema,checkedAt:z.string().datetime(),items:z.array(isolatedExecutionItemSchema).max(256),issues:z.array(z.string().max(256)).max(8)}).strict();
export type IsolatedExecutionReport=z.infer<typeof isolatedExecutionReportSchema>;
export const isolatedExecutionCleanupSchema=isolatedExecutionRunSchema.extend({instanceId:z.string().uuid(),executionId:z.string().uuid(),basis:digest,commandId:z.string().uuid()}).strict();
export type IsolatedExecutionCleanup=z.infer<typeof isolatedExecutionCleanupSchema>;
export const isolatedExecutionCleanupReceiptSchema=z.object({executionId:z.string().uuid(),commandId:z.string().uuid(),state:z.literal('cleaned'),revision:z.number().int().positive()}).strict();
