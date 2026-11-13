/**
 * 作用定位：定义应用级执行准入的公开策略、身份、占用、等待票据与独立读取游标。
 * 设计原因：进程内准入不同于历史负载索引；只公开无正文/凭据的当前事实，等待不代表模型已启动，重启不据这些票据恢复执行。
 */
import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const revision=z.number().int().positive().safe();
/** ownerEpoch 是本进程工作区装配代际，不是任务租约；关闭后旧代际不能再次排队。 */
export const admissionIdentitySchema=z.object({workspaceId:id,ownerEpoch:revision,rootSessionId:id,requestId:id,agentInstanceId:id.optional(),scopeId:id.optional(),taskId:id.optional()}).strict();
export type AdmissionIdentity=z.infer<typeof admissionIdentitySchema>;
/** direct 尚无可重放的首轮排队意图，容量不足只拒绝；另两类已有可信任务/回注来源才能持等待票。 */
export const admissionRequestSchema=admissionIdentitySchema.extend({source:z.enum(['direct','member','main-result']),workspacePermission:z.enum(['read','ask','execute'])}).strict();
export type AdmissionRequest=z.infer<typeof admissionRequestSchema>;
export const admissionWaitReasonSchema=z.enum(['global_capacity','workspace_conflict','agent_busy','fairness']);
export type AdmissionWaitReason=z.infer<typeof admissionWaitReasonSchema>;
export type AdmissionDenialReason=AdmissionWaitReason|'stale_request'|'already_running'|'local_acquire_failed';
/** order 只表示本进程排票顺序；reason 可更新，ticketId/order/requestedAt 在等待期间固定。 */
export const admissionTicketSchema=admissionRequestSchema.extend({ticketId:id,order:revision,requestedAt:z.string().datetime(),reason:admissionWaitReasonSchema}).strict();
export type AdmissionTicket=z.infer<typeof admissionTicketSchema>;
export const admissionOccupantSchema=admissionRequestSchema.extend({acquiredAt:z.string().datetime()}).strict();
export type AdmissionOccupant=z.infer<typeof admissionOccupantSchema>;
export const admissionPolicySchema=z.object({revision,maxConcurrentRuns:z.number().int().min(1).max(32)}).strict();
export type AdmissionPolicy=z.infer<typeof admissionPolicySchema>;
/** revision 是期望当前策略版本；configure 成功后版本递增，不是客户端指定的新版本。 */
export const admissionConfigureSchema=admissionPolicySchema;
export const admissionCursorSchema=z.object({streamId:id,revision:z.number().int().nonnegative().safe()}).strict();
export type AdmissionCursor=z.infer<typeof admissionCursorSchema>;
export const admissionSnapshotSchema=z.object({cursor:admissionCursorSchema,policy:admissionPolicySchema,occupied:z.array(admissionOccupantSchema),waiting:z.array(admissionTicketSchema)}).strict();
export type AdmissionSnapshot=z.infer<typeof admissionSnapshotSchema>;
export type AdmissionRead={kind:'noop';cursor:AdmissionCursor}|{kind:'snapshot';snapshot:AdmissionSnapshot};
export const admissionReadSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('noop'),cursor:admissionCursorSchema}).strict(),z.object({kind:z.literal('snapshot'),snapshot:admissionSnapshotSchema}).strict()]);
