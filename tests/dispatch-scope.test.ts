import {expect,it} from 'vitest';
import path from 'node:path';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';

async function setup(){
  const f=await fixture();
  const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json';
  const definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
  const directory=path.join(f.user,'scope-fixture'),store=new FileDispatchStore(directory,entry.id),service=new WorkspaceDispatchService(workspace,store);
  const identity={workspaceId:entry.id,rootSessionId:'root-one'};
  const input=(commandId:string,agentId='cbim:executor',rootSessionId=identity.rootSessionId)=>({...identity,rootSessionId,commandId,expectedParentRevision:1,task:{assigneeAgentId:agentId,moduleIds:[team.input.moduleId],goal:'验证模块行为',acceptance:[{id:'evidence',text:'提交验证证据'}],prerequisites:[]}});
  return {...f,entry,workspace,team,directory,store,service,identity,input,cleanup:async()=>{await store.close();await f.cleanup()}};
}

it('同一用户周期幂等复用，主会话周期互斥；不同主会话隔离且关闭不可重开',async()=>{
  const f=await setup();try{
    const [first,same]=await Promise.all([f.service.openScope(f.identity,'scope-one'),f.service.openScope(f.identity,'scope-one')]);
    expect(same).toEqual(first);
    const root=(await f.service.snapshot(f.identity)).root;
    await expect(f.service.openScope(f.identity,'scope-competing')).rejects.toMatchObject({code:'DISPATCH_SCOPE_BUSY'});
    const other={...f.identity,rootSessionId:'root-two'};
    await f.service.openScope(other,'scope-two');
    expect((await f.service.snapshot(other)).root.agent.agentInstanceId).not.toBe(root.agent.agentInstanceId);
    await expect(f.service.dispatchTask(f.input('wrong-root','cbim:executor','root-two'),'scope-one')).rejects.toMatchObject({code:'DISPATCH_SCOPE_IDENTITY'});
    const closed=await f.service.closeScope(f.identity,'scope-one','completed');
    expect(await f.service.closeScope(f.identity,'scope-one','cancelled')).toEqual(closed);
    await expect(f.service.openScope(f.identity,'scope-one')).rejects.toMatchObject({code:'DISPATCH_SCOPE_CLOSED'});
    await f.service.openScope(f.identity,'scope-next');
    expect((await f.service.snapshot(f.identity)).root).toEqual(root);
    expect((await f.store.read()).scopes?.filter(item=>item.status==='active').map(item=>item.scopeId).sort()).toEqual(['scope-next','scope-two']);
  }finally{await f.cleanup()}
});

it('每个派发任务创建独立执行实例，关闭原子取消未执行任务并释放实例；历史可重放',async()=>{
  const f=await setup();try{
    await f.service.openScope(f.identity,'scope-one');
    const root=(await f.service.snapshot(f.identity)).root;
    const first=await f.service.dispatchTask(f.input('dispatch-one'),'scope-one');
    expect(await f.service.dispatchTask(f.input('dispatch-one'),'scope-one')).toEqual(first);
    const second=await f.service.dispatchTask(f.input('dispatch-two'),'scope-one');
    const graph=await f.service.snapshot(f.identity);
    expect(graph.tasks).toHaveLength(2);
    expect(new Set(graph.tasks.map(task=>task.assignee.agentInstanceId)).size).toBe(2);
    expect(graph.tasks.every(task=>task.assignee.agentInstanceId!==root.agent.agentInstanceId&&task.scopeId==='scope-one')).toBe(true);
    await expect(f.service.dispatchTask({...f.input('untrusted-scope'),scopeId:'scope-one'})).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await expect(f.service.dispatchTask(f.input('main-forbidden','cbim:main'),'scope-one')).rejects.toMatchObject({code:'AGENT_NOT_EXECUTABLE'});
    await f.service.closeScope(f.identity,'scope-one','cancelled');
    const state=await f.store.read(),closed=await f.service.snapshot(f.identity);
    expect(closed.tasks.map(task=>task.taskId)).toEqual([first.taskId,second.taskId]);
    expect(closed.tasks.every(task=>task.status==='cancelled')).toBe(true);
    expect(closed.root).toEqual(root);
    expect(state.members.filter(member=>member.executionScopeId==='scope-one')).toHaveLength(2);
    expect(state.members.filter(member=>member.executionScopeId==='scope-one').every(member=>member.lifecycle==='released'&&member.activity==='idle'&&!member.activeRunId)).toBe(true);
    expect(state.members.find(member=>member.agentInstanceId===root.agent.agentInstanceId)?.lifecycle).toBeUndefined();
    expect(state.outbox.every(message=>message.delivery==='processed')).toBe(true);
    const delta=await f.service.delta(f.identity,graph.cursor);expect(delta.mode).toBe('delta');if(delta.mode==='delta')expect(delta.batches[0].changes.filter(change=>change.type==='agent.upserted')).toHaveLength(2);
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reader.read()).toEqual(state)}finally{await reader.close()}
    await expect(f.service.dispatchTask(f.input('late-task'),'scope-one')).rejects.toMatchObject({code:'DISPATCH_SCOPE_CLOSED'});
    await f.service.openScope(f.identity,'scope-next');
    const next=await f.service.dispatchTask(f.input('new-cycle'),'scope-next');
    expect((await f.service.snapshot(f.identity)).tasks.find(task=>task.taskId===next.taskId)?.assignee.agentInstanceId).not.toBe(graph.tasks[0].assignee.agentInstanceId);
  }finally{await f.cleanup()}
});

it('存储拒绝半次周期关闭、提前释放及关闭后的实例复活和任务重写',async()=>{
  const f=await setup();try{
    await f.service.openScope(f.identity,'scope-one');await f.service.dispatchTask(f.input('dispatch-one'),'scope-one');
    const state=await f.store.read(),member=state.members.find(item=>item.executionScopeId==='scope-one')!,scope=state.scopes![0];
    await expect(f.store.transact({commandId:'partial-close',fingerprint:'partial-close'},async()=>({scopes:[{...scope,status:'closed',closedAt:new Date().toISOString(),outcome:'cancelled'}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await expect(f.store.transact({commandId:'early-release',fingerprint:'early-release'},async()=>({members:[{...member,lifecycle:'released',releasedAt:new Date().toISOString()}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    expect(await f.store.read()).toEqual(state);
    await f.service.closeScope(f.identity,'scope-one','cancelled');
    const closed=await f.store.read(),released=closed.members.find(item=>item.agentInstanceId===member.agentInstanceId)!;
    await expect(f.store.transact({commandId:'revive',fingerprint:'revive'},async()=>({members:[{...released,lifecycle:'active',releasedAt:undefined}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const session=closed.sessions.find(item=>item.agentInstanceId===released.agentInstanceId)!;
    await expect(f.store.transact({commandId:'late-native',fingerprint:'late-native'},async()=>({sessions:[{...session,nativeSessionId:'late-native'}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const graph=closed.graphs[0],task=graph.tasks[0];
    await expect(f.store.transact({commandId:'rewrite-task',fingerprint:'rewrite-task'},async()=>({batch:{version:1,identity:f.identity,streamId:graph.cursor.streamId,seq:graph.cursor.seq+1,eventId:'rewrite-task-event',commandId:'rewrite-task',cause:'task.revised',committedAt:new Date().toISOString(),changes:[{type:'task.upserted',task:{...task,revision:task.revision+1,updatedAt:new Date().toISOString(),waitReason:'迟到回调修改'}}]},receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    expect(await f.store.read()).toEqual(closed);
  }finally{await f.cleanup()}
});

it('恢复将未关闭周期标记 interrupted 并释放执行实例，不启动任务或改变既有关闭结果',async()=>{
  const f=await setup();try{
    await f.service.openScope(f.identity,'already-done');await f.service.closeScope(f.identity,'already-done','completed');
    await f.service.openScope(f.identity,'unfinished');await f.service.dispatchTask(f.input('unstarted'),'unfinished');
    await f.service.recoverScopes();await f.service.recoverScopes();
    const state=await f.store.read();
    expect(state.scopes).toEqual(expect.arrayContaining([expect.objectContaining({scopeId:'already-done',status:'closed',outcome:'completed'}),expect.objectContaining({scopeId:'unfinished',status:'closed',outcome:'interrupted'})]));
    expect(state.members.filter(member=>member.executionScopeId==='unfinished').every(member=>member.lifecycle==='released')).toBe(true);
    expect(state.runs).toEqual([]);expect(state.graphs[0].tasks[0].status).toBe('cancelled');
  }finally{await f.cleanup()}
});
