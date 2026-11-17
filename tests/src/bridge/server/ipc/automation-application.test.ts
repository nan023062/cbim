// bridge/server/ipc: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {expect,it,vi} from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from '../../../logic/application/support/helpers';
import {seedOwnerExecution,ownerExecutionData} from '../../../logic/team/service/support/owner-execution-fixture';
import {FileAutomations} from '../../../../../src/logic/automation/service/storage';
import {automationActionSchemas} from '../../../../../src/bridge/contracts/automation';
import type {AutomationDefinition,AutomationRun,AutomationJob} from '../../../../../src/logic/automation/rules/contracts';

const definition:AutomationDefinition={name:'自动化只读核实',enabled:true,executor:{kind:'main'},moduleIds:[],workflowSelections:[],skillIds:[],prompt:'读取资料并报告实际结果',permission:'read',schedule:{kind:'manual'}};
async function provider(){
 const calls:{model:string;url:string;body:string}[]=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push({model:body.model,url:req.url??'',body:raw});res.writeHead(200,{'content-type':'text/event-stream'});const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'automation-'+calls.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');emit({role:'assistant',content:'本轮已结束，尚未取得业务验收证据。'});emit({},'stop');res.end('data: [DONE]\n\n')});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('listen');const url='http://127.0.0.1:'+address.port;
 return {calls,urls:{main:url+'/main',a:url+'/a',b:url+'/b'},close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve())})};
}
it('实际 IPC 校验工作区实例并持久保存；重开不启动，损坏数据不覆写为空',async()=>{
 const f=await fixture(),p=await provider();try{
  const seed=await seedOwnerExecution(f.app,f.a,p.urls),identity={workspaceId:seed.entry.id,instanceId:f.app.Workspace(seed.entry.id).instanceId};
  const catalog=await f.app.Dispatch('automation.catalog',identity);expect(catalog.agents).toHaveLength(2);expect(catalog.modules.some((m:{id:string})=>m.id===seed.modules[0])).toBe(true);
  const initial=await f.app.Dispatch('agent.mainSettings',identity);await f.app.Dispatch('agent.configureMain',{...initial,selection:{engine:'pi',profileId:seed.profiles[0].id,modelId:seed.profiles[0].modelId}});
  expect(catalog.skills.some((skill:{id:string})=>skill.id==='builtin:knowledge-query')).toBe(true);
  const job=await f.app.Dispatch('automation.save',{...identity,id:randomUUID(),expectedRevision:0,definition:{...definition,skillIds:['builtin:knowledge-query']}});
  expect(p.calls).toEqual([]);expect(automationActionSchemas['automation.save'].safeParse({...identity,expectedRevision:0,definition,root:f.b}).success).toBe(false);
  await expect(f.app.Dispatch('automation.save',{...identity,instanceId:randomUUID(),expectedRevision:job.revision,id:job.id,definition})).rejects.toMatchObject({code:'STALE_INSTANCE'});
  await f.app.Open(identity.workspaceId,true);const next={...identity,instanceId:f.app.Workspace(identity.workspaceId).instanceId};expect((await f.app.Dispatch('automation.list',next)).jobs).toEqual([job]);expect(p.calls).toEqual([]);
  await expect(f.app.Dispatch('automation.list',identity)).rejects.toMatchObject({code:'STALE_INSTANCE'});
  const file=path.join(f.user,identity.workspaceId,'bad-automations.json');await fs.writeFile(file,'broken');await expect(new FileAutomations(file,identity.workspaceId).Read()).rejects.toThrow();expect(await fs.readFile(file,'utf8')).toBe('broken');
 }finally{await f.cleanup();await p.close()}
},60000);
