/**
 * 完整候选只显式选择原交付清单；跨等待重新决定须明确引用原意见并保存新的当前依据，旧接受不自动继承。
 * 作用定位：定义本机显式人工决定的请求、精确依据和只读历史，供调度与桌面共同校验。
 * 设计原因：人工选择与模型审阅、运行许可分离；记录只声明所述验收项及所选成果，不能把成功命令的范围未知当成工具结果未知。
 * 职责边界：保持纯序列化叶子契约；不读取文件、不认证账号、不批准运行或将目标标为完成。
 */
import {z} from 'zod';
import {artifactFileCheckSchema,artifactLimits} from '../evidence/artifact-baseline';
import {outputManifestProofSchema} from '../evidence/output-manifest';
import {artifactScopeLimits} from '../workspace/artifact-scope';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const logical=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const callId=z.string().min(1).max(128).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const digest=z.string().regex(/^[a-f0-9]{64}$/),seq=z.number().int().nonnegative().safe(),positive=seq.min(1),time=z.string().datetime();
const unique=(values:string[])=>new Set(values).size===values.length;
export const humanDecisionLimit=64;
/** 所有决定都保留此范围说明；接受不构成工作区快照、未知副作用消除或继续执行授权。 */
export const humanDecisionCoverageLimitation='本次决定仅针对所述人工验收项及明确选择的成果，不证明整个工作区或所有副作用已经核实，也不授权继续执行。';
export const humanDecisionKindSchema=z.enum(['accept','reject','request_evidence']);
export type HumanDecisionKind=z.infer<typeof humanDecisionKindSchema>;
export const humanDecisionIdentitySchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id}).strict();
const criterion=z.object({id:logical,text:z.string().min(1).max(16000),kind:z.literal('human')}).strict();
export const humanDecisionBaselineSelectionSchema=z.object({taskId:id,runId:id,baselineId:id}).strict();
export type HumanDecisionBaselineSelection=z.infer<typeof humanDecisionBaselineSelectionSchema>;
export const humanDecisionManifestSelectionSchema=z.object({taskId:id,runId:id,manifestId:id}).strict();
export type HumanDecisionManifestSelection=z.infer<typeof humanDecisionManifestSelectionSchema>;
const selections=z.array(humanDecisionBaselineSelectionSchema).max(16).refine(values=>unique(values.map(item=>item.taskId+':'+item.runId)),'每个候选最多明确选择一份基线');
const manifestSelections=z.array(humanDecisionManifestSelectionSchema).max(16).refine(values=>unique(values.map(item=>item.taskId+':'+item.runId)),'每个候选最多明确选择一份完整清单');
/** reconsidersDecisionId 只选择同项最新的先前等待意见；省略表示独立决定，不自动猜测或迁移旧接受。 */
export const humanDecisionPreviewInputSchema=humanDecisionIdentitySchema.extend({criterionId:logical,baselines:selections,manifests:manifestSelections.optional(),reconsidersDecisionId:z.string().uuid().optional()}).strict();
export type HumanDecisionPreviewInput=z.infer<typeof humanDecisionPreviewInputSchema>;
/** actor、文件观察和证明不属于请求；它们由可信桌面入口与核实服务生成。 */
export const humanDecisionRequestSchema=humanDecisionPreviewInputSchema.extend({commandId:z.string().uuid(),expectedDecisionRevision:seq.max(humanDecisionLimit),expectedBasis:digest,decision:humanDecisionKindSchema,comment:z.string().trim().max(4000)}).strict().refine(value=>value.decision==='accept'||value.comment.length>0,'拒绝或补证须写明意见');
export type HumanDecisionRequest=z.infer<typeof humanDecisionRequestSchema>;
export const humanDecisionLookupSchema=humanDecisionIdentitySchema.extend({commandId:z.string().uuid()}).strict();
export type HumanDecisionLookup=z.infer<typeof humanDecisionLookupSchema>;
export const humanDecisionHistoryInputSchema=humanDecisionIdentitySchema;
export type HumanDecisionHistoryInput=z.infer<typeof humanDecisionHistoryInputSchema>;
export const humanDecisionActorSchema=z.object({kind:z.literal('local_desktop'),interaction:z.literal('explicit_submit')}).strict();
export type HumanDecisionActor=z.infer<typeof humanDecisionActorSchema>;
/** 固定当前等待/计划/审阅，revision 变化与读取时钟分离，不能借另一轮批准同名条件。 */
export const humanDecisionSourceSchema=z.object({waitId:logical,goalRevision:positive.max(65),inputRevision:positive.max(32),planRevision:positive.max(65),reviewRevision:positive.max(65),reviewRunId:id,reviewLogHash:digest,knowledgeRevision:logical,graphCursor:z.object({streamId:logical,seq:positive}).strict(),criterion}).strict();
export type HumanDecisionSource=z.infer<typeof humanDecisionSourceSchema>;
export const humanDecisionArtifactObservationSchema=z.object({baselineId:id,captureToolCallId:callId,capturedSeq:positive,finishedSeq:positive,knowledgeRevision:logical,progressVersion:positive,invalidated:z.boolean(),files:z.array(artifactFileCheckSchema).max(artifactLimits.files)}).strict().superRefine((value,context)=>{
  if(value.capturedSeq>=value.finishedSeq||!unique(value.files.map(file=>file.relativePath)))context.addIssue({code:'custom',message:'采集顺序或文件集合不一致'});
  for(const file of value.files){
    const same=file.observed&&file.expected.byteLength===file.observed.byteLength&&file.expected.sha256===file.observed.sha256;
    if(file.state==='matches'&&!same||file.state==='changed'&&(!file.observed||same)||file.state==='missing'&&file.observed)context.addIssue({code:'custom',message:'文件观察状态与字节指纹矛盾'});
  }
});
export type HumanDecisionArtifactObservation=z.infer<typeof humanDecisionArtifactObservationSchema>;
/** 只存原清单证明与本次全集合观察结论；完整条目保留于 canonical，避免每条意见重复复制。 */
export const humanDecisionManifestObservationSchema=z.object({manifest:outputManifestProofSchema,state:z.enum(['matches','changed','unverifiable']),observedHash:digest.optional()}).strict().superRefine((value,context)=>{
  if(value.state==='matches'&&value.observedHash!==value.manifest.manifestHash||value.state==='changed'&&(!value.observedHash||value.observedHash===value.manifest.manifestHash)||value.state==='unverifiable'&&value.observedHash)context.addIssue({code:'custom',message:'完整集合观察与原清单指纹矛盾'});
});
/** 不复制正文或原生路径；日志指纹与精确候选/回执身份绑定当时事实。 */
export const humanDecisionCandidateProofSchema=z.object({taskId:id,taskRevision:positive,runId:id,resultId:id,planRevision:positive,logHash:digest,evidenceToolCallIds:z.array(callId).min(1).max(100).refine(unique),selected:humanDecisionArtifactObservationSchema.optional(),selectedManifest:humanDecisionManifestObservationSchema.optional()}).strict();
export type HumanDecisionCandidateProof=z.infer<typeof humanDecisionCandidateProofSchema>;
export const humanDecisionCandidateSchema=humanDecisionCandidateProofSchema.extend({agentName:z.string().min(1).max(240),summary:z.string().max(240),baselines:z.array(z.object({baselineId:id,capturedAt:time,fileCount:positive.max(artifactLimits.files)}).strict()).max(artifactLimits.baselines),manifest:outputManifestProofSchema.optional()}).strict();
export type HumanDecisionCandidate=z.infer<typeof humanDecisionCandidateSchema>;
const candidates=z.array(humanDecisionCandidateProofSchema).min(1).max(16).refine(values=>unique(values.map(item=>item.taskId)),'候选任务不能重复');
const limitations=z.array(z.string().min(1).max(1000)).min(1).max(32).refine(values=>values.includes(humanDecisionCoverageLimitation),'人工决定必须保留选定成果的范围限制');
const allowed=z.array(humanDecisionKindSchema).max(3);
const issue=z.object({code:id,message:z.string().min(1).max(512)}).strict();
/** 对照是本次只读观察；evidence_matches 也必须按新等待明确提交，不能作为批准或继续许可。 */
export const humanReconsiderationSchema=z.object({decisionId:z.string().uuid(),previousWaitId:logical.optional(),currentWaitId:logical.optional(),status:z.enum(['evidence_matches','changed','unverifiable','superseded','same_wait']),canReconsider:z.boolean(),checks:z.array(z.object({key:z.enum(['source','latest','waiting','criterion','knowledge','candidates','selection','artifacts']),state:z.enum(['same','changed','unverifiable']),message:z.string().min(1).max(512)}).strict()).length(8)}).strict().superRefine((value,ctx)=>{
  if(!unique(value.checks.map(item=>item.key))||value.canReconsider&&(['superseded','same_wait'].includes(value.status)||!value.previousWaitId||!value.currentWaitId||value.previousWaitId===value.currentWaitId||value.checks.some(item=>['source','latest'].includes(item.key)&&item.state!=='same')))ctx.addIssue({code:'custom',message:'重新决定的原来源、最新意见或等待关系无效'});
  const comparable=value.checks.filter(item=>item.key!=='waiting'),waiting=value.checks.find(item=>item.key==='waiting'),knownWaits=!!value.previousWaitId&&!!value.currentWaitId;
  if(waiting?.state!==(knownWaits?(value.previousWaitId===value.currentWaitId?'same':'changed'):'unverifiable')||value.status==='evidence_matches'&&(!knownWaits||waiting?.state!=='changed'||comparable.some(item=>item.state!=='same'))||value.status==='changed'&&!comparable.some(item=>item.state==='changed')||value.status==='unverifiable'&&!comparable.some(item=>item.state==='unverifiable')||value.status==='superseded'&&value.checks.find(item=>item.key==='latest')?.state!=='changed'||value.status==='same_wait'&&(!knownWaits||value.previousWaitId!==value.currentWaitId))ctx.addIssue({code:'custom',message:'对照结论与逐项观察或等待身份矛盾'});
});
export type HumanReconsideration=z.infer<typeof humanReconsiderationSchema>;
export const humanDecisionPreviewSchema=z.object({identity:humanDecisionPreviewInputSchema.omit({baselines:true,manifests:true,reconsidersDecisionId:true}),checkedAt:time,decisionRevision:seq.max(humanDecisionLimit),basis:digest.optional(),source:humanDecisionSourceSchema.optional(),candidates:z.array(humanDecisionCandidateSchema).max(16),allowedDecisions:allowed.refine(unique),limitations,issues:z.array(issue).max(32),latestDecisionId:z.string().uuid().optional(),reconsideration:humanReconsiderationSchema.optional()}).strict().superRefine((value,context)=>{
  if(value.allowedDecisions.length&&(!value.basis||!value.source||!value.candidates.length))context.addIssue({code:'custom',message:'可提交决定必须具备当前完整依据'});
  if(value.source&&value.source.criterion.id!==value.identity.criterionId)context.addIssue({code:'custom',message:'预览人工项与身份不一致'});
  if(value.reconsideration&&(value.source&&value.reconsideration.currentWaitId!==value.source.waitId||!value.reconsideration.canReconsider&&value.allowedDecisions.length))context.addIssue({code:'custom',message:'对照结果不属于当前等待或仍允许无效关联提交'});
  if(!unique(value.candidates.map(item=>item.taskId)))context.addIssue({code:'custom',message:'候选任务重复'});
  for(const candidate of value.candidates)if(candidate.selected&&candidate.selectedManifest||candidate.manifest&&(candidate.selected||candidate.baselines.length)||candidate.selectedManifest&&JSON.stringify(candidate.selectedManifest.manifest)!==JSON.stringify(candidate.manifest))context.addIssue({code:'custom',message:'完整候选不能退回文件子集或替换原交付清单'});
});
export type HumanDecisionPreview=z.infer<typeof humanDecisionPreviewSchema>;
/** basis 仅覆盖事实与可提交范围，排除读取时间、独立决定序列和候选基线菜单。 */
export const humanDecisionProofSchema=z.object({identity:humanDecisionIdentitySchema,source:humanDecisionSourceSchema,candidates,limitations,allowedDecisions:allowed.min(1).refine(unique)}).strict();
export type HumanDecisionProof=z.infer<typeof humanDecisionProofSchema>;
/** reconsidersDecisionId 保留跨等待来源；supersedesDecisionId 则只链接同一依据上的最近决定，两者不授予执行权。 */
export const humanDecisionRecordSchema=z.object({decisionId:z.string().uuid(),revision:positive.max(humanDecisionLimit),recordedAt:time,actor:humanDecisionActorSchema,criterionId:logical,decision:humanDecisionKindSchema,comment:z.string().trim().max(4000),basis:digest,baselines:selections,manifests:manifestSelections.optional(),proof:humanDecisionProofSchema,supersedesDecisionId:z.string().uuid().optional(),reconsidersDecisionId:z.string().uuid().optional()}).strict().superRefine((value,context)=>{
  const issue=(message:string)=>context.addIssue({code:'custom',message});
  if(value.criterionId!==value.proof.source.criterion.id||!value.proof.allowedDecisions.includes(value.decision))issue('人工项或决定不属于核实依据');
  if(value.reconsidersDecisionId===value.decisionId)issue('新决定不能引用自身作为旧意见');
  if(value.decision!=='accept'&&!value.comment)issue('拒绝或补证须保留意见');
  const selected=value.proof.candidates.filter(item=>item.selected);
  if(value.baselines.length!==selected.length||!value.baselines.every(selection=>selected.some(item=>item.taskId===selection.taskId&&item.runId===selection.runId&&item.selected!.baselineId===selection.baselineId)))issue('选择与已核实文件依据不一致');
  const manifests=value.proof.candidates.filter(item=>item.selectedManifest);
  if((value.manifests?.length??0)!==manifests.length||!value.manifests?.every(selection=>manifests.some(item=>item.taskId===selection.taskId&&item.runId===selection.runId&&item.selectedManifest!.manifest.manifestId===selection.manifestId))&&manifests.length)issue('完整选择与已核实的原交付清单不一致');
  if(value.proof.candidates.some(item=>item.selected&&item.selectedManifest))issue('同一候选不能同时引用文件子集与完整清单');
  if(value.decision==='accept'&&value.proof.candidates.some(item=>item.selectedManifest?item.selectedManifest.state!=='matches'||item.selectedManifest.manifest.knowledgeRevision!==value.proof.source.knowledgeRevision:!item.selected||item.selected.invalidated||!item.selected.files.length||item.selected.files.some(file=>file.state!=='matches')||item.selected.knowledgeRevision!==value.proof.source.knowledgeRevision))issue('接受必须明确选择全部候选的当前有效且完全匹配的产物依据');
  const files=new Map<string,{byteLength:number;sha256:string}>();
  // 拒绝/补证可保留冲突观察；相同路径仍按最大期望大小计量，不能用后来较小的版本降低读取上限。
  for(const item of selected)for(const file of item.selected!.files){const existing=files.get(file.relativePath);if(existing&&(existing.byteLength!==file.expected.byteLength||existing.sha256!==file.expected.sha256)&&value.decision==='accept')issue('候选对同一文件的期望不一致');if(!existing||existing.byteLength<file.expected.byteLength)files.set(file.relativePath,file.expected)}
  if(files.size>artifactLimits.files||[...files.values()].reduce((total,file)=>total+file.byteLength,0)>artifactLimits.totalBytes)issue('人工决定的文件核实范围超过上限');
  const proofs=manifests.map(item=>item.selectedManifest!.manifest);
  if(proofs.reduce((sum,item)=>sum+item.scopes.reduce((n,scope)=>n+scope.scope.roots.length,0),0)>artifactScopeLimits.roots||files.size+proofs.reduce((sum,item)=>sum+item.entryCount,0)>artifactScopeLimits.entries||[...files.values()].reduce((sum,file)=>sum+file.byteLength,0)+proofs.reduce((sum,item)=>sum+item.byteLength,0)>artifactScopeLimits.totalBytes)issue('人工决定的完整集合合并预算超过上限');
});
export type HumanDecisionRecord=z.infer<typeof humanDecisionRecordSchema>;
export const scopeHumanDecisionsSchema=z.object({revision:positive.max(humanDecisionLimit),records:z.array(humanDecisionRecordSchema).min(1).max(humanDecisionLimit)}).strict().superRefine((value,context)=>{
  if(value.revision!==value.records.length||value.records.some((record,index)=>record.revision!==index+1)||!unique(value.records.map(record=>record.decisionId)))context.addIssue({code:'custom',message:'人工决定历史必须有界连续且命令唯一'});
  for(let index=0;index<value.records.length;index++){const record=value.records[index],prior=value.records.slice(0,index).filter(item=>item.criterionId===record.criterionId&&item.basis===record.basis).at(-1);if(record.supersedesDecisionId!==prior?.decisionId)context.addIssue({code:'custom',message:'只能替代同人工项、同依据的最近决定'})}
  for(let index=0;index<value.records.length;index++){const record=value.records[index];if(!record.reconsidersDecisionId)continue;const prior=value.records.slice(0,index).filter(item=>item.criterionId===record.criterionId).at(-1);if(prior?.decisionId!==record.reconsidersDecisionId||prior.proof.source.waitId===record.proof.source.waitId)context.addIssue({code:'custom',message:'跨等待重新决定只能关联本项最新的先前等待意见'})}
});
export type ScopeHumanDecisions=z.infer<typeof scopeHumanDecisionsSchema>;
const sameIdentity=(a:{workspaceId:string;rootSessionId:string;scopeId:string},b:{workspaceId:string;rootSessionId:string;scopeId:string})=>a.workspaceId===b.workspaceId&&a.rootSessionId===b.rootSessionId&&a.scopeId===b.scopeId;
export const humanDecisionReceiptSchema=humanDecisionIdentitySchema.extend({scopeStatus:z.enum(['active','waiting','closed']),decisionRevision:positive.max(humanDecisionLimit),record:humanDecisionRecordSchema}).strict().refine(value=>value.decisionRevision>=value.record.revision&&sameIdentity(value,value.record.proof.identity));
export type HumanDecisionReceipt=z.infer<typeof humanDecisionReceiptSchema>;
export const humanDecisionHistorySchema=humanDecisionIdentitySchema.extend({scopeStatus:z.enum(['active','waiting','closed']),decisionRevision:seq.max(humanDecisionLimit),records:z.array(humanDecisionRecordSchema).max(humanDecisionLimit)}).strict().refine(value=>(value.decisionRevision===0?value.records.length===0:scopeHumanDecisionsSchema.safeParse({revision:value.decisionRevision,records:value.records}).success)&&value.records.every(record=>sameIdentity(value,record.proof.identity)));
export type HumanDecisionHistory=z.infer<typeof humanDecisionHistorySchema>;
