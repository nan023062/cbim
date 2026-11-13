import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/assembly/application';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {usageScopes} from './scope-usage-fixture';
import {activeInputData as data} from './active-goal-input-provider';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import type {OwnerExecutionSelection} from '../src/logic/team/rules/member-execution-binding';

export async function seedActiveInput(app:Application,project:string,user:string,provider:{url:string;bind:(agentId:string,moduleId:string,selection:OwnerExecutionSelection)=>void}){
  await app.models.save({profile:{name:'Active goal input fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Active goal input fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'active-input-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'active-input-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  await fs.writeFile(path.join(project,data.file),data.fact);
  const profileId=(await app.models.list()).selectedId!;
  const registered=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId,modelId:data.model,name:'运行内补充核实岗位'});provider.bind(team.input.agentId,team.input.moduleId,registered.selection);
  return {entry,team,profileId,options:{provider:'cbim-'+profileId,profileId,model:data.model,permission:'read' as const,turnTimeoutMs:60000},scopes:()=>usageScopes(user,entry.id)};
}
export async function activeInputWait(check:()=>Promise<boolean>,label:string,timeout=45000){const until=Date.now()+timeout;while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25))}throw Error('Timed out: '+label)}
