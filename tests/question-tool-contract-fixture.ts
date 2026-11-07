import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import type {Application} from '../src/backend/main/application';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {seedTeam} from './team-fixture';
import {request} from './helpers';
import {questionContractData as data} from './question-tool-contract-provider';

export async function questionWait(check:()=>Promise<boolean>,label:string,timeout=40000){const until=Date.now()+timeout;while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,35))}throw Error('提问工具验收等待超时：'+label)}
export const questionRun=(user:string,workspaceId:string,taskId:string,runId:string)=>new FileRunStorage().read(path.join(user,workspaceId,'dispatch','runs','tasks',taskId,runId));
export async function seedQuestionContract(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string)=>void}){
  await fs.mkdir(project,{recursive:true});await fs.writeFile(path.join(project,'question-input.txt'),data.fact);
  await app.models.save({profile:{name:'Local question contract fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:data.model,enabled:true,contextWindow:65536,maxTokens:2048,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'question-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'question-confirmation',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));provider.bind(team.input.agentId,team.input.moduleId);
  const records=async()=>{const raw=await fs.readFile(path.join(app.paths.project(entry.id),'dispatch','dispatch.jsonl'),'utf8'),scopes=new Map<string,DispatchScope>(),runs=new Map<string,DispatchRun>();for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){const {body}=JSON.parse(line);assert.equal(body.workspaceId,entry.id);for(const item of body.mutation.scopes??[])scopes.set(item.scopeId,item);for(const item of body.mutation.runs??[])runs.set(item.binding.runId,item)}return {scopes:[...scopes.values()],runs:[...runs.values()]}};
  return {entry,team,records,options:{permission:'read' as const,model:data.model,turnTimeoutMs:60000}};
}
