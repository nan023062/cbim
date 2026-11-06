import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {latestExecutable} from './build-artifact.mjs';

// Packaged IPC test: all knowledge, dispatch journals and app state belong to this temporary fixture.
const executable=await latestExecutable();
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-runtime-smoke-'));
const user=path.join(temp,'user'),roots=[path.join(temp,'alpha'),path.join(temp,'beta')];
await Promise.all(roots.map(root=>fs.mkdir(root)));
await fs.mkdir('test-results',{recursive:true});
const report='test-results/runtime-smoke.json',errors=[];
let app,page;
const evidence={packagedExecutable:executable,realProvider:false,multiMemberExecution:false,startedAt:new Date().toISOString(),passed:false};
const stringify=value=>JSON.stringify(value,null,2)+'\n';

async function launch(){
  const env={...process.env,CBIM_USER_DATA_ROOT:user};delete env.ELECTRON_RUN_AS_NODE;delete env.CBIM_SMOKE_ROOT;
  app=await electron.launch({executablePath:executable,env,timeout:60000});
  page=await app.firstWindow({timeout:30000});page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>typeof window.cbim?.call==='function');
  const runtime=await app.evaluate(({app})=>({packaged:app.isPackaged,executable:app.getPath('exe'),userData:app.getPath('userData')}));
  assert.equal(runtime.packaged,true);assert.equal(path.resolve(runtime.executable),path.resolve(executable));
  assert.equal(path.resolve(runtime.userData),path.resolve(user,'desktop'));
  return runtime;
}
async function close(){const active=app;app=undefined;if(active)await active.close()}
const call=(action,args={})=>page.evaluate(({action,args})=>window.cbim.call(action,args),{action,args});

async function seed(workspaceId){
  const snapshot=await call('snapshot',{id:workspaceId});
  const agentId='.cbim/team/engineer',moduleId='.cbim/workspace/game';
  const summary='管理团队客户端资源加载、卸载与缓存，提供加载器和实例生命周期接口。包含异步请求取消、对象池复用、回调有效性检查与过期资源清理，支持定位加载失败、实例释放和重复请求问题。底层资源传输由相关系统提供，本模块负责运行期调用与生命周期管理。';
  const definition={id:moduleId,name:'game',summary,authors:[],sources:[],connectors:[],children:[],overview:'module.md',workflows:[],maintenance:{bindingId:'runtime-smoke-owner',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'runtime-smoke-review',source:'local_user',confirmedAt:new Date().toISOString()}}};
  const changes=[
    {path:agentId+'/agent.json',text:stringify({name:'工程师',summary,authors:[],capabilities:['实现并验证'],limitations:['人工负责业务验收'],work_principles:'principles.md',skills:[],connectors:[]})},
    {path:agentId+'/principles.md',text:'# 工作原则\n先核实职责和模块，报告实际验证证据。\n'},
    {path:'.cbim/team/people.json',text:stringify({people:[{id:'owner',name:'本地测试维护人',team:'.cbim/team'}]})},
    {path:moduleId+'/module.json',text:stringify(definition)},
    {path:moduleId+'/module.md',text:'# game\n\n## 定位\n管理资源。\n\n## 子模块和 source 节点\n无\n\n## 结构关系图与抽象设计决策\n\n```mermaid\nclassDiagram\nclass Game\n```\n无\n\n## 雷区与排障\n无\n\n## 观察模式-待抽象\n无\n'},
  ];
  const request={workspaceId,instanceId:snapshot.instanceId,revision:snapshot.revision,requestId:randomUUID(),changes};
  const preview=await call('preview',request);
  assert.equal(preview.validation.structural,true,JSON.stringify(preview.validation.issues));
  assert.equal((await call('commit',request)).state,'committed');
  assert.equal((await call('snapshot',{id:workspaceId})).validation.structural,true);
  return {agentId,moduleId};
}

try{
  evidence.application=await launch();
  const a=await call('add',{path:roots[0]}),b=await call('add',{path:roots[1]});
  const initial=await call('runtime.snapshot');
  assert.equal(initial.complete,true);assert.equal(initial.pressure.openWorkspaces,2);
  assert.equal(initial.pressure.memberInstances,0);assert.equal(initial.usage.runCount,0);
  assert.deepEqual(await call('runtime.read',{cursor:initial.cursor}),{mode:'noop',cursor:initial.cursor});
  const {agentId,moduleId}=await seed(a.id);
  const identity={workspaceId:a.id,rootSessionId:'smoke-main'},peer={workspaceId:b.id,rootSessionId:'smoke-main'};
  const main=await call('dispatch.open',{...identity,commandId:'open-main'});
  const otherMain=await call('dispatch.open',{...peer,commandId:'open-main'});
  assert.notEqual(main.agent.agentInstanceId,otherMain.agent.agentInstanceId);
  const member=await call('dispatch.memberCreate',{...identity,commandId:'create-engineer',agentId});
  assert.notEqual(member.agent.agentSessionId,main.agent.agentSessionId);
  const command={...identity,commandId:'dispatch-work',expectedParentRevision:1,task:{assigneeAgentId:agentId,moduleIds:[moduleId],goal:'验证任务派发与持久化',acceptance:[{id:'verify',text:'提供真实测试结果'}]}};
  const sent=await call('dispatch.task',command);
  assert.equal(sent.disposition,'queued');
  const delta=await call('dispatch.graphDelta',{identity,cursor:member.cursor});
  assert.equal(delta.mode,'delta');assert.equal(delta.batches.length,1);
  assert.deepEqual(delta.batches[0].changes.map(change=>change.type),['task.upserted','edge.upserted','agent.upserted']);
  const waiting=await call('dispatch.task',{...command,commandId:'dispatch-dependent',task:{...command.task,goal:'等待前置验证结果',prerequisites:[{taskId:sent.taskId,expectedPlanRevision:1}]}});
  assert.equal(waiting.disposition,'waiting');
  const graph=await call('dispatch.graphSnapshot',{identity}),peerGraph=await call('dispatch.graphSnapshot',{identity:peer});
  assert.equal(graph.tasks.length,2);assert.equal(peerGraph.tasks.length,0);
  assert.ok(graph.tasks.every(task=>task.runIds.length===0));
  await assert.rejects(call('dispatch.graphDelta',{identity:peer,cursor:sent.cursor}),/GRAPH_IDENTITY_MISMATCH/);
  const snapshot=await call('runtime.snapshot');
  assert.equal(snapshot.complete,true);
  assert.equal(snapshot.pressure.memberInstances,3);assert.equal(snapshot.pressure.taskInstances,2);
  assert.equal(snapshot.pressure.queuedDispatchTasks,1);assert.equal(snapshot.pressure.waitingDispatchTasks,1);
  assert.equal(snapshot.pressure.pendingOutbox,2);assert.equal(snapshot.pressure.activeRuns,0);
  assert.equal(snapshot.usage.runCount,0);assert.equal(snapshot.usage.usageReported,false);
  assert.deepEqual(await call('dispatch.task',command),sent);
  assert.deepEqual(await call('runtime.read',{cursor:snapshot.cursor}),{mode:'noop',cursor:snapshot.cursor});
  for(const action of ['restartMcp','workspace.restart','discovery','mcpLogs','writeAccess'])await assert.rejects(call(action,{id:a.id}),/ACTION/);
  assert.deepEqual(await call('runtime.read',{cursor:snapshot.cursor}),{mode:'noop',cursor:snapshot.cursor});
  evidence.checks={packagedIpc:true,knowledgePreviewCommit:true,customMember:true,independentWorkspaceInstances:true,dispatchDelta:true,dependencyWaiting:true,graphIsolation:true,idempotentDispatch:true,globalNoop:true,noExternalServiceOrRestartActions:true};
  await page.getByRole('button',{name:'alpha · 运行中',exact:true}).click();
  await page.screenshot({path:'test-results/runtime-smoke.png'});
  await close();await launch();
  const recovered=await call('runtime.snapshot');
  assert.equal(recovered.complete,true);assert.equal(recovered.pressure.openWorkspaces,2);
  assert.equal(recovered.pressure.memberInstances,3);assert.equal(recovered.pressure.taskInstances,2);
  assert.equal(recovered.pressure.pendingOutbox,2);assert.equal(recovered.pressure.activeRuns,0);
  assert.notEqual(recovered.cursor.streamId,snapshot.cursor.streamId);
  assert.ok(recovered.members.every(member=>member.activityCurrent===false));
  assert.deepEqual(await call('dispatch.task',command),sent);
  assert.deepEqual(await call('dispatch.graphSnapshot',{identity}),graph);
  assert.equal((await call('runtime.read',{cursor:snapshot.cursor})).mode,'snapshot');
  await call('remove',{id:b.id});
  const remaining=await call('runtime.snapshot');
  assert.equal(remaining.workspaces.length,1);assert.equal(remaining.workspaces[0].workspaceId,a.id);
  assert.equal(remaining.pressure.taskInstances,2);assert.equal(remaining.pressure.memberInstances,2);
  assert.deepEqual(errors,[]);
  Object.assign(evidence.checks,{applicationRestart:true,stableMemberAndTaskIdentity:true,noFabricatedExecution:true,removeOneWorkspaceKeepsOther:true,noPageErrors:true});
  evidence.pressure=remaining.pressure;evidence.usage=remaining.usage;evidence.passed=true;evidence.completedAt=new Date().toISOString();
  console.log(JSON.stringify(evidence));
}catch(error){evidence.error=error instanceof Error?error.message:String(error);throw error}
finally{
  await fs.writeFile(report,stringify(evidence));
  await close();
  const absolute=await fs.realpath(temp),base=await fs.realpath(os.tmpdir()),relative=path.relative(base,absolute);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(absolute).startsWith('cbim-runtime-smoke-'))throw Error('拒绝清理非本测试临时目录');
  await fs.rm(absolute,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
