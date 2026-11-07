import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';
import {request} from './helpers';
import {seedTeam} from './team-fixture';
import {mainToolContractFixture as data} from './main-tool-contract-provider';
export {workflowConditionRecords as mainToolContractRecords} from './workflow-condition-fixture';
export {globalRuntimeLogBytes as mainToolContractLogBytes} from './global-runtime-fixture';

export async function seedMainToolContract(app:Application,project:string,provider:{url:string;bind:(agentId:string,moduleId:string)=>void}){
  await app.models.save({profile:{name:'Main tool contract fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Main tool contract fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);provider.bind(team.input.agentId,team.input.moduleId);const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'main-contract-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'main-contract-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));await fs.writeFile(path.join(project,data.file),data.fact);return {entry,team};
}
