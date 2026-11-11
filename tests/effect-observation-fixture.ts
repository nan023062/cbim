import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Application} from '../src/backend/main/application';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {seedTeam} from './team-fixture';
import {request} from './data/knowledge';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {additionRecords} from './queued-dependency-addition-fixture';
import {globalRuntimeLogBytes} from './global-runtime-fixture';
import {effectFixture as data,type effectObservationProvider} from './effect-observation-provider';
import {loseOriginalEffectResult} from './effect-observation-fault';
import type {RunSummary} from '../src/backend/core/brain/types';

export {additionRecords as effectRecords,globalRuntimeLogBytes as effectLogBytes};
export async function effectWait(check:()=>Promise<boolean>,provider:Awaited<ReturnType<typeof effectObservationProvider>>,label:string){const end=Date.now()+90000;while(Date.now()<end){assert.deepEqual(provider.errors,[]);if(await check())return;await new Promise(resolve=>setTimeout(resolve,30))}throw Error('Effect fixture timeout: '+label)}

/** 完成真实知识、岗位、负责人和模型登记，不修改通用 seedTeam，也不从主模型隐式回退。 */
export async function seedEffectObservation(app:Application,project:string,provider:Awaited<ReturnType<typeof effectObservationProvider>>){
  const saved=await app.models.save({profile:{name:'Effect observation fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Effect fixture',enabled:true,contextWindow:131072,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}),profile=saved.profiles.find(item=>item.name==='Effect observation fixture');assert.ok(profile);
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'effect-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'effect-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:profile.id,modelId:data.model});provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
  return {entry,team,owner,options:{profileId:profile.id,provider:'cbim-'+profile.id,model:data.model,permission:'execute' as const,turnTimeoutMs:60000}};
}

/** 先制造真实文件影响，再在指定桥处丢失结束消息；运行与周期都实际闭合后才返回供显式观察。 */
export async function prepareUnknownEffect(app:Application,user:string,project:string,provider:Awaited<ReturnType<typeof effectObservationProvider>>,unsupported=false,edit=false){
  const seed=await seedEffectObservation(app,project,provider),id=seed.entry.id,fault=unsupported||edit?undefined:loseOriginalEffectResult(project);
  if(edit)await fs.writeFile(path.join(project,data.file),data.editSeedText);
  try{
    const started=await app.dispatch('loop.chat',{id,message:data.oldGoal,options:seed.options}),identity={workspaceId:id,rootSessionId:started.taskId};
    await effectWait(async()=>{const records=await additionRecords(user,id);return records.scopes.length===1&&records.scopes[0].status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0},provider,'original scope closed');
    const records=await additionRecords(user,id),graph:GraphSnapshot=await app.dispatch('dispatch.graphSnapshot',{identity}),task=graph.tasks[0];assert.equal(graph.tasks.length,1);assert.equal(records.scopes[0].outcome,'failed');assert.ok(task);assert.equal(task.runIds.length,1);assert.equal(task.result,undefined);assert.equal(provider.main.length,6);assert.equal(provider.member.length,3);
    const runId=task.runIds[0],toolCallId=unsupported?'effect-old-command':edit?'effect-old-edit':'effect-old-write',subject={kind:'member_run' as const,taskId:task.taskId,runId,toolCallIds:[toolCallId]},directory=path.join(user,id,'dispatch','runs','tasks',task.taskId,runId),summary=await new FileRunStorage().read(directory);
    assert.ok(summary.sessionFile);assert.equal(summary.logIntegrity?.partialTail,false);assert.ok(summary.events.some(event=>event.type==='session.bound'&&event.data.sessionFile===summary.sessionFile&&typeof event.data.sessionId==='string'&&event.data.sessionId.length>0));
    assert.equal(summary.events.filter(event=>event.type==='tool.allowed'&&event.data.id===toolCallId).length,1);assert.equal(summary.events.filter(event=>event.type==='artifact.baseline_captured').length,0);
    if(!unsupported&&!edit){assert.equal(fault!.events.length,1);assert.ok(summary.unresolvedTools?.includes(toolCallId));assert.equal(summary.events.filter(event=>event.type==='tool.finished'&&event.data.id===toolCallId).length,0);assert.equal(await fs.readFile(path.join(project,data.file),'utf8'),data.oldText)}
    else if(edit){assert.equal(summary.toolReceipts?.find(receipt=>receipt.toolCallId===toolCallId)?.outcome,'succeeded');assert.equal(summary.events.filter(event=>event.type==='tool.finished'&&event.data.id===toolCallId).length,1);assert.equal(await fs.readFile(path.join(project,data.file),'utf8'),data.oldText)}
    else{assert.equal(summary.toolReceipts?.find(receipt=>receipt.toolCallId===toolCallId)?.outcome,'failed');assert.equal(await fs.readFile(path.join(project,data.file),'utf8'),'UNSUPPORTED_NATIVE_EFFECT')}
    const canonical=await fs.readFile(path.join(directory,'events.jsonl')),native=await fs.readFile(summary.sessionFile),sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
    return {seed,started,identity,subject,records,graph,task,summary,original:{canonical,native,canonicalPath:path.join(directory,'events.jsonl'),nativePath:summary.sessionFile,canonicalHash:sha256(canonical),nativeHash:sha256(native)},faultEvents:fault?.events??[]};
  }finally{fault?.restore()}
}

export async function assertOriginalEffectUnchanged(original:Awaited<ReturnType<typeof prepareUnknownEffect>>['original']){assert.deepEqual(await fs.readFile(original.canonicalPath),original.canonical);assert.deepEqual(await fs.readFile(original.nativePath),original.native)}

/** 核实每个真实主/成员绑定；fresh 周期本来就有不同 native，不把它们误判成同一会话文件。 */
export async function effectRunBytes(app:Application,user:string,workspaceId:string,rootSessionId:string){
  assert.equal(app.workspace(workspaceId).entry.id,workspaceId);
  return effectPersistedRunBytes(user,workspaceId,rootSessionId);
}
export async function effectPersistedRunBytes(user:string,workspaceId:string,rootSessionId:string){
  const records=await additionRecords(user,workspaceId),storage=new FileRunStorage();
  // Public thread() intentionally exposes only the current fresh epoch. The persisted tracking
  // lists identify every old and new actual main run without guessing directories or borrowing one epoch.
  const mainIds=[...new Set(records.scopes.filter(scope=>scope.rootSessionId===rootSessionId).flatMap(scope=>scope.runTracking?.mainRunIds??[]))];assert.ok(mainIds.length);
  const main=await Promise.all(mainIds.map(runId=>storage.read(path.join(user,workspaceId,'loop-engine','tasks',rootSessionId,runId))));
  const runs:Array<{kind:'main'|'member';summary:RunSummary}>=main.map(summary=>({kind:'main',summary}));
  for(const run of records.runs.filter(run=>run.binding.rootSessionId===rootSessionId))runs.push({kind:'member',summary:await storage.read(path.join(user,workspaceId,'dispatch','runs','tasks',run.binding.taskId,run.binding.runId))});
  assert.ok(main.length>0);
  return Promise.all(runs.map(async({kind,summary})=>{
    assert.equal(summary.task.workspaceId,workspaceId);assert.equal(summary.logIntegrity?.partialTail,false);const nativePath=summary.sessionFile;assert.ok(nativePath?.trim());assert.ok(nativePath);
    const bounds=summary.events.filter(event=>event.type==='session.bound');assert.ok(bounds.length>0);
    for(const event of bounds){assert.equal(event.data.sessionFile,summary.sessionFile);assert.equal(typeof event.data.sessionId,'string');assert.ok(String(event.data.sessionId).trim())}
    if(kind==='main')assert.equal(summary.conversationBinding?.rootSessionId,rootSessionId);else assert.equal(summary.memberBinding?.rootSessionId,rootSessionId);
    const canonicalPath=path.join(user,workspaceId,...(kind==='main'?['loop-engine','tasks']:['dispatch','runs','tasks']),summary.task.taskId,summary.runId,'events.jsonl');
    return {kind,taskId:summary.task.taskId,runId:summary.runId,nativeSessionId:String(bounds.at(-1)!.data.sessionId),canonicalPath,nativePath,canonical:await fs.readFile(canonicalPath),native:await fs.readFile(nativePath)};
  }));
}
export function effectRunEvidence(runs:Awaited<ReturnType<typeof effectRunBytes>>){return runs.map(({canonical,native,...identity})=>({...identity,canonicalBytes:canonical.length,canonicalHash:createHash('sha256').update(canonical).digest('hex'),nativeBytes:native.length,nativeHash:createHash('sha256').update(native).digest('hex')}))}
export async function archiveEffectRuns(directory:string,user:string,workspaceId:string,runs:Awaited<ReturnType<typeof effectRunBytes>>){
  await fs.mkdir(directory,{recursive:true});await fs.copyFile(path.join(user,workspaceId,'dispatch','dispatch.jsonl'),path.join(directory,'dispatch.jsonl'));
  for(const run of runs){await fs.writeFile(path.join(directory,run.kind+'-'+run.runId+'-canonical.jsonl'),run.canonical);await fs.writeFile(path.join(directory,run.kind+'-'+run.runId+'-native.jsonl'),run.native)}
  await fs.writeFile(path.join(directory,'run-bytes.json'),JSON.stringify(effectRunEvidence(runs),null,2));
}
