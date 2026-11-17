import type {OwnerExecutionSelection} from '../../../../team/rules/member-execution-binding';
import {registerExplicitFixtureOwner} from '../../../../team/service/unittest/support/explicit-owner-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';
import {request} from '../../../../knowledge/rules/unittest/data/knowledge';
import {seedTeam} from '../../../../knowledge/service/unittest/support/team-fixture';
import {reportFixture} from './execution-report-provider';
import type {Application} from '../../../../../bridge/server/application';

/** Seed only the caller's isolated project/user root; no account or user project is reused. */
export async function seedExecutionReport(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string,selection?:OwnerExecutionSelection)=>void}){
  await app.models.Save({profile:{name:'Execution report fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:'report-fixture',models:[{id:'report-fixture',name:'Report fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.Dispatch('add',{path:project}),workspace=app.Workspace(entry.id),team=await seedTeam(workspace);
  const knowledge=await workspace.Snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'report-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'report-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.Commit(request(knowledge,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(app,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:(await app.models.List()).selectedId!,modelId:'report-fixture'});
  provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
  await fs.writeFile(path.join(project,'execution-report-input.txt'),reportFixture.fact);
  return {entry,team};
}

/** Read immutable bytes for no-mutation assertions, not a replacement for product log validation. */
export async function reportFiles(user:string,workspaceId:string,taskId:string,runId:string,protocol:'legacy'|'agent-tools-v1'='legacy'){
  const directory=path.join(user,workspaceId,'dispatch');
  const log=path.join(protocol==='agent-tools-v1'?path.join(user,workspaceId,'loop-engine'):path.join(directory,'runs'),'tasks',taskId,runId,'events.jsonl');
  return {log,dispatch:path.join(directory,'dispatch.jsonl'),read:async()=>({log:await fs.readFile(log,'utf8'),dispatch:await fs.readFile(path.join(directory,'dispatch.jsonl'),'utf8')})};
}
