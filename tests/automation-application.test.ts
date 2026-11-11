import {expect,it,vi} from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {seedOwnerExecution,ownerExecutionData} from './owner-execution-fixture';
import {FileAutomations} from '../src/backend/main/persistence/tasks/automations';
import {automationActionSchemas} from '../src/bridge/contracts/automation';
import type {AutomationDefinition,AutomationRun,AutomationJob} from '../src/backend/core/automation/contracts';

const definition:AutomationDefinition={name:'自动化只读核实',enabled:true,executor:{kind:'main'},moduleIds:[],workflowSelections:[],skillIds:[],prompt:'读取资料并报告实际结果',permission:'read',schedule:{kind:'manual'}};
async function provider(){
 const calls:{model:string;url:string;body:string}[]=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push({model:body.model,url:req.url??'',body:raw});res.writeHead(200,{'content-type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'automation-'+calls.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');emit({role:'assistant',content:'本轮已结束，尚未取得业务验收证据。'});emit({},'stop');res.end('data: [DONE]\n\n')});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('listen');const url='http://127.0.0.1:'+address.port;
 return {calls,urls:{main:url+'/main',a:url+'/a',b:url+'/b'},close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve())})};
}
it('实际 IPC 校验工作区实例并持久保存；重开不启动，损坏数据不覆写为空',async()=>{
 const f=await fixture(),p=await provider();try{
  const seed=await seedOwnerExecution(f.app,f.a,p.urls),identity={workspaceId:seed.entry.id,instanceId:f.app.workspace(seed.entry.id).instanceId};
  const catalog=await f.app.dispatch('automation.catalog',identity);expect(catalog.agents).toHaveLength(2);expect(catalog.modules.some((m:{id:string})=>m.id===seed.modules[0])).toBe(true);
  const initial=await f.app.dispatch('agent.mainSettings',identity);await f.app.dispatch('agent.configureMain',{...initial,selection:{engine:'pi',profileId:seed.profiles[0].id,modelId:seed.profiles[0].modelId}});
  const job=await f.app.dispatch('automation.save',{...identity,id:randomUUID(),expectedRevision:0,definition});
  expect(p.calls).toEqual([]);expect(automationActionSchemas['automation.save'].safeParse({...identity,expectedRevision:0,definition,root:f.b}).success).toBe(false);
  await expect(f.app.dispatch('automation.save',{...identity,instanceId:randomUUID(),expectedRevision:job.revision,id:job.id,definition})).rejects.toMatchObject({code:'STALE_INSTANCE'});
  await f.app.open(identity.workspaceId,true);const next={...identity,instanceId:f.app.workspace(identity.workspaceId).instanceId};expect((await f.app.dispatch('automation.list',next)).jobs).toEqual([job]);expect(p.calls).toEqual([]);
  await expect(f.app.dispatch('automation.list',identity)).rejects.toMatchObject({code:'STALE_INSTANCE'});
  const file=path.join(f.user,identity.workspaceId,'bad-automations.json');await fs.writeFile(file,'broken');await expect(new FileAutomations(file,identity.workspaceId).read()).rejects.toThrow();expect(await fs.readFile(file,'utf8')).toBe('broken');
 }finally{await f.cleanup();await p.close()}
},60000);
it('真实 Pi：主 Agent 使用主配置，团队任务已正式派发且成员使用岗位模型，历史指向原会话',async()=>{
 const f=await fixture(),p=await provider();try{
  const seed=await seedOwnerExecution(f.app,f.a,p.urls),id=seed.entry.id,identity={workspaceId:id,instanceId:f.app.workspace(id).instanceId},initial=await f.app.dispatch('agent.mainSettings',identity);
  await f.app.dispatch('agent.configureMain',{...initial,selection:{engine:'pi',profileId:seed.profiles[0].id,modelId:seed.profiles[0].modelId}});
  const saved=await f.app.dispatch('automation.save',{...identity,expectedRevision:0,definition:{...definition,executor:{kind:'member',memberId:seed.positions[0].member.memberId},moduleIds:[seed.modules[0]],skillIds:[seed.team.shared]}}) as AutomationJob;
  const run=await f.app.dispatch('automation.run',{...identity,id:saved.id,expectedRevision:saved.revision}) as AutomationRun;
  try{await vi.waitFor(()=>expect(p.calls.some(c=>c.model===ownerExecutionData.models[0])).toBe(true),{timeout:20000,interval:50})}catch(error){const state=await f.app.dispatch('automation.list',identity),dispatch=await f.app.workspace(id).dispatchStore.read();throw Error(JSON.stringify({runs:state.runs.map((r:AutomationRun)=>({status:r.status,message:r.message,taskId:r.taskId,runId:r.runId})),calls:p.calls.map(c=>({model:c.model,url:c.url})),scopes:dispatch.scopes,graphs:dispatch.graphs.map(g=>({identity:g.identity,tasks:g.tasks.map(t=>({taskId:t.taskId,status:t.status}))}))}));}
  const history=await f.app.dispatch('automation.list',identity),stored=history.runs.find((item:AutomationRun)=>item.id===run.id) as AutomationRun;expect(stored.taskId).toBeTruthy();expect(stored.runId).toBeTruthy();
  const graph=await f.app.memberDispatch(id).snapshot({workspaceId:id,rootSessionId:stored.taskId!});expect(graph.tasks).toHaveLength(1);expect(graph.tasks[0].ownerBinding?.memberId).toBe(seed.positions[0].member.memberId);expect(graph.tasks[0].ownerBinding?.model.modelId).toBe(ownerExecutionData.models[0]);
  expect(p.calls[0].model).toBe(ownerExecutionData.mainModel);expect(p.calls.some(c=>c.model===ownerExecutionData.models[1])).toBe(false);expect((await f.app.execution(id).threadView(stored.taskId!)).runs[0].runId).toBe(stored.runId);
  await f.app.dispatch('automation.toggle',{...identity,id:saved.id,expectedRevision:saved.revision,enabled:false});expect((await f.app.dispatch('automation.list',identity)).runs.find((item:AutomationRun)=>item.id===run.id).status).toBe('cancelled');
  await expect(f.app.dispatch('automation.save',{...identity,expectedRevision:0,definition:{...definition,executor:{kind:'member',memberId:seed.positions[1].member.memberId},moduleIds:[seed.modules[0]]}})).rejects.toMatchObject({code:'AUTOMATION_OWNER'});
 }finally{await f.cleanup();await p.close()}
},90000);
