import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {goalCompleteArguments,goalPlanArguments} from './goal-provider-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import type {RunSummary} from '../src/backend/core/brain/types';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {MemberExecutionView} from '../src/backend/core/tasks/member-commands';

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
  await f.app.models.save({profile:{name:'Main instance fixture',api:'openai-completions',baseUrl,auth:'none',defaultModel:'main-instance-fixture',models:[{id:'main-instance-fixture',name:'Fixture',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
}

async function completedThread(f:Awaited<ReturnType<typeof fixture>>,workspaceId:string,taskId:string,count:number){
  let history:RunSummary[]=[];
  await vi.waitFor(async()=>{
    history=await f.app.execution(workspaceId).thread(taskId);
    expect(history).toHaveLength(count);expect(history.every(run=>run.status==='completed')).toBe(true);
    expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0);
  },{timeout:30000,interval:50});
  return history;
}

it('registers one real main instance per conversation root, keeps empty chats task-free, and preserves each identity across resume and reopen',async()=>{
  const f=await fixture(),local=await provider(()=>({text:'普通对话已完成，没有创建业务任务。'}));
  try{
    await configure(f,local.url);const entry=await f.app.dispatch('add',{path:f.a});
    const options={permission:'read',turnTimeoutMs:15000};
    const first=await f.app.dispatch('loop.chat',{id:entry.id,message:'MAIN_FIRST_SESSION: 你好，只做普通交流',options}) as {taskId:string;runId:string};
    const firstHistory=await completedThread(f,entry.id,first.taskId,1);
    const graph=(rootSessionId:string)=>f.app.dispatch('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId}}) as Promise<GraphSnapshot>;
    const firstGraph=await graph(first.taskId),mainBinding=firstHistory[0].conversationBinding!;
    expect(mainBinding).toMatchObject({workspaceId:entry.id,rootSessionId:first.taskId,agentId:'cbim:main',agentInstanceId:firstGraph.root.agent.agentInstanceId});
    expect(firstGraph.tasks).toEqual([]);expect(firstGraph.edges).toEqual([]);
    expect(firstGraph.agents).toHaveLength(1);
    expect(firstGraph.root.agent.agentSessionId).not.toBe(mainBinding.agentSessionId);

    const second=await f.app.dispatch('loop.chat',{id:entry.id,message:'MAIN_SECOND_SESSION: 另一个独立会话',options}) as {taskId:string;runId:string};
    const secondHistory=await completedThread(f,entry.id,second.taskId,1),secondGraph=await graph(second.taskId);
    expect(secondHistory[0].conversationBinding).toMatchObject({rootSessionId:second.taskId,agentInstanceId:secondGraph.root.agent.agentInstanceId});
    expect(secondGraph.root.agent.agentInstanceId).not.toBe(firstGraph.root.agent.agentInstanceId);
    expect(secondHistory[0].sessionFile).not.toBe(firstHistory[0].sessionFile);
    expect(secondGraph.tasks).toEqual([]);
    expect(JSON.stringify(local.requests[1].messages)).not.toContain('MAIN_FIRST_SESSION');

    const resumed=await f.app.dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:first.runId,message:'FIRST_RESUME: 请继续这个会话',options}) as {runId:string};
    const resumedHistory=await completedThread(f,entry.id,first.taskId,2);
    expect(resumedHistory[1].conversationBinding).toEqual(mainBinding);expect(resumedHistory[1].sessionFile).toBe(firstHistory[0].sessionFile);
    const requestCount=local.requests.length;await f.app.open(entry.id,true);
    expect(local.requests).toHaveLength(requestCount);
    expect((await graph(first.taskId)).root.agent).toEqual(firstGraph.root.agent);
    expect((await graph(second.taskId)).root.agent).toEqual(secondGraph.root.agent);
    await f.app.dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:resumed.runId,message:'FIRST_REOPEN: 重开后继续',options});
    const reopenedHistory=await completedThread(f,entry.id,first.taskId,3);
    expect(reopenedHistory.every(run=>JSON.stringify(run.conversationBinding)===JSON.stringify(mainBinding))).toBe(true);
    expect(new Set(reopenedHistory.map(run=>run.sessionFile)).size).toBe(1);
    expect((await graph(first.taskId)).tasks).toEqual([]);
    const snapshot=f.app.runtime.snapshot();
    expect(snapshot.complete).toBe(true);expect(snapshot.members.filter(member=>member.agentId==='cbim:main')).toHaveLength(2);
    expect(snapshot.tasks.filter(task=>task.source==='dispatch')).toHaveLength(0);
    expect(snapshot.tasks.filter(task=>task.source==='loop')).toHaveLength(2);
    expect(snapshot.runs).toHaveLength(4);expect(snapshot.usage).toMatchObject({runCount:4,total:440,reportedRuns:4,unreportedRuns:0,cost:0});
    const stableUsage=snapshot.usage;await f.app.open(entry.id,true);
    expect(f.app.runtime.snapshot().usage).toEqual(stableUsage);expect(local.requests).toHaveLength(4);expect(local.errors).toEqual([]);
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
    const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true;
    const requests=isMain?mainRequests:taskRequests,turn=requests.length;requests.push(body);
    if(isMain){
      if(turn===0)return {text:mainPrivate,tool:{id:'executor-goal-plan',name:'cbim_goal_plan',args:goalPlanArguments({objective:mainGoal,agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,acceptance})}};
      if(turn===1)return {tool:{id:'dispatch-executor',name:'cbim_dispatch_task',args:{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,goal:executorGoal,acceptance:acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]}}};
      if(turn===2)return {text:'已登记默认执行成员的正式业务任务，等待执行证据。'};
      if(turn===3)return {tool:{id:'executor-goal-inspect',name:'cbim_goal_inspect',args:{}}};
      if(turn===4)return {tool:{id:'executor-goal-review',name:'cbim_goal_review',args:goalCompleteArguments(body,'executor-goal-inspect')}};
      return {text:JSON.stringify(body.messages).includes(candidate)?'主会话收到执行成员结果：'+fact+'；候选尚未验收。':'缺少正式任务结果。'};
    }
    if(turn===0)return {tool:{id:'executor-plan',name:'cbim_task_plan',args:{expectedVersion:0,goal:executorGoal,reason:'执行主会话已登记的业务任务',acceptance,steps:[{id:'verify',title:'读取文件并核实内容',owner:'默认执行 Agent'}]}}};
    if(turn===1)return {tool:{id:'executor-read',name:'read',args:{path:'executor-input.txt'}}};
    if(turn===2)return {tool:{id:'executor-step',name:'cbim_task_step',args:{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['executor-read']}}};
    if(turn===3)return {tool:{id:'executor-delivery',name:'cbim_delivery_prepare',args:{expectedVersion:2,summary:candidate,limitations:['尚未进行人工业务验收']}}};
    return {text:'正式业务任务已提交交付候选。'};
  });
  try{
    await configure(f,local.url);const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
    moduleId=team.input.moduleId;
    const closeScope=vi.spyOn(f.app.memberDispatch(entry.id),'closeScope');
    const knowledge=await workspace.snapshot(),modulePath=moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'executor-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'executor-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
    await workspace.commit(request(knowledge,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
    ownerSelection=(await registerExplicitFixtureOwner(f.app,entry.id,{agentId:'.cbim/team/dev',moduleIds:[moduleId],profileId:(await f.app.models.list()).selectedId!,modelId:'main-instance-fixture'})).selection;
    await fs.writeFile(path.join(f.a,'executor-input.txt'),fact);
    const started=await f.app.dispatch('loop.chat',{id:entry.id,message:mainGoal,options:{permission:'read',turnTimeoutMs:15000}}) as {taskId:string;runId:string};
    const history=await completedThread(f,entry.id,started.taskId,2),identity={workspaceId:entry.id,rootSessionId:started.taskId};
    await vi.waitFor(()=>expect(closeScope).toHaveBeenCalledTimes(1),{timeout:5000,interval:20});
    const closed=await closeScope.mock.results[0].value;
    const graph=await f.app.dispatch('dispatch.graphSnapshot',{identity}) as GraphSnapshot;
    expect(graph.tasks).toHaveLength(1);const task=graph.tasks[0],binding=history[0].conversationBinding!;
    expect(task).toMatchObject({goal:executorGoal,status:'result_ready',assignee:{agentId:'.cbim/team/dev'},modules:[{moduleId}],result:{summary:candidate,evidenceRefs:['executor-read'],acceptance:'not_evaluated'}});
    expect(closed).toMatchObject({...identity,scopeId:task.scopeId,status:'closed',outcome:'completed',goal:{revision:3,review:{decision:'complete'}}});
    await expect(f.app.dispatch('dispatch.executionStart',{...identity,taskId:task.taskId,commandId:'cannot-revive-released-executor',expectedRevision:task.revision,options:{permission:'read'}})).rejects.toMatchObject({code:'MEMBER_RELEASED'});
    expect(binding.agentInstanceId).toBe(graph.root.agent.agentInstanceId);expect(task.assignee.agentInstanceId).not.toBe(graph.root.agent.agentInstanceId);expect(task.assignee.agentSessionId).not.toBe(graph.root.agent.agentSessionId);
    expect(binding.agentSessionId).not.toBe(task.assignee.agentSessionId);
    expect(graph.agents).toHaveLength(2);expect(graph.edges.filter(edge=>edge.kind==='dispatch')).toEqual([expect.objectContaining({fromNodeId:graph.root.nodeId,toNodeId:task.nodeId})]);
    expect(history[1].conversationBinding).toEqual(binding);expect(history[1].sessionFile).toBe(history[0].sessionFile);
    expect(history[1].source).toMatchObject({kind:'member-results',taskIds:[task.taskId]});
    expect(JSON.stringify(history[1].events.filter(event=>event.type==='message'))).toContain('主会话收到执行成员结果：'+fact);
    const member=await f.app.dispatch('dispatch.executionInspect',{...identity,taskId:task.taskId}) as MemberExecutionView;
    expect(member.runs).toHaveLength(1);expect(member.runs[0]).toMatchObject({status:'completed',permission:'read',binding:{agentId:'.cbim/team/dev',agentInstanceId:task.assignee.agentInstanceId,agentSessionId:task.assignee.agentSessionId,rootSessionId:started.taskId}});
    const memberRun=await new FileRunStorage().read(path.join(f.user,entry.id,'dispatch','runs','tasks',task.taskId,member.runs[0].binding.runId));
    expect(memberRun.conversationBinding).toBeUndefined();expect(memberRun.memberBinding).toEqual(member.runs[0].binding);
    expect(memberRun.sessionFile).not.toBe(history[0].sessionFile);
    expect(memberRun.events.find(event=>event.type==='session.bound')?.data.sessionId).not.toBe(history[0].events.find(event=>event.type==='session.bound')?.data.sessionId);
    expect(memberRun.toolReceipts).toContainEqual(expect.objectContaining({toolCallId:'executor-read',outcome:'succeeded'}));
    expect(await fs.readFile(path.join(f.a,'executor-input.txt'),'utf8')).toBe(fact);
    expect(taskRequests).toHaveLength(5);expect(mainRequests).toHaveLength(6);
    expect(JSON.stringify(taskRequests[0].messages)).not.toContain(mainPrivate);
    expect(JSON.stringify(taskRequests[2].messages)).toContain(fact);
    expect(JSON.stringify(mainRequests[3].messages)).toContain(mainPrivate);expect(JSON.stringify(mainRequests[3].messages)).toContain(candidate);
    expect(taskRequests.every(body=>body.tools?.every(tool=>!tool.function.name.startsWith('cbim_dispatch_')))).toBe(true);
    expect(await f.app.dispatch('dispatch.messages',{...identity,agentSessionId:graph.root.agent.agentSessionId})).toEqual([]);

    const runtime=f.app.runtime.snapshot();expect(runtime.complete).toBe(true);
    expect(runtime.members.filter(member=>member.agentId==='cbim:main')).toHaveLength(1);
    expect(runtime.runs).toHaveLength(3);expect(runtime.tasks.filter(task=>task.source==='loop')).toHaveLength(1);expect(runtime.tasks.filter(task=>task.source==='dispatch')).toHaveLength(1);
    expect(runtime.usage).toMatchObject({runCount:3,total:1210,reportedRuns:3,unreportedRuns:0,cost:0});
    expect(runtime.runs.filter(run=>run.conversationBinding?.agentInstanceId===binding.agentInstanceId)).toHaveLength(2);
    expect(runtime.runs.filter(run=>run.memberBinding?.agentInstanceId===task.assignee.agentInstanceId)).toHaveLength(1);
    const before=local.requests.length;await f.app.open(entry.id,true);
    expect(f.app.runtime.snapshot().usage).toEqual(runtime.usage);
    expect((await f.app.dispatch('dispatch.graphSnapshot',{identity}) as GraphSnapshot).tasks).toEqual(graph.tasks);
    expect((await f.app.execution(entry.id).thread(started.taskId)).map(run=>run.conversationBinding)).toEqual([binding,binding]);
    expect(local.requests).toHaveLength(before);expect(local.errors).toEqual([]);
  }finally{await f.cleanup();await local.close()}
},90000);

it.each(['foreign-file','missing-native-id'] as const)('rejects unsafe main conversation native recovery before any model call (%s)',async(corruption)=>{
  const f=await fixture(),local=await provider(()=>({text:'原会话事实，不能被其他主会话读取。'}));
  try{
    await configure(f,local.url);const entry=await f.app.dispatch('add',{path:f.a}),options={permission:'read',turnTimeoutMs:15000};
    const first=await f.app.dispatch('loop.chat',{id:entry.id,message:'FIRST_NATIVE_OWNER',options}) as {taskId:string;runId:string};
    const [firstSummary]=await completedThread(f,entry.id,first.taskId,1);
    const second=await f.app.dispatch('loop.chat',{id:entry.id,message:'SECOND_NATIVE_PRIVATE_HISTORY',options}) as {taskId:string;runId:string};
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
    const resumed=await f.app.dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:first.runId,message:'THIS_MESSAGE_MUST_NOT_REACH_THE_MODEL',options}) as {runId:string};
    let interrupted:RunSummary|undefined;
    await vi.waitFor(async()=>{
      interrupted=await f.app.execution(entry.id).inspect(first.taskId,resumed.runId);
      expect(interrupted.status).toBe('interrupted');expect(f.app.runtime.snapshot().pressure.activeRuns).toBe(0);
    },{timeout:15000,interval:30});
    expect(interrupted!.conversationBinding).toEqual(firstSummary.conversationBinding);
    expect(interrupted!.events.some(event=>event.type==='session.bound')).toBe(false);
    expect(interrupted!.events.some(event=>event.type==='message'||event.type==='tool.proposed')).toBe(false);
    expect(JSON.stringify(interrupted!.events.at(-1))).toContain(corruption==='foreign-file'?'Pi 原生会话身份与原对话记录不一致':'Pi 恢复记录缺少原生会话身份');
    expect(local.requests).toHaveLength(count);expect(await fs.readFile(secondSummary.sessionFile!,'utf8')).toBe(nativeBefore);
    expect(await fs.readFile(logFile,'utf8')).toBe(corrupted);expect(local.errors).toEqual([]);
  }finally{await f.cleanup();await local.close()}
},90000);
