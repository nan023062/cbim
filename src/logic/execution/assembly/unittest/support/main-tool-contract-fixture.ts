import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../../../../../bridge/server/application';
import {request} from '../../../../knowledge/rules/unittest/data/knowledge';
import {seedTeam} from '../../../../knowledge/service/unittest/support/team-fixture';
import {mainToolContractFixture as data} from './main-tool-contract-provider';
import type {OwnerExecutionSelection} from '../../../../team/rules/member-execution-binding';
import {registerExplicitFixtureOwner} from '../../../../team/service/unittest/support/explicit-owner-fixture';
export {workflowConditionRecords as mainToolContractRecords} from './workflow-condition-fixture';
export {globalRuntimeLogBytes as mainToolContractLogBytes} from '../../../../runtime/monitoring/unittest/support/global-runtime-fixture';

export async function seedMainToolContract(app:Application,project:string,provider:{url:string;bind:(agentId:string,moduleId:string,selection:OwnerExecutionSelection)=>void},workflow?:string){
  const models=await app.models.Save({profile:{name:'Main tool contract fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Main tool contract fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const profile=models.profiles.find(item=>item.name==='Main tool contract fixture');if(!profile)throw Error('Actual main tool contract model profile missing');
  const entry=await app.Dispatch('add',{path:project}),workspace=app.Workspace(entry.id),team=await seedTeam(workspace);const snapshot=await workspace.Snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'main-contract-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'main-contract-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};await workspace.Commit(request(snapshot,[...(workflow?[{path:team.input.workflowId+'/workflow.md',text:workflow}]:[]),{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));await fs.writeFile(path.join(project,data.file),data.fact);const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:profile.id,modelId:data.model});provider.bind(team.input.agentId,team.input.moduleId,owner.selection);return {entry,team,owner};
}
