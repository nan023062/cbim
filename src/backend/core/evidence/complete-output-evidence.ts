/**
 * 目录归属：backend/core/evidence；产物与 Workflow 证据规则。
 * 作用定位：完整产物出口共用的清单选择、身份投影和当前集合比较，供运行、交付及人工核实复用。
 * 设计原因：声明的全部范围必须随同一原清单进入各出口，不能选一个未变文件子集、缺失输出或较新引用来替代。
 * 职责边界：调用方先取得真实 canonical 操作/采集证明和平台观察；本模块不做 I/O，不签署人工接受，普通缺失不能替代操作证明。
 */
import {isDeepStrictEqual as equal} from 'node:util';
import {fail} from '../foundation/errors';
import {preparedArtifactScopes,artifactScopeLimits,type ArtifactScope} from '../workspace/artifact-scope';
import type {ArtifactFileFact} from './artifact-baseline';
import {outputManifestRecordSchema,outputManifestProofSchema,outputManifestCheckSchema,type OutputManifestRecord,type OutputManifestProof,type OutputManifestIdentity,type OutputManifestSnapshot} from './output-manifest';
import {outputManifestHash,outputManifestReference,type verifyOutputManifests} from './output-manifest-evidence';

/** 冻结约定的最小结构边界，避免清单事实反向依赖执行器或 Workflow 证明实现。 */
export interface CompleteOutputBinding {moduleId:string;workflowId:string;workflowVersion:string;contract:{artifactScope?:ArtifactScope;delivery?:{requireCompleteManifest?:true}}}
/** 任一模块要求完整出口时，候选使用本轮全部已声明范围；其它声明不能被静默剔除。 */
export function completeOutputRequired(bindings:readonly CompleteOutputBinding[]){return bindings.some(binding=>binding.contract.delivery?.requireCompleteManifest===true)}
/** 投影原记录的三字段身份；不接受调用方以单个文件指纹替换集合摘要。 */
export function outputManifestIdentity(value:OutputManifestIdentity):OutputManifestIdentity{return {manifestId:value.manifestId,scopeHash:value.scopeHash,manifestHash:value.manifestHash}}
/** 重算引用，保留原采集顺序；记录对象本身不能自报另一份摘要或数量。 */
export function completeOutputProof(raw:OutputManifestRecord):OutputManifestProof{const record=outputManifestRecordSchema.parse(raw);return outputManifestProofSchema.parse({...outputManifestReference(record.manifest),capturedSeq:record.capturedSeq,finishedSeq:record.finishedSeq})}
/** 仅选择已核实的同轮记录；正常根必须存在，唯有覆盖全部冻结要求的原操作证明可解释对应源根缺失。 */
export function selectCompleteOutput(evidence:ReturnType<typeof verifyOutputManifests>,bindings:readonly CompleteOutputBinding[],manifestId:string,context:{workspaceId:string;taskId:string;runId:string;knowledgeRevision:string;progressVersion?:number}):OutputManifestRecord{
  const records=evidence.records.filter(record=>record.manifest.manifestId===manifestId),refs=evidence.refs.filter(ref=>ref.manifestId===manifestId),scopes=preparedArtifactScopes(bindings);
  if(records.length!==1||refs.length!==1||refs[0].invalidated)fail('MANIFEST_REQUIRED','需要明确选择本轮已确认且未失效的完整产物清单');
  const record=outputManifestRecordSchema.parse(records[0]),manifest=record.manifest,proof=completeOutputProof(record);
  if(!scopes.length||!equal(manifest.scopes,scopes)||manifest.binding.workspaceId!==context.workspaceId||manifest.binding.taskId!==context.taskId||manifest.binding.runId!==context.runId||manifest.knowledgeRevision!==context.knowledgeRevision||context.progressVersion!==undefined&&manifest.progressVersion>context.progressVersion||!equal(outputManifestReference(manifest),(({invalidated:_invalidated,...ref})=>ref)(refs[0])))fail('MANIFEST_IDENTITY','完整清单不属于原运行、冻结范围、知识或当前计划');
  const provenSources=(proof.operations??[]).map(item=>item.operation.kind==='delete'?item.operation.path:item.operation.from);
  if(manifest.snapshot.roots.some(root=>root.state==='missing'&&!provenSources.includes(root.relativePath))||!proof.entryCount&&!proof.operations?.length)fail('MANIFEST_OUTPUT_MISSING','完整交付要求的输出根缺失且没有原删除/移动证明，请补齐产物后重新采集');
  return structuredClone(record);
}
/** 当前核实必须返回完整同范围集合且重算哈希匹配；端口自报 matches 不足以放行。 */
export function assertCompleteOutputCurrent(expected:OutputManifestSnapshot,raw:unknown):void{
  if(completeOutputObservation(expected,raw).state!=='matches')fail('MANIFEST_OUTPUT_CHANGED','完整产物集合已变化、缺失或无法核实，请重新读取、采集并验证');
}
/** 负面观察仍可用于拒绝/补证，但错误范围、局部列表或自相矛盾的端口结果不能形成依据。 */
export function completeOutputObservation(expected:OutputManifestSnapshot,raw:unknown):{state:'matches'|'changed'|'unverifiable';observedHash?:string}{
  const parsed=outputManifestCheckSchema.safeParse(raw),expectedHash=outputManifestHash(expected);
  if(!parsed.success||parsed.data.expectedHash!==expectedHash)fail('MANIFEST_OBSERVATION_INVALID','完整产物观察缺少正确的原清单身份');
  const value=parsed.data;
  if(value.state==='unverifiable'){if(value.observed||value.observedHash)fail('MANIFEST_OBSERVATION_INVALID','无法核实的集合不能附带局部成功观察');return {state:value.state}}
  if(!value.observed||!equal(value.observed.scopes,expected.scopes)||value.observedHash!==outputManifestHash(value.observed)||(value.state==='matches')!==(value.observedHash===expectedHash))fail('MANIFEST_OBSERVATION_INVALID','完整产物观察范围或集合指纹不一致');
  return {state:value.state,observedHash:value.observedHash};
}
/** 多候选共用一份有界读取预算，重复清单只由调用方去重，不能把单份限制放大16倍。 */
export function assertCompleteOutputBudget(records:readonly OutputManifestRecord[],files:readonly ArtifactFileFact[]=[]):void{
  const manifests=records.map(record=>record.manifest);
  if(manifests.reduce((sum,item)=>sum+item.snapshot.roots.length,0)>artifactScopeLimits.roots||files.length+manifests.reduce((sum,item)=>sum+item.entryCount,0)>artifactScopeLimits.entries||files.reduce((sum,file)=>sum+file.byteLength,0)+manifests.reduce((sum,item)=>sum+item.byteLength,0)>artifactScopeLimits.totalBytes)fail('MANIFEST_LIMIT','本次完整产物复核超过16根、512条目或32 MiB总预算');
}
