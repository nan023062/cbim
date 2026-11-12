import {test,expect} from 'vitest';
import {authorizeRunTool} from '../src/backend/core/tools/policy/tool-policy';
import {knowledgeTools} from '../src/backend/scheduler-engine/tools/knowledge-tools';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {memberToolEffects} from '../src/backend/core/team/workspace-member-tools';

test('主岗位工具精确核知识范围，预览可读而提交保留 read/ask/execute 门禁',async()=>{
 for(const [name,effect] of Object.entries(memberToolEffects)){
  const call={id:'call',name,input:{}},descriptor={effects:[effect],native:false,scope:{kind:'knowledge' as const,workspaceId:'workspace'}};
  for(const permission of ['read','ask','execute'] as const){
   let approvals=0;const decision=await authorizeRunTool(call,descriptor,{workspaceId:'workspace',permission,guard:async()=>({allow:true}),approve:async()=>{approvals++;return {allow:false}}});
   expect(decision.allow).toBe(effect!=='knowledge-write'||permission==='execute');expect(approvals).toBe(effect==='knowledge-write'&&permission==='ask'?1:0);
  }
  expect((await authorizeRunTool(call,{...descriptor,scope:{kind:'workspace',workspaceId:'workspace'}},{workspaceId:'workspace',permission:'execute',guard:async()=>({allow:true})})).allow).toBe(false);
 }
});

test('read mode denies both write channels, including forged approvals and shell effects',async()=>{
  let approvals=0;
  for(const effect of ['business-write','knowledge-write','command'] as const){
    const result=await authorizeRunTool({id:'call',name:'write',input:{approved:true,permission:'execute'}},{effects:[effect],native:effect!=='knowledge-write'},{workspaceId:'workspace',permission:'read',guard:async()=>({allow:true}),approve:async()=>{approvals++;return {allow:true}}});
    expect(result.allow).toBe(false);expect(result.effects).toEqual([effect]);
  }
  expect(approvals).toBe(0);
});

test('real Pi executor routes knowledge commit through read, ask and execute modes and persists receipts',async()=>{
  const f=await fixture();let turn=0,args:Record<string,unknown>={};
  const advertisedTools:string[][]=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);advertisedTools.push((body.tools??[]).map((tool:{function:{name:string}})=>tool.function.name));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'unified-'+turn,object:'chat.completion.chunk',created:1,model:'policy-model',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    if(turn++===0){emit({role:'assistant',tool_calls:[{index:0,id:'knowledge-write',type:'function',function:{name:'cbim_knowledge_commit',arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')}
    else{emit({role:'assistant',content:'操作结果已返回。'},null);emit({},'stop')}
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const models=await f.app.models.save({profile:{name:'Policy executor fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,auth:'none',defaultModel:'policy-model',models:[{id:'policy-model',name:'Policy',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),team=await seedTeam(ws);
    const initial=await ws.snapshot(),modulePath=team.input.moduleId+'/module.json';
    const definition=JSON.parse(initial.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'policy-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'policy-review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
    await ws.commit(request(initial,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:modulePath,text:json(definition)}]));
    const profile=models.profiles.find(item=>item.name==='Policy executor fixture')!,registered=await registerExplicitFixtureOwner(f.app,entry.id,{agentId:'.cbim/team/dev',moduleIds:[team.input.moduleId],profileId:profile.id,modelId:'policy-model'}),ownerSelection=registered.selection;
    const dispatch=f.app.memberDispatch(entry.id),manager=f.app.memberExecution(entry.id),identity={workspaceId:entry.id,rootSessionId:'policy-root'};
    for(const permission of ['read','ask','execute'] as const){
      turn=0;
      const snap=await ws.snapshot();args={workspaceId:entry.id,instanceId:ws.instanceId,revision:snap.revision,requestId:randomUUID(),changes:[]};
      const scope=await dispatch.openScope(identity,'policy-'+permission,{message:'Inspect authorization receipts'},'policy-main-'+permission);
      await dispatch.goals.plan(identity,scope.scopeId,'policy-main-'+permission,'policy-plan-'+permission,{expectedRevision:1,objective:'Inspect authorization receipts',constraints:[],criteria:[{id:'receipt',text:'Actual tool authorization receipt',kind:'evidence'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[team.input.moduleId],ownerSelection,criterionIds:['receipt'],reason:'Registered executor'}],reason:'Explicit authorization probe'});
      const assigned=await dispatch.dispatchTask({...identity,commandId:'assign-'+permission,expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[team.input.moduleId],ownerSelection,goal:'验证统一知识写入权限',acceptance:[{id:'receipt',text:'记录真实工具授权回执'}],prerequisites:[]}},scope.scopeId);
      const taskIdentity={...identity,taskId:assigned.taskId};
      const run=await manager.start({...taskIdentity,commandId:'start-'+permission,expectedRevision:1,options:{permission,turnTimeoutMs:20000}});
      if(permission==='ask'){
        await expect.poll(async()=>(await manager.pendingApprovals(taskIdentity)).length,{timeout:10000}).toBe(1);
        const approval=(await manager.pendingApprovals(taskIdentity))[0];expect(approval.name).toBe('cbim_knowledge_commit');await manager.answerApproval(taskIdentity,approval.id,true);
      }
      await manager.waitForSettlement(taskIdentity);
      const result=await new FileRunStorage().read(path.join(f.user,entry.id,'dispatch','runs','tasks',assigned.taskId,run.runId));
      expect(result.status,JSON.stringify(result.events.at(-1))).toBe('completed');
      expect(result.memberBinding).toMatchObject({...taskIdentity,agentId:'.cbim/team/dev',runId:run.runId});
      expect(result.toolReceipts,JSON.stringify(result.events.filter(e=>e.type.startsWith('tool.')))).toMatchObject([{toolCallId:'knowledge-write',outcome:permission==='read'?'denied':'succeeded',workspaceId:entry.id,runId:run.runId,effects:['knowledge-write']}]);
      expect((await manager.inspect(taskIdentity)).task.assignee.agentInstanceId).not.toBe((await dispatch.snapshot(identity)).root.agent.agentInstanceId);
      await dispatch.closeScope(identity,scope.scopeId,'cancelled');
    }
    expect(advertisedTools.every(names=>names.includes('cbim_knowledge_commit')&&!names.includes('cbim_dispatch_task'))).toBe(true);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.cleanup()}
},60000);

test.each(['team','auto'] as const)('real Pi %s main governs knowledge with actual authorization and completes in the main session',async mode=>{
  const f=await fixture();let turn=0,args:Record<string,unknown>={};
  const advertisedTools:string[][]=[],transportErrors:unknown[]=[];
  const server=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);advertisedTools.push((body.tools??[]).map((tool:{function:{name:string}})=>tool.function.name));
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({id:'main-knowledge-'+turn,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      if(turn++===0){emit({role:'assistant',tool_calls:[{index:0,id:'main-knowledge-write',type:'function',function:{name:'cbim_knowledge_commit',arguments:JSON.stringify(args)}}]},null);emit({},'tool_calls')}
      else{emit({role:'assistant',content:'已核实本次知识治理操作结果。'},null);emit({},'stop')}
      res.end('data: [DONE]\n\n');
    }catch(error){transportErrors.push(error);res.writeHead(500);res.end('Local governance fixture failed')}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    await f.app.models.save({profile:{name:'Main governance fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,auth:'none',defaultModel:'main-policy-model',models:[{id:'main-policy-model',name:'Main policy',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),manager=f.app.execution(entry.id);
    for(const permission of ['read','ask','execute'] as const){
      turn=0;
      const snap=await ws.snapshot(),file=snap.files.find(item=>item.path==='.cbim/README.md')!,marker='本次知识治理验证：'+permission;
      args={workspaceId:entry.id,instanceId:ws.instanceId,revision:snap.revision,requestId:randomUUID(),changes:[{path:file.path,text:file.text+'\n'+marker+'\n'}]};
      const requestStart=advertisedTools.length;
      const run=await f.app.dispatch('loop.chat',{id:entry.id,message:'更新团队知识说明并核实结果',options:{permission,collaborationMode:mode,turnTimeoutMs:20000}}) as {taskId:string;runId:string};
      if(permission==='ask'){
        await expect.poll(()=>manager.pendingApprovals(run.taskId).length,{timeout:10000}).toBe(1);
        const approval=manager.pendingApprovals(run.taskId)[0];expect(approval.name).toBe('cbim_knowledge_commit');
        expect((await ws.snapshot()).revision).toBe(snap.revision);
        manager.answerApproval(run.taskId,approval.id,true);
      }
      await expect.poll(async()=>(await manager.inspect(run.taskId,run.runId)).status,{timeout:20000}).not.toBe('running');
      const result=await manager.inspect(run.taskId,run.runId);
      expect(result.status,JSON.stringify(result.events.at(-1))).toBe('completed');
      expect(result.conversationBinding).toMatchObject({workspaceId:entry.id,agentId:'cbim:main',rootSessionId:run.taskId});
      expect(result.toolReceipts,JSON.stringify(result.events.filter(event=>event.type.startsWith('tool.')))).toMatchObject([{toolCallId:'main-knowledge-write',outcome:permission==='read'?'denied':'succeeded',workspaceId:entry.id,runId:run.runId,effects:['knowledge-write']}]);
      expect((await ws.snapshot()).files.find(item=>item.path===file.path)!.text.includes(marker)).toBe(permission!=='read');
      expect(manager.pendingApprovals(run.taskId)).toEqual([]);
      expect((await f.app.memberDispatch(entry.id).snapshot({workspaceId:entry.id,rootSessionId:run.taskId})).tasks).toEqual([]);
      await expect.poll(async()=>(await ws.dispatchStore.read()).scopes?.find(scope=>scope.rootSessionId===run.taskId)?.outcome,{timeout:5000}).toBe('completed');
      for(const names of advertisedTools.slice(requestStart))expect(names.includes('write')).toBe(permission!=='read');
    }
    expect(advertisedTools.length).toBeGreaterThanOrEqual(6);
    for(const names of advertisedTools){
      expect(names).toEqual(expect.arrayContaining(['cbim_knowledge_commit','cbim_object_preview','cbim_object_commit','cbim_dispatch_task']));
    }
    expect(transportErrors).toEqual([]);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.cleanup()}
},60000);

test('ask uses the same approval for knowledge and files; platform denials cannot be bypassed',async()=>{
  let approvals=0;const context={workspaceId:'workspace',permission:'ask' as const,guard:async()=>({allow:true}),approve:async()=>{approvals++;return {allow:true}}};
  for(const effect of ['business-write','knowledge-write'] as const)expect((await authorizeRunTool({id:effect,name:'tool',input:{}},{effects:[effect],native:effect==='business-write'},context)).allow).toBe(true);
  expect(approvals).toBe(2);
  expect((await authorizeRunTool({id:'denied',name:'bash',input:{}},{effects:['command'],native:true},{...context,guard:async()=>({allow:false,reason:'outside'})})).allow).toBe(false);
  expect(approvals).toBe(2);
});
test('internal per-call knowledge permission cannot skip identity or revision and is not retained by the next call',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),tools=knowledgeTools(ws),snap=await ws.snapshot();
    const args={workspaceId:entry.id,instanceId:ws.instanceId,revision:snap.revision,requestId:'unified-test',changes:[],approved:true};
    await expect(tools.callFromRun('cbim_knowledge_commit',args,false)).rejects.toThrow('知识写入权限');
    await expect(tools.callFromRun('cbim_knowledge_refresh',args,false)).rejects.toThrow('知识写入权限');
    await expect(tools.callFromRun('cbim_knowledge_commit',{...args,instanceId:'forged'},true)).rejects.toThrow();
    await expect(tools.callFromRun('cbim_knowledge_commit',{...args,revision:'outdated'},true)).rejects.toThrow();
    const value=await tools.callFromRun('cbim_knowledge_commit',args,true);
    expect(JSON.parse(value.content[0].text)).toMatchObject({state:'committed',workspaceId:entry.id});
    await expect(tools.callFromRun('cbim_knowledge_commit',args,false)).rejects.toThrow('知识写入权限');
    for(const tool of tools.list()){expect(tool.version).toBe(['cbim_knowledge_refresh','cbim_module_registry','cbim_module_get','cbim_object_preview'].includes(tool.name)?2:1);expect(tool.effects?.length).toBeGreaterThan(0)}
  }finally{await f.cleanup()}
});
