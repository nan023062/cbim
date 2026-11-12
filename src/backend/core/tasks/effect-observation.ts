/**
 * 作用定位：定义原成员/主调用的影响观察、本机处置附录及后续周期关系的公开叶子契约。
 * 设计原因：当前文件、原知识事务、原私有记录、受控文件原阶段/补偿、原工具结果和新业务结果是不同事实；客户端只选择身份，可信服务采集依据，处置不能清除未知或授予恢复权限。领域摘要是可选扩展，旧处置不补字段。
 * 职责边界：不含原参数/正文、凭据或 native 路径；知识刷新只有可信原v2授权可适配，旧 recovery 协议不在这里默认化。
 */
import {z} from 'zod';
import {artifactFileCheckSchema,artifactRelativePathSchema} from '../evidence/artifact-baseline';
import {commandRecordSchema} from './command-verification';
import {toolScopeSchema} from '../tools/scope-schema';
import {toolReceiptEffectSchema} from '../tools/receipt-schema';
import {knowledgeTransactionObservationSchema} from '../knowledge/knowledge-write-observation';
import {persistentWriteObservationSchema,persistentWriteEffects} from './persistent-write-observation';
import {controlledFileLedgerSchema,controlledFileWriteToolName} from '../file-operations/controlled-file-operation';

const id=z.string().min(1).max(512).refine(v=>v.trim()===v&&!/[\x00-\x1f]/.test(v));
const digest=z.string().regex(/^[a-f0-9]{64}$/),seq=z.number().int().nonnegative().safe(),positive=seq.min(1),time=z.string().datetime();
const identity={workspaceId:id,rootSessionId:id};
export const effectObservationLimits={calls:16,files:16,fileBytes:8*1024*1024,totalBytes:32*1024*1024,baselines:8,limitations:32,recordsPerRoot:64,records:512,storedBytes:16*1024*1024,outputBytes:128*1024} as const;
const calls=z.array(id).min(1).max(effectObservationLimits.calls).refine(v=>new Set(v).size===v.length);
export const effectMemberSubjectSchema=z.object({kind:z.literal('member_run'),taskId:id,runId:id,toolCallIds:calls}).strict();
export const effectMainSubjectSchema=z.object({kind:z.literal('main_run'),runId:id,toolCallIds:calls}).strict();
/** 原顺序冻结；scope 和工具参数不接受客户端声明。 */
export const effectSubjectSchema=z.discriminatedUnion('kind',[effectMemberSubjectSchema,effectMainSubjectSchema]);
export type EffectSubject=z.infer<typeof effectSubjectSchema>;
export const effectObservationInputSchema=z.object({...identity,subject:effectSubjectSchema}).strict();
export type EffectObservationInput=z.infer<typeof effectObservationInputSchema>;
const outcome=z.enum(['succeeded','failed','denied','unknown','not_authorized']);
const logState=z.enum(['verified','missing','incomplete','invalid','identity_mismatch','unavailable']);
export const effectFileObservationSchema=z.object({relativePath:artifactRelativePathSchema,state:z.enum(['present','missing','unverifiable']),byteLength:seq.max(effectObservationLimits.fileBytes).optional(),sha256:digest.optional(),reason:z.string().max(512).optional()}).strict().superRefine((v,c)=>{
  if(v.state==='present'?(v.byteLength===undefined||v.sha256===undefined):(v.byteLength!==undefined||v.sha256!==undefined))c.addIssue({code:'custom',message:'只有真实存在的文件可提供当前字节指纹'});
});
export type EffectFileObservation=z.infer<typeof effectFileObservationSchema>;
export const effectCallObservationSchema=z.object({
  toolCallId:id,toolName:id.optional(),outcome,coverage:z.enum(['control_commit_only','selected_files_now','knowledge_transaction','persistent_record','controlled_file','unsupported']),
  inputHash:digest.optional(),proposedSeq:positive.optional(),allowedSeq:positive.optional(),finishedSeq:positive.optional(),
  scope:toolScopeSchema.optional(),effects:z.array(toolReceiptEffectSchema).max(8).optional(),
  file:effectFileObservationSchema.optional(),command:commandRecordSchema.optional(),knowledge:knowledgeTransactionObservationSchema.optional(),persistent:persistentWriteObservationSchema.optional(),controlled:controlledFileLedgerSchema.optional(),
  baselineChecks:z.array(z.object({baselineId:id,invalidated:z.boolean(),file:artifactFileCheckSchema}).strict()).max(effectObservationLimits.baselines).optional(),
  limitations:z.array(z.string().min(1).max(512)).max(effectObservationLimits.limitations),
}).strict().superRefine((v,c)=>{
  const issue=(m:string)=>c.addIssue({code:'custom',message:m});
  if(v.coverage==='selected_files_now'&&(!v.file||!v.toolName||!['read','write','edit'].includes(v.toolName)||!v.inputHash||!v.allowedSeq||v.scope?.kind!=='workspace'))issue('文件观察必须来自明确授权的单文件调用');
  if(v.coverage!=='selected_files_now'&&(v.file||v.baselineChecks))issue('未覆盖文件的调用不能携带字节证明');
  if(v.coverage==='control_commit_only'?!v.command:v.command!==undefined)issue('控制面核实必须与其覆盖范围一致');
  if(v.coverage==='knowledge_transaction'?!v.knowledge:v.knowledge!==undefined)issue('知识事务摘要必须与其覆盖范围一致');
  if(v.knowledge&&(!v.toolName||!['cbim_knowledge_commit','cbim_object_commit','cbim_knowledge_refresh'].includes(v.toolName)||!v.inputHash||!v.allowedSeq||v.outcome==='denied'||v.scope?.kind!=='knowledge'||v.scope.workspaceId!==v.knowledge.identity.workspaceId||v.effects?.length!==1||v.effects[0]!=='knowledge-write'))issue('知识事务必须来自原明确授权的知识提交或v2刷新');
  if(v.coverage==='persistent_record'?!v.persistent:v.persistent!==undefined)issue('原保存记录必须与其覆盖范围一致');
  if(v.persistent){const i=v.persistent.identity;if(v.toolName!==i.toolName||v.toolCallId!==i.toolCallId||!v.inputHash||!v.allowedSeq||v.outcome==='denied'||v.scope?.kind!=='knowledge'||v.scope.workspaceId!==i.workspaceId||v.effects?.length!==1||v.effects[0]!==persistentWriteEffects[i.toolName])issue('原保存记录必须来自同一次明确授权的主调用')}
  if(v.coverage==='controlled_file'?!v.controlled:v.controlled!==undefined)issue('原受控阶段必须与覆盖范围一致');
  if(v.controlled&&(v.toolName!==controlledFileWriteToolName||!v.inputHash||!v.allowedSeq||v.outcome==='denied'||v.scope?.kind!=='workspace'||v.effects?.length!==1||v.effects[0]!=='business-write'))issue('受控文件观察必须来自原明确授权的写入');
  if(v.baselineChecks?.some(b=>b.file.relativePath!==v.file?.relativePath))issue('历史基线只能比较同一文件');
  if(v.proposedSeq!==undefined&&v.allowedSeq!==undefined&&v.proposedSeq>=v.allowedSeq||v.allowedSeq!==undefined&&v.finishedSeq!==undefined&&v.allowedSeq>=v.finishedSeq)issue('原调用的事件顺序不一致');
});
export type EffectCallObservation=z.infer<typeof effectCallObservationSchema>;
/** 不可核实来源仍能显示诊断；只有可信唯一 scope 才能成为新核实的来源。 */
export const effectObservationReportSchema=z.object({
  version:z.literal(1),identity:effectObservationInputSchema,checkedAt:time,basis:digest,dispositionRevision:seq,consistency:z.enum(['stable','changed_during_read']),
  source:z.object({state:z.enum(['verified','unverifiable']),scopeId:id.optional(),scopeStatus:z.enum(['active','waiting','closed']).optional(),scopeOutcome:z.enum(['completed','failed','cancelled','interrupted']).optional(),
    execution:z.enum(['in_flight','settled','unknown']),logState,logPrefixHash:digest.optional(),throughSeq:seq.optional(),unknownToolCount:seq,
    taskRevision:positive.optional(),planRevision:positive.optional(),goalRevision:positive.optional(),inputRevision:positive.optional(),goalPlanRevision:positive.optional(),
  }).strict(),calls:z.array(effectCallObservationSchema).max(effectObservationLimits.calls),limitations:z.array(z.string().min(1).max(512)).max(effectObservationLimits.limitations),
  readOnly:z.literal(true),acceptance:z.literal('not_evaluated'),
}).strict().superRefine((v,c)=>{
  const issue=(m:string)=>c.addIssue({code:'custom',message:m});
  if(v.calls.length!==v.identity.subject.toolCallIds.length||v.calls.some((x,i)=>x.toolCallId!==v.identity.subject.toolCallIds[i]))issue('观察必须逐项对应原选择的调用顺序');
  const s=v.source;
  if((s.logPrefixHash===undefined)!==(s.throughSeq===undefined))issue('日志前缀指纹和序号须成对');
  if(s.state==='verified'&&(!s.scopeId||!s.scopeStatus||s.logState!=='verified'||s.logPrefixHash===undefined))issue('可信来源缺少周期或完整日志依据');
  if(s.scopeStatus==='closed'?!s.scopeOutcome:s.scopeOutcome!==undefined)issue('原周期关闭状态不一致');
  if(v.identity.subject.kind==='main_run'&&(s.taskRevision!==undefined||s.planRevision!==undefined))issue('主来源不能伪装成成员任务版本');
  if(v.identity.subject.kind!=='main_run'&&v.calls.some(call=>call.knowledge))issue('知识提交观察只接受可信主运行');
  if(v.calls.some(call=>call.persistent&&(v.identity.subject.kind!=='main_run'||call.persistent.identity.workspaceId!==v.identity.workspaceId||call.persistent.identity.rootSessionId!==v.identity.rootSessionId||call.persistent.identity.runId!==v.identity.subject.runId)))issue('原保存记录不属于选定的主运行');
  for(const call of v.calls){if(!call.controlled)continue;if(v.identity.subject.kind!=='member_run'){issue('受控文件观察仅支持原成员调用');continue}if(call.controlled.state==='recorded'){const {operation,compensationRevision,compensations}=call.controlled,b=operation.binding;if(b.workspaceId!==v.identity.workspaceId||b.rootSessionId!==v.identity.rootSessionId||b.taskId!==v.identity.subject.taskId||b.runId!==v.identity.subject.runId||operation.toolCallId!==call.toolCallId||operation.scopeId!==s.scopeId||compensationRevision!==compensations.length||new Set(compensations.map(x=>x.compensationId)).size!==compensations.length)issue('受控阶段或补偿不属于原成员及周期')}}
  if(s.state==='verified'&&v.identity.subject.kind==='member_run'&&(!s.taskRevision||!s.planRevision))issue('成员来源缺少任务版本');
  if(v.calls.some(x=>x.scope&&x.scope.workspaceId!==v.identity.workspaceId))issue('调用范围属于其它工作区');
  if(s.state!=='verified'&&v.calls.some(x=>x.coverage!=='unsupported'))issue('不可核实来源不能给出结构化影响证明');
  if(s.throughSeq!==undefined&&v.calls.some(x=>[x.proposedSeq,x.allowedSeq,x.finishedSeq].some(n=>n!==undefined&&n>s.throughSeq!)))issue('调用超出核实日志前缀');
  const files=new Map<string,EffectFileObservation>();
  for(const call of v.calls){if(!call.file)continue;const previous=files.get(call.file.relativePath);if(previous&&JSON.stringify(previous)!==JSON.stringify(call.file))issue('同一次观察的同路径文件事实不一致');files.set(call.file.relativePath,call.file)}
  if([...files.values()].reduce((total,file)=>total+(file.byteLength??0),0)>effectObservationLimits.totalBytes)issue('所选文件实际总字节超出观察限额');
  if(new TextEncoder().encode(JSON.stringify(v)).length>effectObservationLimits.outputBytes)issue('观察报告超出公开输出字节上限');
});
export type EffectObservationReport=z.infer<typeof effectObservationReportSchema>;
export const effectDispositionInputSchema=effectObservationInputSchema.extend({commandId:z.string().uuid(),expectedBasis:digest,expectedRevision:seq,decision:z.enum(['inspect_more','repair_in_new_cycle','leave_unresolved']),reason:z.string().min(1).max(4096).refine(v=>!!v.trim())}).strict();
export type EffectDispositionInput=z.infer<typeof effectDispositionInputSchema>;
export const effectDispositionRequestSchema=effectDispositionInputSchema;
export type EffectDispositionRequest=EffectDispositionInput;
export const effectDispositionLookupSchema=z.object({...identity,commandId:z.string().uuid()}).strict();
export type EffectDispositionLookup=z.infer<typeof effectDispositionLookupSchema>;
/** 当时观察完整冻结，但不提供今天仍相同、原操作成功或自动写入许可。 */
export const effectDispositionRecordSchema=z.object({version:z.literal(1),dispositionId:z.string().uuid(),request:effectDispositionInputSchema,revision:positive,recordedAt:time,actor:z.object({kind:z.literal('local_desktop'),interaction:z.literal('explicit_submit')}).strict(),observation:effectObservationReportSchema}).strict().superRefine((v,c)=>{
  if(v.dispositionId!==v.request.commandId||v.revision!==v.request.expectedRevision+1||v.observation.dispositionRevision!==v.request.expectedRevision||v.observation.consistency!=='stable'||v.observation.basis!==v.request.expectedBasis||JSON.stringify(v.observation.identity)!==JSON.stringify({workspaceId:v.request.workspaceId,rootSessionId:v.request.rootSessionId,subject:v.request.subject}))c.addIssue({code:'custom',message:'处置与原选择、稳定观察及版本不一致'});
});
export type EffectDispositionRecord=z.infer<typeof effectDispositionRecordSchema>;
export const effectDispositionReceiptSchema=z.object({...identity,record:effectDispositionRecordSchema}).strict().superRefine((v,c)=>{if(v.workspaceId!==v.record.request.workspaceId||v.rootSessionId!==v.record.request.rootSessionId)c.addIssue({code:'custom',message:'处置回执身份不一致'})});
export type EffectDispositionReceipt=z.infer<typeof effectDispositionReceiptSchema>;
export const effectDispositionListInputSchema=effectObservationInputSchema;
export type EffectDispositionListInput=EffectObservationInput;
export const effectDispositionSummarySchema=z.object({dispositionId:z.string().uuid(),revision:positive,decision:effectDispositionInputSchema.shape.decision,reason:z.string().min(1).max(512),reasonTruncated:z.boolean(),recordedAt:time,observationBasis:digest}).strict();
export type EffectDispositionSummary=z.infer<typeof effectDispositionSummarySchema>;
/** 当前 root head 独立于 subject 筛选；这里只返回有界摘要，不重复传输整份观察。 */
export const effectDispositionListSchema=z.object({identity:effectObservationInputSchema,revision:seq,records:z.array(effectDispositionSummarySchema).max(effectObservationLimits.recordsPerRoot),readOnly:z.literal(true)}).strict().superRefine((v,c)=>{if(new Set(v.records.map(x=>x.dispositionId)).size!==v.records.length||v.records.some((x,i)=>x.revision>v.revision||i>0&&x.revision<=v.records[i-1].revision))c.addIssue({code:'custom',message:'处置摘要顺序或版本不一致'})});
export type EffectDispositionList=z.infer<typeof effectDispositionListSchema>;
export const effectRelationsInputSchema=z.object({...identity,dispositionId:z.string().uuid()}).strict();
export type EffectRelationsInput=z.infer<typeof effectRelationsInputSchema>;
export const effectRelationsSchema=z.object({identity:effectRelationsInputSchema,record:effectDispositionRecordSchema,links:z.array(z.object({kind:z.enum(['inspection','repair']),scopeId:id,status:z.enum(['active','waiting','closed']),outcome:z.enum(['completed','failed','cancelled','interrupted']).optional(),runId:id,taskIds:z.array(id).max(500),goalRevision:positive.optional(),reviewDecision:z.enum(['complete','replan','blocked','awaiting_user']).optional()}).strict()).max(64),readOnly:z.literal(true)}).strict().superRefine((v,c)=>{
  if(v.identity.workspaceId!==v.record.request.workspaceId||v.identity.rootSessionId!==v.record.request.rootSessionId||v.identity.dispositionId!==v.record.dispositionId||new Set(v.links.map(x=>x.scopeId)).size!==v.links.length||v.links.some(x=>x.status==='closed'?!x.outcome:x.outcome!==undefined))c.addIssue({code:'custom',message:'处置关系身份或状态不一致'});
});
export type EffectRelations=z.infer<typeof effectRelationsSchema>;
/** 比较的是选择的语义身份，不重排请求或修改持久字节。 */
export const sameEffectSubject=(a:EffectSubject,b:EffectSubject)=>a.kind===b.kind&&a.runId===b.runId&&(a.kind!=='member_run'||b.kind==='member_run'&&a.taskId===b.taskId)&&a.toolCallIds.length===b.toolCallIds.length&&a.toolCallIds.every((id,i)=>id===b.toolCallIds[i]);
