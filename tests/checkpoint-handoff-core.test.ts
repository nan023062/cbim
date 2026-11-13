import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {hash} from '../src/core/platform/node/serialization';
import {dispatchKnowledgeFingerprint} from '../src/logic/tasks/rules/execution-context';
import {abandonCheckpointInputSchema,checkpointAbandonmentSchema,abandonCheckpointReceiptSchema} from '../src/logic/tasks/rules/checkpoint-handoff';
import {checkpointAbandonmentSelection} from '../src/logic/tasks/rules/checkpoint-handoff-rules';
import {taskNodeSchema,validateGraph} from '../src/logic/tasks/rules/graph-rules';
import {mainToolOutputSchema} from '../src/logic/tasks/rules/main-tool-output';
import {isProgressEvidence} from '../src/logic/tasks/rules/member-tool-output';
import {checkedJsonToolResult} from '../src/logic/tools/rules/results';
import {toolReceipt} from '../src/logic/tools/rules/receipts';
import type {DispatchState,DispatchMutation} from '../src/logic/dispatch/rules/dispatch-storage';
import type {TaskNode} from '../src/logic/tasks/rules/graph-types';
import type {ScopeActiveInput} from '../src/logic/tasks/rules/scope-active-input';
import {fixture,input,abandon,resume,resumeClaim,checked,mainRunId,later} from './checkpoint-handoff-core-fixture';
import {identity,scopeId,command,memberEvent,ownershipEvent} from './owner-execution-core-fixture';

const task=(m:DispatchMutation)=>{const change=m.batch!.changes.find(v=>v.type==='task.upserted')!;if(change.type!=='task.upserted')throw Error('Task expected');return change.task};
const select=(state:DispatchState,request=input(state))=>checkpointAbandonmentSelection(state,identity,scopeId,mainRunId,request);

it('叶子严格保留图ID域，null预约必须显式；旧图不补处置字段',async()=>{
  const f=await fixture();try{const state=await f.store.read(),i=input(state),node=state.graphs[0].tasks[0];
    expect(abandonCheckpointInputSchema.parse(i)).toEqual(i);expect(abandonCheckpointInputSchema.safeParse({...i,taskId:'_long-'+ 'x'.repeat(200)}).success).toBe(true);
    for(const bad of [{...i,expectedResumeRequestId:undefined},{...i,reason:'  reason '},{...i,ownerMemberId:'forged'},{...i,proof:{logHash:'x'}}])expect(abandonCheckpointInputSchema.safeParse(bad).success).toBe(false);
    expect(taskNodeSchema.parse(node)).toEqual(node);expect(node).not.toHaveProperty('checkpointAbandonment');
  }finally{await f.cleanup()}
});

it.each([false,true])('精确放弃保留原身份/proof/图边，只消费明确预约；原信封迟到ACK和以后关闭仍合法（预约=%s）',async reserved=>{
  const f=await fixture(reserved);try{const before=await f.store.read(),original=before.graphs[0].tasks[0],m=abandon(before),prepare=vi.fn(async()=>m);
    const receipt=await f.store.transact(command('abandon'),prepare);expect(abandonCheckpointReceiptSchema.safeParse(receipt).success).toBe(true);const after=await f.store.read(),node=after.graphs[0].tasks[0],member=after.members.find(v=>v.agentInstanceId===node.assignee.agentInstanceId)!;
    expect(node).toEqual({...original,status:'cancelled',revision:original.revision+1,updatedAt:later,waitReason:input(before).reason,checkpointAbandonment:task(m).checkpointAbandonment});expect(member.leaseEpoch).toBe(before.runs![0].binding.leaseEpoch+1);
    for(const key of ['runs','sessions','scopes','workspaceMembers','moduleOwnerships','sourceCursor'] as const)expect(after[key]).toEqual(before[key]);expect(after.graphs[0].edges).toEqual(before.graphs[0].edges);
    expect(after.outbox.find(v=>v.kind==='checkpoint')).toEqual(before.outbox.find(v=>v.kind==='checkpoint'));expect(after.outbox.filter(v=>v.kind==='assignment').every(v=>v.delivery==='processed')).toBe(true);
    expect(await f.store.transact(command('abandon'),prepare)).toEqual(receipt);expect(prepare).toHaveBeenCalledTimes(1);await expect(f.store.transact({...command('abandon'),fingerprint:'changed'},prepare)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    const checkpoint=after.outbox.find(v=>v.kind==='checkpoint')!;await f.submit('ack',{messages:[{...checkpoint,delivery:'processed'}],receipt:true});expect((await f.store.read()).graphs[0].tasks[0]).toEqual(node);
    await f.submit('close',{scopes:[{...after.scopes![0],status:'closed',closedAt:later,outcome:'cancelled'}],members:[{...member,leaseEpoch:member.leaseEpoch+1,lifecycle:'released',releasedAt:later}],receipt:true});
    const closed=await f.store.read(),bytes=await fs.readFile(f.file);expect(closed.members.find(v=>v.agentInstanceId===member.agentInstanceId)!.leaseEpoch).toBe(node.checkpointAbandonment!.nextLeaseEpoch+1);
    await f.reopen();expect(await f.store.read()).toEqual(closed);expect(await fs.readFile(f.file)).toEqual(bytes);expect((await f.store.commandReceipt('abandon'))?.receipt).toEqual(receipt);
  }finally{await f.cleanup()}
});

it('当前岗位/模型配置/责任已变或主目标进入审阅不阻止终止，原绑定和原来源证明不可迁移',async()=>{
  const f=await fixture();try{let state=await f.store.read();const current=state.workspaceMembers![0];
    const pause=memberEvent(state,{kind:'state',memberId:current.memberId,expectedRevision:current.revision,nextState:'suspended',reason:'停止原岗位'});await f.store.transact(pause.command,async()=>pause.mutation);
    state=await f.store.read();const replacement=memberEvent(state,undefined,{...current.runtimePolicy.snapshot,id:randomUUID(),model:'new-owner-model'});await f.store.transact(replacement.command,async()=>replacement.mutation);
    state=await f.store.read();const owner=ownershipEvent(state,replacement.event.next.memberId);await f.store.transact(owner.command,async()=>owner.mutation);
    state=await f.store.read();expect(select(state).task.ownerBinding!.memberId).toBe(current.memberId);
    // 负面处置不借旧计划授予执行；仅纯选择测试当前知识、审阅及预算事实不会成为终止前置。
    const blocked=structuredClone(state);blocked.scopes![0].goal!.plan!.knowledgeRevision='different-current';blocked.scopes![0].goal!.blocked={reason:'Review required'} as NonNullable<NonNullable<typeof blocked.scopes>[number]['goal']>['blocked'];expect(()=>select(blocked)).not.toThrow();
    const before=state.graphs[0].tasks[0];await f.submit('abandon',abandon(state));const next=(await f.store.read()).graphs[0].tasks[0];expect(next.ownerBinding).toEqual(before.ownerBinding);expect(next.modules).toEqual(before.modules);expect(next.checkpoints).toEqual(before.checkpoints);
  }finally{await f.cleanup()}
});

it('取消状态或伪造审计不能绕过精确mutation，夹带任何未知集合零日志变化',async()=>{
  const f=await fixture(true);try{const before=await f.store.read(),bytes=await fs.readFile(f.file);
    const mutations:Array<(m:DispatchMutation)=>void>=[m=>{delete task(m).checkpointAbandonment},m=>{m.batch!.cause='task.revised'},m=>{m.members![0].leaseEpoch--},m=>{m.members![0].leaseEpoch++},m=>{task(m).goal='changed';task(m).planRevision++},m=>{task(m).ownerBinding=undefined},m=>{m.messages=[]},m=>{m.messages!.push({...before.outbox.find(v=>v.kind==='checkpoint')!,delivery:'processed'})},m=>{m.runs=[]},m=>{m.scopes=[]},m=>{m.sessions=[]},m=>{Object.assign(m,{unknown:true})},m=>{task(m).checkpointAbandonment!.mainRunId='old-main'},m=>{(m.receipt as {taskId:string}).taskId='foreign'},m=>{task(m).checkpointAbandonment!.previousLeaseEpoch++}];
    for(const mutate of mutations){const m=abandon(before);mutate(m);await expect(f.submit('abandon',m)).rejects.toBeDefined();expect(await fs.readFile(f.file)).toEqual(bytes);expect(await f.store.read()).toEqual(before)}
    await f.submit('abandon',abandon(before));const ended=await f.store.read(),node=ended.graphs[0].tasks[0];
    for(const edit of [(t:TaskNode)=>{delete t.checkpointAbandonment},(t:TaskNode)=>{t.status='checkpointed'},(t:TaskNode)=>{t.waitReason='changed'}]){const changed=structuredClone(node);changed.revision++;edit(changed);expect(()=>checked(ended,{batch:{...abandon(before).batch!,seq:ended.graphs[0].cursor.seq+1,commandId:'tamper',eventId:'tamper',changes:[{type:'task.upserted',task:changed}]},receipt:true})).toThrow()}
  }finally{await f.cleanup()}
});

it('图、目标、主运行、预约CAS及活动/已消费/释放/未决来源分别拒绝',async()=>{
  const f=await fixture(true);try{const state=await f.store.read(),i=input(state);
    for(const request of [{...i,expectedRevision:i.expectedRevision+1},{...i,expectedPlanRevision:2},{...i,expectedGoalRevision:3},{...i,expectedGraphCursor:{...i.expectedGraphCursor,seq:0}},{...i,expectedResumeRequestId:null},{...i,checkpointId:'other'}])expect(()=>select(state,request)).toThrow();
    const edits:Array<(s:DispatchState)=>void>=[s=>{s.scopes![0].status='waiting'},s=>{s.scopes![0].status='closed'},s=>{s.scopes![0].runTracking!.mainRunIds.push('new-main')},s=>{s.graphs[0].tasks[0].runIds.push('second')},s=>{s.runs![0].status='failed'},s=>{delete s.runs![0].checkpointProof},s=>{s.runs![0].checkpointProof!.checkpoint.binding.runId='fake'},s=>{s.members.find(v=>v.executionTaskId)!.lifecycle='released'},s=>{s.members.find(v=>v.executionTaskId)!.activeRunId='claim'},s=>{s.sessions.find(v=>v.lastRunId)!.lastRunId='foreign'},s=>{s.outbox.find(v=>v.messageId==='resume-assignment')!.delivery='claimed'},s=>{s.scopes![0].activeInputs=[{status:'unknown'} as ScopeActiveInput]}];
    for(const edit of edits){const changed=structuredClone(state);edit(changed);expect(()=>select(changed,i)).toThrow()}
    expect(()=>validateGraph(state.graphs[0])).not.toThrow();
  }finally{await f.cleanup()}
});

it.each([true,false])('同Store串行裁决领取/放弃：先到者成立，另一动作零追加（放弃先=%s）',async abandonFirst=>{
  const f=await fixture(true);try{const state=await f.store.read();if(abandonFirst){await f.submit('abandon',abandon(state));const bytes=await fs.readFile(f.file);await expect(f.submit('resume-claim',resumeClaim(state))).rejects.toBeDefined();expect(await fs.readFile(f.file)).toEqual(bytes)}
    else{await f.submit('resume-claim',resumeClaim(state));const bytes=await fs.readFile(f.file);await expect(f.submit('abandon',abandon(state))).rejects.toBeDefined();expect(await fs.readFile(f.file)).toEqual(bytes);expect((await f.store.read()).runs).toHaveLength(2)}
  }finally{await f.cleanup()}
});

it('合成旧协议前缀保留缺省岗位，不能新预约但可以明确放弃；新事务不重写旧字节',async()=>{
  const f=await fixture();try{
    // 将领域 fixture 编码为旧格式，只测试协议兼容；真实旧 EXE/canonical 由独立端到端套验证。
    await f.store.close();const records=(await fs.readFile(f.file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));let previousHash='';
    for(const record of records){delete record.body.executionProtocol;for(const change of record.body.mutation.batch?.changes??[])if(change.type==='task.upserted')delete change.task.ownerBinding;
      for(const scope of record.body.mutation.scopes??[])for(const assignment of scope.goal?.plan?.assignments??[]){delete assignment.ownerBinding;delete assignment.ownerSelection}
      for(const run of record.body.mutation.runs??[]){delete run.prepared.memberContext;run.prepared.fingerprint=dispatchKnowledgeFingerprint(run.prepared)}
      record.body.previousHash=previousHash;record.checksum=hash(JSON.stringify(record.body));previousHash=record.checksum;
    }
    await fs.writeFile(f.file,records.map(record=>JSON.stringify(record)+'\n').join(''),'utf8');await f.reopen();const state=await f.store.read(),prefix=await fs.readFile(f.file);
    expect(state.graphs[0].tasks[0]).not.toHaveProperty('ownerBinding');expect(select(state).task.taskId).toBe('task');await expect(f.submit('reserve',resume(state))).rejects.toMatchObject({code:'OWNER_BINDING_REQUIRED'});expect(await fs.readFile(f.file)).toEqual(prefix);
    await f.submit('abandon',abandon(state));expect((await fs.readFile(f.file)).subarray(0,prefix.length)).toEqual(prefix);const ended=await f.store.read();expect(ended.graphs[0].tasks[0]).not.toHaveProperty('ownerBinding');expect(ended.graphs[0].tasks[0].checkpointAbandonment?.kind).toBe('abandoned_by_handoff');await f.reopen();expect(await f.store.read()).toEqual(ended);
  }finally{await f.cleanup()}
});

it('严格主输出核对本次调用及精确原请求，输出失败不重复已提交动作且永不作业务证据',async()=>{
  const f=await fixture();try{const before=await f.store.read(),m=abandon(before),i=input(before),binding={...identity,scopeId,runId:mainRunId},schema=mainToolOutputSchema('cbim_dispatch_abandon_checkpoint',{binding,input:i,expectedCommandId:'abandon'}),execute=vi.fn(async()=>f.submit('abandon',m)),result=await execute();
    expect(schema.safeParse(result).success).toBe(true);expect(checkpointAbandonmentSchema.safeParse(task(m).checkpointAbandonment).success).toBe(true);const bytes=await fs.readFile(f.file);
    for(const bad of [{...(result as object),workspaceId:'foreign'},{...(result as object),commandId:'other'},{...(result as object),status:'completed'},{...(result as object),abandonment:{...task(m).checkpointAbandonment,resumeRequestId:'wrong'}},{...(result as object),extra:true}])expect(()=>checkedJsonToolResult('cbim_dispatch_abandon_checkpoint',bad,schema)).toThrow(expect.objectContaining({code:'TOOL_OUTPUT_INVALID'}));
    expect(execute).toHaveBeenCalledTimes(1);expect(await fs.readFile(f.file)).toEqual(bytes);expect((await f.store.read()).graphs[0].tasks[0].status).toBe('cancelled');
    const receiptIdentity={workspaceId:identity.workspaceId,taskId:'main',runId:mainRunId},receipt=toolReceipt(receiptIdentity,{id:'call',name:'cbim_dispatch_abandon_checkpoint',input:i},{allow:true,effects:['maintenance'],scope:{kind:'workspace',workspaceId:identity.workspaceId}},'succeeded',result);expect(isProgressEvidence(receipt,receiptIdentity)).toBe(false);
  }finally{await f.cleanup()}
});
