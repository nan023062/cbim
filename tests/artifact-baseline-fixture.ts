import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {artifactBaselineFixture as data} from './artifact-baseline-provider';
import type {Application} from '../src/backend/main/assembly/application';
import {artifactReportSchema,type ArtifactFileCheck} from '../src/logic/evidence/rules/artifact-baseline';
export {queuedTaskCancelRecords as artifactBaselineRecords} from './queued-task-cancel-fixture';
export {reportFiles as artifactBaselineFiles} from './execution-report-fixture';

/** Caller-owned isolated project/user data; only the localhost model profile is installed. */
export async function seedArtifactBaseline(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,selection?:OwnerExecutionSelection)=>void}){
  await app.models.save({profile:{name:'Artifact baseline fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Artifact baseline fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const knowledge=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'artifact-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'artifact-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
  await workspace.commit(request(knowledge,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:(await app.models.list()).selectedId!,modelId:data.model});
  provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
  for(let i=0;i<data.files.length;i++)await fs.writeFile(path.join(project,data.files[i]),data.facts[i]);
  return {entry,team};
}

/** Compare actual platform fingerprints to known fixture bytes; never supply those hashes to the model. */
export function assertArtifactVerification(raw:unknown,states:ArtifactFileCheck['state'][]){
  const report=artifactReportSchema.parse(raw);assert.equal(report.consistency,'stable');assert.equal(report.log.state,'verified');assert.equal(report.coverage,'selected_files_only');assert.equal(report.impact,'selected_files_only');assert.equal(report.baselines.length,1);assert.ok(report.verification);assert.equal(report.verification.baselineId,report.baselines[0].baselineId);assert.equal(report.verification.files.length,data.files.length);
  for(let i=0;i<data.files.length;i++){
    const file:ArtifactFileCheck|undefined=report.verification.files.find(value=>value.relativePath===data.files[i]);assert.ok(file);assert.equal(file.state,states[i]);
    assert.deepEqual(file.expected,{byteLength:Buffer.byteLength(data.facts[i]),sha256:createHash('sha256').update(data.facts[i]).digest('hex')});
    if(states[i]==='matches')assert.deepEqual(file.observed,file.expected);
    if(states[i]==='changed')assert.deepEqual(file.observed,{byteLength:Buffer.byteLength(data.changed),sha256:createHash('sha256').update(data.changed).digest('hex')});
    if(states[i]==='missing')assert.equal(file.observed,undefined);
  }
  assert.equal(report.verification.state,states.every(value=>value==='matches')?'matches':'changed');return report;
}
