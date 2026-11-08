/**
 * 当前证明核实只要求执行知识的只读端口，也供持久等待显式继续使用；历史读取不扩大为恢复许可。
 * 作用定位：核实检查点的 canonical 和私有原生历史，分别支持续执行许可与明确放弃旧待办的历史真实性检查。
 * 设计原因：续执行仍须当前知识及全部文件匹配；放弃只核原冻结证明，不能因来源或模型变化阻止结束旧待办，也不能据历史真实性获得新执行许可。
 */
import {isDeepStrictEqual} from 'node:util';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {RunSummary} from '../../core/brain/types';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {TaskNode} from '../../core/tasks/graph-types';
import type {ArtifactFileFact,ArtifactFileCheck} from '../../core/tasks/artifact-baseline';
import {memberCheckpointProofSchema,type MemberCheckpointProof} from '../../core/tasks/member-checkpoint';
import {verifyMemberCheckpoint,validateCheckpointEligibility} from '../../core/tasks/member-checkpoint-evidence';
import {recheckDispatchExecutionContext,type DispatchKnowledgeWorkspace} from '../context/execution-context';
import {memberPublicTask} from './member-events';

/** 平台端口只接受已登记运行与纯相对文件事实，不能注入模型返回的路径或哈希。 */
export interface MemberCheckpointVerificationPorts {
  inspect(run:DispatchRun):Promise<RunSummary>;
  normalizePath(raw:string):string;
  checkFiles(files:readonly ArtifactFileFact[],signal:AbortSignal):Promise<ArtifactFileCheck[]>;
  nativeFingerprint(session:DispatchRun['session'],signal:AbortSignal):Promise<MemberCheckpointProof['native']>;
}
/** 历史放弃只读取 canonical；当前 native/知识/模型/业务文件不再决定旧待办能否终止。 */
export type MemberCheckpointHistoryPorts=Pick<MemberCheckpointVerificationPorts,'inspect'|'normalizePath'>;
/** 只核原日志及已存 native 证明结构，不重新证明今日文件仍相同、不签发恢复许可；IO 后须 Store CAS。 */
export async function verifyMemberCheckpointHistory(owner:Pick<KnowledgeWorkspace,'entry'|'assert'>,task:TaskNode,run:DispatchRun,ports:MemberCheckpointHistoryPorts,assertCurrent:()=>void):Promise<void>{
  if(!run.checkpointProof||run.status!=='completed')fail('MEMBER_CHECKPOINT_MISSING','原运行没有已冻结的完成检查点证明');
  await verify(owner,task,run,ports,assertCurrent,memberCheckpointProofSchema.parse(run.checkpointProof),false);
}
/** 只读核验，调用者已持有实际业务占用；expected存在时只接受原冻结证明，不能就地刷新过期指纹。 */
export async function verifyMemberCheckpointProof(owner:DispatchKnowledgeWorkspace,task:TaskNode,run:DispatchRun,ports:MemberCheckpointVerificationPorts,assertCurrent:()=>void,expected?:MemberCheckpointProof):Promise<MemberCheckpointProof>{
  return verify(owner,task,run,ports,assertCurrent,expected,true,{owner,ports});
}
/** 原生已加载并应用本轮配置后，只复核尚不能改变的日志/知识/业务文件；不把合法 native 追加伪称仍等于旧指纹。 */
export async function verifyMemberCheckpointInputs(owner:DispatchKnowledgeWorkspace,task:TaskNode,run:DispatchRun,ports:MemberCheckpointVerificationPorts,assertCurrent:()=>void,expected:MemberCheckpointProof):Promise<void>{
  await verify(owner,task,run,ports,assertCurrent,expected,false,{owner,ports});
}
async function verify(owner:Pick<KnowledgeWorkspace,'entry'|'assert'>,task:TaskNode,run:DispatchRun,ports:MemberCheckpointHistoryPorts,assertCurrent:()=>void,expected:MemberCheckpointProof|undefined,includeNative:boolean,current?:{owner:DispatchKnowledgeWorkspace;ports:MemberCheckpointVerificationPorts}):Promise<MemberCheckpointProof>{
  const check=()=>{owner.assert();assertCurrent()};check();
  if(current){await recheckDispatchExecutionContext(current.owner,run.prepared);check()}
  const summary=await ports.inspect(run);check();
  const bounds=summary.events.filter(event=>event.type==='session.bound'),first=summary.events[0];
  if(run.resumeFrom||summary.status!=='completed'||summary.logIntegrity?.partialTail!==false||summary.unresolvedTools.length||summary.conversationBinding||summary.runId!==run.binding.runId||!isDeepStrictEqual(summary.memberBinding,run.binding)||!isDeepStrictEqual(summary.task,memberPublicTask(task,owner.entry.path))||first?.type!=='run.started'||!isDeepStrictEqual(first.data.memberBinding,run.binding)||!isDeepStrictEqual(first.data.task,summary.task)||!run.session.sessionFile||summary.sessionFile!==run.session.sessionFile||!bounds.length||bounds.some(event=>event.data.sessionId!==run.session.nativeSessionId||event.data.sessionFile!==run.session.sessionFile)||!summary.events.every((event,index)=>event.seq===index+1&&event.workspaceId===run.binding.workspaceId&&event.taskId===run.binding.taskId&&event.runId===run.binding.runId))fail('MEMBER_CHECKPOINT_INVALID','检查点日志身份、终态或原生绑定未通过完整核实');
  if(summary.taskProgress?.goal!==task.goal||!isDeepStrictEqual(summary.taskProgress.acceptance,task.acceptance.map(item=>item.text)))fail('MEMBER_CHECKPOINT_PROGRESS','检查点进度改变了派发目标或验收要求，不能续执行');
  const verified=verifyMemberCheckpoint(summary.events,run.binding,run.prepared.knowledgeRevision,ports.normalizePath);
  if(!verified)fail('MEMBER_CHECKPOINT_MISSING','本轮没有已确认检查点请求');
  if(expected&&(!isDeepStrictEqual(verified.checkpoint,expected.checkpoint)||verified.logHash!==expected.logHash))fail('MEMBER_CHECKPOINT_CHANGED','检查点日志与冻结证明不一致');
  // 资格检查只读暂存前的事实；后续回执和终态由上面的完整 verifier 核实。
  const eligible=validateCheckpointEligibility(summary.events.filter(event=>event.seq<verified.checkpoint.requestedSeq),run.binding,run.prepared.knowledgeRevision,ports.normalizePath,verified.checkpoint.input,verified.checkpoint.toolCallId);
  const expectedFiles=eligible.baseline.baseline.files.map(({sourceToolCallIds:_ids,...file})=>file),signal=AbortSignal.timeout(15_000);
  if(current){
    const files=await current.ports.checkFiles(expectedFiles,signal);check();
    if(files.length!==expectedFiles.length||files.some((file,index)=>file.state!=='matches'||file.relativePath!==expectedFiles[index].relativePath||!isDeepStrictEqual(file.expected,{byteLength:expectedFiles[index].byteLength,sha256:expectedFiles[index].sha256})||!isDeepStrictEqual(file.observed,file.expected)))fail('MEMBER_CHECKPOINT_ARTIFACT_CHANGED','检查点涉及的文件已变化、缺失或不可核实');
  }
  const native=includeNative?await current!.ports.nativeFingerprint(run.session,signal):expected!.native;check();
  if(includeNative&&expected&&!isDeepStrictEqual(native,expected.native))fail('MEMBER_CHECKPOINT_NATIVE_CHANGED','原生上下文已偏离检查点，不能续执行');
  const latest=await ports.inspect(run);check();
  if(latest.logIntegrity?.partialTail!==false||hash(json(latest.events))!==verified.logHash)fail('MEMBER_CHECKPOINT_CHANGED','复核期间检查点日志发生变化');
  if(current){await recheckDispatchExecutionContext(current.owner,run.prepared);check()}
  return memberCheckpointProofSchema.parse({...verified,native});
}
