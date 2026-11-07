/**
 * 作用定位：在成员真实关闭之后及续执行领取之前复核同一检查点的 canonical、文件和私有原生历史。
 * 设计原因：运行时请求不能签发可恢复状态；调度复核完整绑定、知识、全部受限文件和前后日志，复用同一校验避免预约与实际领取强度不同。
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
import {recheckDispatchExecutionContext} from '../context/execution-context';
import {memberPublicTask} from './member-events';

/** 平台端口只接受已登记运行与纯相对文件事实，不能注入模型返回的路径或哈希。 */
export interface MemberCheckpointVerificationPorts {
  inspect(run:DispatchRun):Promise<RunSummary>;
  normalizePath(raw:string):string;
  checkFiles(files:readonly ArtifactFileFact[],signal:AbortSignal):Promise<ArtifactFileCheck[]>;
  nativeFingerprint(session:DispatchRun['session'],signal:AbortSignal):Promise<MemberCheckpointProof['native']>;
}
/** 只读核验，调用者已持有实际业务占用；expected存在时只接受原冻结证明，不能就地刷新过期指纹。 */
export async function verifyMemberCheckpointProof(owner:KnowledgeWorkspace,task:TaskNode,run:DispatchRun,ports:MemberCheckpointVerificationPorts,assertCurrent:()=>void,expected?:MemberCheckpointProof):Promise<MemberCheckpointProof>{
  return verify(owner,task,run,ports,assertCurrent,expected,true);
}
/** 原生已加载并应用本轮配置后，只复核尚不能改变的日志/知识/业务文件；不把合法 native 追加伪称仍等于旧指纹。 */
export async function verifyMemberCheckpointInputs(owner:KnowledgeWorkspace,task:TaskNode,run:DispatchRun,ports:MemberCheckpointVerificationPorts,assertCurrent:()=>void,expected:MemberCheckpointProof):Promise<void>{
  await verify(owner,task,run,ports,assertCurrent,expected,false);
}
async function verify(owner:KnowledgeWorkspace,task:TaskNode,run:DispatchRun,ports:MemberCheckpointVerificationPorts,assertCurrent:()=>void,expected:MemberCheckpointProof|undefined,includeNative:boolean):Promise<MemberCheckpointProof>{
  const check=()=>{owner.assert();assertCurrent()};check();
  await recheckDispatchExecutionContext(owner,run.prepared);check();
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
  const files=await ports.checkFiles(expectedFiles,signal);check();
  if(files.length!==expectedFiles.length||files.some((file,index)=>file.state!=='matches'||file.relativePath!==expectedFiles[index].relativePath||!isDeepStrictEqual(file.expected,{byteLength:expectedFiles[index].byteLength,sha256:expectedFiles[index].sha256})||!isDeepStrictEqual(file.observed,file.expected)))fail('MEMBER_CHECKPOINT_ARTIFACT_CHANGED','检查点涉及的文件已变化、缺失或不可核实');
  const native=includeNative?await ports.nativeFingerprint(run.session,signal):expected!.native;check();
  if(includeNative&&expected&&!isDeepStrictEqual(native,expected.native))fail('MEMBER_CHECKPOINT_NATIVE_CHANGED','原生上下文已偏离检查点，不能续执行');
  const latest=await ports.inspect(run);check();
  if(latest.logIntegrity?.partialTail!==false||hash(json(latest.events))!==verified.logHash)fail('MEMBER_CHECKPOINT_CHANGED','复核期间检查点日志发生变化');
  await recheckDispatchExecutionContext(owner,run.prepared);check();
  return memberCheckpointProofSchema.parse({...verified,native});
}
