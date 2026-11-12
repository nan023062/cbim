import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/assembly/application';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {jsonValidationFixture as data} from './json-validation-provider';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
export {workflowConditionRecords as jsonValidationRecords} from './workflow-condition-fixture';
export {globalRuntimeLogBytes as jsonValidationLogBytes} from './global-runtime-fixture';

/** All knowledge edits go through the real workspace service. No business artifact exists before Pi writes it. */
export async function seedJsonValidation(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,workflow?:string,selection?:OwnerExecutionSelection)=>void},options:{deferOwner?:boolean}={}){
  const models=await app.models.save({profile:{name:'JSON validation fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'JSON validation fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const profile=models.profiles.find(item=>item.name==='JSON validation fixture');if(!profile)throw Error('真实 JSON 测试模型配置未保存');
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text),workflow=team.input.workflowId+'/workflow.md';
  definition.maintenance={bindingId:'json-validator-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'json-validator-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
  const contract={version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'read-json',toolName:'read'}],requiredValidations:[{id:data.requirementId,validator:'json-schema-v1',artifactPath:data.file,schema:data.schema}]}},text='# JSON产物验证\n\n保存计划后执行；必须实际读取并验证当前文件结构，不能以模型自述代替。\n\n```cbim-workflow\n'+JSON.stringify(contract,null,2)+'\n```\n';
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:workflow,text},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));await fs.access(path.join(project,data.file)).then(()=>{throw Error('隔离工作区不应预先存在业务JSON')},error=>{if(error.code!=='ENOENT')throw error});
  // 第二 Workflow 的专用夹具还要提交知识，因此显式推迟到它的最后一次知识提交之后登记。
  const owner=options.deferOwner?undefined:await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:profile.id,modelId:data.model,name:'JSON结构验证岗位'});
  if(owner)provider.bind(team.input.agentId,team.input.moduleId,undefined,owner.selection);
  return {entry,team,workflow,contract,owner,profileId:profile.id};
}
