import {runtimeToolGroup} from './runtime-tool-group';
import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {hash,json} from '../src/core/platform/node/serialization';
import {jsonToolResult} from '../src/logic/tools/rules/results';
import {memberHelpInputSchema} from '../src/logic/tasks/rules/member-help';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import {MemberExecutionManager} from '../src/logic/team/runtime/member-execution';
import {memberHelpCandidate} from '../src/logic/team/runtime/member-help-state';
import {LoopRuntime} from '../src/logic/execution/rules/runtime/runtime';
import type {EngineContext,RunSummary} from '../src/logic/execution/rules/types';
import type {MemberExecutionPorts} from '../src/logic/team/runtime/member-execution';

async function setup(mode:'help'|'hold'|'failed'|'close-error'|'write-first'|'post-denial'='help'){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),owner=f.app.workspace(entry.id),team=await seedTeam(owner),snapshot=await owner.snapshot(),moduleId=team.input.moduleId;
  const definition=JSON.parse(snapshot.files.find(item=>item.path===moduleId+'/module.json')!.text);definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await owner.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:json(definition)}]));
  const settings=await f.app.models.save({profile:{name:'Help service fixture',api:'openai-completions',auth:'none',baseUrl:'https://example.test/v1',defaultModel:'fixture',models:[{id:'fixture',name:'fixture',enabled:true,contextWindow:200000,maxTokens:1000,reasoning:false}]}}),profile=settings.profiles.find(item=>item.name==='Help service fixture')!;
  const registered=await registerExplicitFixtureOwner(f.app,entry.id,{agentId:'.cbim/team/dev',moduleIds:[moduleId],profileId:profile.id,modelId:'fixture'}),ownerSelection=registered.selection,model=await f.app.engineModels.configuration(profile.id,'fixture');
  // 登记、模块责任、派发和领取共享唯一真实账本；仅引擎事件由本测试受控地产生。
  const store=owner.dispatchStore,directory=store.directory,storage=new FileRunStorage(),identity={workspaceId:entry.id,rootSessionId:'main-root'},service=new WorkspaceDispatchService(owner,store,undefined,undefined,undefined,f.app.engineModels);
  await service.openScope(identity,'cycle',{message:'完成明确业务目标'});
  await service.goals.plan(identity,'cycle','main-run','goal-plan',{expectedRevision:1,objective:'完成明确业务目标',constraints:[],criteria:[{id:'artifact',text:'真实产物',kind:'evidence'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,criterionIds:['artifact'],reason:'由执行成员实现'}],reason:'按业务图与团队图派发'});
  let wake=()=>{},stagedResolve=()=>{},closed=0;const staged=new Promise<void>(resolve=>{stagedResolve=resolve});
  const inspect=vi.fn<MemberExecutionPorts['inspect']>(run=>storage.read(path.join(directory,'runs',run.binding.taskId,run.binding.runId)));
  const prepare=vi.fn<()=>Awaited<ReturnType<MemberExecutionPorts['prepare']>>>(()=>({model,create:async(_run,_task,hooks)=>{
    let context:EngineContext;return new LoopRuntime({storage,directory:path.join(directory,'runs'),acquireLease:async()=>()=>{},onEngineReady:hooks.onEngineReady,onEvent:hooks.onEvent,toolPolicy:async call=>({allow:true,effects:[call.name==='read'?'read':call.name==='write'?'business-write':'maintenance'],scope:{kind:'workspace',workspaceId:entry.id}}),createEngine:()=>({kind:'help-fixture',start:async value=>{context=value;await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId,sessionFile:path.join(directory,'native-'+context.nativeSessionId+'.jsonl')}})},stop:async()=>wake(),close:async()=>{closed++;if(mode==='close-error')throw Error('close failed')},run:async()=>{
      if(mode==='write-first'){expect((await context.beforeTool({id:'write-1',name:'write',input:{path:'marker.txt',content:'once'}})).allow).toBe(true);await fs.writeFile(path.join(f.a,'marker.txt'),'once');await context.emit({type:'tool.finished',data:{id:'write-1',name:'write',result:jsonToolResult('write',{written:true}),isError:false}})}
      const read={id:'read-1',name:'read',input:{path:'src/app.ts'}};expect((await context.beforeTool(read)).allow).toBe(true);await context.emit({type:'tool.finished',data:{id:read.id,name:read.name,result:jsonToolResult('read',{verified:true}),isError:false}});
      const call={id:'help-1',name:'cbim_task_help',input:{kind:'missing_input',reason:' 缺少输出格式 ',question:' 输出格式是什么？ ',attemptedToolCallIds:[read.id]}};
      expect((await context.beforeTool(call)).allow).toBe(true);const result=await runtimeToolGroup(context,'member-help')!.call(call.name,call.input,call.id);await context.emit({type:'tool.finished',data:{id:call.id,name:call.name,result,isError:false}});stagedResolve();
      if(mode==='post-denial')expect((await context.beforeTool({id:'after-help',name:'write',input:{path:'forbidden.txt',content:'not executed'}})).allow).toBe(false);
      if(mode==='hold'){await new Promise<void>(resolve=>{wake=resolve});return {status:'cancelled'}}
      return {status:mode==='failed'?'failed':'completed'};
    }})});
  }}));
  const release=vi.fn(),members=new MemberExecutionManager(owner,store,{acquire:()=>release,prepare:async()=>prepare(),owners:service.owners,withEngineConfiguration:(reference,_options,use)=>f.app.engineModels.withRuntimeConfiguration(reference,configuration=>use({model:configuration.profile,prepare})),inspect});await members.initialize();let index=0;
  const assign=()=>service.dispatchTask({...identity,commandId:'assign-'+(++index),expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,goal:'完成业务目标',acceptance:[{id:'artifact',text:'真实产物'}],prerequisites:[]}},'cycle');
  const assigned=await assign(),input={...identity,taskId:assigned.taskId};
  const start=()=>members.start({...input,commandId:'start',expectedRevision:1,options:{permission:mode==='write-first'?'execute':'read'}});
  return {...f,owner,entry,identity,directory,store,storage,service,members,inspect,prepare,assigned,input,assign,start,staged,release,get closed(){return closed},cleanup:async()=>{wake();await members.close();await service.close();await f.cleanup()}};
}

it('正常结束并关闭后重读canonical，原子交接blocked求助；收件幂等、不恢复原实例',async()=>{
  const f=await setup();try{
    const receipt=await f.start();await f.members.waitForSettlement(f.input);const state=await f.store.read(),task=state.graphs[0].tasks.find(item=>item.taskId===f.assigned.taskId)!,run=state.runs![0];
    expect(task).toMatchObject({status:'blocked',help:{binding:run.binding,input:{kind:'missing_input',reason:'缺少输出格式',question:'输出格式是什么？',attemptedToolCallIds:['read-1']}}});expect(task.result).toBeUndefined();expect(task.activeRunId).toBeUndefined();expect(task.help!.requestedSeq).toBeLessThan(task.help!.finishedSeq);expect(f.inspect).toHaveBeenCalled();expect(f.closed).toBe(1);expect(f.release).toHaveBeenCalledTimes(1);
    const member=state.members.find(item=>item.agentInstanceId===task.assignee.agentInstanceId)!;expect(member.activity).toBe('idle');expect(member.activeTaskId).toBeUndefined();expect(member.activeRunId).toBeUndefined();
    const recipient={...f.identity,agentSessionId:state.graphs[0].root.agent.agentSessionId},messages=await f.members.messages(recipient);expect(messages).toHaveLength(1);expect(messages[0]).toMatchObject({kind:'help',helpId:task.help!.helpId,runId:receipt.runId,delivery:'pending'});
    const ack={...recipient,commandId:'ack-help',messageId:messages[0].messageId};await f.members.acknowledge(ack);await f.members.acknowledge(ack);expect(await f.members.messages(recipient)).toEqual([]);
    await expect(f.members.start({...f.input,commandId:'new-attempt',expectedRevision:task.revision,options:{permission:'read'}})).rejects.toMatchObject({code:'TASK_NOT_STARTABLE'});
    const next=await f.assign(),graph=await f.service.snapshot(f.identity);expect(graph.tasks.find(item=>item.taskId===next.taskId)!.assignee.agentInstanceId).not.toBe(task.assignee.agentInstanceId);expect(f.prepare).toHaveBeenCalledTimes(1);
    const restored=new FileDispatchStore(f.directory,f.entry.id);try{expect((await restored.read()).graphs[0].tasks[0].help).toEqual(task.help)}finally{await restored.close()}
  }finally{await f.cleanup()}
});

it('求助暂存后停止、运行失败或引擎关闭失败，均无可消费求助或交付候选',async()=>{
  for(const mode of ['hold','failed','close-error'] as const){const f=await setup(mode);try{
    await f.start();await f.staged;if(mode==='hold')await f.members.stop(f.input);await f.members.waitForSettlement(f.input);
    const state=await f.store.read(),task=state.graphs[0].tasks[0];expect(task.help).toBeUndefined();expect(task.result).toBeUndefined();expect(state.outbox.filter(item=>item.kind!=='assignment')).toEqual([]);expect(task.status).toBe(mode==='hold'?'cancelled':mode==='failed'?'failed':'interrupted');
  }finally{await f.cleanup()}}
});

it('canonical身份、完整性、回执哈希、顺序或工具状态矛盾均不能签发安全求助',async()=>{
  const f=await setup();try{
    await f.start();await f.members.waitForSettlement(f.input);const state=await f.store.read(),task=state.graphs[0].tasks[0],run=state.runs![0],good=await f.inspect(run);
    expect(memberHelpCandidate(task,run,good)).toEqual(task.help);
    const mutations:((s:RunSummary)=>void)[]=[
      s=>{s.logIntegrity={partialTail:true}},s=>{s.status='cancelled'},s=>{s.unresolvedTools=['read-1']},s=>{s.memberBinding!.leaseEpoch++},
      s=>{s.events.find(event=>event.type==='task.help_requested')!.data.help={}},
      s=>{s.events.find(event=>event.type==='tool.finished'&&event.data.id==='help-1')!.data.result=jsonToolResult('cbim_task_help',{changed:true})},
      s=>{s.events.find(event=>event.type==='tool.finished'&&event.data.id==='help-1')!.data.isError=true},
      s=>{s.events.find(event=>event.type==='tool.allowed'&&event.data.id==='help-1')!.data.name='read'},
      s=>{s.events.at(-1)!.data.status='failed'},s=>{s.events.splice(-1,0,structuredClone(s.events.find(event=>event.type==='task.help_requested')!))},
    ];
    for(const mutate of mutations){const bad=structuredClone(good);mutate(bad);expect(()=>memberHelpCandidate(task,run,bad)).toThrowError(expect.objectContaining({code:'MEMBER_HELP_INVALID'}))}
    // 修改已返回正文并同步其回执哈希，仍不能越过独立的请求事件交叉核对。
    const conflict=structuredClone(good),finish=conflict.events.find(event=>event.type==='tool.finished'&&event.data.id==='help-1')!;
    const result=finish.data.result as {content:{text:string}[]},body=JSON.parse(result.content[0].text);body.help.input.question='另一个问题';result.content[0].text=JSON.stringify(body);
    (finish.data.receipt as {resultHash:string}).resultHash=hash(JSON.stringify(result));conflict.toolReceipts!.find(item=>item.toolCallId==='help-1')!.resultHash=hash(JSON.stringify(result));
    expect(()=>memberHelpCandidate(task,run,conflict)).toThrowError(expect.objectContaining({code:'MEMBER_HELP_INVALID'}));
  }finally{await f.cleanup()}
});

it('canonical重读损坏时只登记blocked诊断，不把内存暂存变为可靠交接',async()=>{
  const f=await setup();try{
    f.inspect.mockImplementation(async run=>{const summary=await f.storage.read(path.join(f.directory,'runs',run.binding.taskId,run.binding.runId));summary.logIntegrity={partialTail:true};return summary});
    await f.start();await f.members.waitForSettlement(f.input);const state=await f.store.read();expect(state.graphs[0].tasks[0]).toMatchObject({status:'blocked',waitReason:expect.stringContaining('求助记录未通过')});expect(state.graphs[0].tasks[0].help).toBeUndefined();expect(state.outbox.every(item=>item.kind==='assignment')).toBe(true);
  }finally{await f.cleanup()}
});

it('结算持有事务重读canonical时收到停止，身份核实后立即取消交接而不死锁',async()=>{
  const f=await setup();let release=()=>{};try{
    let reading=()=>{};const reached=new Promise<void>(resolve=>{reading=resolve}),barrier=new Promise<void>(resolve=>{release=resolve});
    f.inspect.mockImplementation(async run=>{const summary=await f.storage.read(path.join(f.directory,'runs',run.binding.taskId,run.binding.runId));reading();await barrier;return summary});
    await f.start();await reached;
    await expect(f.members.stop({...f.input,rootSessionId:'other-root'})).rejects.toMatchObject({code:'TASK_NOT_FOUND'});
    await expect(f.members.stop(f.input)).resolves.toEqual({requested:true});release();await f.members.waitForSettlement(f.input);
    const state=await f.store.read();expect(state.graphs[0].tasks[0].status).toBe('cancelled');expect(state.graphs[0].tasks[0].help).toBeUndefined();expect(state.outbox.every(item=>item.kind==='assignment')).toBe(true);expect(f.release).toHaveBeenCalledTimes(1);
  }finally{release();await f.cleanup()}
});

it('已完成副作用保留真实fence，求助后明确拒绝的新调用不抹掉可靠交接；在途工具跨越交接则拒绝',async()=>{
  for(const mode of ['write-first','post-denial'] as const){const f=await setup(mode);try{
    await f.start();await f.members.waitForSettlement(f.input);const state=await f.store.read(),task=state.graphs[0].tasks[0],run=state.runs![0];expect(task.help).toBeDefined();
    if(mode==='write-first'){expect(await fs.readFile(path.join(f.a,'marker.txt'),'utf8')).toBe('once');expect(task.help!.lastEffectSeq).toBeGreaterThan(0);expect(task.help!.lastEffectSeq).toBeLessThan(task.help!.requestedSeq)}
    else expect((await f.inspect(run)).toolReceipts!.find(item=>item.toolCallId==='after-help')!.outcome).toBe('denied');
    const bad=await f.inspect(run),index=bad.events.findIndex(event=>event.type==='tool.finished'&&event.data.id==='read-1'),[late]=bad.events.splice(index,1);bad.events.splice(-1,0,late);bad.events.forEach((event,index)=>{event.seq=index+1});
    expect(()=>memberHelpCandidate(task,run,bad)).toThrowError(expect.objectContaining({code:'MEMBER_HELP_INVALID'}));
  }finally{await f.cleanup()}}
});

it('求助不可改写、补造或重复发信；strict模型输入不接受运行身份和验收字段',async()=>{
  expect(memberHelpInputSchema.safeParse({kind:'permission',reason:'需要权限',question:'允许吗',attemptedToolCallIds:[],runId:'forged'}).success).toBe(false);
  expect(memberHelpInputSchema.safeParse({kind:'permission',reason:'需要权限',question:'允许吗',attemptedToolCallIds:['same','same']}).success).toBe(false);
  const f=await setup();try{
    await f.start();await f.members.waitForSettlement(f.input);const state=await f.store.read(),graph=state.graphs[0],task=graph.tasks[0],help=state.outbox.find(item=>item.kind==='help')!;
    await expect(f.store.transact({commandId:'duplicate',fingerprint:'duplicate'},async()=>({messages:[{...help,messageId:'forged',commandId:'duplicate'}],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const changed=structuredClone(task);changed.revision++;changed.help!.input.question='改写问题';
    await expect(f.store.transact({commandId:'change-help',fingerprint:'change-help'},async()=>({batch:{version:1,identity:graph.identity,streamId:graph.cursor.streamId,seq:graph.cursor.seq+1,eventId:'forged-event',commandId:'change-help',cause:'task.blocked',committedAt:new Date().toISOString(),changes:[{type:'task.upserted',task:changed}]},receipt:true}))).rejects.toThrow();
    await f.service.closeScope(f.identity,'cycle','cancelled');const bytes=await fs.readFile(path.join(f.directory,'dispatch.jsonl'));expect((await f.members.inspect(f.input)).task.help).toEqual(task.help);expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'))).toEqual(bytes);
  }finally{await f.cleanup()}
});
