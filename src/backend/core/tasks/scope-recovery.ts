/**
 * 作用定位：定义用户显式新建只读核实周期的请求、冻结启动意图及公开回执。
 * 设计原因：异常周期保持封存，新主原生上下文与执行实例只通过一次性意图创建；用户观察是陈述，不改写旧回执，也不代表人工业务验收或可写重试许可。
 */
import {z} from 'zod';
import {graphIdentityInput} from './dispatch-commands';
import {scopeContinuationOptionsSchema} from './scope-continuation';
import {executionReportSchema} from './execution-report';
import {freshContextSchema} from './fresh-context';
import {effectMemberSubjectSchema,effectMainSubjectSchema} from './effect-observation';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const sourceScopeId=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const text=z.string().max(64_000).refine(value=>value.trim().length>0,'核实说明不能为空');
const digest=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive().safe();
const legacySource=z.object({scopeId:id,taskId:id,runId:id.optional(),reportBasis:digest}).strict();
const memberSource=effectMemberSubjectSchema.extend({reportBasis:digest}).strict(),mainSource=effectMainSubjectSchema.extend({reportBasis:digest}).strict();
/** 旧无 kind 字段的请求保持原结构；新请求的周期归属由服务派生。 */
export const recoveryRequestSourceSchema=z.union([legacySource,memberSource,mainSource]);
export type RecoveryRequestSource=z.infer<typeof recoveryRequestSourceSchema>;
export const recoverySourceSelectionSchema=z.union([legacySource.omit({reportBasis:true}),memberSource.omit({reportBasis:true}),mainSource.omit({reportBasis:true})]);
export type RecoverySourceSelection=z.infer<typeof recoverySourceSelectionSchema>;
const observation=z.object({text}).strict();
const input=z.object({message:text}).strict();
const options=scopeContinuationOptionsSchema.extend({permission:z.literal('read')}).strict();
/** 首版只接纯文本与只读核实，不接附件、任意原生路径、结果更正或人工批准。 */
export const recoveryRequestSchema=graphIdentityInput.extend({commandId:z.string().uuid(),source:recoveryRequestSourceSchema,operation:z.literal('inspect_effects'),observation,input,options,dispositionId:z.string().uuid().optional()}).strict();
export type RecoveryRequest=z.infer<typeof recoveryRequestSchema>;
/** 同一命令先查询持久回执；undefined 不代表可换 ID 自动重发。 */
export const recoveryLookupSchema=recoveryRequestSchema.pick({workspaceId:true,rootSessionId:true,commandId:true}).strict();
export type RecoveryLookup=z.infer<typeof recoveryLookupSchema>;
/** 旧运行集合在取得租约后由可信存储枚举，最多 4096 项；只隔离已登记旧链，不能忽略新链的未知日志。 */
export const recoveryContextSchema=freshContextSchema;
export type RecoveryContext=z.infer<typeof recoveryContextSchema>;
/** 新 scope 中不可变的核实来源与启动边界；不向已关闭来源周期追加字段。 */
const facts={scopeOutcome:z.enum(['completed','failed','cancelled','interrupted']),reportExecution:executionReportSchema.shape.execution,logState:executionReportSchema.shape.log.shape.state,unknownToolCount:z.number().int().nonnegative().safe()};
const logFacts={logPrefixHash:digest.optional(),throughSeq:z.number().int().nonnegative().safe().optional()};
const legacyRecordedSource=legacySource.extend({taskRevision:revision,planRevision:revision,...facts}).strict();
const memberRecordedSource=memberSource.extend({scopeId:sourceScopeId,taskRevision:revision,planRevision:revision,...facts,...logFacts}).strict();
const mainRecordedSource=mainSource.extend({scopeId:sourceScopeId,...facts,...logFacts,sourceGoalRevision:revision.optional(),sourceInputRevision:revision.optional(),sourcePlanRevision:revision.optional()}).strict();
export const recoveryRecordedSourceSchema=z.union([legacyRecordedSource,memberRecordedSource,mainRecordedSource]).superRefine((v,c)=>{
  if('kind' in v&&((v.logPrefixHash===undefined)!==(v.throughSeq===undefined)))c.addIssue({code:'custom',message:'新核实来源的日志指纹与序号须成对'});
  if('kind' in v&&v.kind==='main_run'&&((v.sourceGoalRevision===undefined)!==(v.sourceInputRevision===undefined)||v.sourcePlanRevision!==undefined&&v.sourceGoalRevision===undefined))c.addIssue({code:'custom',message:'主来源目标版本不完整'});
});
export const scopeRecoverySchema=z.object({recoveryId:z.string().uuid(),acceptedAt:z.string().datetime(),source:recoveryRecordedSourceSchema,operation:z.literal('inspect_effects'),observation,input,options,context:recoveryContextSchema,dispositionId:z.string().uuid().optional()}).strict();
export type ScopeRecovery=z.infer<typeof scopeRecoverySchema>;
/** 公开回执不返回整个旧运行排除集合；runId 只证明受理意图，不保证模型已启动。 */
export const recoveryReceiptSchema=graphIdentityInput.extend({scopeId:id,scopeStatus:z.enum(['active','waiting','closed']),recovery:scopeRecoverySchema.omit({context:true}).extend({runId:id}).strict()}).strict();
export type RecoveryReceipt=z.infer<typeof recoveryReceiptSchema>;

/** 只供分支判断，不给旧对象补 kind 或改写原命令。 */
export function isMainRecoverySource<T extends RecoveryRequestSource|ScopeRecovery['source']|RecoverySourceSelection>(value:T):value is Extract<T,{kind:'main_run'}>{return 'kind' in value&&value.kind==='main_run'}
/** 从持久事实提取原请求字段，legacy 次序与旧 Manager 的指纹提取保持一致。 */
export function recoveryRequestSource(value:ScopeRecovery['source']):RecoveryRequestSource{
  if(!('kind' in value))return {scopeId:value.scopeId,taskId:value.taskId,...(value.runId?{runId:value.runId}:{}),reportBasis:value.reportBasis};
  if(value.kind==='member_run')return {kind:value.kind,taskId:value.taskId,runId:value.runId,toolCallIds:[...value.toolCallIds],reportBasis:value.reportBasis};
  return {kind:value.kind,runId:value.runId,toolCallIds:[...value.toolCallIds],reportBasis:value.reportBasis};
}
/** 报告基线不参与草稿归属；旧数组 key 原样保留，新分支明确区分主/成员与调用顺序。 */
export function recoverySourceKey(value:RecoverySourceSelection|RecoveryRequestSource|ScopeRecovery['source']):string{
  return !('kind' in value)?JSON.stringify([value.scopeId,value.taskId,value.runId]):JSON.stringify([value.kind,value.kind==='member_run'?value.taskId:null,value.runId,value.toolCallIds]);
}
export function recoverySourceSelection(value:RecoveryRequestSource):RecoverySourceSelection{const {reportBasis:_,...selection}=value;return selection}
