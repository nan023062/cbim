import {required} from './support/assertions';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Application} from '../src/backend/main/assembly/application';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';
import type {DispatchRun} from '../src/logic/tasks/rules/dispatch-execution';
import {seedTeam} from './team-fixture';
import {request} from './data/knowledge';
import {commitWorkspaceMember} from './workspace-member-fixture';
import {moduleOwnershipChange,commitModuleOwnership} from './module-ownership-fixture';
import {workflowConditionRecords} from './workflow-condition-fixture';
import {checkpointHandoffData as data} from './checkpoint-handoff-provider';
export {workflowConditionRecords as checkpointHandoffRecords,workflowConditionLogBytes as checkpointHandoffLogBytes} from './workflow-condition-fixture';

/** Explicitly register two same-capability positions with distinct profiles/adaptations, then assign the one module to A. No universal seed is changed. */
export async function seedCheckpointHandoff(app:Application,project:string,urls:{main:string;a:string;b:string}){
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace),snapshot=await workspace.snapshot(),moduleId=team.input.moduleId;
  const moduleFile=snapshot.files.find(item=>item.path===moduleId+'/module.json');assert.ok(moduleFile);const definition=JSON.parse(moduleFile.text);
  definition.maintenance={bindingId:'handoff-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'handoff-maintenance-confirmation',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(snapshot,[{path:moduleFile.path,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'交接测试维护人',team:'.cbim/team'}]})}]));
  const profiles=[];
  for(const role of ['main','a','b'] as const){
    const result=await app.models.save({profile:{name:'Checkpoint handoff '+role,api:'openai-completions',auth:'none',baseUrl:urls[role],defaultModel:data.models[role],models:[{id:data.models[role],name:'Handoff '+role,enabled:true,contextWindow:131072,maxTokens:4096,reasoning:false,vision:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}),profile=result.profiles.find(item=>item.name==='Checkpoint handoff '+role);assert.ok(profile);profiles.push(profile);
  }
  const positions=[];
  for(const index of [0,1]){
    const result=await commitWorkspaceMember(app,entry.id,{kind:'register',agentId:team.input.agentId,name:data.names[index],position:'按当前主目标和模块责任处理真实文件，保留原任务与原运行身份。',adaptation:{instructions:data.adaptations[index],references:[moduleId,team.shared]},runtimePolicy:{profileId:profiles[index+1].id,modelId:index===0?data.models.a:data.models.b},reason:'隔离测试中明确登记交接前后的两份岗位配置。'});
    const detail=await app.dispatch('workspace.members.get',{workspaceId:entry.id,instanceId:workspace.instanceId,memberId:result.receipt.memberId});assert.equal(required(detail.sourceStatus).status,'current');positions.push({registration:result,member:detail.member});
  }
  assert.notEqual(positions[0].member.memberId,positions[1].member.memberId);assert.equal(positions[0].member.adoption.capabilityHash,positions[1].member.adoption.capabilityHash);
  const ownership=await commitModuleOwnership(app,entry.id,await moduleOwnershipChange(app,entry.id,moduleId,{memberId:positions[0].member.memberId,expectedRevision:positions[0].member.revision},'原岗位 A 负责本模块，后续更换须另行明确提交。'));
  // Only B/C inputs exist before execution. The original A marker must be created by the real native write tool.
  for(const index of [1,2])await fs.writeFile(path.join(project,data.files[index]),data.facts[index]);
  return {entry,team,moduleId,profiles,positions,ownership,mainOptions:{profileId:profiles[0].id,model:data.models.main,permission:'execute' as const,turnTimeoutMs:60000}};
}

export async function changeCheckpointOwner(app:Application,seeded:Awaited<ReturnType<typeof seedCheckpointHandoff>>){return commitModuleOwnership(app,seeded.entry.id,await moduleOwnershipChange(app,seeded.entry.id,seeded.moduleId,{memberId:seeded.positions[1].member.memberId,expectedRevision:seeded.positions[1].member.revision},'明确将模块责任改为 B；原任务不迁移、不自动放弃检查点。'))}

/** Both logs are mandatory actual Pi evidence. Reading does not create a competing Store or rewrite native history. */
export async function checkpointHandoffRunBytes(user:string,workspaceId:string,run:DispatchRun){
  const directory=path.join(user,workspaceId,'dispatch','runs','tasks',run.binding.taskId,run.binding.runId),summary=await new FileRunStorage().read(directory),sessionFile=run.session.sessionFile;
  assert.ok(sessionFile);assert.equal(summary.sessionFile,sessionFile);assert.equal(summary.logIntegrity?.partialTail,false);
  const bounds=summary.events.filter(event=>event.type==='session.bound');assert.ok(bounds.length);for(const event of bounds){assert.equal(event.data.sessionFile,sessionFile);assert.equal(event.data.sessionId,run.session.nativeSessionId);assert.ok(String(event.data.sessionId).trim())}
  const canonical=await fs.readFile(path.join(directory,'events.jsonl')),native=await fs.readFile(sessionFile);assert.ok(canonical.length&&native.length);
  return {summary,directory,sessionFile,canonical,native,canonicalHash:createHash('sha256').update(canonical).digest('hex'),nativeHash:createHash('sha256').update(native).digest('hex')};
}

export async function checkpointHandoffClosed(app:Application,user:string,workspaceId:string){const records=await workflowConditionRecords(user,workspaceId);assert.ok(records.scopes.length);assert.ok(records.scopes.every(scope=>scope.status==='closed'));assert.equal(app.runtime.snapshot().pressure.activeRuns,0);return records}
