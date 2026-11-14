import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {moduleOwnershipDetailSchema,moduleOwnershipPreviewSchema} from '../src/logic/workspace/rules/module-ownership';
import {fixture} from './helpers';
import {request,summary} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {json} from '../src/core/platform/node/serialization';
import {RunJournal} from '../src/logic/execution/storage/run-journal';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import type {TaskSpec,StoredEvent} from '../src/logic/execution/rules/types';
import type {AgentHistoryRoles,AgentHistoryPage,AgentHistorySession,AgentHistoryRun,AgentHistoryEventsRead} from '../src/logic/team/rules/session-history';

/** Real Application + pinned Pi, with a deterministic local provider. History queries never call this provider. */
it('按静态角色聚合真实主会话和独立执行通道，释放及删除定义后历史仍可分页只读查询',async()=>{
  const f=await fixture(),requests:unknown[]=[],transportErrors:unknown[]=[];
  const secretToolBody='HISTORY_PRIVATE_TOOL_BODY_不要公开';
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
      const messages=body.messages as {role:string;content:unknown}[];let lastUser=-1;
      for(let index=messages.length-1;index>=0;index--)if(messages[index].role==='user'){lastUser=index;break}
      const hasResult=messages.slice(lastUser+1).some(message=>message.role==='tool');
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'history-'+requests.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      if(!hasResult){emit({role:'assistant',tool_calls:[{index:0,id:'history-read-'+requests.length,type:'function',function:{name:'read',arguments:JSON.stringify({path:'artifact.txt'})}}]},null);emit({},'tool_calls')}
      else{emit({role:'assistant',content:'已核对公开的工作结果，保留真实运行记录。'},null);emit({},'stop')}
      res.end('data: [DONE]\n\n');
    }catch(error){transportErrors.push(error);res.writeHead(500);res.end('History fixture transport failed')}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const models=await f.app.models.save({profile:{name:'History fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,auth:'none',defaultModel:'history-model',models:[{id:'history-model',name:'History',enabled:true,contextWindow:65536,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const profile=models.profiles.find(item=>item.name==='History fixture')!;
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
    const created=await team.call('cbim_object_preview',{revision:(await workspace.snapshot()).revision,operations:[{kind:'agent',action:'create',parentId:'.cbim/team',slug:'history-helper',data:{name:'历史核验员',summary,capabilities:['核实']},body:'# 工作原则\n核实实际结果。'}]});await team.call('cbim_object_commit',{planId:created.planId},true);
    await fs.writeFile(path.join(f.a,'artifact.txt'),secretToolBody);
    const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'history-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'history-review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
    await registerExplicitFixtureOwner(f.app,entry.id,{agentId:'.cbim/team/history-helper',moduleIds:[team.input.moduleId],profileId:profile.id,modelId:'history-model'});
    const manager=f.app.execution(entry.id),dispatch=f.app.memberDispatch(entry.id),members=f.app.memberExecution(entry.id);
    const waitMain=async(run:{taskId:string;runId:string})=>{
      await expect.poll(async()=>(await manager.inspect(run.taskId,run.runId)).status,{timeout:15000}).toBe('completed');
      await expect.poll(async()=>{const reader=new FileDispatchStore(path.join(f.user,entry.id,'dispatch'),entry.id);try{return (await reader.read()).scopes?.filter(scope=>scope.rootSessionId===run.taskId&&scope.status==='active').length??0}finally{await reader.close()}},{timeout:5000}).toBe(0);
    };
    const first=await f.app.dispatch('loop.chat',{id:entry.id,message:'HISTORY_ROOT_A：核实项目',options:{permission:'read',turnTimeoutMs:15000}}) as {taskId:string;runId:string};await waitMain(first);
    const second=await f.app.dispatch('loop.chat',{id:entry.id,message:'HISTORY_ROOT_B：独立核实项目',options:{permission:'read',turnTimeoutMs:15000}}) as {taskId:string;runId:string};await waitMain(second);
    const continued=await f.app.dispatch('loop.resume',{id:entry.id,taskId:first.taskId,runId:first.runId,message:'HISTORY_ROOT_A_CONTINUED：继续核实',options:{permission:'read',turnTimeoutMs:15000}}) as {taskId:string;runId:string};await waitMain(continued);
    const assigned=[] as {agentId:string;taskId:string;runId:string;rootSessionId:string}[];
    for(const [agentId,rootSessionId,suffix] of [['.cbim/team/history-helper',first.taskId,'default'],[team.input.agentId,second.taskId,'custom'],[team.input.agentId,first.taskId,'custom-another-root']] as const){
      if(suffix==='custom'){
        const control={workspaceId:entry.id,instanceId:workspace.instanceId},current=moduleOwnershipDetailSchema.parse(await f.app.dispatch('workspace.ownerships.get',{...control,moduleId:team.input.moduleId})).view.binding!;
        const change={moduleId:team.input.moduleId,expectedBinding:{bindingId:current.bindingId,revision:current.revision,ownerMemberId:current.ownerMemberId},nextOwner:null,reason:'History fixture explicitly transfers responsibility to the custom position'};
        const preview=moduleOwnershipPreviewSchema.parse(await f.app.dispatch('workspace.ownerships.preview',{...control,change}));
        await f.app.dispatch('workspace.ownerships.commit',{...control,change,commandId:randomUUID(),expectedOwnershipCursor:preview.ownershipCursor,expectedBasis:preview.basis});
        await registerExplicitFixtureOwner(f.app,entry.id,{agentId,moduleIds:[team.input.moduleId],profileId:profile.id,modelId:'history-model'});
      }
      const identity={workspaceId:entry.id,rootSessionId},scope=await dispatch.openScope(identity,'history-'+suffix,{message:'History member tool probe'},'history-main-'+suffix),ownerSelection=(await dispatch.owners.discover([team.input.moduleId])).groups[0].selection!;
      await dispatch.goals.plan(identity,scope.scopeId,'history-main-'+suffix,'history-plan-'+suffix,{expectedRevision:1,objective:'History member tool probe',constraints:[],criteria:[{id:'proof',text:'Preserve the real execution record',kind:'evidence'}],assignments:[{agentId,moduleIds:[team.input.moduleId],ownerSelection,criterionIds:['proof'],reason:'Use the explicitly registered position'}],reason:'Trace a real member run without inventing completed business acceptance'});
      const receipt=await dispatch.dispatchTask({...identity,commandId:'history-assign-'+suffix,expectedParentRevision:1,task:{assigneeAgentId:agentId,moduleIds:[team.input.moduleId],ownerSelection,goal:'HISTORY_MEMBER_'+suffix+'：核实业务产物',acceptance:[{id:'proof',text:'公开真实结果'}],prerequisites:[]}},scope.scopeId);
      const taskIdentity={...identity,taskId:receipt.taskId},run=await members.start({...taskIdentity,commandId:'history-start-'+suffix,expectedRevision:1,options:{permission:'read',turnTimeoutMs:15000}});
      await members.waitForSettlement(taskIdentity);expect((await members.inspect(taskIdentity)).runs.at(-1)?.status).toBe('completed');
      // 这里验证真实运行历史，没有业务交付和主审阅；关闭周期不能虚构业务完成。
      await dispatch.closeScope(identity,scope.scopeId,'cancelled');assigned.push({agentId,taskId:receipt.taskId,runId:run.runId,rootSessionId});
    }
    const store=new FileDispatchStore(path.join(f.user,entry.id,'dispatch'),entry.id);
    try{
      const state=await store.read();
      for(const task of assigned){
        const graph=state.graphs.find(value=>value.identity.rootSessionId===task.rootSessionId)!,node=graph.tasks.find(value=>value.taskId===task.taskId)!;
        expect(state.members.find(value=>value.agentInstanceId===node.assignee.agentInstanceId)).toMatchObject({lifecycle:'released',executionTaskId:task.taskId});
        const main=state.members.find(value=>value.agentInstanceId===graph.root.agent.agentInstanceId);
        expect(main).toBeDefined();expect(main?.lifecycle).not.toBe('released');
      }
    }finally{await store.close()}
    const roles=()=>f.app.dispatch('agentHistory.roles',{workspaceId:entry.id}) as Promise<AgentHistoryRoles>;
    const sessions=(agentId:string,cursor?:string)=>f.app.dispatch('agentHistory.sessions',{workspaceId:entry.id,agentId,limit:1,...(cursor?{cursor}:{})}) as Promise<AgentHistoryPage<AgentHistorySession>>;
    const runs=(agentId:string,sessionId:string,cursor?:string)=>f.app.dispatch('agentHistory.runs',{workspaceId:entry.id,agentId,sessionId,limit:1,...(cursor?{cursor}:{})}) as Promise<AgentHistoryPage<AgentHistoryRun>>;
    const beforeReads=requests.length,startSpy=vi.spyOn(members,'start'),ackSpy=vi.spyOn(members,'acknowledge'),approvalSpy=vi.spyOn(members,'answerApproval'),chatSpy=vi.spyOn(manager,'chat');
    try{
      const roleList=await roles();expect(roleList.roles.filter(role=>role.agentId==='cbim:main')).toHaveLength(1);
      expect(roleList.roles.find(role=>role.agentId==='cbim:main')).toMatchObject({sessionCount:2,runCount:3});
      expect(roleList.roles.find(role=>role.agentId==='.cbim/team/history-helper')).toMatchObject({sessionCount:1,runCount:1});
      expect(roleList.roles.find(role=>role.agentId===team.input.agentId)).toMatchObject({sessionCount:2,runCount:2});
      const firstPage=await sessions('cbim:main');expect(firstPage.items).toHaveLength(1);expect(firstPage.nextCursor).toBeTruthy();
      expect(await sessions('cbim:main')).toEqual(firstPage);
      const lastPage=await sessions('cbim:main',firstPage.nextCursor);expect(lastPage.items).toHaveLength(1);expect(lastPage.nextCursor).toBeUndefined();
      const mainSessions=[...firstPage.items,...lastPage.items];expect(new Set(mainSessions.map(item=>item.sessionId)).size).toBe(2);
      expect(new Set(mainSessions.map(item=>item.agentInstanceId)).size).toBe(2);
      expect(mainSessions.every(item=>item.kind==='conversation'&&item.sessionId===item.agentSessionId)).toBe(true);
      const mainA=mainSessions.find(item=>item.rootSessionId===first.taskId)!;
      const runPage=await runs('cbim:main',mainA.sessionId);expect(runPage.nextCursor).toBeTruthy();
      const nextRun=await runs('cbim:main',mainA.sessionId,runPage.nextCursor);
      expect(new Set([...runPage.items,...nextRun.items].map(item=>item.runId))).toEqual(new Set([first.runId,continued.runId]));expect(nextRun.nextCursor).toBeUndefined();
      await expect(sessions('.cbim/team/history-helper',firstPage.nextCursor)).rejects.toMatchObject({code:'AGENT_HISTORY_CURSOR'});
      const customPage=await sessions(team.input.agentId),otherCustomPage=await sessions(team.input.agentId,customPage.nextCursor);
      const customSessions=[...customPage.items,...otherCustomPage.items];
      expect(new Set(customSessions.map(item=>item.sessionId)).size).toBe(2);
      expect(new Set(customSessions.map(item=>item.agentInstanceId)).size).toBe(2);
      expect(new Set(customSessions.map(item=>item.rootSessionId))).toEqual(new Set([first.taskId,second.taskId]));
      for(const item of assigned){
        const available=item.agentId===team.input.agentId?customSessions:(await sessions(item.agentId)).items;
        const session=available.find(value=>value.rootSessionId===item.rootSessionId)!;
        expect(session).toMatchObject({kind:'task',rootSessionId:item.rootSessionId,runCount:1});expect(session.agentInstanceId).not.toBe(mainSessions.find(value=>value.rootSessionId===item.rootSessionId)?.agentInstanceId);
        const history=await runs(item.agentId,session.sessionId);expect(history.items[0]).toMatchObject({source:'member',binding:'registered',taskId:item.taskId,runId:item.runId,agentId:item.agentId});
      }
      const mainRun={workspaceId:entry.id,agentId:'cbim:main',sessionId:mainA.sessionId,taskId:first.taskId,runId:first.runId};
      const custom=assigned[1],customSession=customSessions.find(value=>value.rootSessionId===custom.rootSessionId)!;
      const customRun={workspaceId:entry.id,agentId:custom.agentId,sessionId:customSession.sessionId,taskId:custom.taskId,runId:custom.runId};
      for(const identity of [mainRun,customRun]){
        const events:StoredEvent[]=[];let cursor:undefined|{runId:string;seq:number};
        for(let page=0;page<50;page++){
          const value=await f.app.dispatch('agentHistory.events',{...identity,limit:3,...(cursor?{cursor}:{})}) as AgentHistoryEventsRead;
          if(value.mode==='noop')break;events.push(...value.events);cursor=value.cursor;if(!value.hasMore)break;
        }
        expect(events.length).toBeGreaterThan(3);expect(events.map(event=>event.seq)).toEqual(Array.from({length:events.length},(_,i)=>i+1));
        expect(events.some(event=>event.type==='message'&&event.data.role==='assistant')).toBe(true);
        expect(events.some(event=>event.type==='tool.finished')).toBe(true);
        const serialized=JSON.stringify(events);expect(serialized).not.toContain(secretToolBody);expect(serialized).not.toContain(JSON.stringify(f.user).slice(1,-1));expect(serialized).not.toMatch(/sessionFile|nativeSessionId|workflowContext|effectiveSkills|agentDefinition/);
        expect(await f.app.dispatch('agentHistory.events',{...identity,cursor,limit:3})).toMatchObject({mode:'noop'});
      }
      for(const bad of [{...customRun,agentId:'cbim:main'},{...customRun,sessionId:mainA.sessionId},{...customRun,taskId:first.taskId},{...customRun,runId:first.runId}])await expect(f.app.dispatch('agentHistory.events',bad)).rejects.toThrow();
      const other=await f.app.dispatch('add',{path:f.b});await expect(f.app.dispatch('agentHistory.events',{...customRun,workspaceId:other.id})).rejects.toThrow();
      expect(startSpy).not.toHaveBeenCalled();expect(ackSpy).not.toHaveBeenCalled();expect(approvalSpy).not.toHaveBeenCalled();expect(chatSpy).not.toHaveBeenCalled();expect(requests.length).toBe(beforeReads);
    }finally{startSpy.mockRestore();ackSpy.mockRestore();approvalSpy.mockRestore();chatSpy.mockRestore()}

    const existing=await sessions(team.input.agentId),oldRun=await runs(team.input.agentId,existing.items[0].sessionId),snap=await workspace.snapshot();
    const preview=await team.call('cbim_object_preview',{revision:snap.revision,operations:[{kind:'skill',action:'delete',id:team.own},{kind:'agent',action:'delete',id:team.input.agentId}]});
    await team.call('cbim_object_commit',{planId:preview.planId},true);
    expect((await workspace.snapshot()).files.some(file=>file.path===team.input.agentId+'/agent.json')).toBe(false);
    expect(await sessions(team.input.agentId)).toEqual(existing);expect(await runs(team.input.agentId,existing.items[0].sessionId)).toEqual(oldRun);
    const knowledgeBefore=await workspace.snapshot(),modelRequests=requests.length;
    await f.app.open(entry.id,true);
    expect((await roles()).roles.find(role=>role.agentId===team.input.agentId)).toMatchObject({sessionCount:2,runCount:2});
    expect(await sessions(team.input.agentId)).toEqual(existing);expect(await runs(team.input.agentId,existing.items[0].sessionId)).toEqual(oldRun);
    expect((await f.app.workspace(entry.id).snapshot()).revision).toBe(knowledgeBefore.revision);
    const projectFiles=await fs.readdir(path.join(f.a,'.cbim'),{recursive:true});expect(projectFiles.some(file=>/agent-history|session-history|events\.jsonl/.test(String(file)))).toBe(false);
    expect(requests.length).toBe(modelRequests);expect(transportErrors).toEqual([]);
  }finally{await f.cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},90000);

it('旧日志按明确静态角色标为 legacy，缺少动态绑定不补造 Session；查看历史不改写原记录',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a});await f.app.stop(entry.id);
    const task:TaskSpec={mode:'chat',taskId:'legacy-task',workspaceId:entry.id,root:f.a,agentId:'.cbim/team/removed-role',goal:'旧角色执行记录',moduleIds:[],acceptance:[]};
    const directory=path.join(f.user,entry.id,'loop-engine','tasks',task.taskId,'legacy-run'),journal=new RunJournal(directory,task,'legacy-run');
    await journal.init();await journal.append({type:'run.started',data:{task,message:task.goal,engine:'historical'}});
    await journal.append({type:'session.bound',data:{sessionFile:path.join(f.user,'private-native-history.jsonl'),sessionId:'old-native-id'}});
    await journal.append({type:'message',data:{role:'assistant',text:'保留旧交付事实。'}});await journal.append({type:'run.settled',data:{status:'completed',acceptance:'not_evaluated'}});await journal.flush();
    const file=path.join(directory,'events.jsonl'),before=await fs.readFile(file,'utf8');
    await f.app.open(entry.id);
    const identity={workspaceId:entry.id,agentId:task.agentId!},roles=await f.app.dispatch('agentHistory.roles',{workspaceId:entry.id}) as AgentHistoryRoles;
    expect(roles.roles.find(role=>role.agentId===task.agentId)).toMatchObject({sessionCount:1,runCount:1});
    const sessions=await f.app.dispatch('agentHistory.sessions',identity) as AgentHistoryPage<AgentHistorySession>;
    expect(sessions.items).toHaveLength(1);expect(sessions.items[0]).toMatchObject({kind:'legacy',sessionId:'legacy:'+task.taskId});
    for(const key of ['agentSessionId','agentInstanceId','rootSessionId'])expect(sessions.items[0]).not.toHaveProperty(key);
    const sessionIdentity={...identity,sessionId:sessions.items[0].sessionId},runs=await f.app.dispatch('agentHistory.runs',sessionIdentity) as AgentHistoryPage<AgentHistoryRun>;
    expect(runs.items).toHaveLength(1);expect(runs.items[0]).toMatchObject({source:'legacy',binding:'legacy',taskId:task.taskId,runId:'legacy-run'});
    for(const key of ['agentSessionId','agentInstanceId','rootSessionId'])expect(runs.items[0]).not.toHaveProperty(key);
    const events=await f.app.dispatch('agentHistory.events',{...sessionIdentity,taskId:task.taskId,runId:'legacy-run'}) as AgentHistoryEventsRead;
    expect(events.mode).toBe('reset');expect(JSON.stringify(events)).toContain('保留旧交付事实。');expect(JSON.stringify(events)).not.toMatch(/private-native-history|old-native-id|sessionFile|nativeSessionId/);
    expect(await fs.readFile(file,'utf8')).toBe(before);
  }finally{await f.cleanup()}
});
