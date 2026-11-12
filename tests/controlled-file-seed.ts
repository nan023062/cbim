import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/assembly/application';
import {seedTeam} from './team-fixture';
import {request} from './data/knowledge';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {controlledFileFixture as data} from './controlled-file-provider';

/** 只准备测试自有的既有文件和真实岗位/知识；新工具必须自行读取备份并写独立阶段。 */
export async function seedControlledFile(app:Application,project:string,providerUrl:string){
  const saved=await app.models.save({profile:{name:'Controlled file fixture',api:'openai-completions',baseUrl:providerUrl,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Controlled file fixture',enabled:true,contextWindow:131072,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const profile=saved.profiles.find(item=>item.name==='Controlled file fixture');assert.ok(profile);
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot();
  const modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'controlled-file-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'controlled-file-review',source:'local_user',confirmedAt:'2026-11-08T00:00:00.000Z'}};
  const contract={version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'read-current',toolName:'read'}],requiredValidations:[{id:data.requirementId,validator:'json-schema-v1',artifactPath:data.file,schema:data.schema}]}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:team.input.workflowId+'/workflow.md',text:'# 受控文件验证\n\n真实备份不替代业务验证，受控写后必须重新读取。\n\n```cbim-workflow\n'+JSON.stringify(contract,null,2)+'\n```\n'},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:profile.id,modelId:data.model,name:'受控文件验证岗位'});
  await fs.writeFile(path.join(project,data.file),data.before,{flag:'wx'});
  return {entry,agentId:team.input.agentId,moduleId:team.input.moduleId,selection:owner.selection,options:{profileId:profile.id,provider:'cbim-'+profile.id,model:data.model,permission:'execute' as const,turnTimeoutMs:60000}};
}
