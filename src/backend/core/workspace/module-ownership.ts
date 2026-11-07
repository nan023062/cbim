/**
 * 作用定位：单模块负责人控制面的严格公开协议，供岗位、责任服务、持久化及桌面共用。
 * 设计原因：责任引用稳定 memberId，不写业务定义；观察仅说明内容，来源代次另由可选 sourceRef 明确采纳，不冒充派发身份。
 * 职责边界：纯 Schema 不读取知识、模型或存储；readOnly 表示此查询未写入，不是执行许可或业务验收。
 */
import {z} from 'zod';
import {knowledgeSourceRefSchema,sourceSelectionSchema,knowledgeSourceReadStateSchema,knowledgeSourceCursorSchema,sourceRefMatches,sourceSelectionMatches,sourceReadStateMatches} from './knowledge-source';
import {workspaceMemberIdentitySchema,workspaceRegistryCursorSchema,workspaceMemberSummarySchema} from '../team/workspace-member';

/** 包括已解除关系与全部历史；达到上限拒绝新写入，不裁剪审计。 */
export const moduleOwnershipLimits={bindings:1024,changes:4096,eventBytes:16*1024,historyBytes:16*1024*1024,page:100,history:20,toolItems:20} as const;
const id=z.string().min(1).max(1024).refine(value=>!!value.trim(),'标识不能为空白');
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),time=z.string().datetime();
const positive=z.number().int().positive().safe(),count=z.number().int().nonnegative().safe();
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;

export const moduleOwnershipIdentitySchema=workspaceMemberIdentitySchema;
export type ModuleOwnershipIdentity=z.infer<typeof moduleOwnershipIdentitySchema>;
export const moduleOwnershipCursorSchema=z.object({kind:z.literal('module_ownership'),workspaceId:z.string().min(1).max(512),streamId:uuid,seq:positive.max(moduleOwnershipLimits.changes)}).strict();
export type ModuleOwnershipCursor=z.infer<typeof moduleOwnershipCursorSchema>;
/** 仅保存真实定义观察；同路径同字节也不构成删除重建连续性证明。 */
export const observedModuleSchema=z.object({knowledgeRevision:id,definitionHash:hash,observedAt:time}).strict();
export type ObservedModule=z.infer<typeof observedModuleSchema>;
export const moduleOwnershipSchema=z.object({workspaceId:z.string().min(1).max(512),bindingId:uuid,moduleId:id,revision:positive.max(moduleOwnershipLimits.changes),ownerMemberId:uuid.nullable(),observedModule:observedModuleSchema,sourceRef:knowledgeSourceRefSchema.optional(),createdAt:time,updatedAt:time,lastChangeId:uuid}).strict().refine(value=>(!value.sourceRef||sourceRefMatches(value.sourceRef,value.workspaceId,{kind:'module',sourceId:value.moduleId}))&&Date.parse(value.createdAt)<=Date.parse(value.updatedAt)&&Date.parse(value.observedModule.observedAt)<=Date.parse(value.updatedAt),'责任观察或更新时间无效');
export type ModuleOwnership=z.infer<typeof moduleOwnershipSchema>;
export const moduleOwnershipExpectedSchema=z.object({bindingId:uuid,revision:positive,ownerMemberId:uuid.nullable()}).strict().nullable();
export type ModuleOwnershipExpected=z.infer<typeof moduleOwnershipExpectedSchema>;
export const moduleOwnershipChangeInputSchema=z.object({kind:z.literal('adopt_source').optional(),moduleId:id,expectedBinding:moduleOwnershipExpectedSchema,nextOwner:z.object({memberId:uuid,expectedRevision:positive}).strict().nullable().optional(),reason:z.string().min(1).max(2000).refine(value=>!!value.trim(),'理由不能为空白')}).strict().refine(value=>value.kind==='adopt_source'?!!value.expectedBinding?.ownerMemberId&&!Object.hasOwn(value,'nextOwner'):value.nextOwner!==undefined&&(value.expectedBinding?value.expectedBinding.ownerMemberId!==(value.nextOwner?.memberId??null):value.nextOwner!==null),'负责人变更或同负责人来源采纳不一致');
export type ModuleOwnershipChangeInput=z.infer<typeof moduleOwnershipChangeInputSchema>;
/** 仅明确来源采纳允许保持原负责人；不作为派发或权限变更。 */
export function isModuleOwnershipSourceAdoption(change:ModuleOwnershipChangeInput):change is ModuleOwnershipChangeInput&{kind:'adopt_source'}{return change.kind==='adopt_source'}
export const moduleOwnershipMainActorSchema=z.object({kind:z.literal('main_agent'),rootSessionId:id,scopeId:id,agentInstanceId:id,agentSessionId:id,runId:id,toolCallId:id,toolName:z.literal('cbim_module_owner_change_commit')}).strict();
export type ModuleOwnershipMainActor=z.infer<typeof moduleOwnershipMainActorSchema>;
export const moduleOwnershipActorSchema=z.union([z.object({kind:z.literal('local_desktop'),interaction:z.literal('explicit_submit')}).strict(),moduleOwnershipMainActorSchema]);
export type ModuleOwnershipActor=z.infer<typeof moduleOwnershipActorSchema>;
export const moduleOwnershipPreviewInputSchema=moduleOwnershipIdentitySchema.extend({change:moduleOwnershipChangeInputSchema}).strict();
export type ModuleOwnershipPreviewInput=z.infer<typeof moduleOwnershipPreviewInputSchema>;
export const moduleOwnershipCommitInputSchema=moduleOwnershipPreviewInputSchema.extend({commandId:uuid,expectedOwnershipCursor:moduleOwnershipCursorSchema.nullable(),expectedBasis:hash}).strict().refine(value=>!value.expectedOwnershipCursor||value.expectedOwnershipCursor.workspaceId===value.workspaceId,'责任游标不属于此工作区');
export type ModuleOwnershipCommitInput=z.infer<typeof moduleOwnershipCommitInputSchema>;
export const moduleOwnershipLookupSchema=z.object({workspaceId:z.string().min(1).max(512),commandId:uuid}).strict();
export type ModuleOwnershipLookup=z.infer<typeof moduleOwnershipLookupSchema>;

/** 影响只统计任务图明确绑定此模块的事实，不把旧 assignee 映射为项目岗位。 */
export const moduleOwnershipImpactSchema=z.object({coverage:z.literal('dispatch_graph_tasks_with_module'),total:count,counts:z.object({unclaimed:count,inFlight:count,checkpointed:count,terminal:count,other:count}).strict(),digest:hash}).strict().refine(value=>Object.values(value.counts).reduce((sum,n)=>sum+n,0)===value.total,'影响分类必须覆盖完整关联任务集合');
export type ModuleOwnershipImpact=z.infer<typeof moduleOwnershipImpactSchema>;
export const moduleOwnershipPreviewSchema=z.object({identity:moduleOwnershipIdentitySchema,readOnly:z.literal(true),change:moduleOwnershipChangeInputSchema,ownershipCursor:moduleOwnershipCursorSchema.nullable(),basis:hash,checkedAt:time,previous:moduleOwnershipSchema.nullable(),previousOwner:workspaceMemberSummarySchema.optional(),nextOwner:workspaceMemberSummarySchema.optional(),observedModule:observedModuleSchema.optional(),sourceSelection:sourceSelectionSchema.optional(),impact:moduleOwnershipImpactSchema,issues:z.array(z.object({code:z.string().min(1).max(128),message:z.string().min(1).max(2000)}).strict()).max(20)}).strict().superRefine((value,context)=>{
  const previous=value.previous,expected=value.change.expectedBinding;
  if(value.sourceSelection&&!sourceSelectionMatches(value.sourceSelection,value.identity.workspaceId,{kind:'module',sourceId:value.change.moduleId}))context.addIssue({code:'custom',message:'责任来源选择不属于模块'});
  if(value.ownershipCursor&&value.ownershipCursor.workspaceId!==value.identity.workspaceId||previous&&(previous.workspaceId!==value.identity.workspaceId||previous.moduleId!==value.change.moduleId)||!!previous!==!!expected||previous&&expected&&(previous.bindingId!==expected.bindingId||previous.revision!==expected.revision||previous.ownerMemberId!==expected.ownerMemberId))context.addIssue({code:'custom',message:'预览原关系或工作区不一致'});
  if(value.previousOwner&&value.previousOwner.memberId!==previous?.ownerMemberId)context.addIssue({code:'custom',message:'预览原负责人不一致'});
  if(isModuleOwnershipSourceAdoption(value.change)?!value.nextOwner||value.nextOwner.memberId!==previous?.ownerMemberId||value.nextOwner.revision!==value.previousOwner?.revision||value.nextOwner.state!=='active'||!value.observedModule||!value.sourceSelection:value.change.nextOwner?(!value.nextOwner||value.nextOwner.memberId!==value.change.nextOwner.memberId||value.nextOwner.revision!==value.change.nextOwner.expectedRevision||value.nextOwner.state!=='active'||!value.observedModule):value.nextOwner!==undefined||value.observedModule!==undefined||value.sourceSelection!==undefined)context.addIssue({code:'custom',message:'新负责人或模块观察与预览选择不一致'});
});
export type ModuleOwnershipPreview=z.infer<typeof moduleOwnershipPreviewSchema>;

/** 原命令回执固定结果与来源；后续改名、换人不改写此事实。 */
export const moduleOwnershipReceiptSchema=z.object({identity:moduleOwnershipIdentitySchema,commandId:uuid,action:z.enum(['assign','replace','unassign','adopt_source']),actor:moduleOwnershipActorSchema,changeId:uuid,moduleId:id,bindingId:uuid,previousRevision:count,revision:positive,previousOwnerMemberId:uuid.nullable(),ownerMemberId:uuid.nullable(),ownershipCursor:moduleOwnershipCursorSchema,basis:hash,bindingHash:hash,committedAt:time}).strict().superRefine((value,context)=>{
  const action=value.ownerMemberId!==null&&value.previousOwnerMemberId===value.ownerMemberId?'adopt_source':value.ownerMemberId===null?'unassign':value.previousOwnerMemberId===null?'assign':'replace';
  if(value.revision!==value.previousRevision+1||value.revision>value.ownershipCursor.seq||value.ownershipCursor.workspaceId!==value.identity.workspaceId||value.previousOwnerMemberId===value.ownerMemberId&&action!=='adopt_source'||value.action!==action||value.previousRevision===0&&value.previousOwnerMemberId!==null)context.addIssue({code:'custom',message:'责任回执版本、身份或操作不一致'});
});
export type ModuleOwnershipReceipt=z.infer<typeof moduleOwnershipReceiptSchema>;
export const moduleOwnershipChangeSchema=z.object({version:z.literal(1),request:moduleOwnershipCommitInputSchema,actor:moduleOwnershipActorSchema,changeId:uuid,ownershipCursor:moduleOwnershipCursorSchema,previousRevision:count,previousBindingHash:hash.nullable(),sourceSelection:sourceSelectionSchema.optional(),next:moduleOwnershipSchema,impact:moduleOwnershipImpactSchema,committedAt:time}).strict().superRefine((value,context)=>{
  const expected=value.request.change.expectedBinding;
  if(value.next.workspaceId!==value.request.workspaceId||value.ownershipCursor.workspaceId!==value.request.workspaceId||value.next.moduleId!==value.request.change.moduleId||value.next.ownerMemberId!==(isModuleOwnershipSourceAdoption(value.request.change)?expected?.ownerMemberId:value.request.change.nextOwner?.memberId??null)||value.next.revision!==value.previousRevision+1||value.next.revision>value.ownershipCursor.seq||value.next.updatedAt!==value.committedAt||value.next.lastChangeId!==value.changeId||(expected?value.previousRevision!==expected.revision||value.next.bindingId!==expected.bindingId||value.previousBindingHash===null:value.previousRevision!==0||value.previousBindingHash!==null)||bytes(value)>moduleOwnershipLimits.eventBytes)context.addIssue({code:'custom',message:'责任审计身份、版本或容量无效'});
});
export type ModuleOwnershipChange=z.infer<typeof moduleOwnershipChangeSchema>;

export const moduleOwnershipReadBasisSchema=z.object({ownershipCursor:moduleOwnershipCursorSchema.nullable(),memberRegistryCursor:workspaceRegistryCursorSchema.nullable(),knowledgeRevision:id.nullable(),sourceCursor:knowledgeSourceCursorSchema.nullable().optional()}).strict();
export type ModuleOwnershipReadBasis=z.infer<typeof moduleOwnershipReadBasisSchema>;
export const moduleSourceObservationSchema=z.union([
  z.object({status:z.enum(['observed','same','changed']),knowledgeRevision:id,definitionHash:hash}).strict(),
  z.object({status:z.enum(['missing','invalid','unavailable']),issue:z.string().min(1).max(2000)}).strict(),
]);
export type ModuleSourceObservation=z.infer<typeof moduleSourceObservationSchema>;
export const moduleOwnershipViewSchema=z.object({moduleId:id,module:z.object({name:z.string().max(512),summary:z.string().max(4000)}).strict().optional(),binding:moduleOwnershipSchema.nullable(),owner:workspaceMemberSummarySchema.optional(),status:z.enum(['unassigned','assigned','owner_suspended','owner_retired','owner_missing']),source:moduleSourceObservationSchema,sourceStatus:knowledgeSourceReadStateSchema.optional()}).strict().superRefine((value,context)=>{
  const ownerId=value.binding?.ownerMemberId,status=!ownerId?'unassigned':!value.owner?'owner_missing':value.owner.state==='active'?'assigned':value.owner.state==='suspended'?'owner_suspended':'owner_retired';
  if(value.sourceStatus&&(value.binding?!sourceReadStateMatches(value.sourceStatus,value.binding.workspaceId,{kind:'module',sourceId:value.moduleId},value.binding.sourceRef):['current','retired'].includes(value.sourceStatus.status)))context.addIssue({code:'custom',message:'来源状态不能脱离当前模块及已采纳引用'});
  if(value.binding&&value.binding.moduleId!==value.moduleId||value.owner&&value.owner.memberId!==ownerId||value.status!==status||!ownerId&&value.owner!==undefined)context.addIssue({code:'custom',message:'责任视图与实际关系、岗位状态不一致'});
  if('definitionHash' in value.source){const same=value.source.definitionHash===value.binding?.observedModule.definitionHash;if(value.binding?value.source.status!==(same?'same':'changed'):value.source.status!=='observed')context.addIssue({code:'custom',message:'当前模块观察不能伪造来源连续性'});}
});
export type ModuleOwnershipView=z.infer<typeof moduleOwnershipViewSchema>;
const pagination={offset:count.optional(),limit:positive.max(moduleOwnershipLimits.page).optional(),expectedReadBasis:moduleOwnershipReadBasisSchema.optional()};
const validPagination=(value:{workspaceId:string;offset?:number;expectedReadBasis?:ModuleOwnershipReadBasis})=>(!value.offset||value.expectedReadBasis!==undefined)&&(!value.expectedReadBasis||[value.expectedReadBasis.ownershipCursor,value.expectedReadBasis.memberRegistryCursor,value.expectedReadBasis.sourceCursor].every(cursor=>!cursor||cursor.workspaceId===value.workspaceId));
export const moduleOwnershipListInputSchema=moduleOwnershipIdentitySchema.extend(pagination).strict().refine(validPagination,'后续页须固定同工作区查询依据');
export type ModuleOwnershipListInput=z.infer<typeof moduleOwnershipListInputSchema>;
export const moduleOwnershipGetInputSchema=moduleOwnershipIdentitySchema.extend({moduleId:id}).strict();
export type ModuleOwnershipGetInput=z.infer<typeof moduleOwnershipGetInputSchema>;
export const moduleOwnershipByMemberInputSchema=moduleOwnershipIdentitySchema.extend({memberId:uuid,...pagination}).strict().refine(validPagination,'后续页须固定同工作区查询依据');
export type ModuleOwnershipByMemberInput=z.infer<typeof moduleOwnershipByMemberInputSchema>;
export const moduleOwnershipPageSchema=z.object({identity:moduleOwnershipIdentitySchema,readOnly:z.literal(true),checkedAt:time,basis:moduleOwnershipReadBasisSchema,offset:count,total:count,items:z.array(moduleOwnershipViewSchema).max(moduleOwnershipLimits.page),nextOffset:positive.optional()}).strict().superRefine((value,context)=>{
  const end=value.offset+value.items.length;
  if([value.basis.ownershipCursor,value.basis.memberRegistryCursor,value.basis.sourceCursor].some(cursor=>cursor&&cursor.workspaceId!==value.identity.workspaceId)||value.items.some(item=>item.binding&&item.binding.workspaceId!==value.identity.workspaceId||item.sourceStatus&&!sourceReadStateMatches(item.sourceStatus,value.identity.workspaceId,{kind:'module',sourceId:item.moduleId},item.binding?.sourceRef))||end>value.total||(end<value.total?value.items.length===0||value.nextOffset!==end:value.nextOffset!==undefined)||new Set(value.items.map(item=>item.moduleId)).size!==value.items.length)context.addIssue({code:'custom',message:'责任分页身份、范围或进度无效'});
});
export type ModuleOwnershipPage=z.infer<typeof moduleOwnershipPageSchema>;
/** 详情最多展示近二十条小摘要；完整不可变审计仍在 Store，不能把截断视作删除。 */
export const moduleOwnershipChangeSummarySchema=z.object({changeId:uuid,commandId:uuid,moduleId:id,bindingId:uuid,revision:positive,previousOwnerMemberId:uuid.nullable(),ownerMemberId:uuid.nullable(),actor:moduleOwnershipActorSchema,reason:z.string().min(1).max(2000),committedAt:time}).strict();
export type ModuleOwnershipChangeSummary=z.infer<typeof moduleOwnershipChangeSummarySchema>;
export const moduleOwnershipDetailSchema=z.object({identity:moduleOwnershipIdentitySchema,readOnly:z.literal(true),checkedAt:time,basis:moduleOwnershipReadBasisSchema,view:moduleOwnershipViewSchema,history:z.object({total:count,truncated:z.boolean(),items:z.array(moduleOwnershipChangeSummarySchema).max(moduleOwnershipLimits.history)}).strict()}).strict().superRefine((value,context)=>{
  const {view,history}=value,tail=history.items.at(-1);
  if([value.basis.ownershipCursor,value.basis.memberRegistryCursor,value.basis.sourceCursor].some(cursor=>cursor&&cursor.workspaceId!==value.identity.workspaceId)||view.binding&&view.binding.workspaceId!==value.identity.workspaceId||view.sourceStatus&&!sourceReadStateMatches(view.sourceStatus,value.identity.workspaceId,{kind:'module',sourceId:view.moduleId},view.binding?.sourceRef)||history.total<(history.items.length)||history.truncated!==(history.total>history.items.length)||history.total!== (view.binding?.revision??0)||history.items.length!==Math.min(history.total,moduleOwnershipLimits.history)||history.items.some((item,index)=>item.moduleId!==view.moduleId||item.bindingId!==view.binding?.bindingId||item.revision!==history.total-history.items.length+index+1)||view.binding&&(tail?.changeId!==view.binding.lastChangeId||tail?.ownerMemberId!==view.binding.ownerMemberId))context.addIssue({code:'custom',message:'责任详情历史与当前关系不一致'});
});
export type ModuleOwnershipDetail=z.infer<typeof moduleOwnershipDetailSchema>;

/** 只投影真实审计的小摘要，不按当前岗位名称改写历史负责人身份。 */
export function summarizeModuleOwnershipChange(event:ModuleOwnershipChange):ModuleOwnershipChangeSummary{
  return {changeId:event.changeId,commandId:event.request.commandId,moduleId:event.next.moduleId,bindingId:event.next.bindingId,revision:event.next.revision,previousOwnerMemberId:event.request.change.expectedBinding?.ownerMemberId??null,ownerMemberId:event.next.ownerMemberId,actor:structuredClone(event.actor),reason:event.request.change.reason,committedAt:event.committedAt};
}
