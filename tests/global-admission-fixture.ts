import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';
import type {DispatchMutation} from '../src/backend/core/tasks/dispatch-storage';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import {seedTeam} from './team-fixture';
import {request} from './helpers';
import {globalAdmissionFixture as data,type AdmissionProject} from './global-admission-provider';

/** Both projects share the actual Application and model catalog, while knowledge and business files stay isolated. */
export async function seedGlobalAdmission(app:Application,paths:Record<AdmissionProject,string>,provider:{url:string;bind:(key:AdmissionProject,agentId:string,moduleId:string)=>void}){
  await app.models.save({profile:{name:'Global admission fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model('a'),models:(['a','b'] as const).map(key=>({id:data.model(key),name:'Admission '+key.toUpperCase(),enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}))}});
  const seed=async(key:AdmissionProject)=>{
    const entry=await app.dispatch('add',{path:paths[key]}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);provider.bind(key,team.input.agentId,team.input.moduleId);
    const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    definition.maintenance={bindingId:'admission-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'admission-review',source:'local_user',confirmedAt:new Date().toISOString()}};
    await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
    await fs.writeFile(path.join(paths[key],data.file),data.fact(key));return {entry,team};
  };
  return {a:await seed('a'),b:await seed('b'),profileId:(await app.models.list()).selectedId!};
}

/** Complete committed scope records only; never opens another dispatch writer beside a running application. */
export async function admissionScopes(user:string,workspaceId:string){
  const raw=await fs.readFile(path.join(user,workspaceId,'dispatch','dispatch.jsonl'),'utf8'),scopes=new Map<string,DispatchScope>();
  for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){
    const {body}=JSON.parse(line) as {body:{workspaceId:string;mutation:DispatchMutation}};if(body.workspaceId!==workspaceId)throw Error('Unexpected workspace in admission journal');
    for(const scope of body.mutation.scopes??[])scopes.set(scope.scopeId,scope);
  }
  return [...scopes.values()];
}
