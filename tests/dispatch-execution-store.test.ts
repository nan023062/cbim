import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {hash} from '../src/core/platform/node/serialization';
import {dispatchKnowledgeFingerprint} from '../src/logic/tasks/rules/execution-context';
import type {PreparedDispatchKnowledge} from '../src/logic/tasks/rules/execution-context';
import type {DispatchRun} from '../src/logic/tasks/rules/dispatch-execution';
import type {DispatchMutation,DispatchState,AssignmentMessage} from '../src/logic/dispatch/rules/dispatch-storage';
import type {AgentInstance,AgentSessionBinding} from '../src/logic/team/rules/agent-types';
import type {AgentRef,GraphEventBatch,GraphIdentity,TaskNode} from '../src/logic/tasks/rules/graph-types';
import {seedExecutionOwner} from './owner-execution-store-support';
import {bindingFor} from './owner-execution-core-fixture';

const identity:GraphIdentity={workspaceId:'workspace-1',rootSessionId:'root-session-1'};
const createdAt='2026-11-06T10:00:00.000Z',startedAt='2026-11-06T10:00:01.000Z',settledAt='2026-11-06T10:00:02.000Z';
const main:AgentRef={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主 Agent'};
const dev:AgentRef={agentId:'.cbim/team/dev',agentInstanceId:'dev-instance',agentSessionId:'dev-session',name:'开发者'};
const member=(ref:AgentRef):AgentInstance=>({workspaceId:identity.workspaceId,teamId:'.cbim/team',agentId:ref.agentId,agentInstanceId:ref.agentInstanceId,leaseEpoch:0,configurationRevision:'knowledge-1',agentSessionIds:[ref.agentSessionId],activity:'idle',waitingTaskIds:[],communicatingMessageIds:[]});
const session=(ref:AgentRef):AgentSessionBinding=>({workspaceId:identity.workspaceId,teamId:'.cbim/team',agentId:ref.agentId,agentInstanceId:ref.agentInstanceId,agentSessionId:ref.agentSessionId,rootSessionId:identity.rootSessionId});
const batch=(commandId:string,seq:number,changes:GraphEventBatch['changes'],cause:GraphEventBatch['cause']='task.dispatched'):GraphEventBatch=>({version:1,identity,streamId:'stream-1',seq,eventId:`event-${seq}`,commandId,cause,committedAt:createdAt,changes});
const task=(state:DispatchState):TaskNode=>({kind:'task',nodeId:'task:task-1',taskId:'task-1',identity,requester:main,assignee:dev,scopeId:'owner-scope',ownerBinding:bindingFor(state),modules:[{moduleId:'.cbim/workspace/game',name:'game',knowledgeRevision:'knowledge-1',maintenanceBindingId:'maintenance-1',maintainerPersonIds:['person-1'],workflow:{kind:'general',id:'cbim:general',version:'1',reason:'无专属流程'}}],goal:'生成网页游戏',acceptance:[{id:'a1',text:'可以在浏览器运行'}],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt,updatedAt:createdAt});
function prepared(state:DispatchState,node=state.graphs[0].tasks[0]):PreparedDispatchKnowledge{
  const member=state.workspaceMembers!.find(member=>member.memberId===node.ownerBinding!.memberId)!;
  const value={version:1 as const,workspaceId:identity.workspaceId,knowledgeRevision:'knowledge-1',agent:structuredClone(member.adoption.configuration),agentDefinition:{name:member.adoption.configuration.name},modules:node.modules.map(binding=>({binding,definition:{id:binding.moduleId},overview:'负责网页游戏',workflowText:'business-execution'})),standards:['business-execution','common-rules'].map(id=>({id,text:id,version:hash(id)})),memberContext:{binding:node.ownerBinding!,name:member.name,position:member.position,adaptation:member.adaptation}};
  return {...value,fingerprint:dispatchKnowledgeFingerprint(value)};
}
function run(state:DispatchState,node=state.graphs[0].tasks[0]):DispatchRun{return {binding:{...identity,teamId:'.cbim/team',agentId:node.assignee.agentId,agentInstanceId:node.assignee.agentInstanceId,agentSessionId:node.assignee.agentSessionId,taskId:node.taskId,runId:'run-1',leaseEpoch:0,planRevision:1},assignmentMessageId:'message-1',status:'starting',prepared:prepared(state,node),model:state.workspaceMembers!.find(member=>member.memberId===node.ownerBinding!.memberId)!.runtimePolicy.snapshot,permission:'ask',session:{nativeSessionId:'native-1'},createdAt}}
const command=(commandId:string)=>({commandId,fingerprint:commandId});
function update(state:DispatchState,commandId:string,nextTask:TaskNode,nextMember:AgentInstance,cause:GraphEventBatch['cause']):DispatchMutation{
  const graph=state.graphs[0],view=graph.agents.find(agent=>agent.agentInstanceId===nextTask.assignee.agentInstanceId)!;
  const {runningTaskId:_,...rest}=view;
  return {members:[nextMember],batch:batch(commandId,graph.cursor.seq+1,[{type:'task.upserted',task:nextTask},{type:'agent.upserted',agent:{...rest,revision:view.revision+1,state:nextMember.activity,waitingTaskIds:[],...(nextTask.status==='running'?{runningTaskId:nextTask.taskId}:{})}}],cause),receipt:{commandId}};
}
function claimMutation(state:DispatchState,commandId='claim'):DispatchMutation{
  const current=state.graphs[0].tasks[0],m=state.members.find(member=>member.agentInstanceId===dev.agentInstanceId)!;
  return {...update(state,commandId,{...current,revision:current.revision+1,runIds:['run-1'],activeRunId:'run-1'},{...m,activity:'communicating',activeTaskId:current.taskId,activeRunId:'run-1'},'message.accepted'),runs:[run(state)],sessions:[{...state.sessions.find(session=>session.agentSessionId===dev.agentSessionId)!,nativeSessionId:'native-1'}],messages:[{...state.outbox[0] as AssignmentMessage,delivery:'claimed',claim:{runId:'run-1',leaseEpoch:0}}]};
}
function runningMutation(state:DispatchState,commandId='running'):DispatchMutation{
  const current=state.graphs[0].tasks[0],m=state.members.find(member=>member.agentInstanceId===dev.agentInstanceId)!;
  return {...update(state,commandId,{...current,revision:current.revision+1,status:'running'},{...m,activity:'working'},'task.started'),runs:[{...state.runs![0],status:'running',startedAt,session:{nativeSessionId:'native-1',sessionFile:'C:/private/native-session.jsonl'}}]};
}
function settleMutation(state:DispatchState,status:DispatchRun['status']='completed',candidate=false,commandId='settle'):DispatchMutation{
  const current=state.graphs[0].tasks[0],m=state.members.find(member=>member.agentInstanceId===dev.agentInstanceId)!;
  const {activeRunId:_,...taskRest}=current,{activeTaskId:__,activeRunId:___,...memberRest}=m;
  const nextTask:TaskNode={...taskRest,revision:current.revision+1,status:status==='completed'?(candidate?'result_ready':'blocked'):status as TaskNode['status'],...(candidate?{result:{resultId:'result-1',runId:'run-1',planRevision:1,summary:'已经创建产物',evidenceRefs:['artifact-1'],limitations:[],acceptance:'not_evaluated' as const}}:{})};
  const mutation=update(state,commandId,nextTask,{...memberRest,activity:'idle',leaseEpoch:m.leaseEpoch+(status==='interrupted'?1:0)},candidate?'task.result_ready':status==='completed'?'task.blocked':`task.${status}` as GraphEventBatch['cause']);
  const assignment=state.outbox[0] as AssignmentMessage;
  return {...mutation,runs:[{...state.runs![0],status,settledAt}],messages:[{...assignment,delivery:'processed'},...(candidate?[{kind:'result' as const,messageId:'result-message-1',commandId,identity,from:dev,to:main,taskId:'task-1',planRevision:1,createdAt:settledAt,delivery:'pending' as const,replyTo:assignment.messageId,resultId:'result-1',runId:'run-1'}]:[])]};
}
async function setup(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-execution-store-')),store=new FileDispatchStore(dir,identity.workspaceId);
  await store.transact(command('root'),async()=>({members:[member(main)],sessions:[session(main)],batch:batch('root',1,[{type:'root.upserted',root:{kind:'session-root',nodeId:`session:${identity.rootSessionId}`,identity,agent:main,revision:1,createdAt}},{type:'agent.upserted',agent:{agentInstanceId:main.agentInstanceId,agentId:main.agentId,name:main.name,revision:1,state:'idle',waitingTaskIds:[]}}],'graph.created'),receipt:'root'}));
  await seedExecutionOwner(store,identity,dev.name,createdAt);
  await store.transact(command('dispatch'),async state=>({members:[{...member(dev),executionScopeId:'owner-scope',executionTaskId:'task-1',lifecycle:'active'}],sessions:[session(dev)],batch:batch('dispatch',2,[{type:'task.upserted',task:task(state)},{type:'edge.upserted',edge:{edgeId:'edge-1',identity,kind:'dispatch',fromNodeId:`session:${identity.rootSessionId}`,toNodeId:'task:task-1',revision:1,enabled:true}},{type:'agent.upserted',agent:{agentInstanceId:dev.agentInstanceId,agentId:dev.agentId,name:dev.name,revision:1,state:'idle',waitingTaskIds:[]}}]),messages:[{kind:'assignment',messageId:'message-1',commandId:'dispatch',identity,from:main,to:dev,taskId:'task-1',planRevision:1,createdAt,delivery:'pending'}],receipt:'dispatch'}));
  return {dir,store,cleanup:async()=>{await store.close();await fs.rm(dir,{recursive:true,force:true})}};
}

test('registered owner claim is atomic, idempotent and does not assert execution started',async()=>{
  const f=await setup();try{
    expect((await f.store.read()).runs).toEqual([]);
    await f.store.transact(command('claim'),async state=>claimMutation(state));
    const claimed=await f.store.read();expect(claimed.graphs[0].tasks[0].status).toBe('queued');expect(claimed.members[1].activity).toBe('communicating');expect(claimed.outbox).toHaveLength(1);expect(claimed.outbox[0].delivery).toBe('claimed');
    await f.store.close();const reopened=new FileDispatchStore(f.dir,identity.workspaceId);
    expect(await reopened.read()).toEqual(claimed);
    expect(await reopened.transact(command('claim'),async()=>{throw Error('no replay')})).toEqual({commandId:'claim'});
    expect((await reopened.read()).runs).toHaveLength(1);await reopened.close();
  }finally{await f.cleanup()}
});

test('real start then candidate commits result reference and reverse message; ack does not invent another run',async()=>{
  const f=await setup();try{
    await f.store.transact(command('claim'),async state=>claimMutation(state));
    await f.store.transact(command('running'),async state=>runningMutation(state));
    expect((await f.store.read()).graphs[0].tasks[0].status).toBe('running');
    await f.store.transact(command('settle'),async state=>settleMutation(state,'completed',true));
    let state=await f.store.read();expect(state.runs![0].status).toBe('completed');expect(state.graphs[0].tasks[0].status).toBe('result_ready');expect(state.members[1].activeRunId).toBeUndefined();expect(state.outbox[0].claim).toEqual({runId:'run-1',leaseEpoch:0});
    const cursor=state.graphs[0].cursor;
    await f.store.transact(command('ack'),async state=>({messages:[{...state.outbox[1],delivery:'processed'}],receipt:'ack'}));
    state=await f.store.read();expect(state.outbox[1].delivery).toBe('processed');expect(state.outbox[1].claim).toBeUndefined();expect(state.runs).toHaveLength(1);expect(state.graphs[0].cursor).toEqual(cursor);
    expect(JSON.stringify(await f.store.snapshot(identity))).not.toContain('sessionFile');
    await f.store.close();const reopened=new FileDispatchStore(f.dir,identity.workspaceId);expect(await reopened.read()).toEqual(state);await reopened.close();
  }finally{await f.cleanup()}
});

test('completed without a candidate is blocked, while startup cancellation and recovery retain honest terminal facts',async()=>{
  for(const status of ['completed','cancelled','failed','interrupted'] as const){const f=await setup();try{
    await f.store.transact(command('claim'),async state=>claimMutation(state));
    if(status==='completed')await f.store.transact(command('running'),async state=>runningMutation(state));
    await f.store.transact(command('settle'),async state=>settleMutation(state,status));
    const state=await f.store.read();expect(state.graphs[0].tasks[0].status).toBe(status==='completed'?'blocked':status);expect(state.outbox).toHaveLength(1);expect(state.outbox[0].delivery).toBe('processed');expect(state.outbox[0].claim).toBeDefined();expect(state.members[1].activeRunId).toBeUndefined();expect(state.members[1].leaseEpoch).toBe(status==='interrupted'?1:0);
    const before=await fs.readFile(path.join(f.dir,'dispatch.jsonl'),'utf8');
    await expect(f.store.transact(command('late'),async state=>runningMutation(state,'late'))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    expect(await fs.readFile(path.join(f.dir,'dispatch.jsonl'),'utf8')).toBe(before);
  }finally{await f.cleanup()}}
});

test('half claims, forged bindings, changed inputs and credentials never enter the journal',async()=>{
  const f=await setup();try{
    const before=await fs.readFile(path.join(f.dir,'dispatch.jsonl'),'utf8');
    const variants:Array<(mutation:DispatchMutation)=>void>=[
      mutation=>{mutation.runs=[]},
      mutation=>{mutation.messages=[]},
      mutation=>{mutation.runs![0].binding.leaseEpoch=1},
      mutation=>{mutation.runs![0].binding.agentSessionId=main.agentSessionId},
      mutation=>{mutation.runs![0].prepared.fingerprint='a'.repeat(64)},
      mutation=>{(mutation.runs![0].model as any).apiKey='must-not-persist'},
      mutation=>{(mutation.sessions![0] as any).sessionFile='private-path'},
    ];
    for(const corrupt of variants)await expect(f.store.transact(command('claim'),async state=>{const mutation=claimMutation(state);corrupt(mutation);return mutation})).rejects.toMatchObject({code:expect.stringMatching(/^(GRAPH_INPUT_INVALID|EXECUTION_CONTEXT_INVALID)$/)});
    expect(await fs.readFile(path.join(f.dir,'dispatch.jsonl'),'utf8')).toBe(before);
    await f.store.transact(command('claim'),async state=>claimMutation(state));
    await expect(f.store.transact(command('running'),async state=>{const mutation=runningMutation(state);mutation.runs![0].permission='execute';return mutation})).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await f.store.transact(command('running'),async state=>runningMutation(state));
    await expect(f.store.transact(command('rebind'),async state=>{const mutation=runningMutation(state,'rebind');mutation.runs![0].session.sessionFile='C:/other-session.jsonl';return mutation})).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
  }finally{await f.cleanup()}
});

test('in-place messages cannot change their envelope, regress delivery, or fabricate results',async()=>{
  const f=await setup();try{
    await expect(f.store.transact(command('rename-message'),async state=>({messages:[{...state.outbox[0],commandId:'rename-message'}],receipt:'bad'}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await f.store.transact(command('claim'),async state=>claimMutation(state));
    await expect(f.store.transact(command('release-claim'),async state=>{const mutation=runningMutation(state,'release-claim');mutation.messages=[{...state.outbox[0],delivery:'pending'}];return mutation})).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await f.store.transact(command('running'),async state=>runningMutation(state));
    await expect(f.store.transact(command('settle'),async state=>{const mutation=settleMutation(state,'completed',true);mutation.messages!.pop();return mutation})).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await expect(f.store.transact(command('settle'),async state=>{const mutation=settleMutation(state,'completed',true);mutation.messages![1].to=dev;return mutation})).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await f.store.transact(command('settle'),async state=>settleMutation(state,'completed',true));
    await expect(f.store.transact(command('fake-claim'),async state=>({messages:[{...state.outbox[1],delivery:'claimed',claim:{runId:'consumer-run',leaseEpoch:0}}],receipt:'bad'}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
  }finally{await f.cleanup()}
});

test('member execution slots and running plans cannot be changed through unrelated transactions',async()=>{
  const f=await setup();try{
    await f.store.transact(command('claim'),async state=>claimMutation(state));
    await expect(f.store.transact(command('evict'),async state=>({members:[{...state.members[1],leaseEpoch:1}],receipt:'bad'}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await expect(f.store.transact(command('false-running'),async state=>{const mutation=runningMutation(state,'false-running');delete mutation.runs;return mutation})).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await f.store.transact(command('running'),async state=>runningMutation(state));
    await expect(f.store.transact(command('new-plan'),async state=>{const current=state.graphs[0].tasks[0];return {...update(state,'new-plan',{...current,revision:current.revision+1,planRevision:2,goal:'替换执行目标'},state.members[1],'task.revised')};})).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
  }finally{await f.cleanup()}
});

test('pending cancellation consumes only the assignment without creating a fake run',async()=>{
  const f=await setup();try{
    await f.store.transact(command('cancel-pending'),async state=>({...update(state,'cancel-pending',{...state.graphs[0].tasks[0],revision:2,status:'cancelled'},state.members[1],'task.cancelled'),messages:[{...state.outbox[0],delivery:'processed'}]}));
    expect((await f.store.read()).runs).toEqual([]);expect((await f.store.read()).outbox[0].delivery).toBe('processed');
  }finally{await f.cleanup()}
});

test('claim freezes exactly the satisfied prerequisite candidate and rejects later input substitution',async()=>{
  const f=await setup();try{
    await f.store.transact(command('claim'),async state=>claimMutation(state));
    await f.store.transact(command('running'),async state=>runningMutation(state));
    await f.store.transact(command('settle'),async state=>settleMutation(state,'completed',true));
    const second={...dev,agentInstanceId:'second-instance',agentSessionId:'second-session'};
    await f.store.transact(command('dispatch-2'),async state=>{
      const nextTask={...task(state),taskId:'task-2',nodeId:'task:task-2',assignee:second},graph=state.graphs[0];
      return {members:[{...member(second),executionScopeId:'owner-scope',executionTaskId:'task-2',lifecycle:'active'}],sessions:[session(second)],batch:batch('dispatch-2',graph.cursor.seq+1,[{type:'task.upserted',task:nextTask},{type:'agent.upserted',agent:{agentInstanceId:second.agentInstanceId,agentId:second.agentId,name:second.name,revision:1,state:'idle',waitingTaskIds:[]}},{type:'edge.upserted',edge:{edgeId:'edge-2',identity,kind:'dispatch',fromNodeId:graph.root.nodeId,toNodeId:nextTask.nodeId,revision:1,enabled:true}},{type:'edge.upserted',edge:{edgeId:'dependency-1',identity,kind:'dependency',fromNodeId:'task:task-1',toNodeId:nextTask.nodeId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1}}}]),messages:[{kind:'assignment',messageId:'message-2',commandId:'dispatch-2',identity,from:main,to:second,taskId:'task-2',planRevision:1,createdAt,delivery:'pending'}],receipt:'dispatch-2'};
    });
    const claimSecond=(state:DispatchState):DispatchMutation=>{
      const current=state.graphs[0].tasks[1],prerequisite=state.graphs[0].tasks[0],m=state.members[2],first=run(state,current);
      const mutation=update(state,'claim-2',{...current,revision:2,runIds:['run-2'],activeRunId:'run-2'},{...m,activity:'communicating',activeTaskId:'task-2',activeRunId:'run-2'},'message.accepted');
      const edge=state.graphs[0].edges.find(edge=>edge.edgeId==='dependency-1')!;
      if(edge.kind!=='dependency')throw Error('dependency missing');
      mutation.batch!.changes.push({type:'edge.upserted',edge:{...edge,revision:2,condition:{...edge.condition,resultId:prerequisite.result!.resultId}}});
      return {...mutation,runs:[{...first,binding:{...first.binding,taskId:'task-2',runId:'run-2'},assignmentMessageId:'message-2',session:{nativeSessionId:'native-2'},prerequisites:[{taskId:prerequisite.taskId,planRevision:1,result:prerequisite.result!}]}],messages:[{...state.outbox.find(message=>message.messageId==='message-2')!,delivery:'claimed',claim:{runId:'run-2',leaseEpoch:0}}]};
    };
    for(const variant of ['missing','wrong-result','extra-field'] as const)await expect(f.store.transact(command('claim-2'),async state=>{const mutation=claimSecond(state);if(variant==='missing')delete mutation.runs![0].prerequisites;else if(variant==='wrong-result')mutation.runs![0].prerequisites![0].result.summary='伪造的前置正文';else (mutation.runs![0].prerequisites![0] as any).private='not-allowed';return mutation})).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await f.store.transact(command('claim-2'),async state=>claimSecond(state));
    const state=await f.store.read(),frozen=state.runs![1].prerequisites;
    expect(frozen).toEqual([{taskId:'task-1',planRevision:1,result:state.graphs[0].tasks[0].result}]);
    await expect(f.store.transact(command('tamper-prerequisite'),async state=>{
      const current=state.graphs[0].tasks[1],record=state.runs![1];
      const mutation=update(state,'tamper-prerequisite',{...current,revision:3,status:'running'},{...state.members[2],activity:'working'},'task.started');
      return {...mutation,runs:[{...record,status:'running',startedAt,prerequisites:[]}]};
    })).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    // Upstream can enter a new plan; the already claimed run keeps the evidence it actually consumed.
    await f.store.transact(command('revise-upstream'),async state=>{
      const current=state.graphs[0].tasks[0],{result:_,...rest}=current;
      return {batch:batch('revise-upstream',state.graphs[0].cursor.seq+1,[{type:'task.upserted',task:{...rest,revision:current.revision+1,planRevision:2,goal:'新的上游目标',status:'blocked'}}],'task.revised'),receipt:'revised'};
    });
    await f.store.transact(command('running-2'),async state=>{
      const current=state.graphs[0].tasks[1],record=state.runs![1];
      return {...update(state,'running-2',{...current,revision:3,status:'running'},{...state.members[2],activity:'working'},'task.started'),runs:[{...record,status:'running',startedAt}]};
    });
    expect((await f.store.read()).runs![1].prerequisites).toEqual(frozen);
  }finally{await f.cleanup()}
});
