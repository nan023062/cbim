import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../../../../../bridge/server/application';
import type {OwnerExecutionSelection} from '../../../../team/rules/member-execution-binding';
import {request} from '../../../../knowledge/rules/unittest/data/knowledge';
import {seedTeam} from '../../../../knowledge/service/unittest/support/team-fixture';
import {registerExplicitFixtureOwner} from '../../../../team/service/unittest/support/explicit-owner-fixture';
import {csvValidationData as data} from '../../../../file-operations/platform/files/unittest/support/csv-validation-data';
export {workflowConditionRecords as csvValidationRecords} from './workflow-condition-fixture';
export {globalRuntimeLogBytes as csvValidationLogBytes} from '../../../../runtime/monitoring/unittest/support/global-runtime-fixture';

/** 知识和岗位都走真实服务；实际CSV只能由随后启动的Pi写出。 */
export async function seedCsvValidation(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,workflow?:string,selection?:OwnerExecutionSelection)=>void}){
  const models=await app.models.Save({profile:{name:'CSV库存验证',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'CSV库存验证',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}),profile=models.profiles.find(item=>item.name==='CSV库存验证');
  if(!profile)throw Error('真实CSV测试模型配置未保存');
  const entry=await app.Dispatch('add',{path:project}),workspace=app.Workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.Snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text),workflow=team.input.workflowId+'/workflow.md';
  definition.maintenance={bindingId:'csv-validator-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'csv-validator-review',source:'local_user',confirmedAt:'2026-11-08T00:00:00.000Z'}};
  const contract={version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'read-csv',toolName:'read'}],requiredValidations:[{id:data.requirementId,validator:'csv-table-v1',artifactPath:data.file,schema:data.schema}]}},text='# 库存CSV交付\n\n按冻结表头、类型及唯一键检查真实文件，修正后重新读取和采集验证。\n\n```cbim-workflow\n'+JSON.stringify(contract,null,2)+'\n```\n';
  await workspace.Commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:workflow,text},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  await fs.access(path.join(project,data.file)).then(()=>{throw Error('隔离工作区不能预先写入业务CSV')},error=>{if(error.code!=='ENOENT')throw error});
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:profile.id,modelId:data.model,name:'库存数据校验岗位'});provider.bind(team.input.agentId,team.input.moduleId,undefined,owner.selection);
  return {entry,team,contract,owner,profileId:profile.id};
}
