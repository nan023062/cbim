import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Application} from '../src/backend/main/assembly/application';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import type {RunSummary} from '../src/backend/core/execution/types';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {AddQueuedDependencyReceipt} from '../src/backend/core/tasks/queued-dependency-addition';
import type {DispatchMutation,DispatchMessage} from '../src/backend/core/dispatch/dispatch-storage';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import type {AgentInstance} from '../src/backend/core/team/agent-types';
import {seedTeam} from './team-fixture';
import {request} from './data/knowledge';
import {dependencyAdditionData as data} from './queued-dependency-addition-provider';

export async function seedDependencyAddition(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>void}){
  await fs.mkdir(project,{recursive:true});await app.models.save({profile:{name:'Dependency addition fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:data.model,enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'addition-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'addition-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const profileId=(await app.models.list()).selectedId!,registered=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId,modelId:data.model});provider.bind(team.input.agentId,team.input.moduleId,registered.selection);
  await Promise.all(data.files.map((file,index)=>fs.writeFile(path.join(project,file),data.facts[index])));return {entry,workspace,team};
}
/** Read committed journal bodies without opening a second writer or repairing the tested state. */
export async function additionRecords(user:string,workspaceId:string){
  const raw=await fs.readFile(path.join(user,workspaceId,'dispatch','dispatch.jsonl'),'utf8'),scopes=new Map<string,DispatchScope>(),messages=new Map<string,DispatchMessage>(),members=new Map<string,AgentInstance>(),runs=new Map<string,DispatchRun>();
  for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){
    const {body}=JSON.parse(line) as {body:{workspaceId:string;mutation:DispatchMutation}};assert.equal(body.workspaceId,workspaceId);
    for(const scope of body.mutation.scopes??[])scopes.set(scope.scopeId,scope);for(const message of body.mutation.messages??[])messages.set(message.messageId,message);for(const member of body.mutation.members??[])members.set(member.agentInstanceId,member);for(const run of body.mutation.runs??[])runs.set(run.binding.runId,run);
  }
  return {scopes:[...scopes.values()],messages:[...messages.values()],members:[...members.values()],runs:[...runs.values()]};
}
export async function additionWait(check:()=>Promise<boolean>,label:string,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,30))}throw Error('Dependency addition timeout: '+label)}
/** Every actual Pi run must have a real native binding; absent fields never skip restart checks. */
export async function additionRunBytes(user:string,workspaceId:string,rootSessionId:string,main:RunSummary[],members:DispatchRun[]){
  assert.ok(main.length>0);const storage=new FileRunStorage(),snapshots:Array<{kind:'main'|'member';taskId:string;runId:string;nativeSessionId:string;sessionFile:string;canonical:Buffer;native:Buffer}>=[];
  for(const item of [...main.map(summary=>({kind:'main' as const,summary,member:undefined})),...await Promise.all(members.map(async member=>({kind:'member' as const,member,summary:await storage.read(path.join(user,workspaceId,'dispatch','runs','tasks',member.binding.taskId,member.binding.runId))})))]){
    const {summary,kind,member}=item;assert.equal(summary.task.workspaceId,workspaceId);assert.equal(summary.logIntegrity?.partialTail,false);assert.ok(summary.sessionFile?.trim(),`${kind} ${summary.runId} requires a native session file`);
    const bounds=summary.events.filter(event=>event.type==='session.bound');assert.ok(bounds.length>0,`${kind} ${summary.runId} requires a native binding`);
    for(const event of bounds){assert.equal(typeof event.data.sessionId,'string');assert.ok(String(event.data.sessionId).trim());assert.equal(event.data.sessionFile,summary.sessionFile)}
    const nativeSessionId=String(bounds.at(-1)!.data.sessionId);if(member){assert.deepEqual(summary.memberBinding,member.binding);assert.equal(summary.sessionFile,member.session.sessionFile);assert.equal(nativeSessionId,member.session.nativeSessionId)}else{assert.equal(summary.task.taskId,rootSessionId);assert.equal(summary.conversationBinding?.rootSessionId,rootSessionId)}
    const directory=path.join(user,workspaceId,...(kind==='main'?['loop-engine','tasks']:['dispatch','runs','tasks']),summary.task.taskId,summary.runId),canonical=await fs.readFile(path.join(directory,'events.jsonl')),native=await fs.readFile(summary.sessionFile!);assert.ok(canonical.length>0&&native.length>0);
    snapshots.push({kind,taskId:summary.task.taskId,runId:summary.runId,nativeSessionId,sessionFile:summary.sessionFile!,canonical,native});
  }
  assert.equal(new Set(snapshots.filter(item=>item.kind==='main').map(item=>item.nativeSessionId)).size,1);assert.equal(new Set(snapshots.filter(item=>item.kind==='member').map(item=>item.nativeSessionId)).size,members.length);return snapshots;
}
export function additionRunByteEvidence(snapshots:Awaited<ReturnType<typeof additionRunBytes>>){return snapshots.map(({canonical,native,...identity})=>({...identity,canonicalBytes:canonical.length,canonicalSha256:createHash('sha256').update(canonical).digest('hex'),nativeBytes:native.length,nativeSha256:createHash('sha256').update(native).digest('hex')}))}
export function assertDependencyAddition(graph:GraphSnapshot,before:GraphSnapshot,receipt:AddQueuedDependencyReceipt,executed:boolean){
  assert.equal(graph.tasks.length,3);assert.deepEqual(graph.root.agent,before.root.agent);const [a,b,c]=data.goals.map(goal=>graph.tasks.find(task=>task.goal===goal)!);assert.ok(a&&b&&c);assert.equal(new Set(graph.tasks.map(task=>task.assignee.agentInstanceId)).size,3);
  for(const task of [a,b,c]){const old=before.tasks.find(item=>item.taskId===task.taskId)!;assert.ok(old);assert.deepEqual(task.assignee,old.assignee);assert.equal(task.goal,old.goal);assert.equal(task.planRevision,old.planRevision);assert.deepEqual(task.modules,old.modules);assert.deepEqual(task.acceptance,old.acceptance);assert.equal(task.runIds.length,executed?1:0)}
  assert.equal(receipt.taskId,b.taskId);assert.equal(receipt.status,'waiting');assert.deepEqual(b.dependencyAdditions,[receipt.addition]);assert.equal(a.dependencyAdditions,undefined);assert.equal(c.dependencyAdditions,undefined);assert.equal(receipt.addition.reason,data.reason);assert.deepEqual(receipt.trackedTaskIds,[b.taskId,c.taskId,a.taskId]);assert.deepEqual(receipt.addition.trackedTaskIds,receipt.trackedTaskIds);
  assert.equal(receipt.addition.dependency.sourceTaskId,a.taskId);assert.equal(receipt.addition.dependency.sourcePlanRevision,a.planRevision);assert.equal('resultId'in receipt.addition.dependency,false);
  const added=graph.edges.find(edge=>edge.edgeId===receipt.addition.dependency.edgeId),following=graph.edges.find(edge=>edge.kind==='dependency'&&edge.enabled&&edge.fromNodeId===b.nodeId&&edge.toNodeId===c.nodeId);assert.ok(added&&following);assert.equal(added.kind,'dependency');assert.equal(added.enabled,true);assert.equal(added.fromNodeId,a.nodeId);assert.equal(added.toNodeId,b.nodeId);
  assert.equal(graph.edges.filter(edge=>edge.kind==='dependency'&&edge.enabled&&edge.fromNodeId===a.nodeId&&edge.toNodeId===b.nodeId).length,1);
  if(added.kind==='dependency')assert.deepEqual(added.condition,{kind:'result_ready',planRevision:a.planRevision,...(executed?{resultId:a.result!.resultId}:{})});
  if(executed){assert.ok([a,b,c].every(task=>task.status==='result_ready'&&task.result));if(following.kind==='dependency')assert.equal(following.condition.resultId,b.result!.resultId)}
  return {a,b,c};
}
