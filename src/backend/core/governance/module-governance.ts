/**
 * 作用定位：单个 Module 正式知识治理的严格输入、不可变提案、本机决定及实施回执协议。
 * 设计原因：批准与知识提交分开，模型或页面不能通过普通 ChangeRequest 声明授权；公开历史与私有实施意图共用身份而不依赖存储实现。
 * 职责边界：首片只更新已登记 overview，禁止变更定义、移动、删除或解除保护；本机点击不是认证负责人签署，也不证明业务迁移完成。
 */
import {z} from 'zod';

const id=z.string().min(1).max(512),uuid=z.string().uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive=count.refine(value=>value>0),timestamp=z.string().datetime();
const moduleId=z.string().max(1024).regex(/^\.cbim\/workspace\/(?:[a-z0-9_]+\/)*[a-z0-9_]+$/);
const filePath=z.string().max(2048).regex(/^\.cbim\/workspace\/(?:[a-z0-9_]+\/)+(?:module\.json|module\.md)$/);
const note=z.string().max(8000),nonempty=note.refine(value=>value.trim().length>0,'须提供非空说明');
/** 正文沿用知识事务 2 MiB UTF-8 上限；不按 UTF-16 长度把多字节内容误判为可写。 */
const body=z.string().max(2*1024*1024).refine(value=>new TextEncoder().encode(value).length<=2*1024*1024,'正文不得超过 2 MiB');
const identityShape={workspaceId:id,instanceId:uuid};
export const moduleGovernanceIdentitySchema=z.object(identityShape).strict();
export const moduleGovernanceActorSchema=z.object({kind:z.literal('local_desktop'),interaction:z.literal('explicit_submit')}).strict();
const runId=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),agentIdentity=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
/** 来源由桌面提交入口或真实主运行闭包写入；缺省表示旧记录未登记来源，不推定为本机人员。 */
export const moduleGovernanceMainOriginSchema=z.object({kind:z.literal('main_agent'),rootSessionId:runId,agentInstanceId:agentIdentity,agentSessionId:agentIdentity,runId,toolCallId:z.string().min(1).max(512),toolName:z.enum(['cbim_governance_observe','cbim_governance_propose'])}).strict();
export const moduleGovernanceOriginSchema=z.union([moduleGovernanceActorSchema,moduleGovernanceMainOriginSchema]);
const file=z.object({path:filePath,hash:digest}).strict();
export const moduleGovernanceIssueSchema=z.object({severity:z.enum(['error','warning']),code:id,message:z.string(),path:z.string().optional()}).strict();
const validation=z.object({structural:z.boolean(),issues:z.array(moduleGovernanceIssueSchema),architecture:z.literal('review-required'),business:z.literal('not-run')}).strict();

/** revision 表示此保护对象已生效正文基线的版本；初始登记与后续已提交 journal 派生它，普通 CRUD 不可改写。 */
export const moduleGovernanceProtectionSchema=z.object({protectionId:uuid,workspaceId:id,moduleId,revision:positive,definition:file,overview:file,registeredAt:timestamp,actor:moduleGovernanceActorSchema}).strict();
export const moduleGovernanceObservationSchema=z.object({observationId:uuid,workspaceId:id,protectionId:uuid,protectionRevision:positive,knowledgeRevision:digest,definitionHash:digest,overviewHash:digest,overview:z.object({path:filePath,text:body,hash:digest}).strict(),statement:nonempty,validation,observedAt:timestamp,origin:moduleGovernanceOriginSchema.optional()}).strict();
/** before/after 是唯一保存的差异正文；显示 diff 由它们派生，不另存可与事实分叉的补丁文本。 */
export const moduleGovernanceProposalSchema=z.object({
  proposalId:uuid,workspaceId:id,moduleId,protectionId:uuid,observationId:uuid,
  base:z.object({knowledgeRevision:digest,protectionRevision:positive,definitionHash:digest,overviewHash:digest}).strict(),
  change:z.object({path:filePath,beforeText:body,afterText:body,beforeHash:digest,afterHash:digest}).strict(),
  reason:nonempty,alternatives:z.array(nonempty).min(1).max(16),invariants:z.array(nonempty).min(1).max(32),rollbackNotes:nonempty,basis:digest,createdAt:timestamp,origin:moduleGovernanceOriginSchema.optional(),
}).strict();
export const moduleGovernanceDecisionSchema=z.object({decisionId:uuid,workspaceId:id,proposalId:uuid,revision:positive,basis:digest,decision:z.enum(['approve','reject','defer']),comment:note,revisitCondition:nonempty.optional(),actor:moduleGovernanceActorSchema,recordedAt:timestamp,supersedesDecisionId:uuid.optional()}).strict().superRefine((value,context)=>{
  if(value.decision!=='approve'&&!value.comment.trim())context.addIssue({code:z.ZodIssueCode.custom,path:['comment'],message:'驳回或暂缓须说明原因'});
  if(value.decision==='defer'&&!value.revisitCondition)context.addIssue({code:z.ZodIssueCode.custom,path:['revisitCondition'],message:'暂缓须记录复查条件'});
});

/** 与现有知识请求结构相同；纯叶子契约不反向导入 knowledge，避免持久端口形成文件循环。 */
export const moduleGovernanceChangeRequestSchema=z.object({...identityShape,revision:digest,requestId:uuid,changes:z.array(z.object({path:filePath,text:body}).strict()).length(1)}).strict();
/** 私有意图先于知识提交持久化。它只是原请求，不是已提交或允许任意改动的凭证。 */
export const moduleGovernanceApplyIntentSchema=z.object({intentId:uuid,workspaceId:id,proposalId:uuid,decisionId:uuid,protectionId:uuid,basis:digest,request:moduleGovernanceChangeRequestSchema,requestFingerprint:digest,createdAt:timestamp}).strict();
export const moduleGovernanceKnowledgeReceiptSchema=z.object({state:z.literal('committed'),...identityShape,requestId:uuid,revision:digest,changed:z.array(z.string())}).strict();
/** 仅 committed 可携带真实知识回执；not_applied 只由旧实例退役且原 journal 不存在派生，不能与回滚或当前未查到混淆。 */
const applicationShape={intentId:uuid,workspaceId:id,proposalId:uuid,decisionId:uuid,protectionId:uuid,basis:digest,requestId:uuid,requestFingerprint:digest,createdAt:timestamp};
export const moduleGovernanceApplicationSchema=z.union([
  z.object({...applicationShape,state:z.literal('committed'),result:moduleGovernanceKnowledgeReceiptSchema}).strict(),
  z.object({...applicationShape,state:z.enum(['pending','not_applied','rolled_back','recovery_required'])}).strict(),
]);

export const moduleGovernanceRegisterInputSchema=z.object({...identityShape,commandId:uuid,expectedKnowledgeRevision:digest,moduleId}).strict();
export const moduleGovernanceObserveInputSchema=z.object({...identityShape,commandId:uuid,protectionId:uuid,expectedProtectionRevision:positive,expectedKnowledgeRevision:digest,statement:nonempty}).strict();
export const moduleGovernanceProposeInputSchema=z.object({...identityShape,commandId:uuid,protectionId:uuid,observationId:uuid,expectedProtectionRevision:positive,expectedKnowledgeRevision:digest,newOverviewText:body,reason:nonempty,alternatives:z.array(nonempty).min(1).max(16),invariants:z.array(nonempty).min(1).max(32),rollbackNotes:nonempty}).strict();
export const moduleGovernanceDecideInputSchema=z.object({...identityShape,commandId:uuid,proposalId:uuid,expectedDecisionRevision:count,expectedBasis:digest,decision:z.enum(['approve','reject','defer']),comment:note,revisitCondition:nonempty.optional()}).strict().superRefine((value,context)=>{
  if(value.decision!=='approve'&&!value.comment.trim())context.addIssue({code:z.ZodIssueCode.custom,path:['comment'],message:'驳回或暂缓须说明原因'});
  if(value.decision==='defer'&&!value.revisitCondition)context.addIssue({code:z.ZodIssueCode.custom,path:['revisitCondition'],message:'暂缓须记录复查条件'});
});
export const moduleGovernanceApplyInputSchema=z.object({...identityShape,commandId:uuid,proposalId:uuid,decisionId:uuid,expectedBasis:digest}).strict();
export const moduleGovernanceLookupSchema=z.object({workspaceId:id,commandId:uuid}).strict();
const action=z.enum(['register','observe','propose','decide','apply']);
/** 仅退役实例经同一串行屏障核实无命令/意图/journal才可声明未受理；当前没有回执不构成证明。 */
export const moduleGovernanceUnacceptedInputSchema=z.object({...identityShape,commandId:uuid,action}).strict();
export const moduleGovernanceUnacceptedSchema=z.object({identity:moduleGovernanceIdentitySchema,commandId:uuid,action,unaccepted:z.boolean()}).strict();
export const moduleGovernanceListInputSchema=z.object({...identityShape,moduleId,proposalId:uuid.optional(),observationId:uuid.optional()}).strict();
const receiptShape={identity:moduleGovernanceIdentitySchema,commandId:uuid};
export const moduleGovernanceReceiptSchema=z.discriminatedUnion('action',[
  z.object({...receiptShape,action:z.literal('register'),record:moduleGovernanceProtectionSchema}).strict(),
  z.object({...receiptShape,action:z.literal('observe'),record:moduleGovernanceObservationSchema}).strict(),
  z.object({...receiptShape,action:z.literal('propose'),record:moduleGovernanceProposalSchema}).strict(),
  z.object({...receiptShape,action:z.literal('decide'),record:moduleGovernanceDecisionSchema}).strict(),
  z.object({...receiptShape,action:z.literal('apply'),record:moduleGovernanceApplicationSchema}).strict(),
]);
/** 目录不批量返回所有提案正文；明确 proposalId 后只展开该提案、决定和实施记录。 */
const observationSummary=moduleGovernanceObservationSchema.omit({overview:true,validation:true}).extend({overview:file}).strict();
export const moduleGovernanceListSchema=z.object({identity:moduleGovernanceIdentitySchema,moduleId,knowledgeRevision:digest,protection:moduleGovernanceProtectionSchema.optional(),observations:z.array(observationSummary),selectedObservation:moduleGovernanceObservationSchema.optional(),proposals:z.array(z.object({proposalId:uuid,protectionId:uuid,observationId:uuid,basis:digest,reason:nonempty,createdAt:timestamp,decisionRevision:count,origin:moduleGovernanceOriginSchema.optional()}).strict()),selected:z.object({proposal:moduleGovernanceProposalSchema,decisions:z.array(moduleGovernanceDecisionSchema),applications:z.array(moduleGovernanceApplicationSchema)}).strict().optional(),issues:z.array(moduleGovernanceIssueSchema)}).strict();

export type ModuleGovernanceIdentity=z.infer<typeof moduleGovernanceIdentitySchema>;
export type ModuleGovernanceActor=z.infer<typeof moduleGovernanceActorSchema>;
export type ModuleGovernanceOrigin=z.infer<typeof moduleGovernanceOriginSchema>;
export type ModuleGovernanceMainOrigin=z.infer<typeof moduleGovernanceMainOriginSchema>;
export type ModuleGovernanceProtection=z.infer<typeof moduleGovernanceProtectionSchema>;
export type ModuleGovernanceObservation=z.infer<typeof moduleGovernanceObservationSchema>;
export type ModuleGovernanceProposal=z.infer<typeof moduleGovernanceProposalSchema>;
export type ModuleGovernanceDecision=z.infer<typeof moduleGovernanceDecisionSchema>;
export type ModuleGovernanceChangeRequest=z.infer<typeof moduleGovernanceChangeRequestSchema>;
export type ModuleGovernanceApplyIntent=z.infer<typeof moduleGovernanceApplyIntentSchema>;
export type ModuleGovernanceKnowledgeReceipt=z.infer<typeof moduleGovernanceKnowledgeReceiptSchema>;
export type ModuleGovernanceApplication=z.infer<typeof moduleGovernanceApplicationSchema>;
export type ModuleGovernanceRegisterInput=z.infer<typeof moduleGovernanceRegisterInputSchema>;
export type ModuleGovernanceObserveInput=z.infer<typeof moduleGovernanceObserveInputSchema>;
export type ModuleGovernanceProposeInput=z.infer<typeof moduleGovernanceProposeInputSchema>;
export type ModuleGovernanceDecideInput=z.infer<typeof moduleGovernanceDecideInputSchema>;
export type ModuleGovernanceApplyInput=z.infer<typeof moduleGovernanceApplyInputSchema>;
export type ModuleGovernanceLookup=z.infer<typeof moduleGovernanceLookupSchema>;
export type ModuleGovernanceUnacceptedInput=z.infer<typeof moduleGovernanceUnacceptedInputSchema>;
export type ModuleGovernanceUnaccepted=z.infer<typeof moduleGovernanceUnacceptedSchema>;
export type ModuleGovernanceListInput=z.infer<typeof moduleGovernanceListInputSchema>;
export type ModuleGovernanceList=z.infer<typeof moduleGovernanceListSchema>;
export type ModuleGovernanceReceipt=z.infer<typeof moduleGovernanceReceiptSchema>;
