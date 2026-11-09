/**
 * 作用定位：定义完成只读核实后显式创建业务新周期的预览、启动意图和公开回执。
 * 设计原因：业务重规划独立于只读 recovery，冻结用户新目标、权限与真实核实证据；旧未知事实不被更正，人工约束必须传递到新计划。
 */
import {z} from 'zod';
import {graphIdentityInput} from './dispatch-commands';
import {scopeContinuationOptionsSchema} from './scope-continuation';
import {freshContextSchema} from './fresh-context';
const id=z.string().min(1).max(512),digest=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive().safe();
const source=z.object({inspectionScopeId:id,expectedBasis:digest}).strict();
const input=z.object({message:z.string().max(64000).refine(value=>!!value.trim(),'业务目标不能为空')}).strict();
const options=scopeContinuationOptionsSchema.extend({permission:z.enum(['ask','execute'])}).strict();
const module=z.object({moduleId:id,name:z.string().min(1).max(16000)}).strict();
const human=z.object({id,text:z.string().min(1).max(16000),kind:z.literal('human'),sourceScopeId:id,sourceGoalRevision:revision}).strict();
const identity=graphIdentityInput.extend({inspectionScopeId:id}).strict();
/** 显式预览只读返回当前联合证据版本；eligible 不是启动授权，accept 必须重新核实。 */
export const replanPreviewInputSchema=identity;
export const replanPreviewSchema=z.object({identity,eligible:z.boolean(),basis:digest.optional(),graphCursor:z.object({streamId:id,seq:z.number().int().nonnegative().safe()}).strict().optional(),inspectionGoalRevision:revision.optional(),knowledgeRevision:id.optional(),requiredModules:z.array(module).max(50),inheritedHuman:z.array(human).max(50),issues:z.array(z.object({code:id,message:z.string().max(2000)}).strict()).max(50)}).strict();
export type ReplanPreviewInput=z.infer<typeof replanPreviewInputSchema>;
export type ReplanPreview=z.infer<typeof replanPreviewSchema>;
export const replanRequestSchema=graphIdentityInput.extend({commandId:z.string().uuid(),source,input,options,dispositionId:z.string().uuid().optional()}).strict();
export type ReplanRequest=z.infer<typeof replanRequestSchema>;
export const replanLookupSchema=replanRequestSchema.pick({workspaceId:true,rootSessionId:true,commandId:true}).strict();
export type ReplanLookup=z.infer<typeof replanLookupSchema>;
/** 只冻结证据摘要与版本，不复制旧工具参数、私有日志路径或生成一份新的工具回执。 */
const commonProof={inspectionGoalRevision:revision,inspectionPlanRevision:revision,reviewRunId:id,knowledgeRevision:id,sourceScopeId:id,sourceReportBasis:digest,evidenceDigest:digest,requiredModules:z.array(module).min(1).max(50),inheritedHuman:z.array(human).max(50)};
const sourceCalls=z.array(id).min(1).max(16).refine(v=>new Set(v).size===v.length);
const legacyProof=z.object({...commonProof,sourceTaskId:id,sourceRunId:id.optional()}).strict();
const memberProof=z.object({...commonProof,kind:z.literal('member_run'),sourceTaskId:id,sourceRunId:id,sourceToolCallIds:sourceCalls}).strict();
const mainProof=z.object({...commonProof,kind:z.literal('main_run'),sourceRunId:id,sourceToolCallIds:sourceCalls,sourceGoalRevision:revision,sourceInputRevision:revision,sourcePlanRevision:revision}).strict();
/** main proof 没有成员任务，旧无 kind proof 不默认升级或放宽必需字段。 */
export const inspectionProofSchema=z.union([legacyProof,memberProof,mainProof]);
export type InspectionProof=z.infer<typeof inspectionProofSchema>;
export const scopeReplanSchema=z.object({replanId:z.string().uuid(),acceptedAt:z.string().datetime(),source:source.extend({proof:inspectionProofSchema}).strict(),operation:z.literal('business_replan'),input,options,context:freshContextSchema,dispositionId:z.string().uuid().optional()}).strict();
export type ScopeReplan=z.infer<typeof scopeReplanSchema>;
/** runId 仅证明受理意图；上下文隔离清单只保留在后端，不随公开回执传输。 */
export const replanReceiptSchema=graphIdentityInput.extend({scopeId:id,scopeStatus:z.enum(['active','waiting','closed']),replan:scopeReplanSchema.omit({context:true}).extend({runId:id}).strict()}).strict();
export type ReplanReceipt=z.infer<typeof replanReceiptSchema>;
/** 只读分支视图不参与持久化或旧命令指纹。 */
export function inspectionProofSource(proof:InspectionProof){return 'kind' in proof&&proof.kind==='main_run'?{kind:'main_run' as const,scopeId:proof.sourceScopeId,runId:proof.sourceRunId,toolCallIds:proof.sourceToolCallIds}:{kind:'member_run' as const,scopeId:proof.sourceScopeId,taskId:proof.sourceTaskId,runId:proof.sourceRunId,...('kind' in proof?{toolCallIds:proof.sourceToolCallIds}:{})}}
