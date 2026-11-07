/**
 * 作用定位：唯一派发 Store 在提交及重放时校验受控文件附录的身份、阶段、回执和容量。
 * 设计原因：每次仅保存一条不可变阶段，不与任务图混写；文件 IO 在 Store 外，终态必须保留已执行事实而不能被停止或今日配置变化抹掉。
 */
import {isDeepStrictEqual as equal} from 'node:util';
import {fail} from '../foundation/errors';
import {controlledFileLimits} from './controlled-file-operation';
import {controlledFileChangeSchema,type ControlledFileChange,type ControlledFileIntent,type ControlledWritePrepared,type FileCompensationPrepared} from './controlled-file-event';
import {controlledFileOperation,controlledFileOperationId,controlledFileOwnerBindingHash,controlledFileRequestFingerprint,controlledFileIntentHash,controlledFileChangeHash,controlledFilePhaseCommand,controlledFilePhaseReceipt,fileCompensationId,fileCompensationRequestFingerprint,fileCompensationRevision,fileCompensationBasis} from './controlled-file-rules';
import type {DispatchState,DispatchMutation,DispatchCommand} from './dispatch-storage';

function check(value:unknown,message:string):asserts value{if(!value)fail('CONTROLLED_FILE_AUDIT',message)}
const sameFact=(a:{byteLength:number;sha256:string},b:{byteLength:number;sha256:string})=>a.byteLength===b.byteLength&&a.sha256===b.sha256;
const workspace=(i:ControlledFileIntent)=>i.kind==='member_write'?i.origin.binding.workspaceId:i.request.workspaceId;
const root=(i:ControlledFileIntent)=>i.kind==='member_write'?i.origin.binding.rootSessionId:i.request.rootSessionId;
/** 新内容写准入只针对真实在途正式成员；不靠公开 taskId 或模型自报授权补出执行身份。 */
function liveMember(state:DispatchState,intent:ControlledWritePrepared):void{
  const {origin}=intent,b=origin.binding,scope=state.scopes?.find(s=>s.scopeId===origin.scopeId&&s.workspaceId===b.workspaceId&&s.rootSessionId===b.rootSessionId);
  const graph=state.graphs.find(g=>g.identity.workspaceId===b.workspaceId&&g.identity.rootSessionId===b.rootSessionId),task=graph?.tasks.find(t=>t.taskId===b.taskId),run=state.runs?.find(r=>r.binding.runId===b.runId);
  const member=state.members.find(m=>m.agentInstanceId===b.agentInstanceId),session=state.sessions.find(s=>s.agentSessionId===b.agentSessionId);
  check(scope?.status==='active'&&!scope.recovery,'业务写必须属于当前非只读周期');
  check(task&&task.scopeId===scope.scopeId&&task.ownerBinding&&task.activeRunId===b.runId&&task.planRevision===b.planRevision&&task.runIds.includes(b.runId)&&task.assignee.agentId===b.agentId&&task.assignee.agentInstanceId===b.agentInstanceId&&task.assignee.agentSessionId===b.agentSessionId,'业务写缺少原任务及岗位绑定');
  check(run?.status==='running'&&equal(run.binding,b)&&run.prepared.memberContext&&equal(run.prepared.memberContext.binding,task.ownerBinding),'业务写缺少可靠在途成员领取');
  check(origin.permission===run.permission&&origin.knowledgeRevision===run.prepared.knowledgeRevision&&origin.ownerBindingHash===controlledFileOwnerBindingHash(task.ownerBinding),'业务写权限、知识或岗位指纹不符');
  check(member?.workspaceId===b.workspaceId&&member.agentId===b.agentId&&member.teamId===b.teamId&&member.activeRunId===b.runId&&member.activeTaskId===b.taskId&&member.leaseEpoch===b.leaseEpoch&&member.lifecycle==='active'&&member.executionScopeId===scope.scopeId&&member.executionTaskId===b.taskId,'业务写成员租约已失效');
  check(session?.workspaceId===b.workspaceId&&session.rootSessionId===b.rootSessionId&&session.agentInstanceId===b.agentInstanceId&&session.agentId===b.agentId&&session.teamId===b.teamId&&(session.purpose??'task')==='task'&&b.agentId!=='cbim:main','业务写通道或主成员边界不符');
}
function validateWrite(state:DispatchState,i:ControlledWritePrepared):void{
  check(i.operationId===controlledFileOperationId(i.origin.binding,i.origin.toolCallId)&&i.requestFingerprint===controlledFileRequestFingerprint(i.origin,i.request),'原操作身份或请求指纹不一致');
  check(i.before.role==='before'&&i.intendedAfter.role==='intended_after'&&i.before.blobId!==i.intendedAfter.blobId&&i.before.createdForOperationId===i.operationId&&i.intendedAfter.createdForOperationId===i.operationId&&sameFact(i.before,i.request.expectedBefore)&&sameFact(i.intendedAfter,i.request.after),'原写备份引用、角色或字节摘要不一致');
  const prior=(state.controlledFileChanges??[]).flatMap(c=>c.phase==='prepared'&&c.intent.kind==='member_write'?[c.intent]:[]);
  check(!prior.some(p=>p.origin.binding.runId===i.origin.binding.runId&&p.origin.allowedSeq===i.origin.allowedSeq),'同一授权事件不能用于另一个受控调用');
  check(!prior.some(p=>[p.before.blobId,p.intendedAfter.blobId].some(id=>id===i.before.blobId||id===i.intendedAfter.blobId)),'新原写不能改绑已经保存的备份引用');
  liveMember(state,i);
}
function validateCompensation(state:DispatchState,i:FileCompensationPrepared):void{
  const original=controlledFileOperation(state,i.original.operationId);
  check(original?.intent.kind==='member_write'&&original.change.phase==='applied','补偿必须引用原可靠 applied 成员写入');
  const old=original.intent,b=old.origin.binding,scope=state.scopes?.find(s=>s.scopeId===old.origin.scopeId&&s.workspaceId===b.workspaceId&&s.rootSessionId===b.rootSessionId),run=state.runs?.find(r=>r.binding.runId===b.runId);
  check(i.operationId===fileCompensationId(i.request)&&i.requestFingerprint===fileCompensationRequestFingerprint(i.request,i.actor)&&i.actor.instanceId===i.request.instanceId,'补偿命令、指纹或本机身份不一致');
  check(i.request.workspaceId===b.workspaceId&&i.request.rootSessionId===b.rootSessionId&&i.request.operationId===old.operationId&&i.original.intentHash===controlledFileIntentHash(old)&&i.original.appliedEventHash===controlledFileChangeHash(original.change)&&i.original.appliedRevision===original.revision&&i.request.expectedOperationRevision===original.revision,'补偿与原来源及 applied 依据不一致');
  check(i.preparedAt>=original.updatedAt,'补偿意图不能早于原 applied 事实');
  check(scope?.status==='closed'&&run&&equal(run.binding,b)&&!['starting','running'].includes(run.status)&&!state.members.some(m=>m.activeRunId===b.runId),'原周期或运行仍在途，不得补偿');
  check(i.request.expectedCompensationRevision===fileCompensationRevision(state,old.operationId)&&i.compensationRevision===i.request.expectedCompensationRevision+1,'补偿版本已变化');
  const prior=(state.controlledFileChanges??[]).filter(c=>c.phase==='prepared'&&c.intent.kind==='desktop_compensation'&&c.intent.original.operationId===old.operationId);
  check(prior.every(c=>controlledFileOperation(state,c.operationId)?.phase==='not_applied'),'已有成功或未决补偿，不得创建第二次恢复');
  check(equal(i.fileIdentity,old.fileIdentity)&&sameFact(i.observedBefore,old.intendedAfter)&&equal(i.before,old.intendedAfter)&&equal(i.intendedAfter,old.before)&&i.relativePath===old.request.relativePath,'补偿不得改变原路径、文件身份或备份引用');
  check(i.previewBasis===i.request.expectedBasis&&i.previewBasis===fileCompensationBasis({original,compensationRevision:i.request.expectedCompensationRevision,fileIdentity:i.fileIdentity,observedBefore:i.observedBefore}),'补偿预览依据与原事实不一致');
}
function capacity(changes:ControlledFileChange[],intent:ControlledFileIntent):void{
  const prepared=changes.filter(c=>c.phase==='prepared');
  if(prepared.length>controlledFileLimits.operations||prepared.filter(c=>root(c.intent)===root(intent)).length>controlledFileLimits.operationsPerRoot||intent.kind==='member_write'&&prepared.filter(c=>c.intent.kind==='member_write'&&c.intent.origin.binding.runId===intent.origin.binding.runId).length>controlledFileLimits.writesPerRun||intent.kind==='desktop_compensation'&&prepared.filter(c=>c.intent.kind==='desktop_compensation'&&c.intent.original.operationId===intent.original.operationId).length>controlledFileLimits.compensations)fail('CONTROLLED_FILE_LIMIT','受控操作历史达到保存上限，原记录不会被淘汰');
  // 为每条未结算链预留后续最大阶段空间；达到容量也不能留下无法保存终态的许可。
  const reserve=prepared.reduce((sum,c)=>{const operation=controlledFileOperation({controlledFileChanges:changes},c.operationId)!;return sum+(operation.phase==='prepared'?2:operation.phase==='executing'?1:0)*controlledFileLimits.terminalReserveBytes},0);
  if(new TextEncoder().encode(JSON.stringify(changes)).length+reserve>controlledFileLimits.storedBytes)fail('CONTROLLED_FILE_LIMIT','受控操作附录无法同时容纳新意图及终态预留空间');
}
/** 无记录保留旧缺省；新阶段仅接受精确的一条附录和其原回执，禁止夹带任何领域变更。 */
export function projectControlledFileMutation(previous:DispatchState,mutation:DispatchMutation,command:DispatchCommand):Pick<DispatchState,'controlledFileChanges'>{
  if(mutation.controlledFileChanges===undefined){check(!command.commandId.startsWith('controlled-file:'),'受控文件命令缺少阶段事件');return previous.controlledFileChanges===undefined?{}:{controlledFileChanges:previous.controlledFileChanges}}
  check(Array.isArray(mutation.controlledFileChanges)&&mutation.controlledFileChanges.length===1&&Object.keys(mutation).every(k=>k==='controlledFileChanges'||k==='receipt'),'文件阶段必须单条追加，不得混入其它变化');
  const change=mutation.controlledFileChanges[0],parsed=controlledFileChangeSchema.safeParse(change);check(parsed.success&&equal(parsed.data,change),'受控文件事件结构无效或需要转换');
  check(equal(command,controlledFilePhaseCommand(change))&&equal(mutation.receipt,controlledFilePhaseReceipt(change)),'阶段命令或回执与原事件不一致');
  const records=previous.controlledFileChanges??[],old=controlledFileOperation(previous,change.operationId);
  if(change.phase==='prepared'){
    check(!old&&change.intent.operationId===change.operationId&&workspace(change.intent)===previous.workspaceId&&change.intent.preparedAt===change.recordedAt,'prepared 身份重复、跨工作区或时间不符');
    if(change.intent.kind==='member_write')validateWrite(previous,change.intent);else validateCompensation(previous,change.intent);
  }else{
    check(old&&['prepared','executing'].includes(old.phase)&&change.previousRevision===old.revision&&change.revision===old.revision+1&&change.intentHash===controlledFileIntentHash(old.intent)&&change.recordedAt>=old.updatedAt,'阶段前缀、版本、指纹或时间不一致');
    check(change.phase==='not_applied'||(old.phase==='prepared'?change.phase==='executing':change.phase==='applied'||change.phase==='unknown'),'不能越过执行阶段或改写终态');
    if(change.phase==='executing'){
      if(old.intent.kind==='member_write')liveMember(previous,old.intent);
      // 本次 prepared 已占补偿编号；复核其它前置时排除自身，不把自己的意图误判为另一条未决恢复。
      else validateCompensation({...previous,controlledFileChanges:records.filter(c=>c.operationId!==change.operationId)},old.intent);
    }
    if(change.phase==='applied')check(equal(change.fileIdentity,old.intent.fileIdentity)&&sameFact(change.observedAfter,old.intent.intendedAfter),'applied 文件身份或实读字节不符');
  }
  const next=[...records,structuredClone(change)];capacity(next,change.phase==='prepared'?change.intent:old!.intent);return {controlledFileChanges:next};
}
