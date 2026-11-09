import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';
import type {DispatchMutation,DispatchMessage} from '../src/backend/core/tasks/dispatch-storage';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import {seedTeam} from './team-fixture';
import {request} from './helpers';
import {memberHelpFixture as data} from './member-help-provider';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';

/** Seed only the isolated project and explicit maintainer; no account or existing workspace is used. */
export async function seedMemberHelp(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>void}){
  const models=await app.models.save({profile:{name:'Member help fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:'help-fixture',models:[{id:'help-fixture',name:'Help fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const knowledge=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'help-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'help-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(knowledge,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:models.profiles.find(profile=>profile.name==='Member help fixture')!.id,modelId:'help-fixture'});provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
  await fs.writeFile(path.join(project,data.source),data.sourceText);await fs.writeFile(path.join(project,data.supplement),data.supplementText);
  return {entry,team};
}

/** Observe complete committed records only, without opening a second writer against the live desktop. */
export async function memberHelpRecords(user:string,workspaceId:string){
  const raw=await fs.readFile(path.join(user,workspaceId,'dispatch','dispatch.jsonl'),'utf8'),scopes=new Map<string,DispatchScope>(),messages=new Map<string,DispatchMessage>();
  for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){
    const {body}=JSON.parse(line) as {body:{workspaceId:string;mutation:DispatchMutation}};
    if(body.workspaceId!==workspaceId)throw Error('Unexpected workspace in isolated help journal');
    for(const scope of body.mutation.scopes??[])scopes.set(scope.scopeId,scope);
    for(const message of body.mutation.messages??[])messages.set(message.messageId,message);
  }
  return {scopes:[...scopes.values()],messages:[...messages.values()]};
}
