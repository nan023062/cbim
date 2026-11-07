import {afterEach, expect, test, vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {hash} from '../src/backend/core/foundation/serialization';
import type {DispatchMutation,DispatchState} from '../src/backend/core/tasks/dispatch-storage';
import type {AgentInstance, AgentSessionBinding} from '../src/backend/core/team/agent-types';
import type {AgentRef, GraphEventBatch, GraphIdentity, TaskNode} from '../src/backend/core/tasks/graph-types';
import {prepareMember} from '../src/backend/scheduler-engine/execution/agent-manager';
import {seedExecutionOwner} from './owner-execution-store-support';
import {bindingFor} from './owner-execution-core-fixture';

const identity:GraphIdentity={workspaceId:'workspace-1',rootSessionId:'root-session-1'};
const createdAt='2026-11-06T10:00:00.000Z';
const main:AgentRef={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-session',name:'主 Agent'};
const dev:AgentRef={agentId:'.cbim/team/dev',agentInstanceId:'dev-instance',agentSessionId:'dev-session',name:'开发者'};
function member(ref:AgentRef):AgentInstance{return {workspaceId:identity.workspaceId,teamId:'.cbim/team',agentId:ref.agentId,agentInstanceId:ref.agentInstanceId,leaseEpoch:0,configurationRevision:'knowledge-1',agentSessionIds:[ref.agentSessionId],activity:'idle',waitingTaskIds:[],communicatingMessageIds:[]}}
function session(ref:AgentRef):AgentSessionBinding{return {workspaceId:identity.workspaceId,teamId:'.cbim/team',agentId:ref.agentId,agentInstanceId:ref.agentInstanceId,agentSessionId:ref.agentSessionId,rootSessionId:identity.rootSessionId}}
function batch(commandId:string,seq:number,changes:GraphEventBatch['changes']):GraphEventBatch{return {version:1,identity,streamId:'stream-1',seq,eventId:`event-${seq}`,commandId,cause:seq===1?'graph.created':'task.dispatched',committedAt:createdAt,changes}}
function rootMutation():DispatchMutation<{root:string}>{return {
  members:[member(main)],sessions:[session(main)],receipt:{root:identity.rootSessionId},
  batch:batch('create-root',1,[
    {type:'root.upserted',root:{kind:'session-root',nodeId:`session:${identity.rootSessionId}`,identity,agent:main,revision:1,createdAt}},
    {type:'agent.upserted',agent:{agentInstanceId:main.agentInstanceId,agentId:main.agentId,name:main.name,revision:1,state:'idle',waitingTaskIds:[]}}
  ])
}}
function taskMutation(state:DispatchState):DispatchMutation<{taskId:string}>{
  const task:TaskNode={kind:'task',nodeId:'task:task-1',taskId:'task-1',identity,requester:main,assignee:dev,scopeId:'owner-scope',ownerBinding:bindingFor(state),modules:[{moduleId:'.cbim/workspace/game',name:'game',knowledgeRevision:'knowledge-1',maintenanceBindingId:'maintenance-1',maintainerPersonIds:['person-1'],workflow:{kind:'general',id:'cbim:general',version:'1',reason:'无专属流程'}}],goal:'生成网页游戏',acceptance:[{id:'a1',text:'可以在浏览器运行'}],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt,updatedAt:createdAt};
  return {members:[{...member(dev),executionScopeId:task.scopeId,executionTaskId:task.taskId,lifecycle:'active'}],sessions:[session(dev)],receipt:{taskId:task.taskId},
    batch:batch('dispatch-task',2,[
      {type:'task.upserted',task},
      {type:'edge.upserted',edge:{edgeId:'dispatch-edge-1',identity,kind:'dispatch',fromNodeId:`session:${identity.rootSessionId}`,toNodeId:task.nodeId,revision:1,enabled:true}},
      {type:'agent.upserted',agent:{agentInstanceId:dev.agentInstanceId,agentId:dev.agentId,name:dev.name,revision:1,state:'idle',waitingTaskIds:[]}}
    ]),messages:[{kind:'assignment',messageId:'message-1',commandId:'dispatch-task',identity,from:main,to:dev,taskId:task.taskId,planRevision:1,createdAt,delivery:'pending'}]};
}
async function setup(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-dispatch-store-'));const store=new FileDispatchStore(dir,identity.workspaceId);return {dir,store,cleanup:async()=>{await store.close().catch(()=>{});await fs.rm(dir,{recursive:true,force:true})}}}
const commitRoot=(store:FileDispatchStore)=>store.transact({commandId:'create-root',fingerprint:'root-input'},async()=>rootMutation());
afterEach(()=>vi.restoreAllMocks());

test('dispatch commit restores members, independent channels, graph and one pending assignment atomically',async()=>{
  const f=await setup();try{
    await commitRoot(f.store);await seedExecutionOwner(f.store,identity,dev.name,createdAt);const before=(await f.store.snapshot(identity)).cursor;
    await f.store.transact({commandId:'dispatch-task',fingerprint:'task-input'},async state=>taskMutation(state));
    const delta=await f.store.delta(identity,before);
    expect(delta.mode).toBe('delta');if(delta.mode!=='delta')throw Error('missing delta');
    expect(delta.batches).toHaveLength(1);expect(delta.batches[0].changes.map(c=>c.type)).toEqual(['task.upserted','edge.upserted','agent.upserted']);
    const snapshot=await f.store.snapshot(identity);expect(snapshot.tasks[0].status).toBe('queued');expect(snapshot.tasks[0].runIds).toEqual([]);
    const state=await f.store.read();expect(state.members).toHaveLength(2);expect(state.sessions.map(s=>s.agentSessionId)).toEqual(['main-session','dev-session']);expect(state.outbox).toHaveLength(1);
    // 返回值不是存储本身；调用方修改自己的快照不能制造后端状态。
    state.outbox.length=0;snapshot.tasks[0].goal='篡改';
    expect((await f.store.read()).outbox).toHaveLength(1);expect((await f.store.snapshot(identity)).tasks[0].goal).toBe('生成网页游戏');
    const expected=await f.store.snapshot(identity);await f.store.close();const reopened=new FileDispatchStore(f.dir,identity.workspaceId);
    expect(await reopened.snapshot(identity)).toEqual(expected);
    expect((await reopened.read()).outbox[0].delivery).toBe('pending');
    expect(await reopened.delta(identity,delta.cursor)).toEqual({mode:'noop',cursor:delta.cursor});
    await reopened.close();
  }finally{await f.cleanup()}
});

test('idempotent retry runs prepare once, survives reopen and rejects same ID with different fingerprint',async()=>{
  const f=await setup();try{
    let calls=0;const prepare=async()=>{calls++;return rootMutation()};
    const command={commandId:'create-root',fingerprint:'root-input'};
    const receipts=await Promise.all([f.store.transact(command,prepare),f.store.transact(command,prepare)]);
    expect(receipts[0]).toEqual(receipts[1]);expect(calls).toBe(1);
    await expect(f.store.transact({...command,fingerprint:'changed'},prepare)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});expect(calls).toBe(1);
    await f.store.close();const reopened=new FileDispatchStore(f.dir,identity.workspaceId);
    expect(await reopened.transact(command,async()=>{throw Error('cannot run again')})).toEqual(receipts[0]);
    expect((await reopened.snapshot(identity)).cursor.seq).toBe(1);await reopened.close();
  }finally{await f.cleanup()}
});

test('invalid half-dispatch and cross-workspace messages leave graph and WAL unchanged',async()=>{
  const f=await setup();try{
    await commitRoot(f.store);await seedExecutionOwner(f.store,identity,dev.name,createdAt);const file=path.join(f.dir,'dispatch.jsonl');const before=await fs.readFile(file,'utf8');
    await expect(f.store.transact({commandId:'dispatch-task',fingerprint:'task-input'},async state=>({...taskMutation(state),messages:[]}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const foreign=taskMutation(await f.store.read());foreign.messages![0].identity={...identity,workspaceId:'other-workspace'};
    await expect(f.store.transact({commandId:'dispatch-task',fingerprint:'task-input'},async()=>foreign)).rejects.toMatchObject({code:'GRAPH_IDENTITY_MISMATCH'});
    expect(await fs.readFile(file,'utf8')).toBe(before);expect((await f.store.snapshot(identity)).tasks).toEqual([]);
    await expect(f.store.snapshot({...identity,workspaceId:'other-workspace'})).rejects.toMatchObject({code:'GRAPH_IDENTITY_MISMATCH'});
    // Validation failure must not poison a later valid transaction.
    await f.store.transact({commandId:'dispatch-task',fingerprint:'task-input'},async state=>taskMutation(state));
    expect((await f.store.read()).outbox).toHaveLength(1);
  }finally{await f.cleanup()}
});

test('recovery truncates only an incomplete tail; a complete corrupt line fails closed',async()=>{
  const f=await setup();try{
    await commitRoot(f.store);await f.store.close();const file=path.join(f.dir,'dispatch.jsonl');const intact=await fs.readFile(file);
    await fs.appendFile(file,'{"body":');const recovered=new FileDispatchStore(f.dir,identity.workspaceId);
    expect((await recovered.snapshot(identity)).cursor.seq).toBe(1);expect(await fs.readFile(file)).toEqual(intact);await recovered.close();
    await fs.appendFile(file,'{"body":{}}\n');const corrupt=new FileDispatchStore(f.dir,identity.workspaceId);
    await expect(corrupt.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'});
    expect((await fs.readFile(file)).length).toBeGreaterThan(intact.length);await expect(corrupt.close()).resolves.toBeUndefined();
  }finally{await f.cleanup()}
});

test('no-op delta uses memory and a syncing failure closes the write chain until recovery',async()=>{
  const f=await setup();try{
    await commitRoot(f.store);await seedExecutionOwner(f.store,identity,dev.name,createdAt);const cursor=(await f.store.snapshot(identity)).cursor;
    const read=vi.spyOn(fs,'readFile');expect((await f.store.delta(identity,cursor)).mode).toBe('noop');expect(read).not.toHaveBeenCalled();read.mockRestore();
    const originalOpen=fs.open.bind(fs);
    const open=vi.spyOn(fs,'open').mockImplementation(async(...args:any[])=>{
      const file=await (originalOpen as any)(...args);
      if(args[1]!=='a')return file;
      return new Proxy(file,{get(target,key){if(key==='sync')return async()=>{throw Error('simulated fsync failure')};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}});
    });
    await expect(f.store.transact({commandId:'dispatch-task',fingerprint:'task-input'},async state=>taskMutation(state))).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});
    open.mockRestore();
    await expect(f.store.transact({commandId:'next',fingerprint:'next'},async()=>({receipt:'no'}))).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});
    await expect(f.store.snapshot(identity)).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});
    await expect(f.store.close()).resolves.toBeUndefined();
    // The full record may have reached storage even though acknowledgement failed; retry finds it.
    const reopened=new FileDispatchStore(f.dir,identity.workspaceId);
    expect(await reopened.transact({commandId:'dispatch-task',fingerprint:'task-input'},async()=>{throw Error('must not replay')})).toEqual({taskId:'task-1'});
    expect((await reopened.read()).outbox).toHaveLength(1);await reopened.close();
  }finally{await f.cleanup()}
});

test('recovery rejects changed complete records, broken transaction order and foreign workspace ownership',async()=>{
  const f=await setup();try{
    await commitRoot(f.store);await f.store.close();const file=path.join(f.dir,'dispatch.jsonl');const original=await fs.readFile(file,'utf8');
    const modified=JSON.parse(original);modified.body.command.fingerprint='tampered';
    await fs.writeFile(file,JSON.stringify(modified)+'\n');
    const badHash=new FileDispatchStore(f.dir,identity.workspaceId);await expect(badHash.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'});await badHash.close();
    const skipped=JSON.parse(original);skipped.body.transactionSeq=2;skipped.checksum=hash(JSON.stringify(skipped.body));
    await fs.writeFile(file,JSON.stringify(skipped)+'\n');
    const badSequence=new FileDispatchStore(f.dir,identity.workspaceId);await expect(badSequence.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'});await badSequence.close();
    await fs.writeFile(file,original);const foreign=new FileDispatchStore(f.dir,'different-workspace');
    await expect(foreign.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'});await foreign.close();
  }finally{await f.cleanup()}
});

test('close drains already accepted commits and rejects later commands',async()=>{
  const f=await setup();try{
    await commitRoot(f.store);await seedExecutionOwner(f.store,identity,dev.name,createdAt);
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});
    const first=f.store.transact({commandId:'accepted-before-close',fingerprint:'accepted-before-close'},async()=>{await gate;return {receipt:'accepted'}});
    const second=f.store.transact({commandId:'dispatch-task',fingerprint:'task-input'},async state=>taskMutation(state));
    const close=f.store.close();await expect(f.store.transact({commandId:'later',fingerprint:'later'},async()=>({receipt:'no'}))).rejects.toMatchObject({code:'GRAPH_STORE_CLOSED'});
    release();await Promise.all([first,second,close]);
    const reopened=new FileDispatchStore(f.dir,identity.workspaceId);expect((await reopened.read()).outbox).toHaveLength(1);await reopened.close();
  }finally{await f.cleanup()}
});

test('旧共享主实例和无用途任务通道保留原生身份，新根实例隔离；通道用途与实例范围不能改绑',async()=>{
  const f=await setup();try{
    await commitRoot(f.store);
    await f.store.transact({commandId:'legacy-native',fingerprint:'legacy-native'},async state=>({sessions:[{...state.sessions[0],nativeSessionId:'old-native'}],receipt:true}));
    const otherIdentity={...identity,rootSessionId:'legacy-other-root'},otherAgent={...main,agentSessionId:'legacy-other-session'};
    await f.store.transact({commandId:'legacy-other',fingerprint:'legacy-other'},async state=>({
      members:[{...state.members[0],agentSessionIds:[...state.members[0].agentSessionIds,otherAgent.agentSessionId]}],
      sessions:[{...session(otherAgent),rootSessionId:otherIdentity.rootSessionId}],
      batch:{...batch('legacy-other',1,[{type:'root.upserted',root:{kind:'session-root',nodeId:'session:'+otherIdentity.rootSessionId,identity:otherIdentity,agent:otherAgent,revision:1,createdAt}},{type:'agent.upserted',agent:{agentInstanceId:main.agentInstanceId,agentId:main.agentId,name:main.name,revision:1,state:'idle',waitingTaskIds:[]}}]),identity:otherIdentity,streamId:'legacy-other-stream'},receipt:true,
    }));
    const state=await f.store.read(),configuration={workspaceId:identity.workspaceId,teamId:'.cbim/team',agentId:'cbim:main',knowledgeRevision:'knowledge-1',name:'主 Agent',source:'builtin' as const,principles:'',effectiveSkills:[]};
    const old=prepareMember(state,configuration,identity.rootSessionId),conversation=prepareMember(state,configuration,identity.rootSessionId,'conversation');
    expect(prepareMember(state,configuration,otherIdentity.rootSessionId).agent).toEqual(otherAgent);
    expect(old.session).toEqual(state.sessions[0]);expect(old.member.mainRootSessionId).toBeUndefined();
    expect(conversation.member.agentInstanceId).toBe(main.agentInstanceId);
    expect(conversation.session.agentSessionId).not.toBe(main.agentSessionId);
    expect(conversation.session.nativeSessionId).toBeUndefined();
    await f.store.transact({commandId:'conversation',fingerprint:'conversation'},async()=>({members:[conversation.member],sessions:[conversation.session],receipt:true}));
    const newRoot=prepareMember(await f.store.read(),configuration,'new-root');
    expect(newRoot.member.agentInstanceId).not.toBe(main.agentInstanceId);
    expect(newRoot.member.mainRootSessionId).toBe('new-root');
    await f.store.transact({commandId:'new-main',fingerprint:'new-main'},async()=>({members:[newRoot.member],sessions:[newRoot.session],receipt:true}));
    const before=await fs.readFile(path.join(f.dir,'dispatch.jsonl'),'utf8');
    for(const purpose of ['conversation','unknown'])await expect(f.store.transact({commandId:'bad-'+purpose,fingerprint:purpose},async()=>({sessions:[{...old.session,purpose:purpose as any}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await expect(f.store.transact({commandId:'rebind-main',fingerprint:'rebind'},async()=>({members:[{...conversation.member,mainRootSessionId:identity.rootSessionId}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await expect(f.store.transact({commandId:'rebind-new-main',fingerprint:'rebind-new'},async()=>({members:[{...newRoot.member,mainRootSessionId:'other-root'}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const invalidSession={...newRoot.session,agentSessionId:'foreign-session',rootSessionId:identity.rootSessionId};
    await expect(f.store.transact({commandId:'foreign-channel',fingerprint:'foreign'},async()=>({members:[{...newRoot.member,agentSessionIds:[newRoot.session.agentSessionId,invalidSession.agentSessionId]}],sessions:[invalidSession],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    expect(await fs.readFile(path.join(f.dir,'dispatch.jsonl'),'utf8')).toBe(before);
    await f.store.close();const reopened=new FileDispatchStore(f.dir,identity.workspaceId);
    const restored=await reopened.read();expect(restored.members).toHaveLength(2);
    expect(restored.sessions.find(item=>item.agentSessionId===main.agentSessionId)).toEqual(old.session);
    expect((await reopened.snapshot(identity)).root.agent).toEqual(main);await reopened.close();
  }finally{await f.cleanup()}
});

test('同根主实例和自定义角色仍禁止重复，不能借主会话范围创建任意重复成员',async()=>{
  const f=await setup();try{
    await commitRoot(f.store);
    await f.store.transact({commandId:'dev',fingerprint:'dev'},async()=>({members:[member(dev)],sessions:[session(dev)],receipt:true}));
    const duplicate={...member(dev),agentInstanceId:'duplicate-dev',agentSessionIds:['duplicate-session']},channel={...session(dev),agentInstanceId:duplicate.agentInstanceId,agentSessionId:'duplicate-session'};
    for(const candidate of [duplicate,{...duplicate,mainRootSessionId:'another-root'}])await expect(f.store.transact({commandId:'duplicate-dev',fingerprint:'duplicate'},async()=>({members:[candidate],sessions:[channel],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const scoped={...member(main),agentInstanceId:'scoped-main',mainRootSessionId:'new-root',agentSessionIds:['scoped-session']},scopedSession={...session(main),agentInstanceId:scoped.agentInstanceId,agentSessionId:'scoped-session',rootSessionId:'new-root'};
    await f.store.transact({commandId:'scoped',fingerprint:'scoped'},async()=>({members:[scoped],sessions:[scopedSession],receipt:true}));
    await expect(f.store.transact({commandId:'duplicate-main',fingerprint:'duplicate-main'},async()=>({members:[{...scoped,agentInstanceId:'another-main',agentSessionIds:['another-session']}],sessions:[{...scopedSession,agentInstanceId:'another-main',agentSessionId:'another-session'}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
  }finally{await f.cleanup()}
});
