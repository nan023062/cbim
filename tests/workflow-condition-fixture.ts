import type {Application} from '../src/backend/main/application';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {DispatchMutation,DispatchMessage} from '../src/backend/core/tasks/dispatch-storage';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {AgentInstance} from '../src/backend/core/team/agent-types';
import {seedTeam} from './team-fixture';
import {request} from './helpers';
import {workflowConditionFixture as data,type WorkflowConditionMode} from './workflow-condition-provider';
export {humanDecisionLogBytes as workflowConditionLogBytes} from './human-decisions-fixture';

/** Observe committed records without creating a competing store writer; incomplete live tails are not transactions. */
export async function workflowConditionRecords(user:string,workspaceId:string){
  const raw=await fs.readFile(path.join(user,workspaceId,'dispatch','dispatch.jsonl'),'utf8'),scopes=new Map<string,DispatchScope>(),messages=new Map<string,DispatchMessage>(),members=new Map<string,AgentInstance>(),runs=new Map<string,DispatchRun>();
  for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){
    const {body}=JSON.parse(line) as {body:{workspaceId:string;mutation:DispatchMutation}};if(body.workspaceId!==workspaceId)throw Error('Unexpected workspace in workflow fixture journal');
    for(const value of body.mutation.scopes??[])scopes.set(value.scopeId,value);for(const value of body.mutation.messages??[])messages.set(value.messageId,value);for(const value of body.mutation.members??[])members.set(value.agentInstanceId,value);for(const value of body.mutation.runs??[])runs.set(value.binding.runId,value);
  }
  return {scopes:[...scopes.values()],messages:[...messages.values()],members:[...members.values()],runs:[...runs.values()]};
}

/** Commit the optional workflow through the real knowledge service; the business result file is never seeded. */
export async function seedWorkflowCondition(app:Application,project:string,provider:{url:string;bind:(agent:string,module:string)=>void},mode:WorkflowConditionMode='complete'){
  await app.models.save({profile:{name:'Workflow condition fixture',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:data.model,models:[{id:data.model,name:'Workflow condition fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);provider.bind(team.input.agentId,team.input.moduleId);
  const snapshot=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text),workflow=team.input.workflowId+'/workflow.md';
  if(!snapshot.files.some(file=>file.path===workflow))throw Error('真实模块Workflow正文路径缺失');
  definition.maintenance={bindingId:'workflow-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'workflow-review',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
  const contract={version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'inspect-result',toolName:'read'},...(mode==='missing-capability'?[{id:'write-result',toolName:'write'}]:[])]}},text='# 构建与核实流程\n\n此模块要求先保存计划，交付前读取真实产物。\n\n```cbim-workflow\n'+JSON.stringify(contract,null,2)+'\n```\n';
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:workflow,text},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  return {entry,team,workflow,contract,text};
}
