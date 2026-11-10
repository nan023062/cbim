/**
 * 作用定位：定义工作区长期岗位、采纳快照、版本化登记命令与公开查询协议，供 Main、Store 和桌面共用。
 * 设计原因：memberId 与执行实例分离；captureId 只记录采纳，来源连续性另经可选 sourceRef 明确绑定，旧缺省不补造。
 * 职责边界：纯 schema 不读知识或凭据、不派工；active 仅是岗位登记状态，不证明配置可执行或业务已验收。
 * 模型快照可包含 engine 并参与配置哈希；历史未声明引擎的快照保持原字节，不隐式迁移。
 */
import {z} from 'zod';
import {loopEngineSchema,engineApi,engineLabel} from '../brain/llm/engine';
import {capabilitySourceRefSchema,sourceSelectionSchema,knowledgeSourceReadStateSchema,sourceRefMatches,sourceSelectionMatches,sourceReadStateMatches} from '../workspace/knowledge-source';

/** 累计容量包括退休岗位和全部审计；超限拒绝新写入，不删除历史或截断采纳正文。 */
export const workspaceMemberLimits={members:256,changes:4096,capabilityBytes:1024*1024,eventBytes:2*1024*1024,historyBytes:32*1024*1024,skills:256,listPage:100} as const;
const id=z.string().min(1).max(512).refine(value=>!!value.trim(),'身份不能为空白');
const uuid=z.string().uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/),time=z.string().datetime();
const revision=z.number().int().positive().safe(),seq=z.number().int().positive().safe();
const text=(max:number)=>z.string().min(1).max(max).refine(value=>!!value.trim(),'文本不能为空白');
const byteLength=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
const endpoint=z.string().max(4096).url().refine(value=>{try{const url=new URL(value);return value.trim()===value&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))}catch{return false}},'模型地址不能包含凭据、查询或片段');

export const workspaceMemberIdentitySchema=z.object({workspaceId:id,instanceId:uuid}).strict();
export type WorkspaceMemberIdentity=z.infer<typeof workspaceMemberIdentitySchema>;
export const workspaceRegistryCursorSchema=z.object({kind:z.literal('workspace_registry'),workspaceId:id,streamId:uuid,seq:seq.max(workspaceMemberLimits.changes)}).strict();
export type WorkspaceRegistryCursor=z.infer<typeof workspaceRegistryCursorSchema>;
export const workspaceMemberStateSchema=z.enum(['active','suspended','retired']);
export type WorkspaceMemberState=z.infer<typeof workspaceMemberStateSchema>;
export const workspaceMemberAdaptationSchema=z.object({instructions:z.string().max(8000),references:z.array(id).max(32).refine(values=>new Set(values).size===values.length)}).strict();
export type WorkspaceMemberAdaptation=z.infer<typeof workspaceMemberAdaptationSchema>;
export const workspaceMemberModelRefSchema=z.object({profileId:uuid,modelId:text(160)}).strict();
export type WorkspaceMemberModelRef=z.infer<typeof workspaceMemberModelRefSchema>;
/** 字段对应实际解析后的公开 profile；仅依赖公开引擎标识，不接受密钥、hasKey、默认选择或 enabled 伪运行事实。 */
export const workspaceMemberModelSnapshotSchema=z.object({engine:loopEngineSchema.optional(),id:uuid,name:text(80),api:z.enum(['openai-completions','openai-responses','anthropic-messages']),baseUrl:endpoint,auth:z.enum(['api-key','none']),model:text(160),contextWindow:z.number().int().min(1024).max(2000000),maxTokens:z.number().int().min(64).max(2000000),reasoning:z.boolean(),vision:z.boolean().optional(),outputLimit:z.number().int().min(1).max(2000000).optional(),thinkingLevel:z.enum(['off','minimal','low','medium','high','xhigh']).optional(),workingContextWindow:z.number().int().min(1024).max(2000000).optional(),compactionPercent:z.number().int().min(10).max(95).optional(),pricing:z.object({input:z.number().finite().min(0),output:z.number().finite().min(0),cacheRead:z.number().finite().min(0),cacheWrite:z.number().finite().min(0)}).strict().optional()}).strict().superRefine((value,context)=>{
  const api=engineApi(value.engine??'pi');if(api&&value.api!==api)context.addIssue({code:'custom',message:engineLabel(value.engine!)+' 需要 '+api+' 接口'});
  if(value.maxTokens>value.contextWindow||value.outputLimit!==undefined&&value.maxTokens>value.outputLimit||value.workingContextWindow!==undefined&&value.workingContextWindow>value.contextWindow)context.addIssue({code:'custom',message:'模型预算超过公开能力上限'});
});
export type WorkspaceMemberModelSnapshot=z.infer<typeof workspaceMemberModelSnapshotSchema>;
export const workspaceMemberRuntimePolicySchema=workspaceMemberModelRefSchema.extend({configurationHash:digest,snapshot:workspaceMemberModelSnapshotSchema}).strict().refine(value=>value.profileId===value.snapshot.id&&value.modelId===value.snapshot.model,'模型引用与快照不一致');
export type WorkspaceMemberRuntimePolicy=z.infer<typeof workspaceMemberRuntimePolicySchema>;
/** 保存真实原则与有效继承 Skill；整库知识 revision 是采集出处，不是能力内容的独立代次。 */
export const workspaceMemberCapabilitySchema=z.object({workspaceId:id,teamId:id,agentId:id,name:text(512),knowledgeRevision:id,source:z.enum(['builtin','workspace']),principles:z.string(),effectiveSkills:z.array(z.object({skillId:id,ownerId:id,inherited:z.boolean(),content:z.string()}).strict()).max(workspaceMemberLimits.skills)}).strict().superRefine((value,context)=>{
  if(value.agentId==='cbim:main'||value.source==='builtin'&&value.agentId!=='cbim:executor'||value.source==='workspace'&&!value.agentId.startsWith('.cbim/team/')||new Set(value.effectiveSkills.map(item=>item.skillId)).size!==value.effectiveSkills.length||byteLength(value)>workspaceMemberLimits.capabilityBytes)context.addIssue({code:'custom',message:'岗位能力身份、有效 Skill 或容量无效'});
});
export type WorkspaceMemberCapability=z.infer<typeof workspaceMemberCapabilitySchema>;
export const workspaceMemberAdoptionSchema=z.object({captureId:uuid,capturedAt:time,knowledgeRevision:id,capabilityHash:digest,configuration:workspaceMemberCapabilitySchema,sourceRef:capabilitySourceRefSchema.optional()}).strict().refine(value=>value.knowledgeRevision===value.configuration.knowledgeRevision&&(!value.sourceRef||sourceRefMatches(value.sourceRef,value.configuration.workspaceId,value.configuration.source==='builtin'?'cbim:executor':{kind:'agent',sourceId:value.configuration.agentId})),'采纳知识版本或来源身份不一致');
export type WorkspaceMemberAdoption=z.infer<typeof workspaceMemberAdoptionSchema>;
export const workspaceMemberSchema=z.object({workspaceId:id,memberId:uuid,revision:revision.max(workspaceMemberLimits.changes),name:text(100),position:text(500),adaptation:workspaceMemberAdaptationSchema,state:workspaceMemberStateSchema,adoption:workspaceMemberAdoptionSchema,runtimePolicy:workspaceMemberRuntimePolicySchema,createdAt:time,updatedAt:time}).strict().superRefine((value,context)=>{
  if(value.workspaceId!==value.adoption.configuration.workspaceId||Date.parse(value.updatedAt)<Date.parse(value.createdAt)||Date.parse(value.adoption.capturedAt)>Date.parse(value.updatedAt))context.addIssue({code:'custom',message:'岗位身份或时间不一致'});
});
export type WorkspaceMember=z.infer<typeof workspaceMemberSchema>;
const reason=text(2000);
const patch=z.object({name:text(100).optional(),position:text(500).optional(),adaptation:workspaceMemberAdaptationSchema.optional(),runtimePolicy:workspaceMemberModelRefSchema.optional()}).strict().refine(value=>Object.values(value).some(item=>item!==undefined),'编辑至少包含一个字段');
export const workspaceMemberChangeInputSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('register'),agentId:id,name:text(100),position:text(500),adaptation:workspaceMemberAdaptationSchema,runtimePolicy:workspaceMemberModelRefSchema,reason}).strict(),
  z.object({kind:z.literal('update'),memberId:uuid,expectedRevision:revision,patch,reason}).strict(),
  z.object({kind:z.literal('adopt'),memberId:uuid,expectedRevision:revision,target:z.enum(['capability','model']),reason}).strict(),
  z.object({kind:z.literal('state'),memberId:uuid,expectedRevision:revision,nextState:workspaceMemberStateSchema,reason}).strict(),
]);
export type WorkspaceMemberChangeInput=z.infer<typeof workspaceMemberChangeInputSchema>;
export const workspaceMemberPreviewInputSchema=workspaceMemberIdentitySchema.extend({change:workspaceMemberChangeInputSchema}).strict();
export type WorkspaceMemberPreviewInput=z.infer<typeof workspaceMemberPreviewInputSchema>;
export const workspaceMemberCommitInputSchema=workspaceMemberPreviewInputSchema.extend({commandId:uuid,expectedRegistryCursor:workspaceRegistryCursorSchema.nullable(),expectedBasis:digest}).strict().refine(value=>value.expectedRegistryCursor===null||value.expectedRegistryCursor.workspaceId===value.workspaceId,'登记游标不属于此工作区');
export type WorkspaceMemberCommitInput=z.infer<typeof workspaceMemberCommitInputSchema>;
export const workspaceMemberLookupSchema=z.object({workspaceId:id,commandId:uuid}).strict();
export type WorkspaceMemberLookup=z.infer<typeof workspaceMemberLookupSchema>;
export const workspaceMemberProposedSchema=z.object({name:text(100),position:text(500),adaptation:workspaceMemberAdaptationSchema,state:workspaceMemberStateSchema,capability:z.object({configuration:workspaceMemberCapabilitySchema,capabilityHash:digest,sourceRef:capabilitySourceRefSchema.optional()}).strict(),runtimePolicy:workspaceMemberRuntimePolicySchema}).strict();
export type WorkspaceMemberProposed=z.infer<typeof workspaceMemberProposedSchema>;
export const workspaceMemberFieldSchema=z.enum(['name','position','adaptation','capability','runtimePolicy','state']);
export type WorkspaceMemberField=z.infer<typeof workspaceMemberFieldSchema>;
export const workspaceMemberPreviewSchema=z.object({identity:workspaceMemberIdentitySchema,change:workspaceMemberChangeInputSchema,registryCursor:workspaceRegistryCursorSchema.nullable(),basis:digest,checkedAt:time,previousRevision:z.number().int().nonnegative().safe(),previousMember:workspaceMemberSchema.optional(),sourceSelection:sourceSelectionSchema.optional(),proposed:workspaceMemberProposedSchema,changedFields:z.array(workspaceMemberFieldSchema).min(1).max(6).refine(items=>new Set(items).size===items.length)}).strict().superRefine((value,context)=>{
  const old=value.previousMember,configuration=value.proposed.capability.configuration;
  if(value.sourceSelection&&!sourceSelectionMatches(value.sourceSelection,value.identity.workspaceId,configuration.source==='builtin'?'cbim:executor':{kind:'agent',sourceId:configuration.agentId})||value.proposed.capability.sourceRef&&!sourceRefMatches(value.proposed.capability.sourceRef,value.identity.workspaceId,configuration.source==='builtin'?'cbim:executor':{kind:'agent',sourceId:configuration.agentId}))context.addIssue({code:'custom',message:'预览来源选择不属于岗位能力'});
  if(value.proposed.capability.configuration.workspaceId!==value.identity.workspaceId||value.registryCursor&&value.registryCursor.workspaceId!==value.identity.workspaceId||(value.change.kind==='register'?old!==undefined||value.previousRevision!==0:!old||old.memberId!==value.change.memberId||old.revision!==value.change.expectedRevision||old.revision!==value.previousRevision||old.workspaceId!==value.identity.workspaceId))context.addIssue({code:'custom',message:'预览岗位、版本或工作区不一致'});
});
export type WorkspaceMemberPreview=z.infer<typeof workspaceMemberPreviewSchema>;
/** 原命令回执只引用提交结果；不再复制能力正文，后续修改不改变此事实。 */
export const workspaceMemberReceiptSchema=z.object({identity:workspaceMemberIdentitySchema,commandId:uuid,action:z.enum(['register','update','adopt','state']),changeId:uuid,memberId:uuid,previousRevision:z.number().int().nonnegative().safe(),memberRevision:revision,registryCursor:workspaceRegistryCursorSchema,basis:digest,memberHash:digest,committedAt:time}).strict().refine(value=>value.memberRevision===value.previousRevision+1&&value.memberRevision<=value.registryCursor.seq&&value.registryCursor.workspaceId===value.identity.workspaceId&&(value.action==='register'?value.previousRevision===0:value.previousRevision>0),'登记回执版本或身份不一致');
export type WorkspaceMemberReceipt=z.infer<typeof workspaceMemberReceiptSchema>;
export const workspaceMemberChangeSchema=z.object({version:z.literal(1),request:workspaceMemberCommitInputSchema,changeId:uuid,registryCursor:workspaceRegistryCursorSchema,previousRevision:z.number().int().nonnegative().safe(),previousMemberHash:digest.nullable(),sourceSelection:sourceSelectionSchema.optional(),next:workspaceMemberSchema,actor:z.object({kind:z.literal('local_desktop'),interaction:z.literal('explicit_submit')}).strict(),committedAt:time}).strict().superRefine((value,context)=>{
  if(value.request.workspaceId!==value.next.workspaceId||value.registryCursor.workspaceId!==value.next.workspaceId||value.next.revision!==value.previousRevision+1||value.next.updatedAt!==value.committedAt||(value.request.change.kind==='register'?value.previousRevision!==0||value.previousMemberHash!==null:value.request.change.memberId!==value.next.memberId||value.request.change.expectedRevision!==value.previousRevision||value.previousMemberHash===null)||byteLength(value)>workspaceMemberLimits.eventBytes)context.addIssue({code:'custom',message:'登记审计身份、版本或容量不一致'});
});
export type WorkspaceMemberChange=z.infer<typeof workspaceMemberChangeSchema>;

export const workspaceMemberSummarySchema=z.object({memberId:uuid,revision,name:text(100),position:text(500),state:workspaceMemberStateSchema,agentId:id,teamId:id,profileId:uuid,modelId:text(160),createdAt:time,updatedAt:time}).strict();
export type WorkspaceMemberSummary=z.infer<typeof workspaceMemberSummarySchema>;
export const workspaceMemberListInputSchema=workspaceMemberIdentitySchema.extend({offset:z.number().int().nonnegative().safe().optional(),limit:z.number().int().min(1).max(workspaceMemberLimits.listPage).optional(),expectedRegistryCursor:workspaceRegistryCursorSchema.optional()}).strict().refine(value=>(!value.offset||value.expectedRegistryCursor!==undefined)&&(!value.expectedRegistryCursor||value.expectedRegistryCursor.workspaceId===value.workspaceId),'后续页须绑定同工作区登记游标');
export type WorkspaceMemberListInput=z.infer<typeof workspaceMemberListInputSchema>;
export const workspaceMemberListSchema=z.object({identity:workspaceMemberIdentitySchema,registryCursor:workspaceRegistryCursorSchema.nullable(),offset:z.number().int().nonnegative().safe(),total:z.number().int().min(0).max(workspaceMemberLimits.members),items:z.array(workspaceMemberSummarySchema).max(workspaceMemberLimits.listPage),nextOffset:z.number().int().positive().safe().optional()}).strict().superRefine((value,context)=>{
  const end=value.offset+value.items.length;
  if(value.registryCursor&&value.registryCursor.workspaceId!==value.identity.workspaceId||!value.registryCursor&&value.total!==0||value.offset>value.total||end>value.total||(end<value.total?value.items.length===0||value.nextOffset!==end:value.nextOffset!==undefined)||new Set(value.items.map(item=>item.memberId)).size!==value.items.length)context.addIssue({code:'custom',message:'岗位分页与登记游标不一致'});
});
export type WorkspaceMemberList=z.infer<typeof workspaceMemberListSchema>;
export const workspaceMemberGetInputSchema=workspaceMemberIdentitySchema.extend({memberId:uuid}).strict();
export type WorkspaceMemberGetInput=z.infer<typeof workspaceMemberGetInputSchema>;
const current=z.object({status:z.enum(['same','changed','missing','invalid']),adoptedHash:digest,currentHash:digest.optional(),issue:z.string().max(2000).optional()}).strict();
export const workspaceMemberCurrentDiffSchema=z.object({checkedAt:time,capability:current.extend({knowledgeRevision:id.optional()}).strict(),model:current}).strict().superRefine((value,context)=>{
  for(const item of [value.capability,value.model])if(item.status==='same'?item.currentHash!==item.adoptedHash:item.status==='changed'?!item.currentHash||item.currentHash===item.adoptedHash:item.currentHash!==undefined)context.addIssue({code:'custom',message:'当前差异与指纹不一致'});
});
export type WorkspaceMemberCurrentDiff=z.infer<typeof workspaceMemberCurrentDiffSchema>;
export const workspaceMemberDetailSchema=z.object({identity:workspaceMemberIdentitySchema,registryCursor:workspaceRegistryCursorSchema,member:workspaceMemberSchema,sourceStatus:knowledgeSourceReadStateSchema.optional(),currentDiff:workspaceMemberCurrentDiffSchema}).strict().refine(value=>(!value.sourceStatus||sourceReadStateMatches(value.sourceStatus,value.identity.workspaceId,value.member.adoption.configuration.source==='builtin'?'cbim:executor':{kind:'agent',sourceId:value.member.adoption.configuration.agentId},value.member.adoption.sourceRef))&&value.identity.workspaceId===value.member.workspaceId&&value.registryCursor.workspaceId===value.member.workspaceId&&value.currentDiff.capability.adoptedHash===value.member.adoption.capabilityHash&&value.currentDiff.model.adoptedHash===value.member.runtimePolicy.configurationHash,'岗位详情与采纳身份不一致');
export type WorkspaceMemberDetail=z.infer<typeof workspaceMemberDetailSchema>;

/** 列表只投影岗位摘要，不复制原则、Skill 或模型配置，也不把当前来源差异缓存到登记中。 */
export function summarizeWorkspaceMember(member:WorkspaceMember):WorkspaceMemberSummary{
  return {memberId:member.memberId,revision:member.revision,name:member.name,position:member.position,state:member.state,agentId:member.adoption.configuration.agentId,teamId:member.adoption.configuration.teamId,profileId:member.runtimePolicy.profileId,modelId:member.runtimePolicy.modelId,createdAt:member.createdAt,updatedAt:member.updatedAt};
}
