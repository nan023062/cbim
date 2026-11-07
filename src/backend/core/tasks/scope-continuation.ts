/**
 * 作用定位：定义安全等待检查点、用户显式补充原目标的请求和一次性启动意图。
 * 设计原因：补充保留原等待、原文、附件 ID 与可信快照清单，派发日志先消费启动权再运行；重复请求只能查询原回执，不能重放模型或把“同意”当作人工验收。
 */
import {z} from 'zod';
import {continuationAttachmentIdsSchema,continuationAttachmentManifestSchema,assertContinuationAttachmentManifest} from './scope-continuation-attachments';

const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const revision=z.number().int().min(1).max(65);
const unique=(values:string[])=>new Set(values).size===values.length;
/** 可信协调器冻结已观察主轮；跨等待累计，不因显式补充或重启重置。 */
export const dispatchScopeWaitSchema=z.object({waitId:id,reason:z.string().trim().min(1).max(16000),createdAt:z.string().datetime(),runId:id,goalRevision:revision,graphCursor:z.object({streamId:id,seq:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)}).strict(),knowledgeRevision:id,mainRunIds:z.array(id).min(1).max(32).refine(unique)}).strict().refine(value=>value.mainRunIds.includes(value.runId),'等待检查点必须包含当前主运行');
export type DispatchScopeWait=z.infer<typeof dispatchScopeWaitSchema>;
/** 同一事务会保存完整周期快照；限制补充总量，避免反复追加放大日志，超限拒绝而非截断原文。 */
export const scopeContinuationTextLimit=64_000;
export const scopeContinuationTotalTextLimit=256_000;
const input=z.object({message:z.string().max(scopeContinuationTextLimit).refine(value=>value.trim().length>0,'补充正文不能为空'),attachmentIds:continuationAttachmentIdsSchema.optional()}).strict();
export const scopeContinuationOptionsSchema=z.object({provider:id,model:id,profileId:z.string().uuid(),permission:z.enum(['read','ask','execute']),turnTimeoutMs:z.number().int().min(1000).max(3600000).optional()}).strict();
export type ScopeContinuationOptions=z.infer<typeof scopeContinuationOptionsSchema>;
/** 仅接收正文与本工作区附件 ID；不接收快照清单、路径、图片字节、权限批准或人工签署。 */
export const goalContinuationRequestSchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id,waitId:id,expectedGoalRevision:revision,expectedInputRevision:z.number().int().min(1).max(32),commandId:z.string().uuid(),input,options:scopeContinuationOptionsSchema}).strict();
export type GoalContinuationRequest=z.infer<typeof goalContinuationRequestSchema>;
/** 只读查找可用于判断重试结果；没有回执不代表可以换 commandId 重发。 */
export const scopeContinuationLookupSchema=goalContinuationRequestSchema.pick({workspaceId:true,rootSessionId:true,scopeId:true,commandId:true}).strict();
export type ScopeContinuationLookup=z.infer<typeof scopeContinuationLookupSchema>;
export const scopeContinuationSchema=z.object({continuationId:z.string().uuid(),acceptedAt:z.string().datetime(),wait:dispatchScopeWaitSchema,inputRevision:z.number().int().min(2).max(32),input,runId:id,options:scopeContinuationOptionsSchema,attachmentManifest:continuationAttachmentManifestSchema.optional()}).strict().superRefine((value,context)=>{try{assertContinuationAttachmentManifest(value.input,value.attachmentManifest)}catch{context.addIssue({code:'custom',message:'补充附件引用与可信快照清单不一致'})}});
export type ScopeContinuation=z.infer<typeof scopeContinuationSchema>;
/** 公开 receipt 仅证明意图已保存；scopeStatus 与当前事实一致，不包含可复用的启动许可。 */
export const goalContinuationReceiptSchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id,scopeStatus:z.enum(['active','waiting','closed']),continuation:scopeContinuationSchema}).strict();
export type GoalContinuationReceipt=z.infer<typeof goalContinuationReceiptSchema>;
