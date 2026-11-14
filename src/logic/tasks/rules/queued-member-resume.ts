/**
 * 作用定位：主调度为同一活动任务预约一次检查点续执行的纯协议。
 * 设计原因：预约与真正领取分离；模型不能传运行身份、权限、路径或新目标，等待容量不会提前消费检查点。
 */
import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),revision=z.number().int().positive().safe();
export const resumeMemberInputSchema=z.object({expectedGraphCursor:z.object({streamId:id,seq:z.number().int().nonnegative().safe()}).strict(),expectedGoalRevision:revision,taskId:id,expectedRevision:revision,checkpointId:id,reason:z.string().trim().min(1).max(4000)}).strict();
export type ResumeMemberInput=z.infer<typeof resumeMemberInputSchema>;
/** 公开预约审计永久冻结；原 runId 只指来源，不能被误当成新运行或已消费许可。 */
export const memberResumeRequestSchema=z.object({requestId:id,commandId:id,scopeId:id,mainRunId:id,checkpointId:id,runId:id,requestedAt:z.string().datetime(),reason:z.string().trim().min(1).max(4000),graphCursor:z.object({streamId:id,seq:z.number().int().nonnegative().safe()}).strict(),goalRevision:revision,previousTaskRevision:revision,trackedTaskIds:z.array(id).min(1).max(500).refine(ids=>new Set(ids).size===ids.length,'后继任务不能重复')}).strict();
export type MemberResumeRequest=z.infer<typeof memberResumeRequestSchema>;
/** requestId 是新待领取信封 ID；本回执不携带新 runId，也不宣称成员已恢复。 */
export type ResumeMemberReceipt={taskId:string;checkpointId:string;requestId:string;trackedTaskIds:string[];cursor:{workspaceId:string;rootSessionId:string;streamId:string;seq:number}};
