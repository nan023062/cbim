/**
 * 作用定位：从原完整清单、实际操作阶段与成功工具回执重建文件删除/移动证明，供采集及验收共用。
 * 设计原因：前态必须早于原调用，后态须恰好对应声明操作；其它副作用、重规划或内容变化不能沿用旧操作。
 * 职责边界：只验证已取得的原始事件与快照，不运行操作、不将事后缺失或模型文本作为因果证明。
 */
import {z} from 'zod';
import {isDeepStrictEqual as equal} from 'node:util';
import {hash} from '../foundation/serialization';
import {preparedArtifactTransitions,artifactScopeLimits,type ArtifactScopeBinding,type ArtifactTransitionDefinition} from '../workspace/artifact-scope';
import {artifactEventChangesFiles,artifactSucceededCall,type ArtifactEvidenceEvent} from './artifact-evidence';
import {outputManifestHash,outputManifestScopeHash} from './output-manifest-identity';
import {outputManifestSnapshotSchema,type OutputManifestSnapshot,type OutputManifestRecord} from './output-manifest';
import {artifactTransitionToolName,artifactTransitionInputSchema,artifactTransitionPreparedSchema,artifactTransitionExecutingSchema,artifactTransitionOutputSchema,artifactTransitionAppliedSchema,artifactTransitionProofSchema,type ArtifactTransitionPrepared,type ArtifactTransitionApplied,type ArtifactTransitionProof} from './artifact-transition';

function valid(value:unknown,message:string):asserts value{if(!value)throw Error(message)}
type Binding=ArtifactTransitionPrepared['binding'];
/** 原运行和调用决定唯一操作标识；更换模型 toolCallId 仍必须经过真实授权和新前态。 */
export function artifactTransitionOperationId(binding:Binding,toolCallId:string){return hash(JSON.stringify([binding.workspaceId,binding.rootSessionId,binding.taskId,binding.runId,toolCallId]))}
/** 精确变换完整集合；不补父目录、不覆盖目标、不修改其它文件，调用方须再核平台真实 after。 */
export function expectedArtifactTransitionSnapshot(raw:OutputManifestSnapshot,operation:ArtifactTransitionDefinition):OutputManifestSnapshot{
  const before=outputManifestSnapshotSchema.parse(raw),source=operation.kind==='delete'?operation.path:operation.from,entry=before.entries.find(item=>item.relativePath===source);
  valid(entry?.kind==='file'&&entry.byteLength<=1024*1024,'原操作来源不是受支持的真实普通文件');
  if(operation.kind==='move')valid(!before.entries.some(item=>item.relativePath.toLowerCase()===operation.to.toLowerCase()),'原目标已存在，不能覆盖或借此证明移动');
  const after=structuredClone(before);after.entries=after.entries.filter(item=>item.relativePath!==source);
  for(const root of after.roots)if(root.relativePath===source)root.state='missing';
  if(operation.kind==='move'){after.entries.push({...entry,relativePath:operation.to});for(const root of after.roots)if(root.relativePath===operation.to)root.state='file'}
  after.entries.sort((a,b)=>a.relativePath<b.relativePath?-1:a.relativePath>b.relativePath?1:0);return outputManifestSnapshotSchema.parse(after);
}
/** 仅从原 prepared 和实际 append 序号投影公开成功内容，不复制私有文件对象身份。 */
export function artifactTransitionAppliedValue(prepared:ArtifactTransitionPrepared,sequences:{preparedSeq:number;executingSeq:number;appliedSeq:number},after:{afterManifestHash:string;appliedAt:string}):ArtifactTransitionApplied{
  const {version:_version,binding:_binding,inputHash:_inputHash,progressVersion:_progressVersion,fileIdentity:_identity,preparedAt:_preparedAt,...common}=artifactTransitionPreparedSchema.parse(prepared);
  return artifactTransitionAppliedSchema.parse({...common,...sequences,...after});
}
const appliedEvent=z.object({operationId:z.string().regex(/^[a-f0-9]{64}$/),executingSeq:z.number().int().positive().safe(),afterManifestHash:z.string().regex(/^[a-f0-9]{64}$/),afterSnapshot:outputManifestSnapshotSchema,appliedAt:z.string().datetime()}).strict();
/** 已核清单由调用方按日志顺序传入，避免反向调用清单验证器形成依赖环。坏/未结束操作不产生证明。 */
export function verifyArtifactTransitions(events:readonly ArtifactEvidenceEvent[],binding:Binding,knowledgeRevision:string,scopes:readonly ArtifactScopeBinding[],manifests:readonly OutputManifestRecord[]):ArtifactTransitionProof[]{
  const proofs:ArtifactTransitionProof[]=[],preparedEvents=events.filter(e=>e.type==='artifact.transition_prepared'),declared=preparedArtifactTransitions(scopes);
  if(preparedEvents.length>artifactScopeLimits.transitions)return proofs;
  for(const event of preparedEvents){try{
    const prepared=artifactTransitionPreparedSchema.parse(event.data.prepared),own=artifactSucceededCall(events,binding,prepared.toolCallId),input=artifactTransitionInputSchema.parse(own.allowed.data.input);
    valid(equal(prepared.binding,binding)&&prepared.knowledgeRevision===knowledgeRevision&&prepared.scopeHash===outputManifestScopeHash(scopes)&&prepared.operationId===artifactTransitionOperationId(binding,prepared.toolCallId),'原操作身份不一致');
    valid(preparedEvents.filter(e=>(e.data.prepared as {operationId?:unknown})?.operationId===prepared.operationId).length===1&&preparedEvents.filter(e=>(e.data.prepared as {toolCallId?:unknown})?.toolCallId===prepared.toolCallId).length===1,'原操作重复');
    const requirement=declared.find(item=>item.moduleId===input.moduleId&&item.operationIndex===input.operationIndex);valid(requirement&&equal(requirement.operation,prepared.operation)&&prepared.moduleId===input.moduleId&&prepared.operationIndex===input.operationIndex&&prepared.beforeManifestId===input.beforeManifestId&&prepared.progressVersion===input.expectedTaskProgressVersion,'原操作不符合冻结要求');
    valid(own.receipt.toolName===artifactTransitionToolName&&own.allowed.data.contractVersion===1&&own.receipt.scope.kind==='workspace'&&equal(own.receipt.effects,['business-write'])&&prepared.allowedSeq===own.allowed.seq&&prepared.inputHash===own.receipt.inputHash,'原操作授权不可信');
    const before=manifests.find(item=>item.manifest.manifestId===input.beforeManifestId);valid(before&&before.finishedSeq<own.proposed.seq&&before.manifest.manifestHash===prepared.beforeManifestHash&&before.manifest.scopeHash===prepared.scopeHash&&before.manifest.progressVersion<=input.expectedTaskProgressVersion,'写前清单缺失或晚于原调用');
    const progress=events.filter(e=>e.seq<own.proposed.seq&&e.type==='task.updated').at(-1)?.data.progress as {version?:number}|undefined;valid(progress?.version===input.expectedTaskProgressVersion,'写前计划版本不一致');
    valid(!events.some(e=>e.seq>before.finishedSeq&&e.seq<own.allowed.seq&&(artifactEventChangesFiles(e)||e.type==='tool.allowed'&&e.data.name==='cbim_task_plan')),'写前清单已被其它操作或重规划取代');
    const source=prepared.operation.kind==='delete'?prepared.operation.path:prepared.operation.from,file=before.manifest.snapshot.entries.find(e=>e.relativePath===source);valid(file?.kind==='file'&&file.byteLength===prepared.before.byteLength&&file.sha256===prepared.before.sha256,'句柄字节与原清单不一致');
    const executingEvents=events.filter(e=>e.type==='artifact.transition_executing'&&e.data.operationId===prepared.operationId),appliedEvents=events.filter(e=>e.type==='artifact.transition_applied'&&e.data.operationId===prepared.operationId);valid(executingEvents.length===1&&appliedEvents.length===1,'原操作阶段缺失或重复');
    const executing=executingEvents[0],applied=appliedEvents[0],intent=artifactTransitionExecutingSchema.parse(executing.data),after=appliedEvent.parse(applied.data);valid(intent.preparedSeq===event.seq&&after.executingSeq===executing.seq,'原操作阶段关联不一致');
    valid(equal(after.afterSnapshot,expectedArtifactTransitionSnapshot(before.manifest.snapshot,prepared.operation))&&after.afterManifestHash===outputManifestHash(after.afterSnapshot),'真实后态不是原操作的完整集合');
    const proof=artifactTransitionProofSchema.parse({...artifactTransitionAppliedValue(prepared,{preparedSeq:event.seq,executingSeq:executing.seq,appliedSeq:applied.seq},{afterManifestHash:after.afterManifestHash,appliedAt:after.appliedAt}),finishedSeq:own.finished.seq});
    valid(!events.some(e=>e.seq>own.allowed.seq&&e.seq<own.finished.seq&&['tool.allowed','task.updated','run.stop_requested','run.interrupted'].includes(e.type)),'操作期间发生其它调用、停止或进度变化');
    const content=(own.finished.data.result as {content?:Array<{type?:unknown;text?:unknown}>})?.content;valid(content?.length===1&&content[0].type==='text'&&typeof content[0].text==='string','原操作没有唯一JSON回包');const result=artifactTransitionOutputSchema.parse(JSON.parse(content[0].text));const {finishedSeq:_finished,...summary}=proof;valid(equal(result.operation,summary),'原操作回包不一致');proofs.push(proof);
  }catch{/* 无完整成功链的原事实保留历史，但不给新清单签发操作证明 */}}
  return proofs.sort((a,b)=>a.finishedSeq-b.finishedSeq);
}
/** 只保留同一连续操作链且当前集合等于最后 after；普通写入、重规划或外部变化都不会自动采纳旧操作。 */
export function currentArtifactTransitions(events:readonly ArtifactEvidenceEvent[],proofs:readonly ArtifactTransitionProof[],snapshot:OutputManifestSnapshot):ArtifactTransitionProof[]{
  if(!proofs.length)return [];
  const ids=new Set(proofs.map(p=>p.toolCallId)),first=proofs[0];
  if(new Set(proofs.map(p=>p.moduleId+'\0'+p.operationIndex)).size!==proofs.length||events.some(e=>e.seq>first.allowedSeq&&(artifactEventChangesFiles(e)&&!ids.has(String(e.data.id))||e.type==='tool.allowed'&&e.data.name==='cbim_task_plan'))||proofs.at(-1)!.afterManifestHash!==outputManifestHash(snapshot)||proofs.some((p,i)=>i>0&&p.beforeManifestHash!==proofs[i-1].afterManifestHash))return [];
  return structuredClone([...proofs]);
}
