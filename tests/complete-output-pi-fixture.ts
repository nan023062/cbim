import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import type {Application} from '../src/backend/main/assembly/application';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {completeOutputData as d,completeOutputTransitions,type completeOutputProvider} from './complete-output-provider';
export {workflowConditionRecords as completeOutputRecords} from './workflow-condition-fixture';
export {humanContinuationSourceBytes as completeOutputSourceBytes} from './human-continuation-fixture';
export async function seedCompleteOutput(app:Application,project:string,provider:Pick<Awaited<ReturnType<typeof completeOutputProvider>>,'url'|'bind'>,transitions=false){
  const models=await app.models.save({profile:{name:'Complete output acceptance',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:d.model,models:[{id:d.model,name:'Complete output acceptance',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}),profile=models.profiles.find(p=>p.name==='Complete output acceptance');assert.ok(profile);
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(f=>f.path===modulePath)!.text),workflow=team.input.workflowId+'/workflow.md';
  definition.maintenance={bindingId:'full-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'full-review',source:'local_user',confirmedAt:'2026-11-08T00:00:00.000Z'}};
  const contract={version:1,beforeEffects:{requirePlan:true},artifactScope:{version:1,roots:[{path:d.root,kind:'directory'}],...(transitions?{transitions:completeOutputTransitions}:{})},delivery:{requireCompleteManifest:true,requiredToolEvidence:[{id:'read-output',toolName:'read'}],requiredValidations:[{id:'json',validator:'json-schema-v1',artifactPath:d.file,schema:d.schema}]}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:workflow,text:'# 完整集合交付\n\n```cbim-workflow\n'+JSON.stringify(contract,null,2)+'\n```\n'},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:profile.id,modelId:d.model,name:'完整集合执行岗位'});provider.bind(team.input.agentId,team.input.moduleId,owner.selection);await fs.mkdir(path.join(project,d.root,'empty'),{recursive:true});if(transitions){await fs.writeFile(path.join(project,'outputs/old.txt'),'真实删除源文件');await fs.writeFile(path.join(project,'outputs/from.txt'),'\uFEFF真实移动源文件\r\n')}return {entry,contract,profileId:profile.id,agentId:team.input.agentId,moduleId:team.input.moduleId,selection:owner.selection};
}
