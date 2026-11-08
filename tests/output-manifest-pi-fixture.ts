import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import type {Application} from '../src/backend/main/application';
import {request} from './helpers';
import {seedTeam} from './team-fixture';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {outputManifestData as d,type outputManifestProvider} from './output-manifest-provider';
import {outputManifestReportSchema} from '../src/backend/core/tasks/output-manifest';
import {outputManifestHash} from '../src/backend/core/tasks/output-manifest-evidence';
import {hash} from '../src/backend/core/foundation/serialization';
export {workflowConditionRecords as manifestRecords} from './workflow-condition-fixture';
export {reportFiles as manifestLogFiles} from './execution-report-fixture';

export async function seedOutputManifest(app:Application,project:string,provider:Pick<Awaited<ReturnType<typeof outputManifestProvider>>,'url'|'bind'>){
  const models=await app.models.save({profile:{name:'Complete output manifest fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:d.model,models:[{id:d.model,name:'Complete manifest fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}),profile=models.profiles.find(item=>item.name==='Complete output manifest fixture');assert.ok(profile);
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text),workflow=team.input.workflowId+'/workflow.md';
  definition.maintenance={bindingId:'manifest-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'manifest-review',source:'local_user',confirmedAt:'2026-11-08T00:00:00.000Z'}};
  const contract={version:1,artifactScope:{version:1,roots:[{path:d.root,kind:'directory'}]}},text='# 完整产物观察\n\n固定目录范围，只读观察不是交付条件。\n\n```cbim-workflow\n'+JSON.stringify(contract,null,2)+'\n```\n';
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:workflow,text},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:profile.id,modelId:d.model,name:'完整产物观察岗位'});provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
  await fs.mkdir(path.join(project,d.root,'empty'),{recursive:true});await fs.writeFile(path.join(project,d.file),d.content);return {entry,team,contract,workflow};
}
/** 对真实端口完整集合重算身份；目录新增即使旧文件不变也必须 changed。 */
export function assertManifestReport(raw:unknown,state:'matches'|'changed'|'unverifiable',paths?:string[]){
  const report=outputManifestReportSchema.parse(raw);assert.equal(report.consistency,'stable');assert.equal(report.log,'verified');assert.equal(report.coverage,'declared_scope_complete');assert.equal(report.manifests.length,1);const check=report.verification;assert.ok(check);assert.equal(check.state,state);assert.equal(check.manifestId,report.manifests[0].manifestId);
  if(state!=='unverifiable'){assert.ok(check.expected);assert.ok(check.observed);assert.equal(check.expectedHash,outputManifestHash(check.expected));assert.equal(check.observedHash,outputManifestHash(check.observed));assert.deepEqual(check.expected.entries.find(e=>e.relativePath===d.file),{relativePath:d.file,kind:'file',byteLength:Buffer.byteLength(d.content),sha256:hash(d.content)});if(paths)assert.deepEqual(check.observed.entries.map(e=>e.relativePath),paths)}
  return report;
}
