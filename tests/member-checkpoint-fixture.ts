import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import type {Application} from '../src/backend/main/application';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {memberCheckpointFixture as data} from './member-checkpoint-provider';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
export {queuedTaskCancelRecords as checkpointRecords} from './queued-task-cancel-fixture';
export {dependencyRuns as checkpointRuns} from './queued-dependency-replacement-fixture';

/** Isolated fixture: the A marker is deliberately absent until the actual member's native write. */
export async function seedMemberCheckpoint(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>void}){
  const models=await app.models.save({profile:{name:'Member checkpoint fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Member checkpoint fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'checkpoint-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'checkpoint-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:models.profiles.find(profile=>profile.name==='Member checkpoint fixture')!.id,modelId:data.model});provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
  for(let i=1;i<data.files.length;i++)await fs.writeFile(path.join(project,data.files[i]),data.facts[i]);return {entry,team};
}

/** Stable identity and actual run records, not status labels, prove original member/task resumption. */
export function assertCheckpointGraph(graph:GraphSnapshot,parked:GraphSnapshot,runs:DispatchRun[],resumed:boolean){
  assert.equal(graph.tasks.length,3);assert.deepEqual(graph.root.agent,parked.root.agent);
  const nodes=data.goals.map(goal=>{const node=graph.tasks.find(task=>task.goal===goal);assert.ok(node);return node}),original=data.goals.map(goal=>parked.tasks.find(task=>task.goal===goal)!);
  for(let i=0;i<nodes.length;i++){assert.equal(nodes[i].taskId,original[i].taskId);assert.deepEqual(nodes[i].assignee,original[i].assignee);assert.deepEqual(nodes[i].modules,original[i].modules);assert.equal(nodes[i].planRevision,original[i].planRevision);assert.deepEqual(nodes[i].acceptance,original[i].acceptance)}
  const [a,b,c]=nodes;assert.deepEqual(a.checkpoints,original[0].checkpoints);assert.equal(a.checkpoints?.length,1);assert.equal(a.help,undefined);
  const aRuns=runs.filter(run=>run.binding.taskId===a.taskId),first=aRuns.find(run=>run.binding.runId===a.checkpoints![0].binding.runId);assert.ok(first);assert.equal(first.status,'completed');assert.ok(first.checkpointProof);assert.equal(first.checkpointProof.checkpoint.checkpointId,a.checkpoints![0].checkpointId);
  assert.equal(aRuns.length,resumed?2:1);assert.equal(a.runIds.length,resumed?2:1);assert.equal(b.runIds.length,resumed?1:0);assert.equal(c.runIds.length,resumed?1:0);
  if(resumed){
    const next=aRuns.find(run=>run.binding.runId!==first.binding.runId);assert.ok(next);assert.equal(next.status,'completed');assert.deepEqual(next.resumeFrom,{checkpointId:a.checkpoints![0].checkpointId,runId:first.binding.runId});
    for(const key of ['workspaceId','rootSessionId','taskId','agentId','agentInstanceId','agentSessionId','planRevision'] as const)assert.equal(next.binding[key],first.binding[key]);
    assert.equal(next.binding.leaseEpoch,first.binding.leaseEpoch+1);assert.deepEqual(next.session,first.session);assert.equal(next.prepared.knowledgeRevision,first.prepared.knowledgeRevision);assert.equal(next.permission,first.permission);
    assert.equal(a.result?.runId,next.binding.runId);assert.deepEqual(a.result?.evidenceRefs,['checkpoint-resumed-read']);assert.equal(b.status,'result_ready');assert.equal(c.status,'result_ready');
    assert.deepEqual(runs.find(run=>run.binding.taskId===b.taskId)?.prerequisites,[{taskId:a.taskId,planRevision:a.planRevision,result:a.result}]);assert.deepEqual(runs.find(run=>run.binding.taskId===c.taskId)?.prerequisites,[{taskId:b.taskId,planRevision:b.planRevision,result:b.result}]);
  }else{assert.equal(a.result,undefined);assert.ok(!runs.some(run=>[b.taskId,c.taskId].includes(run.binding.taskId)))}
  return {a,b,c,first};
}

/** Snapshot real canonical bytes only after run settlement; native session changes on legitimate continuation. */
export async function checkpointLogBytes(user:string,workspaceId:string,runs:DispatchRun[]){
  return Object.fromEntries(await Promise.all(runs.map(async run=>{const file=path.join(user,workspaceId,'dispatch','runs','tasks',run.binding.taskId,run.binding.runId,'events.jsonl');return [run.binding.runId,await fs.readFile(file,'utf8')] as const})));
}
