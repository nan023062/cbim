import {expect,it} from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {hash,json} from '../src/core/platform/node/serialization';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import {registerServiceOwner} from './owner-service-fixture';

async function setup(){
  const f=await fixture();
  const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json';
  const definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
  await registerServiceOwner(f.app,workspace,'.cbim/team/dev',[team.input.moduleId]);
  const store=workspace.dispatchStore,directory=store.directory,service=new WorkspaceDispatchService(workspace,store,undefined,undefined,undefined,f.app.models);
  const identity={workspaceId:entry.id,rootSessionId:'root-one'};
  const ownerSelection=(await service.owners.discover([team.input.moduleId])).groups[0].selection!;
  const input=(commandId:string,agentId='.cbim/team/dev',rootSessionId=identity.rootSessionId)=>({...identity,rootSessionId,commandId,expectedParentRevision:1,task:{assigneeAgentId:agentId,moduleIds:[team.input.moduleId],ownerSelection,goal:'验证模块行为',acceptance:[{id:'evidence',text:'提交验证证据'}],prerequisites:[]}});
  const openPlanned=async(scopeId:string)=>{
    const runId='main-'+scopeId;await service.openScope(identity,scopeId,{message:'验证模块行为'},runId);
    return service.goals.plan(identity,scopeId,runId,'plan-'+scopeId,{expectedRevision:1,objective:'验证模块行为',constraints:[],criteria:[{id:'evidence',text:'提交验证证据',kind:'evidence'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[team.input.moduleId],ownerSelection,criterionIds:['evidence'],reason:'由当前负责岗位执行'}],reason:'保留真实目标计划后派发'});
  };
  return {...f,entry,workspace,team,directory,store,service,identity,input,openPlanned,cleanup:async()=>{await store.close();await f.cleanup()}};
}

it('新周期首轮与回注清单原子登记，重复不增量、旧周期不补造，真实重开保留隔离集合',async()=>{
  const f=await setup();try{
    const initial=await f.service.openScope(f.identity,'tracked',{message:'本轮目标'},'main-first');expect(initial.runTracking).toEqual({version:1,mainRunIds:['main-first']});
    await f.service.registerMainRun(f.identity,'tracked','main-return');await f.service.registerMainRun(f.identity,'tracked','main-return');
    expect((await f.service.openScope(f.identity,'tracked',{message:'本轮目标'},'main-first')).runTracking?.mainRunIds).toEqual(['main-first','main-return']);
    await expect(f.service.openScope(f.identity,'tracked',{message:'本轮目标'},'other-first')).rejects.toBeDefined();
    await f.service.closeScope(f.identity,'tracked','failed');await expect(f.service.registerMainRun(f.identity,'tracked','late-run')).rejects.toMatchObject({code:'DISPATCH_SCOPE_CLOSED'});
    await f.service.openScope(f.identity,'legacy');await f.service.registerMainRun(f.identity,'legacy','do-not-invent');expect((await f.service.goals.inspect(f.identity,'legacy')).runTracking).toBeUndefined();
    await f.service.closeScope(f.identity,'legacy','cancelled');await f.store.close();
    const reopened=new FileDispatchStore(f.directory,f.entry.id),service=new WorkspaceDispatchService(f.workspace,reopened);
    try{expect((await service.goals.inspect(f.identity,'tracked')).runTracking?.mainRunIds).toEqual(['main-first','main-return']);expect(await service.recoveries.priorRunIds(f.identity)).toEqual(['main-first','main-return']);expect((await service.goals.inspect(f.identity,'legacy')).runTracking).toBeUndefined()}finally{await reopened.close()}
  }finally{await f.cleanup()}
});

it('同一用户周期幂等复用，主会话周期互斥；不同主会话隔离且关闭不可重开',async()=>{
  const f=await setup();try{
    const [first,same]=await Promise.all([f.service.openScope(f.identity,'scope-one'),f.service.openScope(f.identity,'scope-one')]);
    expect(same).toEqual(first);
    const root=(await f.service.snapshot(f.identity)).root;
    await expect(f.service.openScope(f.identity,'scope-competing')).rejects.toMatchObject({code:'DISPATCH_SCOPE_BUSY'});
    const other={...f.identity,rootSessionId:'root-two'};
    await f.service.openScope(other,'scope-two');
    expect((await f.service.snapshot(other)).root.agent.agentInstanceId).not.toBe(root.agent.agentInstanceId);
    await expect(f.service.dispatchTask(f.input('wrong-root','.cbim/team/dev','root-two'),'scope-one')).rejects.toMatchObject({code:'DISPATCH_SCOPE_IDENTITY'});
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
    await f.openPlanned('scope-one');
    const root=(await f.service.snapshot(f.identity)).root;
    const first=await f.service.dispatchTask(f.input('dispatch-one'),'scope-one');
    expect(await f.service.dispatchTask(f.input('dispatch-one'),'scope-one')).toEqual(first);
    const second=await f.service.dispatchTask(f.input('dispatch-two'),'scope-one');
    const graph=await f.service.snapshot(f.identity);
    expect(graph.tasks).toHaveLength(2);
    const logical=(await f.store.read()).teamSessions!;
    expect(logical.filter(session=>session.rootSessionId===f.identity.rootSessionId)).toHaveLength(2);
    const child=logical.find(session=>session.agentId==='.cbim/team/dev')!;
    expect(new Set(graph.tasks.map(task=>task.assignee.agentInstanceId)).size).toBe(2);
    expect(graph.tasks.every(task=>task.assignee.agentInstanceId!==root.agent.agentInstanceId&&task.scopeId==='scope-one')).toBe(true);
    await expect(f.service.dispatchTask({...f.input('untrusted-scope'),scopeId:'scope-one'})).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await expect(f.service.dispatchTask(f.input('main-forbidden','cbim:main'),'scope-one')).rejects.toMatchObject({code:'AGENT_NOT_EXECUTABLE'});
    await f.service.closeScope(f.identity,'scope-one','cancelled');
    const state=await f.store.read(),closed=await f.service.snapshot(f.identity);
    expect(state.teamSessions).toEqual(logical);
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
    await f.openPlanned('scope-next');
    const next=await f.service.dispatchTask(f.input('new-cycle'),'scope-next');
    expect((await f.store.read()).teamSessions!.find(session=>session.agentId==='.cbim/team/dev')).toEqual(child);
    expect((await f.service.snapshot(f.identity)).tasks.find(task=>task.taskId===next.taskId)?.assignee.agentInstanceId).not.toBe(graph.tasks[0].assignee.agentInstanceId);
  }finally{await f.cleanup()}
});

it('存储拒绝半次周期关闭、提前释放及关闭后的实例复活和任务重写',async()=>{
  const f=await setup();try{
    await f.openPlanned('scope-one');await f.service.dispatchTask(f.input('dispatch-one'),'scope-one');
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
    await f.openPlanned('unfinished');await f.service.dispatchTask(f.input('unstarted'),'unfinished');
    await f.service.recoverScopes();await f.service.recoverScopes();
    const state=await f.store.read();
    expect(state.scopes).toEqual(expect.arrayContaining([expect.objectContaining({scopeId:'already-done',status:'closed',outcome:'completed'}),expect.objectContaining({scopeId:'unfinished',status:'closed',outcome:'interrupted'})]));
    expect(state.members.filter(member=>member.executionScopeId==='unfinished').every(member=>member.lifecycle==='released')).toBe(true);
    expect(state.runs).toEqual([]);expect(state.graphs[0].tasks[0].status).toBe('cancelled');
  }finally{await f.cleanup()}
});

const attachmentA='11111111-1111-4111-8111-111111111111';
const attachmentB='22222222-2222-4222-8222-222222222222';

it('周期冻结真实输入而非旧任务目标，保留原文及附件；关闭、新周期和真实重放相互独立',async()=>{
  const f=await setup();try{
    const message='  本轮用户输入\n保留换行和尾部空白  ',input={message,attachmentIds:[attachmentA]};
    const opening=f.service.openScope(f.identity,'input-one',input);
    input.message='调用者随后改动';input.attachmentIds.push(attachmentB);
    const first=await opening,goal={revision:1,input:{message,attachmentIds:[attachmentA]}};
    expect(first.goal).toEqual(goal);
    first.goal!.input.message='修改返回对象也不得覆盖';
    expect((await f.store.read()).scopes!.find(scope=>scope.scopeId==='input-one')!.goal).toEqual(goal);
    const closed=await f.service.closeScope(f.identity,'input-one','completed');expect(closed.goal).toEqual(goal);
    const second=await f.service.openScope(f.identity,'input-two',{message:'续聊发起的新目标'});
    expect(second.goal).toEqual({revision:1,input:{message:'续聊发起的新目标',attachmentIds:[]}});
    expect((await f.store.read()).scopes!.find(scope=>scope.scopeId==='input-one')!.goal).toEqual(goal);
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{
      expect(await reader.read()).toEqual(await f.store.read());
      const service=new WorkspaceDispatchService(f.workspace,reader);
      expect(await service.openScope(f.identity,'input-two',{message:'续聊发起的新目标',attachmentIds:[]})).toEqual(second);
      await expect(service.openScope(f.identity,'input-one',{message,attachmentIds:[attachmentA]})).rejects.toMatchObject({code:'DISPATCH_SCOPE_CLOSED'});
    }finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('相同scope的不同正文或附件不能绕过已保存幂等回执，规范化空附件可正常重发',async()=>{
  const f=await setup();try{
    const original={message:'本轮原始目标',attachmentIds:[attachmentA,attachmentB]};
    const scope=await f.service.openScope(f.identity,'fixed-input',original),file=path.join(f.directory,'dispatch.jsonl'),before=await fs.readFile(file,'utf8');
    expect(await f.service.openScope(f.identity,'fixed-input',structuredClone(original))).toEqual(scope);
    for(const changed of [{...original,message:'不同目标'},{...original,attachmentIds:[attachmentB,attachmentA]},{...original,attachmentIds:[]},undefined]){
      await expect(f.service.openScope(f.identity,'fixed-input',changed)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
      expect(await fs.readFile(file,'utf8')).toBe(before);
    }
    await f.service.closeScope(f.identity,'fixed-input','cancelled');
    const empty=await f.service.openScope(f.identity,'empty-input',{message:'没有附件'});
    expect(await f.service.openScope(f.identity,'empty-input',{message:'没有附件',attachmentIds:[]})).toEqual(empty);
    // 没有 scope.open 幂等回执的既有记录也必须经过事务内输入检查。
    const other={...f.identity,rootSessionId:'other-root'};await f.service.openGraph({...other,commandId:'create-other-root'});
    await f.store.transact({commandId:'independent-scope-creator',fingerprint:'independent-scope-creator'},async()=>({scopes:[{...scope,scopeId:'other-scope',rootSessionId:other.rootSessionId}],receipt:true}));
    await expect(f.service.openScope(other,'other-scope',{message:'不能重绑定',attachmentIds:[]})).rejects.toMatchObject({code:'DISPATCH_SCOPE_INPUT_CONFLICT'});
  }finally{await f.cleanup()}
});

it('输入边界拒绝空白/过长正文、无效或过多附件与额外字段，最大长度原样保存',async()=>{
  const f=await setup();try{
    const invalid:unknown[]=[{message:''},{message:' \n\t '},{message:'x'.repeat(1_000_001)},{message:'目标',attachmentIds:['not-a-uuid']},{message:'目标',attachmentIds:Array(13).fill(attachmentA)},{message:'目标',phase:'running'},{message:'目标',revision:2}];
    for(let i=0;i<invalid.length;i++)await expect(f.service.openScope(f.identity,'invalid-'+i,invalid[i] as any)).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    expect((await f.store.read()).scopes).toEqual([]);expect((await f.store.read()).graphs).toEqual([]);
    const message=' '+ 'x'.repeat(999_998)+' ',scope=await f.service.openScope(f.identity,'largest',{message,attachmentIds:Array(12).fill(attachmentA)});
    expect(scope.goal!.input.message).toBe(message);expect(scope.goal!.input.message.length).toBe(1_000_000);expect(scope.goal!.input.attachmentIds).toHaveLength(12);
  }finally{await f.cleanup()}
});

it('提交和完整校验和的日志重放都拒绝改写/移除goal或input，legacy不补造',async()=>{
  const f=await setup();try{
    const scope=await f.service.openScope(f.identity,'protected',{message:'原始输入',attachmentIds:[attachmentA]}),file=path.join(f.directory,'dispatch.jsonl'),original=await fs.readFile(file,'utf8');
    const withoutGoal=structuredClone(scope);delete withoutGoal.goal;
    const changes:unknown[]=[withoutGoal,{...scope,goal:{revision:1}},{...scope,goal:{revision:2,input:scope.goal!.input}},{...scope,goal:{revision:1,input:{message:'篡改正文',attachmentIds:[attachmentA]}}},{...scope,goal:{revision:1,input:{message:'原始输入',attachmentIds:[attachmentB]}}},{...scope,goal:{revision:1,input:{message:'原始输入'}}}];
    for(let i=0;i<changes.length;i++){
      await expect(f.store.transact({commandId:'invalid-mutation-'+i,fingerprint:'invalid-mutation-'+i},async()=>({scopes:[changes[i] as any],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
      expect(await fs.readFile(file,'utf8')).toBe(original);
      // 伪造下一条完整且校验和正确的事务，证明拒绝来自领域重放校验而不只是 hash 检查。
      const previous=JSON.parse(original.trim().split('\n').at(-1)!);
      const body={version:1,executionProtocol:'module_owner_v1',workspaceId:f.entry.id,transactionSeq:previous.body.transactionSeq+1,previousHash:previous.checksum,command:{commandId:'replayed-mutation-'+i,fingerprint:'replayed-mutation-'+i},mutation:{scopes:[changes[i]],receipt:true}};
      await fs.writeFile(file,original+JSON.stringify({body,checksum:hash(JSON.stringify(body))})+'\n');
      const reader=new FileDispatchStore(f.directory,f.entry.id);try{await expect(reader.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await reader.close();await fs.writeFile(file,original)}
    }
    await f.service.closeScope(f.identity,'protected','completed');
    const legacy=await f.service.openScope(f.identity,'legacy');expect(legacy).not.toHaveProperty('goal');
    await expect(f.service.openScope(f.identity,'legacy',{message:'不能给旧记录补造'})).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    await expect(f.store.transact({commandId:'fill-legacy',fingerprint:'fill-legacy'},async()=>({scopes:[{...legacy,goal:{revision:1,input:{message:'不能猜测',attachmentIds:[]}}}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    await f.service.closeScope(f.identity,'legacy','interrupted');
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect((await reader.read()).scopes!.find(value=>value.scopeId==='legacy')).not.toHaveProperty('goal')}finally{await reader.close()}
  }finally{await f.cleanup()}
});
