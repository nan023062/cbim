import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import type {MemberExecutionView,MemberStartReceipt} from '../src/backend/core/tasks/member-commands';
import type {OpenGraphReceipt,DispatchReceipt} from '../src/backend/core/tasks/dispatch-commands';
import type {ChatApproval} from '../src/backend/core/policy/types';
import type {MemberEventsRead,MemberEventCursor} from '../src/backend/core/tasks/member-events';
import type {StoredEvent} from '../src/backend/core/brain/types';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';

/** Actual Application, dispatch transactions, policy, persistence and pinned Pi; only the model provider is a deterministic localhost fixture. */
it('runs a dispatched member through approval, verified candidate and inbox acknowledgement; restart preserves identity and later tasks get fresh approval',async()=>{
  const f=await fixture();
  const firstGoal='LOCAL_MEMBER_DELIVER: 写入并验证成员成果';
  const cancelGoal='LOCAL_MEMBER_CANCEL: 本次任务必须重新批准';
  const plainGoal='LOCAL_MEMBER_PLAIN: 普通结束不能伪造交付';
  const acceptance=['实际文件内容为 member-result'];
  const requests:{messages:{role:string;content:unknown}[]}[]=[];
  const transportErrors:unknown[]=[];
  const turns=new Map<string,number>();
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);requests.push(body);
      const lastUser=JSON.stringify(body.messages.filter((message:{role:string})=>message.role==='user').at(-1)?.content);
      const goal=lastUser.includes('LOCAL_MEMBER_CANCEL')?cancelGoal:lastUser.includes('LOCAL_MEMBER_PLAIN')?plainGoal:firstGoal;
      const turn=turns.get(goal)??0;turns.set(goal,turn+1);
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'application-member-'+requests.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')};
      if(goal===firstGoal){
        if(turn===0)tool('create-plan','cbim_task_plan',{expectedVersion:0,goal:firstGoal,reason:'执行已派发任务',acceptance,steps:[{id:'verify',title:'写入并读取真实文件',owner:'开发者'}]});
        else if(turn===1)tool('write-output','write',{path:'member-result.txt',content:'member-result'});
        else if(turn===2)tool('verify-output','read',{path:'member-result.txt'});
        else if(turn===3)tool('inspect-plan','cbim_task_inspect',{});
        else if(turn===4)tool('finish-step','cbim_task_step',{expectedVersion:2,id:'verify',state:'reported_done',evidenceIds:['verify-output']});
        else if(turn===5)tool('prepare-result','cbim_delivery_prepare',{expectedVersion:3,summary:'已生成并读取成员成果文件',limitations:['尚未进行人工业务验收']});
        else {emit({role:'assistant',content:'已提交待审阅候选。'},null);emit({},'stop')}
      }else if(goal===cancelGoal&&turn===0)tool('next-task-write','write',{path:'must-not-exist.txt',content:'not authorized'});
      else {emit({role:'assistant',content:'这是一次普通回复，未提交交付证据。'},null);emit({},'stop')}
      res.end('data: [DONE]\n\n');
    }catch(error){transportErrors.push(error);res.writeHead(500);res.end('Local fixture failed')}
  });
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw Error('Local fixture did not bind');
    await f.app.models.save({profile:{name:'Local member fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'member-fixture',models:[{id:'member-fixture',name:'Fixture',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
    const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json';
    const definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'member-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'member-review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
    const {selection:ownerSelection}=await registerExplicitFixtureOwner(f.app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:(await f.app.models.list()).selectedId!,modelId:'member-fixture'});
    const identity={workspaceId:entry.id,rootSessionId:'member-root'};
    const root=await f.app.dispatch('dispatch.open',{...identity,commandId:'open-root'}) as OpenGraphReceipt;
    const scopes=new Map<string,string>(),openPlanned=async(graph:typeof identity,scopeId:string)=>{
      const service=f.app.memberDispatch(entry.id),runId='main-'+scopeId;await service.openScope(graph,scopeId,{message:'验证原权限、证据与成员实例隔离'},runId);
      await service.goals.plan(graph,scopeId,runId,'plan-'+scopeId,{expectedRevision:1,objective:'验证原权限、证据与成员实例隔离',constraints:[],criteria:acceptance.map((text,i)=>({id:'criterion-'+i,text,kind:'evidence'})),assignments:[{agentId:team.input.agentId,moduleIds:[team.input.moduleId],ownerSelection,criterionIds:acceptance.map((_,i)=>'criterion-'+i),reason:'真实模块负责岗位'}],reason:'明确规划再派发'});scopes.set(graph.rootSessionId,scopeId);
    };
    await openPlanned(identity,'member-cycle-one');
    const dispatch=async(goal:string,commandId:string,graph=identity)=>await f.app.dispatch('dispatch.task',{...graph,scopeId:scopes.get(graph.rootSessionId),commandId,expectedParentRevision:1,task:{assigneeAgentId:team.input.agentId,moduleIds:[team.input.moduleId],ownerSelection,goal,acceptance:acceptance.map((text,i)=>({id:'criterion-'+i,text})),prerequisites:[]}}) as DispatchReceipt;
    const assigned=await dispatch(firstGoal,'assign-first'),taskIdentity={...identity,taskId:assigned.taskId};
    const startInput={...taskIdentity,commandId:'start-first',expectedRevision:1,options:{permission:'ask',turnTimeoutMs:15000}};
    const started=await f.app.dispatch('dispatch.executionStart',startInput) as MemberStartReceipt;
    expect(await f.app.dispatch('dispatch.executionStart',startInput)).toEqual(started);
    const view=()=>f.app.dispatch('dispatch.executionInspect',taskIdentity) as Promise<MemberExecutionView>;
    let approvals:ChatApproval[]=[];
    await vi.waitFor(async()=>{approvals=await f.app.dispatch('dispatch.approvals',taskIdentity);expect(approvals).toHaveLength(1)},{timeout:15000,interval:30});
    expect(approvals[0].name).toBe('write');
    expect((await view()).task.status).toBe('running');
    const eventInput={...taskIdentity,runId:started.runId},readEvents=(cursor?:MemberEventCursor,limit=3)=>f.app.dispatch('dispatch.executionEvents',{...eventInput,cursor,limit}) as Promise<MemberEventsRead>;
    let streamed=await readEvents();expect(streamed.mode).toBe('reset');
    const publicEvents:StoredEvent[]=[];
    while(streamed.mode!=='noop'){
      publicEvents.push(...streamed.events);if(!streamed.hasMore)break;
      streamed=await readEvents(streamed.cursor);
    }
    expect(publicEvents.some(event=>event.type==='tool.proposed'&&event.data.name==='write')).toBe(true);
    expect(publicEvents.some(event=>event.type==='engine.status'&&event.data.label==='成员会话已连接')).toBe(true);
    expect(JSON.stringify(publicEvents)).not.toMatch(/sessionFile|nativeSessionId|workflowContext|effectiveSkills/);
    const fileReads=vi.spyOn(fs,'readFile');
    try{for(let i=0;i<3;i++)expect(await readEvents(streamed.cursor)).toMatchObject({mode:'noop',run:{status:'running'}});expect(fileReads).not.toHaveBeenCalled()}finally{fileReads.mockRestore()}
    await expect(f.app.dispatch('dispatch.executionEvents',{...eventInput,rootSessionId:'foreign-root'})).rejects.toMatchObject({code:'TASK_NOT_FOUND'});
    await expect(f.app.dispatch('dispatch.executionEvents',{...eventInput,runId:'foreign-run'})).rejects.toMatchObject({code:'MEMBER_RUN_NOT_FOUND'});
    await expect(readEvents({runId:'foreign-run',seq:0})).rejects.toMatchObject({code:'MEMBER_EVENT_IDENTITY_MISMATCH'});
    await expect(readEvents(undefined,501)).rejects.toMatchObject({code:'MEMBER_INPUT_INVALID'});
    expect(await readEvents({runId:started.runId,seq:999999})).toMatchObject({mode:'reset',cursor:{seq:3},hasMore:true});
    await expect(fs.readFile(path.join(f.a,'member-result.txt'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
    await expect(f.app.dispatch('dispatch.approve',{...taskIdentity,rootSessionId:'foreign-root',approvalId:approvals[0].id,allow:true})).rejects.toMatchObject({code:'TASK_NOT_FOUND'});
    await expect(f.app.dispatch('loop.chat',{id:entry.id,message:'Cannot overlap a writing member',options:{permission:'read'}})).rejects.toMatchObject({code:'WORKSPACE_EXECUTION_BUSY'});
    await f.app.dispatch('dispatch.approve',{...taskIdentity,approvalId:approvals[0].id,allow:true,allowAll:true});
    await vi.waitFor(async()=>expect((await view()).task.status).toBe('result_ready'),{timeout:15000,interval:30});
    expect(await fs.readFile(path.join(f.a,'member-result.txt'),'utf8')).toBe('member-result');
    const completed=await view();expect(completed.runs).toHaveLength(1);expect(completed.runs[0]).toMatchObject({status:'completed',permission:'ask',binding:{taskId:assigned.taskId,runId:started.runId}});
    do {streamed=await readEvents(streamed.cursor);if(streamed.mode!=='noop')publicEvents.push(...streamed.events)}while(streamed.mode!=='noop'&&streamed.hasMore);
    expect(streamed.run.status).toBe('completed');expect(streamed.run.taskProgress?.state).toBe('awaiting_review');
    expect(publicEvents.map(event=>event.seq)).toEqual(Array.from({length:publicEvents.length},(_,i)=>i+1));
    expect(publicEvents.find(event=>event.type==='tool.finished'&&event.data.id==='verify-output')?.data).toMatchObject({receipt:{outcome:'succeeded'},result:{content:[{type:'text',text:'工具已完成；详细正文未公开'}]}});
    expect(publicEvents.some(event=>event.type==='message'&&event.data.text==='已提交待审阅候选。')).toBe(true);
    expect(completed.task.result).toMatchObject({runId:started.runId,planRevision:1,evidenceRefs:['verify-output'],acceptance:'not_evaluated'});
    const serialized=JSON.stringify(completed);expect(serialized).not.toContain('sessionFile');expect(serialized).not.toContain(f.user);expect(serialized).not.toContain('effectiveSkills');
    expect(f.app.runtime.snapshot().runs.find(run=>run.runId===started.runId)?.memberBinding).toMatchObject({taskId:assigned.taskId,agentSessionId:completed.task.assignee.agentSessionId});
    const inboxIdentity={...identity,agentSessionId:root.agent.agentSessionId};
    const inbox=await f.app.dispatch('dispatch.messages',inboxIdentity);
    expect(inbox).toHaveLength(1);expect(inbox[0]).toMatchObject({kind:'result',taskId:assigned.taskId,runId:started.runId,delivery:'pending'});
    const ack={...inboxIdentity,commandId:'ack-result',messageId:inbox[0].messageId};
    expect(await f.app.dispatch('dispatch.acknowledge',ack)).toEqual({messageId:inbox[0].messageId,delivery:'processed'});
    expect(await f.app.dispatch('dispatch.acknowledge',ack)).toEqual({messageId:inbox[0].messageId,delivery:'processed'});
    expect(await f.app.dispatch('dispatch.messages',inboxIdentity)).toEqual([]);
    expect((await view()).task.result?.acceptance).toBe('not_evaluated');
    const beforeRestart=requests.length;
    await f.app.open(entry.id,true);
    expect(await view()).toEqual(completed);expect(requests).toHaveLength(beforeRestart);
    const restoredReads=vi.spyOn(FileRunStorage.prototype,'read');
    try{
      const restored=await readEvents(undefined,500);expect(restored).toMatchObject({mode:'reset',run:{status:'completed'},hasMore:false});
      if(restored.mode==='noop')throw Error('expected restored reset');expect(restored.events).toEqual(publicEvents);
      expect(await readEvents(restored.cursor)).toMatchObject({mode:'noop',run:{status:'completed'}});expect(restoredReads).toHaveBeenCalledTimes(1);
    }finally{restoredReads.mockRestore()}
    await expect(f.app.dispatch('dispatch.executionStart',{...startInput,commandId:'retry-completed',expectedRevision:completed.task.revision})).rejects.toMatchObject({code:'MEMBER_RELEASED'});

    // 重开已封存原周期；新任务须新周期与独立实例，旧 allowAll 和原生历史都不能继承。
    await openPlanned(identity,'member-cycle-two');
    const second=await dispatch(cancelGoal,'assign-second'),secondIdentity={...identity,taskId:second.taskId};
    const next=await f.app.dispatch('dispatch.executionStart',{...secondIdentity,commandId:'start-second',expectedRevision:1,options:{permission:'ask',turnTimeoutMs:15000}}) as MemberStartReceipt;
    await vi.waitFor(async()=>expect(await f.app.dispatch('dispatch.approvals',secondIdentity)).toHaveLength(1),{timeout:15000,interval:30});
    expect(JSON.stringify(requests.at(-1)?.messages)).not.toContain(firstGoal);
    await f.app.stop(entry.id); // Closing a workspace must drain its member before the shared store closes.
    await f.app.open(entry.id);
    const stopped=await f.app.dispatch('dispatch.executionInspect',secondIdentity) as MemberExecutionView;
    const stopSummary=await new FileRunStorage().read(path.join(f.user,entry.id,'dispatch','runs','tasks',second.taskId,next.runId));
    expect(stopped.task.status,JSON.stringify(stopSummary.events.slice(-6))).toBe('cancelled');expect(stopped.runs[0].status).toBe('cancelled');expect(stopped.task.result).toBeUndefined();
    await expect(fs.readFile(path.join(f.a,'must-not-exist.txt'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
    const storage=new FileRunStorage(),runDirectory=path.join(f.user,entry.id,'dispatch','runs','tasks');
    const firstRun=await storage.read(path.join(runDirectory,assigned.taskId,started.runId)),nextRun=await storage.read(path.join(runDirectory,second.taskId,next.runId));
    expect(nextRun.sessionFile).not.toBe(firstRun.sessionFile);expect(nextRun.memberBinding?.agentSessionId).not.toBe(firstRun.memberBinding?.agentSessionId);

    // A different root gets its own member channel; plain model completion remains blocked without a structured result.
    const otherIdentity={workspaceId:entry.id,rootSessionId:'other-member-root'};
    await f.app.dispatch('dispatch.open',{...otherIdentity,commandId:'open-other'});
    await openPlanned(otherIdentity,'other-member-cycle');
    const plain=await dispatch(plainGoal,'assign-plain',otherIdentity),plainIdentity={...otherIdentity,taskId:plain.taskId};
    await f.app.dispatch('dispatch.executionStart',{...plainIdentity,commandId:'start-plain',expectedRevision:1,options:{permission:'read',turnTimeoutMs:15000}});
    await vi.waitFor(async()=>expect((await f.app.dispatch('dispatch.executionInspect',plainIdentity) as MemberExecutionView).task.status).toBe('blocked'),{timeout:15000,interval:30});
    expect(JSON.stringify(requests.at(-1)?.messages)).not.toContain(firstGoal);
    expect(transportErrors).toEqual([]);
  }finally{await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},90000);
