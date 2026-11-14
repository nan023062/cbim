import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/bridge/server/application';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import {pngValidationData as data} from './png-validation-data';
export {workflowConditionRecords as pngValidationRecords} from './workflow-condition-fixture';
export {globalRuntimeLogBytes as pngValidationLogBytes} from './global-runtime-fixture';

/** 知识和岗位都走真实服务；实际PNG只能由随后启动的Pi写出。 */
export async function seedPngValidation(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,workflow?:string,selection?:OwnerExecutionSelection)=>void}){
  const models=await app.models.save({profile:{name:'PNG界面资源验证',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'PNG界面资源验证',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}),profile=models.profiles.find(item=>item.name==='PNG界面资源验证');
  if(!profile)throw Error('真实PNG测试模型配置未保存');
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text),workflow=team.input.workflowId+'/workflow.md';
  definition.maintenance={bindingId:'png-validator-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'png-validator-review',source:'local_user',confirmedAt:'2026-11-08T00:00:00.000Z'}};
  const contract={version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'read-png',toolName:'read'}],requiredValidations:[{id:data.requirementId,validator:'png-raster-v1',artifactPath:data.file,schema:data.schema}]}},text='# 界面资源PNG交付\n\n实际完整解码PNG并核对冻结尺寸与通道，修正后重新读取和采集验证。\n\n```cbim-workflow\n'+JSON.stringify(contract,null,2)+'\n```\n';
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:workflow,text},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  await fs.access(path.join(project,data.file)).then(()=>{throw Error('隔离工作区不能预先写入业务PNG')},error=>{if(error.code!=='ENOENT')throw error});
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:profile.id,modelId:data.model,name:'界面资源数据校验岗位'});provider.bind(team.input.agentId,team.input.moduleId,undefined,owner.selection);
  return {entry,team,contract,owner,profileId:profile.id};
}
