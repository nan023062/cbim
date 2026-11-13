import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/assembly/application';
import type {RunSummary} from '../src/logic/execution/rules/types';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {originalCommandData as data,originalFaultCall,type OriginalCommandMode,type originalCommandProvider} from './original-command-provider';
import {workflowConditionRecords} from './workflow-condition-fixture';
import {globalRuntimeLogBytes} from './global-runtime-fixture';
import {additionRunBytes,additionRunByteEvidence} from './queued-dependency-addition-fixture';
export {workflowConditionRecords as originalCommandRecords,globalRuntimeLogBytes as originalCommandLogBytes,additionRunBytes as originalCommandRunBytes,additionRunByteEvidence as originalCommandByteEvidence};

export async function seedOriginalCommand(app:Application,project:string,provider:Awaited<ReturnType<typeof originalCommandProvider>>){
  const models=await app.models.save({profile:{name:'Original command verification fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Original command fixture',enabled:true,contextWindow:131072,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}),profile=models.profiles.find(item=>item.name==='Original command verification fixture');assert.ok(profile);
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'original-command-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'original-command-review',source:'local_user',confirmedAt:'2026-11-08T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:profile.id,modelId:data.model});await fs.writeFile(path.join(project,data.file),data.fact);provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
  return {entry,team,owner,options:{profileId:profile.id,model:data.model,permission:'read' as const,turnTimeoutMs:60000}};
}

/** 故障只包本 Application 的真实方法：成功后破坏输出，或明确在未调用真实提交前失败；不手写日志／回执。 */
export function installOriginalCommandFault(app:Application,id:string,mode:OriginalCommandMode){
  const service=app.memberDispatch(id),plan=service.goals.plan,dispatch=service.dispatchTask,counts={planCalls:0,planCommits:0,dispatchCalls:0,dispatchCommits:0};
  service.goals.plan=async function(...args){counts.planCalls++;if(mode==='absent-plan')throw Error('TEST_BEFORE_COMMIT: isolated test failure before the real plan transaction');const result=await plan.apply(this,args);counts.planCommits++;return mode==='bad-plan'?{...result,scopeId:undefined}as unknown as typeof result:result};
  service.dispatchTask=async function(...args){counts.dispatchCalls++;const result=await dispatch.apply(this,args);counts.dispatchCommits++;return mode==='bad-dispatch'?{...result,cursor:{...result.cursor,rootSessionId:'invalid-wire-root'}}:result};
  return {counts,restore:()=>{service.goals.plan=plan;service.dispatchTask=dispatch}};
}

export async function waitOriginalCommand(check:()=>Promise<boolean>,provider:Awaited<ReturnType<typeof originalCommandProvider>>,label:string){
  const end=Date.now()+90000;while(Date.now()<end){assert.deepEqual(provider.errors,[]);if(await check())return;await new Promise(resolve=>setTimeout(resolve,30))}throw Error('Original command timed out: '+label);
}

/** 可由 Pi 单测或桌面种子共用，关闭前等待真实调度终态；模型轮次结束不等于周期闭合。 */
export async function executeOriginalCommandSeed(app:Application,user:string,project:string,provider:Awaited<ReturnType<typeof originalCommandProvider>>,mode:OriginalCommandMode){
  const seeded=await seedOriginalCommand(app,project,provider),id=seeded.entry.id,fault=installOriginalCommandFault(app,id,mode);
  try{
    const started=await app.dispatch('loop.chat',{id,message:data.goal,options:seeded.options}),records=()=>workflowConditionRecords(user,id);
    if(mode==='absent-plan'){await waitOriginalCommand(async()=>provider.state.absentReady===true,provider,'actual absent self report');const stopping=app.dispatch('loop.stop',{id,taskId:started.taskId});provider.release();await stopping}
    await waitOriginalCommand(async()=>{const saved=await records();return saved.scopes.length>0&&saved.scopes.every(scope=>scope.status==='closed')&&app.runtime.snapshot().pressure.activeRuns===0},provider,'all persisted scopes settled');
    const saved=await records(),identity={workspaceId:id,rootSessionId:started.taskId},graph:GraphSnapshot=await app.dispatch('dispatch.graphSnapshot',{identity}),thread=await app.execution(id).thread(started.taskId),query={...identity,runId:started.runId,toolCallId:originalFaultCall(mode)};
    assert.equal(provider.state.runId,started.runId);assert.equal(saved.scopes[0].outcome,mode==='absent-plan'?'cancelled':'completed');assert.deepEqual(fault.counts,{planCalls:1,planCommits:mode==='absent-plan'?0:1,dispatchCalls:mode==='absent-plan'?0:1,dispatchCommits:mode==='absent-plan'?0:1});assert.equal(provider.main.length,mode==='absent-plan'?5:10);assert.equal(provider.member.length,mode==='absent-plan'?0:5);
    const source=thread[0]as RunSummary;assert.ok(source.sessionFile);assert.equal(source.logIntegrity?.partialTail,false);assert.ok(source.events.some(event=>event.type==='session.bound'&&typeof event.data.sessionId==='string'&&event.data.sessionId.length>0&&event.data.sessionFile===source.sessionFile));assert.equal(source.toolReceipts?.find(receipt=>receipt.toolCallId===query.toolCallId)?.outcome,'failed');
    assert.equal(graph.tasks.length,mode==='absent-plan'?0:1);if(mode!=='absent-plan'){assert.deepEqual(graph.tasks[0].result?.evidenceRefs,['original-member-read']);assert.equal(graph.tasks[0].result?.acceptance,'not_evaluated')}
    const runBytes=await additionRunBytes(user,id,started.taskId,thread,saved.runs),logs=await globalRuntimeLogBytes(user,id);
    return {seeded,started,query,saved,graph,thread,runBytes,logs,faultCounts:structuredClone(fault.counts)};
  }finally{fault.restore()}
}

/** 将真实原字节独立保留到 ignored 验收目录；可清隔离运行目录，不丢失失败／查无记录的证据。 */
export async function archiveOriginalCommandEvidence(directory:string,user:string,workspaceId:string,runs:Awaited<ReturnType<typeof additionRunBytes>>){
  await fs.mkdir(directory,{recursive:true});await fs.copyFile(path.join(user,workspaceId,'dispatch','dispatch.jsonl'),path.join(directory,'dispatch.jsonl'));
  for(const run of runs){const prefix=run.kind+'-'+run.runId;await fs.writeFile(path.join(directory,prefix+'-canonical.jsonl'),run.canonical);await fs.writeFile(path.join(directory,prefix+'-native.jsonl'),run.native)}
  await fs.writeFile(path.join(directory,'run-bytes.json'),JSON.stringify(additionRunByteEvidence(runs),null,2));
}
