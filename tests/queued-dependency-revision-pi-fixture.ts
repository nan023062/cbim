import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {ReviseQueuedDependenciesReceipt} from '../src/backend/core/tasks/queued-dependency-revision';
import {seedTeam} from './team-fixture';
import {request} from './data/knowledge';
import {dependencyRevisionData as data} from './queued-dependency-revision-provider';
export {additionRecords as revisionRecords,additionWait as revisionWait,additionRunBytes as revisionRunBytes,additionRunByteEvidence as revisionRunByteEvidence} from './queued-dependency-addition-fixture';
export async function seedDependencyRevision(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>void}){
  await fs.mkdir(project,{recursive:true});await app.models.save({profile:{name:'Dependency revision fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:data.model,enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'revision-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'revision-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const profileId=(await app.models.list()).selectedId!,registered=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId,modelId:data.model});provider.bind(team.input.agentId,team.input.moduleId,registered.selection);
  await Promise.all(data.files.map((file,index)=>fs.writeFile(path.join(project,file),data.facts[index])));return {entry,workspace,team};
}

export function assertDependencyRevision(graph:GraphSnapshot,before:GraphSnapshot,receipt:ReviseQueuedDependenciesReceipt,executed:boolean){
 assert.equal(graph.tasks.length,4);assert.deepEqual(graph.root.agent,before.root.agent);const [a,b,c,d]=data.goals.map(goal=>graph.tasks.find(t=>t.goal===goal)!);assert.ok(a&&b&&c&&d);
 assert.equal(new Set(graph.tasks.map(t=>t.assignee.agentInstanceId)).size,4);
 for(const t of [a,b,c,d]){const old=before.tasks.find(x=>x.taskId===t.taskId)!;assert.ok(old);for(const key of ['taskId','goal','assignee','modules','ownerBinding','acceptance','workflowSelections','planRevision'] as const)assert.deepEqual(t[key],old[key]);assert.equal(t.runIds.length,executed?1:0);if(executed)assert.equal(t.status,'result_ready')}
 assert.equal(receipt.taskId,c.taskId);assert.equal(receipt.status,'waiting');assert.deepEqual(c.dependencyRevisions,[receipt.revision]);assert.equal(receipt.revision.request.reason,data.reason);assert.deepEqual(receipt.trackedTaskIds,before.tasks.map(t=>t.taskId));
 const retired=graph.edges.find(e=>e.edgeId===receipt.revision.removed[0].edgeId)!;assert.equal(retired.enabled,false);assert.equal(retired.fromNodeId,b.nodeId);assert.equal(retired.toNodeId,c.nodeId);assert.equal(retired.revision,2);if(retired.kind==='dependency')assert.equal(retired.condition.resultId,undefined);
 assert.equal(receipt.revision.added.length,2);
 for(const source of [a,d]){const record=receipt.revision.added.find(e=>e.sourceTaskId===source.taskId)!;assert.ok(record);const edge=graph.edges.find(e=>e.edgeId===record.edgeId)!;assert.equal(edge.kind,'dependency');assert.equal(edge.enabled,true);assert.equal(edge.fromNodeId,source.nodeId);assert.equal(edge.toNodeId,c.nodeId);if(edge.kind==='dependency')assert.deepEqual(edge.condition,{kind:'result_ready',planRevision:source.planRevision,...(executed?{resultId:source.result!.resultId}:{})})}
 assert.equal(graph.edges.filter(e=>e.kind==='dependency'&&e.enabled).length,3);
 return {a,b,c,d};
}
