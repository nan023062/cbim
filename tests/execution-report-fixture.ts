import fs from 'node:fs/promises';
import path from 'node:path';
import {request} from './helpers';
import {seedTeam} from './team-fixture';
import {reportFixture} from './execution-report-provider';
import type {Application} from '../src/backend/main/application';

/** Seed only the caller's isolated project/user root; no account or user project is reused. */
export async function seedExecutionReport(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string)=>void}){
  await app.models.save({profile:{name:'Execution report fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:'report-fixture',models:[{id:'report-fixture',name:'Report fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);provider.bind(team.input.agentId,team.input.moduleId);
  const knowledge=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'report-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'report-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(knowledge,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  await fs.writeFile(path.join(project,'execution-report-input.txt'),reportFixture.fact);
  return {entry,team};
}

/** Read immutable bytes for no-mutation assertions, not a replacement for product log validation. */
export async function reportFiles(user:string,workspaceId:string,taskId:string,runId:string){
  const directory=path.join(user,workspaceId,'dispatch');
  const log=path.join(directory,'runs','tasks',taskId,runId,'events.jsonl');
  return {log,dispatch:path.join(directory,'dispatch.jsonl'),read:async()=>({log:await fs.readFile(log,'utf8'),dispatch:await fs.readFile(path.join(directory,'dispatch.jsonl'),'utf8')})};
}
