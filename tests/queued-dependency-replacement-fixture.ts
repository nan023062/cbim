import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {ReplaceQueuedDependencyReceipt} from '../src/backend/core/tasks/queued-dependency-replacement';
import type {DispatchMutation} from '../src/backend/core/tasks/dispatch-storage';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import {seedTeam} from './team-fixture';
import {request} from './helpers';
import {dependencyReplacementFixture as data} from './queued-dependency-replacement-provider';

export {queuedTaskCancelRecords as dependencyRecords} from './queued-task-cancel-fixture';
export async function dependencyRuns(user:string,workspaceId:string){
  const raw=await fs.readFile(path.join(user,workspaceId,'dispatch','dispatch.jsonl'),'utf8'),runs=new Map<string,DispatchRun>();
  for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){const {body}=JSON.parse(line) as {body:{workspaceId:string;mutation:DispatchMutation}};assert.equal(body.workspaceId,workspaceId);for(const run of body.mutation.runs??[])runs.set(run.binding.runId,run)}
  return [...runs.values()];
}
export async function seedDependencyReplacement(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>void},contextWindow=65536){
  await app.models.save({profile:{name:'Dependency replacement fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:'dependency-replacement-fixture',models:[{id:'dependency-replacement-fixture',name:'Dependency replacement fixture',enabled:true,contextWindow,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'dependency-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'dependency-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const profileId=(await app.models.list()).selectedId!,registered=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId,modelId:'dependency-replacement-fixture'});provider.bind(team.input.agentId,team.input.moduleId,registered.selection);
  await Promise.all(data.files.map((file,index)=>fs.writeFile(path.join(project,file),data.facts[index])));return {entry,team};
}

/** Shared assertions inspect real snapshots and receipt, without writing or inventing scheduler identities. */
export function assertDependencyReplacement(graph:GraphSnapshot,initial:GraphSnapshot,before:GraphSnapshot,receipt:ReplaceQueuedDependencyReceipt,executed:boolean){
  assert.equal(graph.tasks.length,4);const [a,b,c,a2]=data.goals.map(goal=>graph.tasks.find(task=>task.goal===goal)!);assert.ok([a,b,c,a2].every(Boolean));
  assert.deepEqual(graph.root.agent,initial.root.agent);assert.deepEqual(a,before.tasks.find(task=>task.taskId===a.taskId));assert.equal(a.result,undefined);assert.ok(a.help);assert.ok(a2.result);assert.equal(new Set(graph.tasks.map(task=>task.assignee.agentInstanceId)).size,4);
  for(const task of [b,c]){const old=initial.tasks.find(item=>item.goal===task.goal)!;assert.equal(task.taskId,old.taskId);assert.deepEqual(task.assignee,old.assignee);assert.equal(task.planRevision,old.planRevision);assert.deepEqual(task.modules,old.modules);assert.equal(task.goal,old.goal);assert.deepEqual(task.acceptance,old.acceptance);assert.equal(task.runIds.length,executed?1:0)}
  assert.deepEqual(b.dependencyReplacements,[receipt.replacement]);assert.deepEqual(c.dependencyReplacements,undefined);assert.deepEqual(new Set(receipt.trackedTaskIds),new Set([b.taskId,c.taskId]));assert.deepEqual(receipt.replacement.trackedTaskIds,receipt.trackedTaskIds);
  const old=graph.edges.find(edge=>edge.edgeId===receipt.replacement.retired.edgeId),fresh=graph.edges.find(edge=>edge.edgeId===receipt.replacement.replacement.edgeId);assert.ok(old&&fresh);assert.equal(old.enabled,false);assert.equal(old.fromNodeId,a.nodeId);assert.equal(old.toNodeId,b.nodeId);assert.equal(fresh.enabled,true);assert.equal(fresh.fromNodeId,a2.nodeId);assert.equal(fresh.toNodeId,b.nodeId);assert.equal(fresh.kind,'dependency');if(fresh.kind==='dependency')assert.deepEqual(fresh.condition,{kind:'result_ready',planRevision:a2.planRevision,resultId:a2.result!.resultId});
  assert.equal(receipt.replacement.replacement.runId,a2.result!.runId);assert.equal(receipt.replacement.replacement.resultId,a2.result!.resultId);assert.equal(receipt.replacement.reason,data.reason);
  const following=graph.edges.find(edge=>edge.enabled&&edge.kind==='dependency'&&edge.fromNodeId===b.nodeId&&edge.toNodeId===c.nodeId);assert.ok(following);if(executed){assert.equal(b.status,'result_ready');assert.equal(c.status,'result_ready');assert.ok(b.result&&c.result);if(following.kind==='dependency')assert.equal(following.condition.resultId,b.result!.resultId)}
  return {a,b,c,a2};
}
