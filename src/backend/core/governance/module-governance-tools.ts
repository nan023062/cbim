/**
 * 作用定位：主 Agent 治理工具的严格输入、真实来源端口和有界业务输出；不承载桌面批准或正式知识实施。
 * 设计原因：桌面记录可含 2 MiB 正文，不能直接塞入模型上下文；正文超限只返回明确元数据，不把片段冒充完整替换。
 * 职责边界：身份由主运行闭包绑定，模型不能传 actor、commandId、路径或权限；投影不写存储、不生成回执事实。
 */
import {z} from 'zod';
import {fail} from '../foundation/errors';
import {hash as contentHash} from '../foundation/serialization';
import {validateModuleGovernanceRecordOrigin} from './module-governance-rules';
import {
  moduleGovernanceListSchema,moduleGovernanceReceiptSchema,moduleGovernanceOriginSchema,moduleGovernanceMainOriginSchema,
  moduleGovernanceDecisionIdsSchema,moduleGovernanceResponseRefsSchema,moduleGovernanceResponseRefSchema,moduleGovernanceFeedbackSchema,moduleGovernanceAssessmentsSchema,
  type ModuleGovernanceList,type ModuleGovernanceReceipt,
} from './module-governance';

export const governanceToolBodyLimit=16*1024;
export const governanceToolOutputLimit=128*1024;
export const governanceToolSummaryLimit=20;
/** 精确注册表同时供可信 wrapper 与权限分类使用；不能按 cbim_ 前缀推定权限。 */
export const governanceToolEffects={cbim_governance_get:'read',cbim_governance_receipt:'read',cbim_governance_observe:'maintenance',cbim_governance_propose:'preview'} as const;
export type GovernanceToolName=keyof typeof governanceToolEffects;
export function isGovernanceToolName(name:string):name is GovernanceToolName{return Object.prototype.hasOwnProperty.call(governanceToolEffects,name)}

const utf8=(text:string)=>new TextEncoder().encode(text).length;
const uuid=z.string().uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),positive=count.refine(value=>value>0);
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),timestamp=z.string().datetime();
const moduleId=z.string().max(1024).regex(/^\.cbim\/workspace\/(?:[a-z0-9_]+\/)*[a-z0-9_]+$/);
const path=z.string().max(2048).regex(/^\.cbim\/workspace\/(?:[a-z0-9_]+\/)+module\.md$/);
const note=z.string().max(1024).refine(value=>value.trim().length>0),shortNote=z.string().max(512).refine(value=>value.trim().length>0);
const body=z.string().max(governanceToolBodyLimit).refine(value=>utf8(value)<=governanceToolBodyLimit,'模型治理正文超过 16 KiB，请使用桌面完整处理');
export const governanceToolIdentitySchema=z.object({workspaceId:z.string().min(1).max(512),rootSessionId:id}).strict();

export const governanceGetInputSchema=z.object({moduleId,observationId:uuid.optional(),proposalId:uuid.optional()}).strict().refine(value=>!(value.observationId&&value.proposalId),'一次只读取一个明确记录');
export const governanceObserveInputSchema=z.object({protectionId:uuid,expectedProtectionRevision:positive,expectedKnowledgeRevision:digest,statement:note}).strict();
export const governanceProposeInputSchema=z.object({protectionId:uuid,observationId:uuid,expectedProtectionRevision:positive,expectedKnowledgeRevision:digest,newOverviewText:body,reason:note,alternatives:z.array(shortNote).min(1).max(8),invariants:z.array(shortNote).min(1).max(8),rollbackNotes:note,respondsToDecisionIds:moduleGovernanceDecisionIdsSchema.optional()}).strict();
/** 原调用查询不发写请求；缺省 runId 仅表示可信当前运行，不推断最新历史运行。 */
export const governanceReceiptInputSchema=z.union([
  z.object({commandId:uuid}).strict(),
  z.object({action:z.enum(['observe','propose']),toolCallId:z.string().min(1).max(512),runId:id.optional()}).strict(),
]);

const preview=z.object({text:z.string().max(512),totalCharacters:count,truncated:z.boolean()}).strict().superRefine((value,ctx)=>{
  const length=Array.from(value.text).length;
  if(value.totalCharacters<length||value.truncated!==(value.totalCharacters>length))ctx.addIssue({code:z.ZodIssueCode.custom,message:'摘要长度与截断声明不一致'});
});
/** complete 才携带全文；oversized 不携带 text，旧大正文或转义后过大的正文交回桌面。 */
export const governanceBodyViewSchema=z.discriminatedUnion('state',[
  z.object({state:z.literal('complete'),text:body,utf8Bytes:count,hash:digest}).strict(),
  z.object({state:z.literal('oversized'),utf8Bytes:count,hash:digest,limitBytes:z.literal(governanceToolBodyLimit),reason:z.enum(['body_limit','output_limit'])}).strict(),
]).superRefine((value,ctx)=>{
  if(value.state==='complete'&&value.utf8Bytes!==utf8(value.text))ctx.addIssue({code:z.ZodIssueCode.custom,message:'正文 UTF-8 字节数不一致'});
  if(value.state==='oversized'&&value.reason==='body_limit'&&value.utf8Bytes<=governanceToolBodyLimit)ctx.addIssue({code:z.ZodIssueCode.custom,message:'正文未超过声明上限'});
});
const file=z.object({path,hash:digest}).strict();
const observationSummary=z.object({observationId:uuid,protectionId:uuid,protectionRevision:positive,knowledgeRevision:digest,overview:file,statement:preview,observedAt:timestamp,origin:moduleGovernanceOriginSchema.optional()}).strict();
const proposalSummary=z.object({proposalId:uuid,protectionId:uuid,observationId:uuid,basis:digest,reason:preview,createdAt:timestamp,decisionRevision:count,origin:moduleGovernanceOriginSchema.optional()}).strict();
const list=<T extends z.ZodTypeAny>(item:T)=>z.object({total:count,truncated:z.boolean(),items:z.array(item).max(governanceToolSummaryLimit)}).strict().superRefine((value,ctx)=>{
  if(value.total<value.items.length||value.truncated!==(value.total>value.items.length))ctx.addIssue({code:z.ZodIssueCode.custom,message:'目录总数与截断声明不一致'});
});
const base=z.object({knowledgeRevision:digest,protectionRevision:positive,definitionHash:digest,overviewHash:digest}).strict();
const selectedObservation=observationSummary.extend({body:governanceBodyViewSchema,structural:z.boolean()}).strict();
const responseState=z.object({reference:moduleGovernanceResponseRefSchema,state:z.enum(['current','superseded']),latestDecisionId:uuid,latestDecisionRevision:positive,feedback:moduleGovernanceFeedbackSchema,comment:preview}).strict();
const selectedProposal=proposalSummary.extend({base,path,before:governanceBodyViewSchema,after:governanceBodyViewSchema,alternatives:list(preview),invariants:list(preview),rollbackNotes:preview,respondsTo:moduleGovernanceResponseRefsSchema.optional(),responseStates:z.array(responseState).max(8).optional(),decisions:list(z.object({decisionId:uuid,revision:positive,decision:z.enum(['approve','reject','defer']),comment:preview,recordedAt:timestamp,feedback:moduleGovernanceFeedbackSchema.optional(),assessments:moduleGovernanceAssessmentsSchema.optional()}).strict()),applications:list(z.object({intentId:uuid,decisionId:uuid,state:z.enum(['pending','not_applied','rolled_back','recovery_required','committed']),createdAt:timestamp}).strict())}).strict().superRefine((value,ctx)=>{
  const refs=value.respondsTo??[],states=value.responseStates??[];
  if(refs.length!==states.length||refs.some((ref,index)=>JSON.stringify(ref)!==JSON.stringify(states[index]?.reference)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'回应引用和当前状态必须完整对应'});
  for(const state of states){const current=state.latestDecisionId===state.reference.decisionId&&state.latestDecisionRevision===state.reference.decisionRevision;if((state.state==='current')!==current||state.latestDecisionRevision<state.reference.decisionRevision||!current&&(state.latestDecisionId===state.reference.decisionId||state.latestDecisionRevision===state.reference.decisionRevision))ctx.addIssue({code:z.ZodIssueCode.custom,message:'回应当前状态与最新来源不一致'});}
});
export const governanceGetOutputSchema=z.object({identity:governanceToolIdentitySchema,moduleId,knowledgeRevision:digest,protection:z.object({protectionId:uuid,revision:positive,definitionHash:digest,overview:file}).strict().optional(),observations:list(observationSummary),proposals:list(proposalSummary),selectedObservation:selectedObservation.optional(),selectedProposal:selectedProposal.optional(),issues:list(z.object({severity:z.enum(['error','warning']),code:preview,message:preview}).strict())}).strict().refine(value=>!(value.selectedObservation&&value.selectedProposal),'一次只返回一个明确记录');

const mainOrigin=moduleGovernanceMainOriginSchema;
const observedRecord=z.object({observationId:uuid,protectionId:uuid,protectionRevision:positive,knowledgeRevision:digest,overview:file,utf8Bytes:count,observedAt:timestamp,origin:mainOrigin}).strict();
const proposedRecord=z.object({proposalId:uuid,moduleId,protectionId:uuid,observationId:uuid,basis:digest,base,change:z.object({path,beforeHash:digest,afterHash:digest}).strict(),createdAt:timestamp,origin:mainOrigin,respondsTo:moduleGovernanceResponseRefsSchema.optional()}).strict();
export const governanceRecordedReceiptSchema=z.discriminatedUnion('action',[
  z.object({identity:governanceToolIdentitySchema,status:z.literal('recorded'),commandId:uuid,action:z.literal('observe'),record:observedRecord}).strict(),
  z.object({identity:governanceToolIdentitySchema,status:z.literal('recorded'),commandId:uuid,action:z.literal('propose'),record:proposedRecord}).strict(),
]).superRefine((value,ctx)=>{
  const recordId=value.action==='observe'?value.record.observationId:value.record.proposalId;
  if(recordId!==value.commandId||value.record.origin.rootSessionId!==value.identity.rootSessionId||value.record.origin.toolName!==`cbim_governance_${value.action}`)ctx.addIssue({code:z.ZodIssueCode.custom,message:'治理回执与可信来源不一致'});
});
export const governanceOversizedOutputSchema=z.object({identity:governanceToolIdentitySchema,status:z.literal('oversized'),commandId:uuid,action:z.enum(['observe','propose']),protectionId:uuid,body:governanceBodyViewSchema.refine(value=>value.state==='oversized'),recorded:z.literal(false)}).strict();
export const governanceWriteOutputSchema=z.union([governanceRecordedReceiptSchema,governanceOversizedOutputSchema]);
export const governanceReceiptOutputSchema=z.union([governanceRecordedReceiptSchema,z.object({identity:governanceToolIdentitySchema,status:z.literal('unknown'),commandId:uuid}).strict()]);

export type GovernanceToolIdentity=z.infer<typeof governanceToolIdentitySchema>;
export type GovernanceGetInput=z.infer<typeof governanceGetInputSchema>;
export type GovernanceObserveInput=z.infer<typeof governanceObserveInputSchema>;
export type GovernanceProposeInput=z.infer<typeof governanceProposeInputSchema>;
export type GovernanceReceiptInput=z.infer<typeof governanceReceiptInputSchema>;
export type GovernanceGetOutput=z.infer<typeof governanceGetOutputSchema>;
export type GovernanceRecordedReceipt=z.infer<typeof governanceRecordedReceiptSchema>;
export type GovernanceWriteOutput=z.infer<typeof governanceWriteOutputSchema>;
export type GovernanceReceiptOutput=z.infer<typeof governanceReceiptOutputSchema>;
export type GovernanceBodyView=z.infer<typeof governanceBodyViewSchema>;

/** Main 每个真实主运行单独创建；闭包持有 workspace/root/主实例/run，工具参数不得替换。 */
export interface GovernanceToolsPort {
  get(input:GovernanceGetInput,signal:AbortSignal):Promise<GovernanceGetOutput>;
  observe(input:GovernanceObserveInput,toolCallId:string,signal:AbortSignal):Promise<GovernanceWriteOutput>;
  propose(input:GovernanceProposeInput,toolCallId:string,signal:AbortSignal):Promise<GovernanceWriteOutput>;
  receipt(input:GovernanceReceiptInput,signal:AbortSignal):Promise<GovernanceReceiptOutput>;
}

function textPreview(text:string):z.infer<typeof preview>{const chars=Array.from(text),shown=chars.slice(0,256).join('');return {text:shown,totalCharacters:chars.length,truncated:chars.length>256}}
function recent<T>(items:readonly T[]){return {total:items.length,truncated:items.length>governanceToolSummaryLimit,items:items.slice(-governanceToolSummaryLimit)}}
/** 不做内容裁剪；JSON 转义也会占上下文，单正文编码超过 32 KiB 时同样只返回元数据。 */
export function projectGovernanceBody(text:string,hash:string):GovernanceBodyView{
  if(contentHash(text)!==hash)fail('GOVERNANCE_OUTPUT','治理原正文与内容指纹不一致');
  const bytes=utf8(text);return bytes<=governanceToolBodyLimit&&utf8(JSON.stringify(text))<=2*governanceToolBodyLimit?{state:'complete',text,utf8Bytes:bytes,hash}:{state:'oversized',utf8Bytes:bytes,hash,limitBytes:governanceToolBodyLimit,reason:bytes>governanceToolBodyLimit?'body_limit':'output_limit'};
}

/** 桌面领域事实投影为有界模型视图；不会选择“最新正文”代替显式记录，不暴露原实施请求。 */
export function projectGovernanceGet(raw:ModuleGovernanceList,rawIdentity:GovernanceToolIdentity):GovernanceGetOutput{
  const value=moduleGovernanceListSchema.parse(raw),identity=governanceToolIdentitySchema.parse(rawIdentity);
  if(value.identity.workspaceId!==identity.workspaceId)fail('GOVERNANCE_IDENTITY','治理读取不属于本轮工作区');
  const observation=(item:ModuleGovernanceList['observations'][number])=>({observationId:item.observationId,protectionId:item.protectionId,protectionRevision:item.protectionRevision,knowledgeRevision:item.knowledgeRevision,overview:item.overview,statement:textPreview(item.statement),observedAt:item.observedAt,...(item.origin?{origin:item.origin}:{})});
  const proposal=(item:ModuleGovernanceList['proposals'][number])=>({...item,reason:textPreview(item.reason)});
  const selected=value.selected,chosen=value.selectedObservation;
  const output:GovernanceGetOutput={identity,moduleId:value.moduleId,knowledgeRevision:value.knowledgeRevision,...(value.protection?{protection:{protectionId:value.protection.protectionId,revision:value.protection.revision,definitionHash:value.protection.definition.hash,overview:value.protection.overview}}:{}),observations:recent(value.observations.map(observation)),proposals:recent(value.proposals.map(proposal)),issues:recent(value.issues.map(issue=>({severity:issue.severity,code:textPreview(issue.code),message:textPreview(issue.message)})))};
  if(chosen)output.selectedObservation={...observation({...chosen,overview:{path:chosen.overview.path,hash:chosen.overview.hash}}),body:projectGovernanceBody(chosen.overview.text,chosen.overview.hash),structural:chosen.validation.structural};
  if(selected){const p=selected.proposal;output.selectedProposal={
    ...proposal({proposalId:p.proposalId,protectionId:p.protectionId,observationId:p.observationId,basis:p.basis,reason:p.reason,createdAt:p.createdAt,decisionRevision:selected.decisions.at(-1)?.revision??0,...(p.origin?{origin:p.origin}:{})}),
    base:p.base,path:p.change.path,before:projectGovernanceBody(p.change.beforeText,p.change.beforeHash),after:projectGovernanceBody(p.change.afterText,p.change.afterHash),
    alternatives:recent(p.alternatives.map(textPreview)),invariants:recent(p.invariants.map(textPreview)),rollbackNotes:textPreview(p.rollbackNotes),
    ...(p.respondsTo?{respondsTo:p.respondsTo}:{}),...(selected.responseStates?{responseStates:selected.responseStates.map(state=>({...state,comment:textPreview(state.comment)}))}:{}),
    decisions:recent(selected.decisions.map(d=>({decisionId:d.decisionId,revision:d.revision,decision:d.decision,comment:textPreview(d.comment),recordedAt:d.recordedAt,...(d.feedback?{feedback:d.feedback}:{}),...(d.assessments?{assessments:d.assessments}:{})}))),
    applications:recent(selected.applications.map(a=>({intentId:a.intentId,decisionId:a.decisionId,state:a.state,createdAt:a.createdAt}))),
  };}
  const result=governanceGetOutputSchema.parse(output);
  // 这里只量度已经由严格 Schema 复制的普通 DTO；真正发送的单次编码仍由工具包装层校验。
  // 超长合法路径/来源组合可能撑大目录，缩小有标识目录而不删选定正文的一部分。
  const groups=[result.observations,result.proposals,result.issues,...(result.selectedProposal?[result.selectedProposal.decisions,result.selectedProposal.applications,result.selectedProposal.alternatives,result.selectedProposal.invariants]:[])];
  while(utf8(JSON.stringify(result))>governanceToolOutputLimit){
    const group=groups.filter(item=>item.items.length).sort((a,b)=>b.items.length-a.items.length)[0];
    if(!group)fail('GOVERNANCE_OUTPUT','治理选定记录超过模型输出上限，请使用桌面完整处理');
    group.items.shift();group.truncated=group.total>group.items.length;
  }
  return result;
}

/** 只投影同主会话的已保存模型观察/提案；undefined 明确返回 unknown，不推定未受理。 */
export function projectGovernanceReceipt(raw:ModuleGovernanceReceipt|undefined,rawIdentity:GovernanceToolIdentity,commandId:string):GovernanceReceiptOutput{
  const identity=governanceToolIdentitySchema.parse(rawIdentity);
  if(!raw)return governanceReceiptOutputSchema.parse({identity,status:'unknown',commandId});
  const value=moduleGovernanceReceiptSchema.parse(raw);
  if(value.identity.workspaceId!==identity.workspaceId||value.commandId!==commandId||(value.action!=='observe'&&value.action!=='propose')||value.record.origin?.kind!=='main_agent'||value.record.origin.rootSessionId!==identity.rootSessionId)fail('GOVERNANCE_IDENTITY','治理回执不属于原主调用');
  validateModuleGovernanceRecordOrigin(value.record);
  const common={identity,status:'recorded' as const,commandId,action:value.action};
  if(value.action==='observe'){const r=value.record;return governanceRecordedReceiptSchema.parse({...common,record:{observationId:r.observationId,protectionId:r.protectionId,protectionRevision:r.protectionRevision,knowledgeRevision:r.knowledgeRevision,overview:{path:r.overview.path,hash:r.overview.hash},utf8Bytes:utf8(r.overview.text),observedAt:r.observedAt,origin:r.origin}});}
  const r=value.record;return governanceRecordedReceiptSchema.parse({...common,record:{proposalId:r.proposalId,moduleId:r.moduleId,protectionId:r.protectionId,observationId:r.observationId,basis:r.basis,base:r.base,change:{path:r.change.path,beforeHash:r.change.beforeHash,afterHash:r.change.afterHash},createdAt:r.createdAt,origin:r.origin,...(r.respondsTo?{respondsTo:r.respondsTo}:{})}});
}
