import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {hash} from '../src/backend/core/foundation/serialization';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import type {DispatchState,DispatchMutation,CheckpointMessage,AssignmentMessage} from '../src/backend/core/tasks/dispatch-storage';
import type {GraphEventBatch,TaskNode} from '../src/backend/core/tasks/graph-types';
import type {MemberCheckpointRecord} from '../src/backend/core/tasks/member-checkpoint';
import type {MemberResumeRequest} from '../src/backend/core/tasks/queued-member-resume';
import type {AbandonCheckpointInput,CheckpointAbandonment,AbandonCheckpointReceipt} from '../src/backend/core/tasks/checkpoint-handoff';
import {applyGraphBatch} from '../src/backend/core/tasks/graph-reducer';
import {validateDispatchExecution} from '../src/backend/core/tasks/dispatch-invariants';
import {validateDispatchScopes} from '../src/backend/core/tasks/dispatch-scope-invariants';
import {validateOwnerExecutionMutation} from '../src/backend/core/tasks/owner-execution-invariants';
import {memberEvent,ownershipEvent,bindingFor,ws,identity,scopeId,at,command,rootMutation,taskMutation,initialScope,plannedScope,claimMutation} from './owner-execution-core-fixture';

export const mainRunId='main-run',later='2026-11-08T08:00:02.000Z';
const upsert=<T>(old:T[],updates:T[]|undefined,key:(v:T)=>string)=>{const map=new Map(old.map(v=>[key(v),v]));for(const v of updates??[])map.set(key(v),v);return [...map.values()]};
export function project(state:DispatchState,m:DispatchMutation):DispatchState{return {...state,graphs:state.graphs.map(g=>m.batch&&g.identity.rootSessionId===m.batch.identity.rootSessionId?applyGraphBatch(g,m.batch):g),members:upsert(state.members,m.members,v=>v.agentInstanceId),sessions:upsert(state.sessions,m.sessions,v=>v.agentSessionId),runs:upsert(state.runs??[],m.runs,v=>v.binding.runId),outbox:upsert(state.outbox,m.messages,v=>v.messageId),scopes:upsert(state.scopes??[],m.scopes,v=>v.scopeId)}}
export function checked(state:DispatchState,m:DispatchMutation){const next=project(state,m);validateDispatchExecution(state,next,m,command(m.batch?.commandId??'domain'));validateDispatchScopes(state,next,m);validateOwnerExecutionMutation(state,next,m,'module_owner_v1');return next}
function batch(state:DispatchState,id:string,cause:GraphEventBatch['cause'],changes:GraphEventBatch['changes'],time=at):GraphEventBatch{const g=state.graphs[0];return {version:1,identity:g.identity,streamId:g.cursor.streamId,seq:g.cursor.seq+1,eventId:id,commandId:id,cause,committedAt:time,changes}}
export function input(state:DispatchState):AbandonCheckpointInput{const g=state.graphs[0],t=g.tasks[0];return {expectedGraphCursor:{streamId:g.cursor.streamId,seq:g.cursor.seq},expectedGoalRevision:state.scopes![0].goal!.revision,taskId:t.taskId,expectedRevision:t.revision,expectedPlanRevision:t.planRevision,checkpointId:t.checkpoints![0].checkpointId,expectedResumeRequestId:t.resumeRequest?.requestId??null,reason:'明确结束原待办，另行规划交接'}}
export function abandon(state:DispatchState,id='abandon'):DispatchMutation{
  const i=input(state),t=state.graphs[0].tasks[0],m=state.members.find(m=>m.agentInstanceId===t.assignee.agentInstanceId)!,v=state.graphs[0].agents.find(v=>v.agentInstanceId===m.agentInstanceId)!;
  const record:CheckpointAbandonment={kind:'abandoned_by_handoff',commandId:id,scopeId,mainRunId,graphCursor:i.expectedGraphCursor,goalRevision:i.expectedGoalRevision,previousTaskRevision:t.revision,planRevision:t.planRevision,checkpointId:i.checkpointId,sourceRunId:t.runIds[0],resumeRequestId:i.expectedResumeRequestId,previousLeaseEpoch:m.leaseEpoch,nextLeaseEpoch:m.leaseEpoch+1,reason:i.reason,abandonedAt:later};
  const next:TaskNode={...t,status:'cancelled',revision:t.revision+1,waitReason:i.reason,updatedAt:later,checkpointAbandonment:record};
  const event=batch(state,id,'task.cancelled',[{type:'task.upserted',task:next},{type:'agent.upserted',agent:{...v,revision:v.revision+1}}],later);
  const receipt:AbandonCheckpointReceipt={...identity,scopeId,mainRunId,commandId:id,taskId:t.taskId,status:'cancelled',abandonment:record,graphCursor:{streamId:event.streamId,seq:event.seq}};
  return {batch:event,members:[{...m,leaseEpoch:m.leaseEpoch+1}],...(t.resumeRequest?{messages:[{...state.outbox.find(v=>v.messageId===t.resumeRequest!.requestId)!,delivery:'processed' as const}]}:{}),receipt};
}
export function resume(state:DispatchState):DispatchMutation{
  const t=state.graphs[0].tasks[0],g=state.graphs[0],original=state.outbox.find(v=>v.kind==='assignment')!;
  const request:MemberResumeRequest={requestId:'resume-assignment',commandId:'reserve',scopeId,mainRunId,checkpointId:t.checkpoints![0].checkpointId,runId:t.runIds[0],requestedAt:at,reason:'继续原任务',graphCursor:{streamId:g.cursor.streamId,seq:g.cursor.seq},goalRevision:2,previousTaskRevision:t.revision,trackedTaskIds:[t.taskId]};
  const message:AssignmentMessage={...original,kind:'assignment',messageId:request.requestId,commandId:'reserve',delivery:'pending',claim:undefined,resumeFrom:{checkpointId:request.checkpointId,runId:request.runId}};
  return {batch:batch(state,'reserve','task.resume_requested',[{type:'task.upserted',task:{...t,status:'queued',revision:t.revision+1,updatedAt:at,waitReason:request.reason,resumeRequest:request}}]),messages:[message],receipt:true};
}
export function resumeClaim(state:DispatchState):DispatchMutation{
  const t=state.graphs[0].tasks[0],source=state.runs![0],m=state.members.find(m=>m.agentInstanceId===t.assignee.agentInstanceId)!,v=state.graphs[0].agents.find(v=>v.agentInstanceId===m.agentInstanceId)!,assignment=state.outbox.find(v=>v.messageId===t.resumeRequest!.requestId)!;
  const {checkpointProof:_,startedAt:__,settledAt:___,...old}=source,run={...old,binding:{...source.binding,runId:'resumed',leaseEpoch:m.leaseEpoch+1},status:'starting' as const,assignmentMessageId:assignment.messageId,resumeFrom:{checkpointId:t.checkpoints![0].checkpointId,runId:source.binding.runId}};
  return {batch:batch(state,'resume-claim','message.accepted',[{type:'task.upserted',task:{...t,revision:t.revision+1,activeRunId:'resumed',runIds:[...t.runIds,'resumed'],waitReason:undefined}},{type:'agent.upserted',agent:{...v,revision:v.revision+1,state:'communicating'}}]),members:[{...m,leaseEpoch:m.leaseEpoch+1,activity:'communicating',activeTaskId:t.taskId,activeRunId:'resumed',communicatingMessageIds:[assignment.messageId]}],runs:[run],messages:[{...assignment,delivery:'claimed',claim:{runId:'resumed',leaseEpoch:m.leaseEpoch+1}}],receipt:true};
}
/** 真实 Store 逐条提交登记、派发、领取、结算；合成 proof 只供纯领域状态测试，不冒充真实引擎日志核验。 */
export async function fixture(reserved=false){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-checkpoint-handoff-core-'));let store=new FileDispatchStore(directory,ws);
  const submit=async(id:string,m:DispatchMutation)=>store.transact(command(id),async()=>m);
  const member=memberEvent(await store.read());await store.transact(member.command,async()=>member.mutation);const owner=ownershipEvent(await store.read());await store.transact(owner.command,async()=>owner.mutation);const binding=bindingFor(await store.read());
  await submit('root',rootMutation());await submit('scope',{scopes:[{...initialScope(),runTracking:{version:1,mainRunIds:[mainRunId]}}],receipt:true});await submit('plan',{scopes:[{...plannedScope(binding),runTracking:{version:1,mainRunIds:[mainRunId]}}],receipt:true});await submit('dispatch',taskMutation(binding));
  await submit('claim',claimMutation(await store.read()));let state=await store.read();let t=state.graphs[0].tasks[0],m=state.members.find(v=>v.agentInstanceId===t.assignee.agentInstanceId)!,v=state.graphs[0].agents.find(v=>v.agentInstanceId===m.agentInstanceId)!,run=state.runs![0];
  await submit('start',{batch:batch(state,'start','task.started',[{type:'task.upserted',task:{...t,status:'running',revision:t.revision+1}},{type:'agent.upserted',agent:{...v,state:'working',runningTaskId:t.taskId,revision:v.revision+1}}]),members:[{...m,activity:'working'}],sessions:[{...state.sessions.find(s=>s.agentInstanceId===m.agentInstanceId)!,lastRunId:run.binding.runId,lastTaskId:t.taskId}],runs:[{...run,status:'running',startedAt:at,session:{...run.session,sessionFile:path.join(directory,'native.jsonl')}}],receipt:true});
  state=await store.read();t=state.graphs[0].tasks[0];m=state.members.find(v=>v.agentInstanceId===t.assignee.agentInstanceId)!;v=state.graphs[0].agents.find(v=>v.agentInstanceId===m.agentInstanceId)!;run=state.runs![0];const assignment=state.outbox[0];
  const checkpoint:MemberCheckpointRecord={version:1,checkpointId:'checkpoint',toolCallId:'checkpoint-call',binding:run.binding,input:{expectedTaskProgressVersion:1,baselineId:'baseline',reason:'交回主调度'},knowledgeRevision:run.prepared.knowledgeRevision,requestedAt:at,lastEffectSeq:0,requestedSeq:10,finishedSeq:11,terminalSeq:12};
  const message:CheckpointMessage={...assignment,kind:'checkpoint',messageId:'checkpoint-message',commandId:'park',from:t.assignee,to:t.requester,delivery:'pending',claim:undefined,replyTo:assignment.messageId,checkpointId:checkpoint.checkpointId,runId:run.binding.runId};
  await submit('park',{batch:batch(state,'park','task.checkpointed',[{type:'task.upserted',task:{...t,status:'checkpointed',revision:t.revision+1,activeRunId:undefined,checkpoints:[checkpoint],waitReason:checkpoint.input.reason}},{type:'agent.upserted',agent:{...v,revision:v.revision+1,state:'idle',runningTaskId:undefined,waitingTaskIds:[]}}]),members:[{...m,activity:'idle',activeRunId:undefined,activeTaskId:undefined,waitingTaskIds:[],communicatingMessageIds:[]}],runs:[{...run,status:'completed',settledAt:at,checkpointProof:{checkpoint,logHash:hash('canonical-domain-fixture'),native:{byteLength:10,sha256:hash('native-domain-fixture')}}}],messages:[{...assignment,delivery:'processed'},message],receipt:true});
  if(reserved)await submit('reserve',resume(await store.read()));
  return {directory,file:path.join(directory,'dispatch.jsonl'),get store(){return store},submit,async reopen(){await store.close();store=new FileDispatchStore(directory,ws);return store},async cleanup(){await store.close();if(!path.resolve(directory).startsWith(path.join(os.tmpdir(),'cbim-checkpoint-handoff-core-')))throw Error('Unexpected fixture path');await fs.rm(directory,{recursive:true,force:true})}};
}
