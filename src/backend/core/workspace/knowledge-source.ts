/**
 * 作用定位：受控知识来源代次、读取状态和原日志握手的纯协议，供岗位、责任、Store 与桌面共用。
 * 设计原因：内容指纹不能证明对象连续性；来源代次只从真实观察或受控知识事务建立，旧记录不补造历史。
 * 职责边界：不读取知识、不认证磁盘；pending 只记录写前屏障，公开 selection 不是客户端可提交的证明。
 */
import {z} from 'zod';

export const knowledgeSourceLimits={generations:4096,events:8192,affected:512,eventBytes:512*1024,historyBytes:16*1024*1024,terminalReserveBytes:16*1024} as const;
const id=z.string().min(1).max(1024).refine(value=>!!value.trim()),workspace=z.string().min(1).max(512),uuid=z.string().uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/),time=z.string().max(40).datetime(),seq=z.number().int().positive().safe();
export const knowledgeSourceKeySchema=z.object({kind:z.enum(['agent','module']),sourceId:id}).strict().refine(value=>value.sourceId.startsWith(value.kind==='agent'?'.cbim/team/':'.cbim/workspace/')&&!value.sourceId.split('/').some(part=>!part||part==='.'||part==='..')&&!value.sourceId.includes('\\'),'来源必须是对应领域的明确逻辑对象');
export type KnowledgeSourceKey=z.infer<typeof knowledgeSourceKeySchema>;
export const knowledgeSourceRefSchema=z.object({version:z.literal(1),workspaceId:workspace,source:knowledgeSourceKeySchema,generationId:uuid}).strict();
export type KnowledgeSourceRef=z.infer<typeof knowledgeSourceRefSchema>;
export const builtinCapabilitySourceRefSchema=z.object({kind:z.literal('builtin'),id:z.literal('cbim:executor'),contentHash:digest}).strict();
export type BuiltinCapabilitySourceRef=z.infer<typeof builtinCapabilitySourceRefSchema>;
export const capabilitySourceRefSchema=z.union([knowledgeSourceRefSchema,builtinCapabilitySourceRefSchema]);
export type CapabilitySourceRef=z.infer<typeof capabilitySourceRefSchema>;
export const knowledgeSourceObservationSchema=z.object({knowledgeRevision:id,definitionHash:digest,visible:z.literal(true)}).strict();
export type KnowledgeSourceObservation=z.infer<typeof knowledgeSourceObservationSchema>;
/** expectedRef=null 表示预览时尚未追踪；新 UUID 只在实际明确采纳提交时生成。 */
export const sourceSelectionSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('workspace'),workspaceId:workspace,source:knowledgeSourceKeySchema,expectedRef:knowledgeSourceRefSchema.nullable(),observation:knowledgeSourceObservationSchema}).strict(),
  z.object({kind:z.literal('builtin'),ref:builtinCapabilitySourceRefSchema}).strict(),
]).superRefine((value,ctx)=>{if(value.kind==='workspace'&&value.expectedRef&&(value.expectedRef.workspaceId!==value.workspaceId||!sameKnowledgeSourceKey(value.expectedRef.source,value.source)))ctx.addIssue({code:'custom',message:'来源选择与原引用不一致'})});
export type SourceSelection=z.infer<typeof sourceSelectionSchema>;
export const knowledgeSourceReadStateSchema=z.union([
  z.object({status:z.literal('untracked'),source:knowledgeSourceKeySchema,observation:knowledgeSourceObservationSchema}).strict(),
  z.object({status:z.literal('current'),ref:capabilitySourceRefSchema}).strict(),
  z.object({status:z.literal('needs_adoption'),currentRef:capabilitySourceRefSchema}).strict(),
  z.object({status:z.literal('retired'),ref:knowledgeSourceRefSchema,currentRef:knowledgeSourceRefSchema.optional()}).strict(),
  z.object({status:z.literal('pending'),transitionId:id}).strict(),
  z.object({status:z.enum(['missing','invalid','unverifiable']),issue:z.string().min(1).max(2000)}).strict(),
]);
export type KnowledgeSourceReadState=z.infer<typeof knowledgeSourceReadStateSchema>;
export const knowledgeSourceCursorSchema=z.object({kind:z.literal('knowledge_sources'),workspaceId:workspace,streamId:uuid,seq:seq.max(knowledgeSourceLimits.events)}).strict();
export type KnowledgeSourceCursor=z.infer<typeof knowledgeSourceCursorSchema>;
export const knowledgeSourceGenerationSchema=knowledgeSourceRefSchema.extend({origin:z.enum(['observed_existing','controlled_create','controlled_replace']),createdAt:time,createdChangeId:id,retired:z.object({changeId:id,at:time,reason:z.enum(['deleted','moved','replaced','hidden'])}).strict().optional()}).strict().refine(value=>!value.retired||Date.parse(value.retired.at)>=Date.parse(value.createdAt),'退役不能早于来源建立');
export type KnowledgeSourceGeneration=z.infer<typeof knowledgeSourceGenerationSchema>;
export const knowledgeSourceMutationPlanSchema=z.object({source:knowledgeSourceKeySchema,previous:knowledgeSourceRefSchema.nullable(),next:knowledgeSourceGenerationSchema.nullable(),reason:z.enum(['created','deleted','moved','replaced','hidden','visible_again'])}).strict().superRefine((value,ctx)=>{
  if(value.previous&&!sameKnowledgeSourceKey(value.previous.source,value.source)||value.next&&(!sameKnowledgeSourceKey(value.next.source,value.source)||value.next.retired||value.next.origin==='observed_existing')||value.previous&&value.next&&(value.previous.workspaceId!==value.next.workspaceId||value.previous.generationId===value.next.generationId))ctx.addIssue({code:'custom',message:'来源生命周期前后引用无效'});
  // 未追踪对象也可能被真实删除/隐藏；只记录计划事实，不为它补造旧 generation。
  if(['created','visible_again'].includes(value.reason)?!!value.previous||!value.next:['deleted','hidden','moved'].includes(value.reason)?!!value.next:!value.next)ctx.addIssue({code:'custom',message:'来源操作与前后对象不一致'});
});
export type KnowledgeSourceMutationPlan=z.infer<typeof knowledgeSourceMutationPlanSchema>;
const transitionBody={version:z.literal(1),transitionId:id,workspaceId:workspace,instanceId:uuid,requestId:id,requestFingerprint:digest,journalBindingHash:digest,expectedSourceCursor:knowledgeSourceCursorSchema.nullable(),changes:z.array(knowledgeSourceMutationPlanSchema).max(knowledgeSourceLimits.affected),preparedAt:time};
export const knowledgeSourceTransitionSchema=z.object({...transitionBody,state:z.enum(['pending','committed','rolled_back']),resolved:z.object({at:time,journalProofHash:digest,committedRevision:id.optional()}).strict().optional()}).strict().superRefine((value,ctx)=>{
  if(value.expectedSourceCursor&&value.expectedSourceCursor.workspaceId!==value.workspaceId||new Set(value.changes.map(item=>knowledgeSourceKey(item.source))).size!==value.changes.length||value.changes.some(item=>item.previous&&item.previous.workspaceId!==value.workspaceId||item.next&&(item.next.workspaceId!==value.workspaceId||item.next.createdChangeId!==value.transitionId||item.next.createdAt!==value.preparedAt))||(value.state==='pending'?value.resolved!==undefined:!value.resolved||Date.parse(value.resolved.at)<Date.parse(value.preparedAt)||(value.state==='committed')!==(value.resolved.committedRevision!==undefined)))ctx.addIssue({code:'custom',message:'来源握手身份、计划或结算无效'});
});
export type KnowledgeSourceTransition=z.infer<typeof knowledgeSourceTransitionSchema>;
const common={version:z.literal(1),changeId:uuid,workspaceId:workspace,sourceCursor:knowledgeSourceCursorSchema,recordedAt:time};
export const knowledgeSourceCaptureSchema=z.object({...common,kind:z.literal('capture'),generation:knowledgeSourceGenerationSchema,observation:knowledgeSourceObservationSchema,consumer:z.object({kind:z.enum(['workspace_member','module_ownership']),changeId:uuid}).strict()}).strict();
export type KnowledgeSourceCapture=z.infer<typeof knowledgeSourceCaptureSchema>;
export const knowledgeSourcePreparedSchema=z.object({...common,kind:z.literal('prepared'),transition:knowledgeSourceTransitionSchema}).strict();
export type KnowledgeSourcePrepared=z.infer<typeof knowledgeSourcePreparedSchema>;
export const knowledgeSourceResolvedSchema=z.object({...common,kind:z.literal('resolved'),transitionId:id,requestFingerprint:digest,journalBindingHash:digest,outcome:z.enum(['committed','rolled_back']),journalProofHash:digest,committedRevision:id.optional()}).strict();
export type KnowledgeSourceResolved=z.infer<typeof knowledgeSourceResolvedSchema>;
export const knowledgeSourceChangeSchema=z.union([knowledgeSourceCaptureSchema,knowledgeSourcePreparedSchema,knowledgeSourceResolvedSchema]).superRefine((value,ctx)=>{
  if(value.sourceCursor.workspaceId!==value.workspaceId||new TextEncoder().encode(JSON.stringify(value)).length>knowledgeSourceLimits.eventBytes)ctx.addIssue({code:'custom',message:'来源事件身份或容量无效'});
  if(value.kind==='capture'&&(value.generation.workspaceId!==value.workspaceId||value.generation.origin!=='observed_existing'||!!value.generation.retired||value.generation.createdChangeId!==value.changeId||value.generation.createdAt!==value.recordedAt))ctx.addIssue({code:'custom',message:'首次采集必须固定真实观察起点'});
  if(value.kind==='prepared'&&(value.transition.state!=='pending'||value.transition.workspaceId!==value.workspaceId||value.transition.preparedAt!==value.recordedAt))ctx.addIssue({code:'custom',message:'准备事件与原意图不一致'});
  if(value.kind==='resolved'&&((value.outcome==='committed')!==(value.committedRevision!==undefined)))ctx.addIssue({code:'custom',message:'结算结果缺少真实知识版本'});
});
export type KnowledgeSourceChange=z.infer<typeof knowledgeSourceChangeSchema>;
export const knowledgeSourceReceiptSchema=z.object({workspaceId:workspace,transitionId:id,state:z.enum(['pending','committed','rolled_back']),sourceCursor:knowledgeSourceCursorSchema,requestFingerprint:digest,journalBindingHash:digest}).strict();
export type KnowledgeSourceReceipt=z.infer<typeof knowledgeSourceReceiptSchema>;

/** 逻辑键不混淆模块与 Agent；仅用于已通过严格协议的值。 */
export function knowledgeSourceKey(value:KnowledgeSourceKey){return value.kind+':'+value.sourceId}
export function sameKnowledgeSourceKey(a:KnowledgeSourceKey,b:KnowledgeSourceKey){return a.kind===b.kind&&a.sourceId===b.sourceId}
export function sourceRefMatches(ref:CapabilitySourceRef,workspaceId:string,source:KnowledgeSourceKey|'cbim:executor'){
  return source==='cbim:executor'?'kind' in ref&&ref.kind==='builtin':!('kind' in ref)&&ref.workspaceId===workspaceId&&sameKnowledgeSourceKey(ref.source,source);
}
export function sourceSelectionMatches(selection:SourceSelection,workspaceId:string,source:KnowledgeSourceKey|'cbim:executor'){
  return source==='cbim:executor'?selection.kind==='builtin':selection.kind==='workspace'&&selection.workspaceId===workspaceId&&sameKnowledgeSourceKey(selection.source,source);
}
/** 公开状态必须属于所显示对象；current 只说明已采纳引用与当前头相同，不表示可执行。 */
export function sourceReadStateMatches(value:KnowledgeSourceReadState,workspaceId:string,source:KnowledgeSourceKey|'cbim:executor',adopted?:CapabilitySourceRef):boolean{
  const same=(a:CapabilitySourceRef|undefined,b:CapabilitySourceRef)=>!!a&&('kind' in a?'kind' in b&&a.contentHash===b.contentHash:!('kind' in b)&&a.workspaceId===b.workspaceId&&a.generationId===b.generationId&&sameKnowledgeSourceKey(a.source,b.source));
  if(adopted&&!sourceRefMatches(adopted,workspaceId,source))return false;
  if(value.status==='untracked')return !adopted&&source!=='cbim:executor'&&sameKnowledgeSourceKey(value.source,source);
  if(value.status==='current')return sourceRefMatches(value.ref,workspaceId,source)&&same(adopted,value.ref);
  if(value.status==='needs_adoption')return sourceRefMatches(value.currentRef,workspaceId,source)&&!same(adopted,value.currentRef);
  if(value.status==='retired')return sourceRefMatches(value.ref,workspaceId,source)&&same(adopted,value.ref)&&(!value.currentRef||sourceRefMatches(value.currentRef,workspaceId,source)&&!same(value.ref,value.currentRef));
  return true;
}
