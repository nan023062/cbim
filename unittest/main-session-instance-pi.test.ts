import {registerExplicitFixtureOwner} from '../src/logic/team/service/unittest/support/explicit-owner-fixture';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from '../src/logic/application/unittest/support/helpers';
import {request} from '../src/logic/knowledge/rules/unittest/data/knowledge';
import {seedTeam} from '../src/logic/knowledge/service/unittest/support/team-fixture';
import {json} from '../src/core/platform/node/serialization';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import type {RunSummary} from '../src/logic/execution/rules/types';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';

type ProviderRequest={model:string;messages:{role:string;content:unknown}[];tools?:{function:{name:string}}[]};
type ProviderResponse={text?:string;tool?:{id:string;name:string;args:unknown}};

/** Deterministic localhost provider; Application, persistence, policies and Pi subprocesses remain real. */
async function provider(respond:(request:ProviderRequest)=>ProviderResponse){
  const requests:ProviderRequest[]=[],errors:unknown[]=[];
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw) as ProviderRequest;requests.push(body);
      const response=respond(body),id='main-instance-'+requests.length;
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}],...(finish_reason?{usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}}:{})})+'\n\n');
      if(response.text)emit({role:'assistant',content:response.text},null);
      if(response.tool)emit({role:'assistant',tool_calls:[{index:0,id:response.tool.id,type:'function',function:{name:response.tool.name,arguments:JSON.stringify(response.tool.args)}}]},null);
      emit({},response.tool?'tool_calls':'stop');res.end('data: [DONE]\n\n');
    }catch(error){errors.push(error);if(!res.headersSent)res.writeHead(500);res.end('Local main instance fixture failed')}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Local main instance fixture did not bind');
  return {requests,errors,url:`http://127.0.0.1:${address.port}/v1`,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}

async function configure(f:Awaited<ReturnType<typeof fixture>>,baseUrl:string){
  await f.app.models.Save({profile:{name:'Main instance fixture',api:'openai-completions',baseUrl,auth:'none',defaultModel:'main-instance-fixture',models:[{id:'main-instance-fixture',name:'Fixture',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
}

async function completedThread(f:Awaited<ReturnType<typeof fixture>>,workspaceId:string,taskId:string,count:number){
  let history:RunSummary[]=[];
  await vi.waitFor(async()=>{
    history=await f.app.Execution(workspaceId).Thread(taskId);
    expect(history).toHaveLength(count);expect(history.every(run=>run.status==='completed')).toBe(true);
    expect(f.app.runtime.Snapshot().pressure.activeRuns).toBe(0);
  },{timeout:30000,interval:50});
  return history;
}

it('registers one real main instance per conversation root, keeps empty chats task-free, and preserves each identity across resume and reopen',async()=>{
  const f=await fixture(),local=await provider(()=>({text:'普通对话已完成，没有创建业务任务。'}));
  try{
    await configure(f,local.url);const entry=await f.app.Dispatch('add',{path:f.a});
    const options={permission:'read',turnTimeoutMs:15000};
    const first=await f.app.Dispatch('loop.chat',{id:entry.id,message:'MAIN_FIRST_SESSION: 你好，只做普通交流',options}) as {taskId:string;runId:string};
    const firstHistory=await completedThread(f,entry.id,first.taskId,1);
    const graph=(rootSessionId:string)=>f.app.Dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId}}) as Promise<GraphSnapshot>;
    const firstGraph=await graph(first.taskId),mainBinding=firstHistory[0].conversationBinding!;
    expect(mainBinding).toMatchObject({workspaceId:entry.id,rootSessionId:first.taskId,agentId:'cbim:main',agentInstanceId:firstGraph.root.agent.agentInstanceId});
    expect(firstGraph.tasks).toEqual([]);expect(firstGraph.edges).toEqual([]);
    expect(firstGraph.agents).toHaveLength(1);
    expect(firstGraph.root.agent.agentSessionId).not.toBe(mainBinding.agentSessionId);

    const second=await f.app.Dispatch('loop.chat',{id:entry.id,message:'MAIN_SECOND_SESSION: 另一个独立会话',options}) as {taskId:string;runId:string};
    const secondHistory=await completedThread(f,entry.id,second.taskId,1),secondGraph=await graph(second.taskId);
    expect(secondHistory[0].conversationBinding).toMatchObject({rootSessionId:second.taskId,agentInstanceId:secondGraph.root.agent.agentInstanceId});
    expect(secondGraph.root.agent.agentInstanceId).not.toBe(firstGraph.root.agent.agentInstanceId);
    expect(secondHistory[0].sessionFile).not.toBe(firstHistory[0].sessionFile);
    expect(secondGraph.tasks).toEqual([]);
    expect(JSON.stringify(local.requests[1].messages)).not.toContain('MAIN_FIRST_SESSION');

    const resumed=await f.app.Dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:first.runId,message:'FIRST_RESUME: 请继续这个会话',options}) as {runId:string};
    const resumedHistory=await completedThread(f,entry.id,first.taskId,2);
    expect(resumedHistory[1].conversationBinding).toEqual(mainBinding);expect(resumedHistory[1].sessionFile).toBe(firstHistory[0].sessionFile);
    const requestCount=local.requests.length;await f.app.Open(entry.id,true);
    expect(local.requests).toHaveLength(requestCount);
    expect((await graph(first.taskId)).root.agent).toEqual(firstGraph.root.agent);
    expect((await graph(second.taskId)).root.agent).toEqual(secondGraph.root.agent);
    await f.app.Dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:resumed.runId,message:'FIRST_REOPEN: 重开后继续',options});
    const reopenedHistory=await completedThread(f,entry.id,first.taskId,3);
    expect(reopenedHistory.every(run=>JSON.stringify(run.conversationBinding)===JSON.stringify(mainBinding))).toBe(true);
    expect(new Set(reopenedHistory.map(run=>run.sessionFile)).size).toBe(1);
    expect((await graph(first.taskId)).tasks).toEqual([]);
    const snapshot=f.app.runtime.Snapshot();
    expect(snapshot.complete).toBe(true);expect(snapshot.members.filter(member=>member.agentId==='cbim:main')).toHaveLength(2);
    expect(snapshot.tasks.filter(task=>task.source==='dispatch')).toHaveLength(0);
    expect(snapshot.tasks.filter(task=>task.source==='loop')).toHaveLength(2);
    expect(snapshot.runs).toHaveLength(4);expect(snapshot.usage).toMatchObject({runCount:4,total:440,reportedRuns:4,unreportedRuns:0,cost:0});
    const stableUsage=snapshot.usage;await f.app.Open(entry.id,true);
    expect(f.app.runtime.Snapshot().usage).toEqual(stableUsage);expect(local.requests).toHaveLength(4);expect(local.errors).toEqual([]);
  }finally{await f.cleanup();await local.close()}
},90000);

it('executes an explicitly registered custom executor in a separate scoped instance, returns evidence to the original root and counts usage once',async()=>{
  const f=await fixture();
  const mainGoal='EXECUTOR_MAIN_REQUEST: 请核实业务模块文件并提交可验证结果';
  const executorGoal='EXECUTOR_BUSINESS_TASK: 读取 executor-input.txt 并记录事实';
  const mainPrivate='MAIN_CHAT_ONLY_BACKGROUND_14ccef',fact='EXECUTOR_REAL_FILE_FACT_98d1cb',candidate='已读取 executor-input.txt，事实为 '+fact;
  const acceptance=['实际读取 executor-input.txt 并提交读取证据'];
  const mainRequests:ProviderRequest[]=[],taskRequests:ProviderRequest[]=[];
  let moduleId='';let ownerSelection:OwnerExecutionSelection|undefined;
  const local=await provider(body=>{
    const isMain=body.tools?.some(tool=>tool.function.name==='cbim_agent_result_review')===true;
    const requests=isMain?mainRequests:taskRequests,turn=requests.length;requests.push(body);
    if(isMain){
      if(turn===0)return {text:mainPrivate,tool:{id:'dispatch-executor',name:'cbim_agent_call',args:{agentId:ownerSelection!.memberId,message:executorGoal,business:{moduleIds:[moduleId],acceptance}}}};
      expect(turn).toBe(1);
      return {text:JSON.stringify(body.messages).includes(candidate)?'主会话收到执行成员结果：'+fact+'；候选尚未验收。':'缺少正式任务结果。'};
    }
    if(turn===0)return {tool:{id:'executor-plan',name:'cbim_task_plan',args:{expectedVersion:0,goal:executorGoal,reason:'执行主会话已登记的业务任务',acceptance,steps:[{id:'verify',title:'读取文件并核实内容',owner:'默认执行 Agent'}]}}};
    if(turn===1)return {tool:{id:'executor-read',name:'read',args:{path:'executor-input.txt'}}};
    if(turn===2)return {tool:{id:'executor-step',name:'cbim_task_step',args:{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['executor-read']}}};
    if(turn===3)return {tool:{id:'executor-delivery',name:'cbim_delivery_prepare',args:{expectedVersion:2,summary:candidate,limitations:['尚未进行人工业务验收']}}};
    return {text:candidate+'；尚未人工验收。'};
  });
  try{
    await configure(f,local.url);const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),team=await seedTeam(workspace);
    moduleId=team.input.moduleId;
    const closeScope=vi.spyOn(f.app.MemberDispatch(entry.id),'CloseScope');
    const knowledge=await workspace.Snapshot(),modulePath=moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'executor-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'executor-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
    await workspace.Commit(request(knowledge,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
    ownerSelection=(await registerExplicitFixtureOwner(f.app,entry.id,{agentId:'.cbim/team/dev',moduleIds:[moduleId],profileId:(await f.app.models.List()).selectedId!,modelId:'main-instance-fixture'})).selection;
    await fs.writeFile(path.join(f.a,'executor-input.txt'),fact);
    const started=await f.app.Dispatch('loop.chat',{id:entry.id,message:mainGoal,options:{permission:'read',turnTimeoutMs:15000}}) as {taskId:string;runId:string};
    const history=await completedThread(f,entry.id,started.taskId,1),identity={workspaceId:entry.id,rootSessionId:started.taskId};
    await vi.waitFor(()=>expect(closeScope).toHaveBeenCalledTimes(1),{timeout:5000,interval:20});
    const closed=await closeScope.mock.results[0].value,graph=await f.app.Dispatch('dispatch.graphSnapshot',{identity}) as GraphSnapshot;
    const registered=(await workspace.dispatchStore.Read()).agentBusinessRuns!;expect(registered).toHaveLength(1);
    const run=registered[0],b=run.binding,binding=history[0].conversationBinding!;
    expect(graph.tasks).toEqual([]);expect(run).toMatchObject({status:'closed',permission:'read',scopeId:closed.scopeId,parent:{callerTaskId:started.taskId,callerRunId:started.runId,toolCallId:'dispatch-executor'},binding:{agentId:'.cbim/team/dev',rootSessionId:started.taskId}});
    expect(closed).toMatchObject({...identity,status:'closed',outcome:'completed'});expect(closed.goal?.review).toBeUndefined();
    const count=local.requests.length;
    await expect(f.app.Dispatch('dispatch.executionStart',{...identity,taskId:b.taskId,commandId:'cannot-revive-recursive-executor',expectedRevision:1,options:{permission:'read'}})).rejects.toThrow();
    expect(local.requests).toHaveLength(count);
    expect(binding.agentInstanceId).toBe(graph.root.agent.agentInstanceId);expect(b.agentInstanceId).not.toBe(binding.agentInstanceId);expect(b.agentSessionId).not.toBe(binding.agentSessionId);
    const ref=history[0].events.find(e=>e.type==='tool.updated'&&e.data.id==='dispatch-executor'&&e.data.limits)?.data.agentCall;
    expect(ref).toMatchObject({workspaceId:entry.id,callerTaskId:started.taskId,callerRunId:started.runId,toolCallId:'dispatch-executor',taskId:b.taskId,runId:b.runId});
    expect(JSON.stringify(history[0].events.filter(e=>e.type==='message'))).toContain('主会话收到执行成员结果：'+fact);
    const memberRun=await new FileRunStorage().Read(path.join(f.user,entry.id,'loop-engine','tasks',b.taskId,b.runId));
    expect(memberRun.conversationBinding).toBeUndefined();expect(memberRun.memberBinding).toEqual(b);expect(memberRun.events[0].data.agentCall).toEqual(ref);
    expect(memberRun.sessionFile).not.toBe(history[0].sessionFile);
    expect(memberRun.events.find(e=>e.type==='session.bound')?.data.sessionId).not.toBe(history[0].events.find(e=>e.type==='session.bound')?.data.sessionId);
    expect(memberRun.toolReceipts).toContainEqual(expect.objectContaining({toolCallId:'executor-read',outcome:'succeeded'}));
    expect(memberRun.taskProgress?.steps[0].evidence).toEqual(['executor-read']);expect(memberRun.taskProgress?.delivery?.summary).toBe(candidate);
    expect(await fs.readFile(path.join(f.a,'executor-input.txt'),'utf8')).toBe(fact);
    expect(taskRequests).toHaveLength(5);expect(mainRequests).toHaveLength(2);
    expect(JSON.stringify(taskRequests[0].messages)).not.toContain(mainPrivate);expect(JSON.stringify(taskRequests[2].messages)).toContain(fact);
    expect(JSON.stringify(mainRequests[1].messages)).toContain(mainPrivate);expect(JSON.stringify(mainRequests[1].messages)).toContain(candidate);
    expect(taskRequests.every(body=>body.tools?.every(tool=>!tool.function.name.startsWith('cbim_dispatch_')))).toBe(true);
    expect(await f.app.Dispatch('dispatch.messages',{...identity,agentSessionId:graph.root.agent.agentSessionId})).toEqual([]);
    const runtime=f.app.runtime.Snapshot();expect(runtime.complete,JSON.stringify(runtime.workspaces)).toBe(true);
    expect(runtime.runs).toHaveLength(2);expect(runtime.tasks.filter(task=>task.source==='dispatch')).toHaveLength(0);
    expect(runtime.usage).toMatchObject({runCount:2,total:770,reportedRuns:2,unreportedRuns:0,cost:0});
    expect(runtime.runs.filter(r=>r.conversationBinding?.agentInstanceId===binding.agentInstanceId)).toHaveLength(1);
    expect(runtime.runs.filter(r=>r.memberBinding?.agentInstanceId===b.agentInstanceId)).toHaveLength(1);
    const usage=await f.app.Dispatch('dispatch.scopeUsage',{...identity,scopeId:closed.scopeId});
    expect(usage.totals).toMatchObject({registeredRuns:2,tokensComplete:true,tokens:{total:770}});
    const childHistory={workspaceId:entry.id,agentId:b.agentId,sessionId:b.agentSessionId,taskId:b.taskId,runId:b.runId};
    expect((await f.app.Dispatch('agentHistory.runs',{workspaceId:entry.id,agentId:b.agentId,sessionId:b.agentSessionId})).items).toHaveLength(1);
    const archived=await f.app.Dispatch('agentHistory.events',childHistory);expect(archived.mode).toBe('reset');
    const before=local.requests.length;await f.app.Open(entry.id,true);
    expect(f.app.runtime.Snapshot().complete).toBe(true);expect(f.app.runtime.Snapshot().usage).toEqual(runtime.usage);expect((await f.app.Workspace(entry.id).dispatchStore.Read()).agentBusinessRuns).toEqual(registered);
    expect(await f.app.Dispatch('agentHistory.events',childHistory)).toEqual(archived);
    expect((await f.app.Execution(entry.id).Thread(started.taskId)).map(r=>r.conversationBinding)).toEqual([binding]);
    expect(local.requests).toHaveLength(before);expect(local.errors).toEqual([]);
  }finally{await f.cleanup();await local.close()}
},90000);

it.each(['foreign-file','missing-native-id'] as const)('rejects unsafe main conversation native recovery before any model call (%s)',async(corruption)=>{
  const f=await fixture(),local=await provider(()=>({text:'原会话事实，不能被其他主会话读取。'}));
  try{
    await configure(f,local.url);const entry=await f.app.Dispatch('add',{path:f.a}),options={permission:'read',turnTimeoutMs:15000};
    const first=await f.app.Dispatch('loop.chat',{id:entry.id,message:'FIRST_NATIVE_OWNER',options}) as {taskId:string;runId:string};
    const [firstSummary]=await completedThread(f,entry.id,first.taskId,1);
    const second=await f.app.Dispatch('loop.chat',{id:entry.id,message:'SECOND_NATIVE_PRIVATE_HISTORY',options}) as {taskId:string;runId:string};
    const [secondSummary]=await completedThread(f,entry.id,second.taskId,1);
    const expectedNative=firstSummary.events.find(event=>event.type==='session.bound')!.data.sessionId;
    expect(expectedNative).toBeTruthy();expect(expectedNative).not.toBe(secondSummary.events.find(event=>event.type==='session.bound')!.data.sessionId);
    const logFile=path.join(f.user,entry.id,'loop-engine','tasks',first.taskId,first.runId,'events.jsonl');
    const records=(await fs.readFile(logFile,'utf8')).trimEnd().split('\n').map(line=>JSON.parse(line));
    const session=records.find(record=>record.type==='session.bound');
    if(corruption==='foreign-file')session.data.sessionFile=secondSummary.sessionFile;
    else delete session.data.sessionId;
    // Simulate an incorrect recovery file or legacy missing identity; keep the trusted instance binding intact.
    const corrupted=records.map(record=>JSON.stringify(record)).join('\n')+'\n';await fs.writeFile(logFile,corrupted);
    const nativeBefore=await fs.readFile(secondSummary.sessionFile!,'utf8'),count=local.requests.length;
    const resumed=await f.app.Dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:first.runId,message:'THIS_MESSAGE_MUST_NOT_REACH_THE_MODEL',options}) as {runId:string};
    let interrupted:RunSummary|undefined;
    await vi.waitFor(async()=>{
      interrupted=await f.app.Execution(entry.id).Inspect(first.taskId,resumed.runId);
      expect(interrupted.status).toBe('interrupted');expect(f.app.runtime.Snapshot().pressure.activeRuns).toBe(0);
    },{timeout:15000,interval:30});
    expect(interrupted!.conversationBinding).toEqual(firstSummary.conversationBinding);
    expect(interrupted!.events.some(event=>event.type==='session.bound')).toBe(false);
    expect(interrupted!.events.some(event=>event.type==='message'||event.type==='tool.proposed')).toBe(false);
    expect(JSON.stringify(interrupted!.events.at(-1))).toContain(corruption==='foreign-file'?'Pi 原生会话身份与原对话记录不一致':'Pi 恢复记录缺少原生会话身份');
    expect(local.requests).toHaveLength(count);expect(await fs.readFile(secondSummary.sessionFile!,'utf8')).toBe(nativeBefore);
    expect(await fs.readFile(logFile,'utf8')).toBe(corrupted);expect(local.errors).toEqual([]);
  }finally{await f.cleanup();await local.close()}
},90000);
