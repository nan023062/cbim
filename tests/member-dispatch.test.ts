import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import type {GraphDelta,GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {OpenGraphReceipt,CreateMemberReceipt,DispatchReceipt} from '../src/backend/core/tasks/dispatch-commands';

async function setup(){
  const f=await fixture();
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),w=f.app.workspace(entry.id),team=await seedTeam(w);
    const snapshot=await w.snapshot();
    const changes=[team.input.moduleId,team.child].map((id,index)=>{
      const definition=JSON.parse(snapshot.files.find(x=>x.path===id+'/module.json')!.text);
      definition.maintenance={bindingId:'maintenance-'+index,maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review-'+index,source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
      return {path:id+'/module.json',text:json(definition)};
    });
    await w.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},...changes]));
    const identity={workspaceId:entry.id,rootSessionId:'main-session'};
    const task={assigneeAgentId:team.input.agentId,moduleIds:[team.input.moduleId,team.child],goal:'完成可验证的模块交付',acceptance:[{id:'verified',text:'给出真实验证证据'}],prerequisites:[]};
    return {...f,entry,w,team,identity,task};
  }catch(error){await f.cleanup();throw error}
}

it('真实应用入口完成成员创建、可靠派发和增量；重开保持身份、游标与幂等回执',async()=>{
  const f=await setup();
  try{
    await expect(f.app.dispatch('dispatch.graphSnapshot',{identity:f.identity})).rejects.toMatchObject({code:'GRAPH_NOT_FOUND'});
    const root=await f.app.dispatch('dispatch.open',{...f.identity,commandId:'open'}) as OpenGraphReceipt;
    const member=await f.app.dispatch('dispatch.memberCreate',{...f.identity,commandId:'member',agentId:f.team.input.agentId}) as CreateMemberReceipt;
    expect(root.cursor.seq).toBe(1);expect(member.cursor.seq).toBe(2);
    expect(member.member).toMatchObject({agentId:f.team.input.agentId,activity:'idle',leaseEpoch:1});
    expect(member.session.agentSessionId).not.toBe(root.agent.agentSessionId);
    const command={...f.identity,commandId:'dispatch-first',expectedParentRevision:1,task:f.task};
    const receipt=await f.app.dispatch('dispatch.task',command) as DispatchReceipt;
    expect(receipt).toMatchObject({disposition:'queued',cursor:{seq:3}});
    const delta=await f.app.dispatch('dispatch.graphDelta',{identity:f.identity,cursor:member.cursor}) as GraphDelta;
    expect(delta.mode).toBe('delta');
    if(delta.mode!=='delta')throw Error('expected delta');
    expect(delta.batches).toHaveLength(1);
    expect(delta.batches[0].changes.map(c=>c.type)).toEqual(['task.upserted','edge.upserted','agent.upserted']);
    const graph=await f.app.dispatch('dispatch.graphSnapshot',{identity:f.identity}) as GraphSnapshot;
    expect(graph.tasks).toHaveLength(1);expect(graph.tasks[0]).toMatchObject({taskId:receipt.taskId,status:'queued',runIds:[],modules:[{moduleId:f.team.input.moduleId,maintainerPersonIds:['owner']},{moduleId:f.team.child}]});
    expect(graph.tasks[0].assignee).toEqual(member.agent);
    expect(await f.app.dispatch('dispatch.graphDelta',{identity:f.identity,cursor:receipt.cursor})).toEqual({mode:'noop',cursor:receipt.cursor});
    const file=path.join(f.user,f.entry.id,'dispatch','dispatch.jsonl');
    const journal=await fs.readFile(file,'utf8');
    const transaction=JSON.parse(journal.trim().split('\n').at(-1)!);
    expect(transaction.body.mutation.messages[0]).toMatchObject({taskId:receipt.taskId,messageId:receipt.messageId,delivery:'pending'});
    expect(await f.app.dispatch('dispatch.task',command)).toEqual(receipt);
    expect(await fs.readFile(file,'utf8')).toBe(journal);
    await f.app.open(f.entry.id,true);
    expect(await f.app.dispatch('dispatch.task',command)).toEqual(receipt);
    expect(await f.app.dispatch('dispatch.graphSnapshot',{identity:f.identity})).toEqual(graph);
    const restored=await f.app.dispatch('dispatch.memberCreate',{...f.identity,commandId:'member-after-restart',agentId:f.team.input.agentId}) as CreateMemberReceipt;
    expect(restored.agent).toEqual(member.agent);
    expect(restored.cursor).toEqual(receipt.cursor);
  }finally{await f.cleanup()}
});

it('并发派发串行提交；不同主会话复用成员但隔离Session与图增量',async()=>{
  const f=await setup();
  try{
    const root=await f.app.dispatch('dispatch.open',{...f.identity,commandId:'open'}) as OpenGraphReceipt;
    const command={...f.identity,expectedParentRevision:1,task:f.task};
    const receipts=await Promise.all(Array.from({length:4},(_,i)=>f.app.dispatch('dispatch.task',{...command,commandId:'dispatch-'+i}))) as DispatchReceipt[];
    expect(receipts.map(r=>r.cursor.seq)).toEqual([2,3,4,5]);
    expect(new Set(receipts.map(r=>r.taskId)).size).toBe(4);
    const delta=await f.app.dispatch('dispatch.graphDelta',{identity:f.identity,cursor:root.cursor,limit:2}) as GraphDelta;
    expect(delta).toMatchObject({mode:'delta',hasMore:true,cursor:{seq:3}});
    const other={...f.identity,rootSessionId:'another-session'};
    await f.app.dispatch('dispatch.open',{...other,commandId:'open-other'});
    const memberA=await f.app.dispatch('dispatch.memberCreate',{...f.identity,commandId:'member-a',agentId:f.team.input.agentId}) as CreateMemberReceipt;
    const memberB=await f.app.dispatch('dispatch.memberCreate',{...other,commandId:'member-b',agentId:f.team.input.agentId}) as CreateMemberReceipt;
    expect(memberA.agent.agentInstanceId).toBe(memberB.agent.agentInstanceId);
    expect(memberA.agent.agentSessionId).not.toBe(memberB.agent.agentSessionId);
    expect(memberB.member.agentSessionIds).toEqual([memberB.agent.agentSessionId]);
    expect((await f.app.dispatch('dispatch.graphSnapshot',{identity:other}) as GraphSnapshot).tasks).toHaveLength(0);
    await expect(f.app.dispatch('dispatch.graphDelta',{identity:other,cursor:receipts[0].cursor})).rejects.toMatchObject({code:'GRAPH_IDENTITY_MISMATCH'});
    const waiting=await f.app.dispatch('dispatch.task',{...command,commandId:'dependent',task:{...f.task,prerequisites:[{taskId:receipts[0].taskId,expectedPlanRevision:1}]}}) as DispatchReceipt;
    expect(waiting.disposition).toBe('waiting');
    const graph=await f.app.dispatch('dispatch.graphSnapshot',{identity:f.identity}) as GraphSnapshot;
    expect(graph.tasks.at(-1)).toMatchObject({status:'waiting',runIds:[]});
    expect(graph.edges.at(-1)).toMatchObject({kind:'dependency',condition:{kind:'result_ready',planRevision:1}});
    expect(graph.agents.find(a=>a.agentId===f.team.input.agentId)?.state).toBe('waiting');
    const stillLocal=await f.app.dispatch('dispatch.memberCreate',{...other,commandId:'local-view',agentId:f.team.input.agentId}) as CreateMemberReceipt;
    expect(stillLocal.member.activity).toBe('idle');expect(stillLocal.member.waitingTaskIds).toEqual([]);
  }finally{await f.cleanup()}
});

it('缺维护关系、伪造身份、命令重用与跨图依赖失败时没有半次派发',async()=>{
  const f=await setup();
  try{
    await f.app.dispatch('dispatch.open',{...f.identity,commandId:'open'});
    const command={...f.identity,commandId:'dispatch-one',expectedParentRevision:1,task:f.task};
    const receipt=await f.app.dispatch('dispatch.task',command);
    const before=await f.app.dispatch('dispatch.graphSnapshot',{identity:f.identity});
    await expect(f.app.dispatch('dispatch.task',{...command,task:{...f.task,goal:'different'}})).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    await expect(f.app.dispatch('dispatch.task',{...command,commandId:'fake',requester:'someone-else'})).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await expect(f.app.dispatch('dispatch.task',{...command,commandId:'old',expectedParentRevision:999})).rejects.toMatchObject({code:'GRAPH_REVISION_CONFLICT'});
    await expect(f.app.dispatch('dispatch.task',{...command,commandId:'foreign',task:{...f.task,prerequisites:[{taskId:'other-task',expectedPlanRevision:1}]}})).rejects.toMatchObject({code:'GRAPH_REFERENCE_INVALID'});
    const snap=await f.w.snapshot(),file=f.team.input.moduleId+'/module.json';
    const definition=JSON.parse(snap.files.find(x=>x.path===file)!.text);delete definition.maintenance;
    await f.w.commit(request(snap,[{path:file,text:json(definition)}]));
    await expect(f.app.dispatch('dispatch.task',{...command,commandId:'missing-maintainer'})).rejects.toMatchObject({code:'MAINTAINER_UNCONFIRMED'});
    expect(await f.app.dispatch('dispatch.task',command)).toEqual(receipt); // 已提交命令不因后来知识变化而重复执行
    expect(await f.app.dispatch('dispatch.graphSnapshot',{identity:f.identity})).toEqual(before);
    const service=f.app.memberDispatch(f.entry.id);await f.app.stop(f.entry.id);
    await expect(service.openGraph({...f.identity,commandId:'closed'})).rejects.toMatchObject({code:'DISPATCH_CLOSED'});
  }finally{await f.cleanup()}
});

it('关闭和重启在排空旧服务前拒绝新建成员服务及执行管理器',async()=>{
  const f=await fixture();
  let release=()=>{};
  try{
    const e=await f.app.dispatch('add',{path:f.a});
    const gate=new Promise<void>(resolve=>{release=resolve});
    const execution=f.app.execution(e.id),close=execution.close.bind(execution);
    const closeSpy=vi.spyOn(execution,'close').mockImplementation(async()=>{await gate;await close()});
    const stopping=f.app.stop(e.id);
    await Promise.resolve();
    expect(()=>f.app.memberDispatch(e.id)).toThrow('工作区正在关闭或重启');
    expect(()=>f.app.execution(e.id)).toThrow('工作区正在关闭或重启');
    release();await stopping;closeSpy.mockRestore();
    await f.app.open(e.id);
    const service=f.app.memberDispatch(e.id);
    let entered!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve});
    const gate2=new Promise<void>(resolve=>{release=resolve});
    const closeService=service.close.bind(service);
    vi.spyOn(service,'close').mockImplementation(async()=>{entered();await gate2;await closeService()});
    const restarting=f.app.open(e.id,true);await started;
    expect(()=>f.app.memberDispatch(e.id)).toThrow('工作区正在关闭或重启');
    expect(()=>f.app.execution(e.id)).toThrow('工作区正在关闭或重启');
    release();await restarting;
    expect(f.app.memberDispatch(e.id)).not.toBe(service);
  }finally{release();await f.cleanup()}
});
