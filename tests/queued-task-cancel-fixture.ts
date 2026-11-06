import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';
import type {DispatchMutation,DispatchMessage} from '../src/backend/core/tasks/dispatch-storage';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {AgentInstance} from '../src/backend/core/team/agent-types';
import {seedTeam} from './team-fixture';
import {request} from './helpers';
import {queuedTaskCancelFixture as data} from './queued-task-cancel-provider';

/** Explicit local team and maintained business module; never reuse account settings or user projects. */
export async function seedQueuedTaskCancel(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string)=>void}){
  await app.models.save({profile:{name:'Queued cancellation fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:'cancel-fixture',models:[{id:'cancel-fixture',name:'Cancel fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);provider.bind(team.input.agentId,team.input.moduleId);
  const knowledge=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'cancel-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'cancel-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(knowledge,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  await Promise.all(data.files.map((file,index)=>fs.writeFile(path.join(project,file),data.facts[index])));return {entry,team};
}

/** Observe committed mutations only; this helper does not open a competing DispatchStore writer. */
export async function queuedTaskCancelRecords(user:string,workspaceId:string){
  const raw=await fs.readFile(path.join(user,workspaceId,'dispatch','dispatch.jsonl'),'utf8'),scopes=new Map<string,DispatchScope>(),messages=new Map<string,DispatchMessage>(),members=new Map<string,AgentInstance>();
  for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){
    const {body}=JSON.parse(line) as {body:{workspaceId:string;mutation:DispatchMutation}};if(body.workspaceId!==workspaceId)throw Error('Unexpected workspace in isolated cancellation journal');
    for(const scope of body.mutation.scopes??[])scopes.set(scope.scopeId,scope);for(const message of body.mutation.messages??[])messages.set(message.messageId,message);for(const member of body.mutation.members??[])members.set(member.agentInstanceId,member);
  }
  return {scopes:[...scopes.values()],messages:[...messages.values()],members:[...members.values()]};
}
