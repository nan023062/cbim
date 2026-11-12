/**
 * 目录归属：backend/scheduler-engine/members；主运行与成员执行管理。
 * 当前证明核实只要求执行知识的只读端口，也供持久等待显式继续使用；历史读取不扩大为恢复许可。
 * 作用定位：核实逐段检查点的完整 canonical、累计文件与最新私有原生历史，分别支持续执行许可与明确放弃旧待办的历史真实性检查。
 * 设计原因：续执行仍须当前知识及全部文件匹配；放弃只核原冻结证明，不能因来源或模型变化阻止结束旧待办，也不能据历史真实性获得新执行许可。
 */
import {isDeepStrictEqual} from 'node:util';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {RunSummary} from '../../core/execution/types';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {TaskNode} from '../../core/tasks/graph-types';
import type {ArtifactFileFact,ArtifactFileCheck} from '../../core/evidence/artifact-baseline';
import {artifactLimits} from '../../core/evidence/artifact-baseline';
import {memberCheckpointProofSchema,memberCheckpointLimit,type MemberCheckpointProof} from '../../core/tasks/member-checkpoint';
import {verifyMemberCheckpoint,validateCheckpointEligibility} from '../../core/tasks/member-checkpoint-evidence';
import {recheckDispatchExecutionContext,type DispatchKnowledgeWorkspace} from '../context/execution-context';
import {memberPublicTask} from '../runtime/member-events';

/** 平台端口只接受已登记运行与纯相对文件事实，不能注入模型返回的路径或哈希。 */
export interface MemberCheckpointVerificationPorts {
  inspect(run:DispatchRun):Promise<RunSummary>;
  normalizePath(raw:string):string;
  checkFiles(files:readonly ArtifactFileFact[],signal:AbortSignal):Promise<ArtifactFileCheck[]>;
  nativeFingerprint(session:DispatchRun['session'],signal:AbortSignal):Promise<MemberCheckpointProof['native']>;
}
/** 历史放弃只读取 canonical；当前 native/知识/模型/业务文件不再决定旧待办能否终止。 */
export type MemberCheckpointHistoryPorts=Pick<MemberCheckpointVerificationPorts,'inspect'|'normalizePath'>;
/** 核整个原运行链的 canonical 及冻结证明；不读取今日文件/native，不签发恢复许可。 */
export async function verifyMemberCheckpointHistory(owner:Pick<KnowledgeWorkspace,'entry'|'assert'>,task:TaskNode,run:DispatchRun,ports:MemberCheckpointHistoryPorts,assertCurrent:()=>void,priorRuns:readonly DispatchRun[]=[]):Promise<void>{
  if(!run.checkpointProof||run.status!=='completed')fail('MEMBER_CHECKPOINT_MISSING','原运行没有已冻结的完成检查点证明');
  await verifyChain(owner,task,run,ports,assertCurrent,memberCheckpointProofSchema.parse(run.checkpointProof),false,priorRuns);
}
/** 最新 native 和全链累计文件均需相同；priorRuns 来自同一可信快照，不从事务内部反向读取 Store。 */
export async function verifyMemberCheckpointProof(owner:DispatchKnowledgeWorkspace,task:TaskNode,run:DispatchRun,ports:MemberCheckpointVerificationPorts,assertCurrent:()=>void,expected?:MemberCheckpointProof,priorRuns:readonly DispatchRun[]=[]):Promise<MemberCheckpointProof>{
  return verifyChain(owner,task,run,ports,assertCurrent,expected,true,priorRuns,{owner,ports});
}
/** 原生加载后只核全链日志/知识/累计文件；不把合法 native 配置追加说成仍等于旧指纹。 */
export async function verifyMemberCheckpointInputs(owner:DispatchKnowledgeWorkspace,task:TaskNode,run:DispatchRun,ports:MemberCheckpointVerificationPorts,assertCurrent:()=>void,expected:MemberCheckpointProof,priorRuns:readonly DispatchRun[]=[]):Promise<void>{
  await verifyChain(owner,task,run,ports,assertCurrent,expected,false,priorRuns,{owner,ports});
}
async function verifyChain(owner:Pick<KnowledgeWorkspace,'entry'|'assert'>,task:TaskNode,run:DispatchRun,ports:MemberCheckpointHistoryPorts,assertCurrent:()=>void,expected:MemberCheckpointProof|undefined,includeNative:boolean,priorRuns:readonly DispatchRun[],current?:{owner:DispatchKnowledgeWorkspace;ports:MemberCheckpointVerificationPorts}):Promise<MemberCheckpointProof>{
  const check=()=>{owner.assert();assertCurrent()};check();
  const index=task.runIds.indexOf(run.binding.runId);
  if(index<0||index>=memberCheckpointLimit)fail('MEMBER_CHECKPOINT_INVALID','检查点不属于有界原运行链');
  if(current){await recheckDispatchExecutionContext(current.owner,run.prepared);check()}
  const segments:Array<{run:DispatchRun;verified:{checkpoint:MemberCheckpointProof['checkpoint'];logHash:string}}>=[],filesByPath=new Map<string,ArtifactFileFact>();
  for(let position=0;position<=index;position++){
    const segment=position===index?run:priorRuns.find(value=>value.binding.runId===task.runIds[position]),proof=position===index?expected:segment?.checkpointProof;
    if(!segment||position<index&&(segment.status!=='completed'||!proof||!isDeepStrictEqual(proof.checkpoint,task.checkpoints?.[position])))fail('MEMBER_CHECKPOINT_INVALID','原检查点链缺少完整的已完成前段');
    const previous=segments.at(-1)?.run,from=previous?{checkpointId:previous.checkpointProof!.checkpoint.checkpointId,runId:previous.binding.runId}:undefined;
    if(!isDeepStrictEqual(segment.resumeFrom,from)||previous&&(!isDeepStrictEqual({...segment.binding,runId:previous.binding.runId,leaseEpoch:previous.binding.leaseEpoch},previous.binding)||segment.binding.leaseEpoch!==previous.binding.leaseEpoch+1||!isDeepStrictEqual(segment.prepared,previous.prepared)||!isDeepStrictEqual(segment.model,previous.model)||segment.permission!==previous.permission||segment.turnTimeoutMs!==previous.turnTimeoutMs||!isDeepStrictEqual(segment.prerequisites??[],previous.prerequisites??[])||!isDeepStrictEqual(segment.session,previous.session)))fail('MEMBER_CHECKPOINT_INVALID','原运行链的身份、权限或来源发生变化');
    const verified=await verifySegment(owner,task,segment,ports,check,proof);check();segments.push({run:segment,verified});
    // 后段重新触及的路径使用其已核实新事实；没有再次触及的早期文件不能从恢复条件中消失。
    for(const file of verified.files)filesByPath.set(ports.normalizePath(file.relativePath),file);
  }
  const signal=AbortSignal.timeout(15_000),expectedFiles=[...filesByPath.values()];
  if(current){
    // 原平台端口仍限制每批16文件/32MiB；全链最多16个这样的原基线，共用一次15秒截止，不把后段文件挤掉早期事实。
    for(let start=0;start<expectedFiles.length;){
      let end=start,bytes=0;while(end<expectedFiles.length&&end-start<artifactLimits.files&&bytes+expectedFiles[end].byteLength<=artifactLimits.totalBytes){bytes+=expectedFiles[end].byteLength;end++}
      if(end===start)fail('MEMBER_CHECKPOINT_INVALID','检查点链文件超过原有界基线');
      const expectedBatch=expectedFiles.slice(start,end),files=await current.ports.checkFiles(expectedBatch,signal);check();signal.throwIfAborted();
      if(files.length!==expectedBatch.length||files.some((file,i)=>file.state!=='matches'||file.relativePath!==expectedBatch[i].relativePath||!isDeepStrictEqual(file.expected,{byteLength:expectedBatch[i].byteLength,sha256:expectedBatch[i].sha256})||!isDeepStrictEqual(file.observed,file.expected)))fail('MEMBER_CHECKPOINT_ARTIFACT_CHANGED','检查点链涉及的文件已变化、缺失或不可核实');
      start=end;
    }
  }
  const native=includeNative?await current!.ports.nativeFingerprint(run.session,signal):expected!.native;check();
  if(includeNative&&expected&&!isDeepStrictEqual(native,expected.native))fail('MEMBER_CHECKPOINT_NATIVE_CHANGED','原生上下文已偏离最新检查点，不能续执行');
  for(const segment of segments){const latest=await ports.inspect(segment.run);check();if(latest.logIntegrity?.partialTail!==false||hash(json(latest.events))!==segment.verified.logHash)fail('MEMBER_CHECKPOINT_CHANGED','复核期间检查点链日志发生变化')}
  if(current){await recheckDispatchExecutionContext(current.owner,run.prepared);check()}
  const latest=segments.at(-1)!.verified;return memberCheckpointProofSchema.parse({checkpoint:latest.checkpoint,logHash:latest.logHash,native});
}
async function verifySegment(owner:Pick<KnowledgeWorkspace,'entry'|'assert'>,task:TaskNode,run:DispatchRun,ports:MemberCheckpointHistoryPorts,check:()=>void,expected?:MemberCheckpointProof){
  const summary=await ports.inspect(run);check();
  const bounds=summary.events.filter(event=>event.type==='session.bound'),first=summary.events[0];
  if(!isDeepStrictEqual(first?.data.memberResume,run.resumeFrom)||summary.status!=='completed'||summary.logIntegrity?.partialTail!==false||summary.unresolvedTools.length||summary.conversationBinding||summary.runId!==run.binding.runId||!isDeepStrictEqual(summary.memberBinding,run.binding)||!isDeepStrictEqual(summary.task,memberPublicTask(task,owner.entry.path))||first?.type!=='run.started'||!isDeepStrictEqual(first.data.memberBinding,run.binding)||!isDeepStrictEqual(first.data.task,summary.task)||!run.session.sessionFile||summary.sessionFile!==run.session.sessionFile||!bounds.length||bounds.some(event=>event.data.sessionId!==run.session.nativeSessionId||event.data.sessionFile!==run.session.sessionFile)||!summary.events.every((event,i)=>event.seq===i+1&&event.workspaceId===run.binding.workspaceId&&event.taskId===run.binding.taskId&&event.runId===run.binding.runId))fail('MEMBER_CHECKPOINT_INVALID','检查点日志身份、终态或原生绑定未通过完整核实');
  if(summary.taskProgress?.goal!==task.goal||!isDeepStrictEqual(summary.taskProgress.acceptance,task.acceptance.map(item=>item.text)))fail('MEMBER_CHECKPOINT_PROGRESS','检查点进度改变了派发目标或验收要求');
  const verified=verifyMemberCheckpoint(summary.events,run.binding,run.prepared.knowledgeRevision,ports.normalizePath);
  if(!verified)fail('MEMBER_CHECKPOINT_MISSING','本段没有已确认检查点请求');
  if(expected&&(!isDeepStrictEqual(verified.checkpoint,expected.checkpoint)||verified.logHash!==expected.logHash))fail('MEMBER_CHECKPOINT_CHANGED','检查点日志与冻结证明不一致');
  const eligible=validateCheckpointEligibility(summary.events.filter(event=>event.seq<verified.checkpoint.requestedSeq),run.binding,run.prepared.knowledgeRevision,ports.normalizePath,verified.checkpoint.input,verified.checkpoint.toolCallId);
  const files=eligible.baseline.baseline.files.map(({sourceToolCallIds:_ids,...file})=>file);
  return {...verified,files};
}
