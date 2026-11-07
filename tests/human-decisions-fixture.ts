import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';
import {seedTeam} from './team-fixture';
import {request} from './helpers';
import {humanDecisionFixture as data} from './human-decisions-provider';
import {registerExplicitFixtureOwner} from './explicit-owner-fixture';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
export {queuedTaskCancelRecords as humanDecisionRecords} from './queued-task-cancel-fixture';

/** Isolated empty project: the artifact is created by real Pi's native write, not seeded as a fake result. */
export async function seedHumanDecision(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,selection:OwnerExecutionSelection)=>void}){
  const models=await app.models.save({profile:{name:'Human decision fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Human decision fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'human-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'human-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:models.profiles.find(profile=>profile.name==='Human decision fixture')!.id,modelId:data.model});provider.bind(team.input.agentId,team.input.moduleId,owner.selection);return {entry,team};
}

/** Real canonical and native history bytes in the isolated user root; human records are stored separately. */
export async function humanDecisionLogBytes(user:string,workspaceId:string){
  const base=path.join(user,workspaceId),result:Record<string,string>={};
  const walk=async(directory:string)=>{for(const item of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())await walk(file);else if(item.name.endsWith('.jsonl')&&item.name!=='dispatch.jsonl')result[path.relative(base,file)]=await fs.readFile(file,'utf8')}};
  await walk(base);return result;
}
