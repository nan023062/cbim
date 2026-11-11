import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';
import type {LlmDefinition} from '../src/backend/core/brain/llm/config';
import {workspaceMemberDetailSchema,type WorkspaceMemberAdaptation} from '../src/backend/core/team/workspace-member';
import {seedTeam} from './team-fixture';
import {moduleFiles,request,summary} from './data/knowledge';
import {commitWorkspaceMember} from './workspace-member-fixture';
import {commitModuleOwnership,moduleOwnershipChange,moduleOwnershipDetail} from './module-ownership-fixture';
export {workflowConditionRecords as ownerExecutionRecords,workflowConditionLogBytes as ownerExecutionLogBytes} from './workflow-condition-fixture';
export {moduleOwnershipNativeBytes as ownerExecutionNativeBytes} from './module-ownership-fixture';

export const ownerExecutionData={
  goal:'OWNER_EXECUTION_MAIN: 按两个模块的真实负责岗位分别派发，使用岗位各自模型和适配，核对实际文件证据后审阅目标。',
  mainModel:'owner-main-third',models:['owner-position-a','owner-position-b'],
  names:['资料核实岗位 A','资料核实岗位 B'],
  goals:['OWNER_POSITION_A: 核实 owner-a.txt 并提交本岗位真实读取证据','OWNER_POSITION_B: 核实 owner-b.txt 并提交本岗位真实读取证据'],
  files:['owner-a.txt','owner-b.txt'],facts:['OWNER_FILE_A_4e832','OWNER_FILE_B_9c26d'],
  adaptations:['OWNER_ADAPTATION_A_7f32: 仅核实 A 模块材料，不执行 B 的职责。','OWNER_ADAPTATION_B_69ad: 独立核实 B 模块材料，不借用 A 的结果。'],
  sharedSkill:'OWNER_SHARED_SKILL_4fa2',ownSkill:'OWNER_AGENT_SKILL_8ce1',
  acceptance:['两个模块各由其已登记负责岗位实际读取材料，保留独立结果及岗位模型身份'],
  held:'两个岗位任务已保存，主轮尚未结束，成员尚未领取。',
  final:'两个岗位已使用各自模型和适配提交真实读取证据，主调度已核对当前目标。',
  draft:'普通草稿：岗位派发和负责人变更不得发送或清除这段文字。',
} as const;

/** Opt-in setup for real integration fixtures. No implicit registry writes are added to seedTeam or production paths. */
export async function registerFixtureOwner(app:Application,workspaceId:string,input:{agentId:string;moduleIds:string[];profileId:string;modelId:string;name:string;adaptation:WorkspaceMemberAdaptation}){
  assert.ok(input.moduleIds.length);assert.equal(new Set(input.moduleIds).size,input.moduleIds.length);
  const registration=await commitWorkspaceMember(app,workspaceId,{
    kind:'register',agentId:input.agentId,name:input.name,
    position:'由主调度按当前模块责任派发，使用该岗位独立配置核实实际业务证据。',
    adaptation:input.adaptation,runtimePolicy:{profileId:input.profileId,modelId:input.modelId},
    reason:'测试中明确登记岗位及运行配置，不从静态 Agent 或主模型推测岗位。',
  });
  const identity={workspaceId,instanceId:app.workspace(workspaceId).instanceId};
  const detail=workspaceMemberDetailSchema.parse(await app.dispatch('workspace.members.get',{...identity,memberId:registration.receipt.memberId}));
  assert.equal(detail.sourceStatus?.status,'current');assert.ok(detail.member.adoption.sourceRef);
  const ownerships=[];
  for(const moduleId of input.moduleIds){
    const change=await moduleOwnershipChange(app,workspaceId,moduleId,{memberId:detail.member.memberId,expectedRevision:detail.member.revision},'明确登记本模块负责岗位，供后续真实计划和领取重新核实。');
    const committed=await commitModuleOwnership(app,workspaceId,change),view=await moduleOwnershipDetail(app,workspaceId,moduleId);
    assert.equal(view.view.sourceStatus?.status,'current');assert.ok(view.view.binding?.sourceRef);ownerships.push(committed);
  }
  return {registration,member:detail.member,ownerships};
}

/** Three explicit profiles have distinct localhost routes as well as model IDs; request receipts prove actual configuration selection. */
export async function seedOwnerExecution(app:Application,project:string,urls:{main:string;a:string;b:string}){
  const entry=await app.dispatch('add',{path:project}),workspace=app.workspace(entry.id),team=await seedTeam(workspace);
  const preview=await team.call('cbim_object_preview',{revision:(await workspace.snapshot()).revision,operations:[
    {kind:'module',action:'create',parentId:'.cbim/workspace',slug:'owner_b',data:{summary},body:moduleFiles('owner_b')[1].text},
    {kind:'module',action:'create',parentId:'.cbim/workspace',slug:'owner_a_extra',data:{summary},body:moduleFiles('owner_a_extra')[1].text},
  ]});
  assert.equal(preview.validation.structural,true);await team.call('cbim_object_commit',{planId:preview.planId},true);
  const modules=[team.input.moduleId,'.cbim/workspace/owner_b'] as const,extraModule='.cbim/workspace/owner_a_extra';
  const snapshot=await workspace.snapshot(),changes=[];
  for(const [index,moduleId] of [...modules,extraModule].entries()){
    const file=snapshot.files.find(item=>item.path===moduleId+'/module.json');assert.ok(file);const definition=JSON.parse(file.text);
    definition.maintenance={bindingId:'owner-execution-maintainer-'+index,maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'owner-execution-confirmation-'+index,source:'local_user',confirmedAt:new Date().toISOString()}};
    changes.push({path:file.path,text:JSON.stringify(definition)});
  }
  changes.push({path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'实际测试维护人',team:'.cbim/team'}]})});
  for(const [skill,marker] of [[team.shared,ownerExecutionData.sharedSkill],[team.own,ownerExecutionData.ownSkill]]){
    const file=snapshot.files.find(item=>item.path===skill+'/SKILL.md');assert.ok(file);changes.push({path:file.path,text:file.text+'\n\n'+marker+'\n'});
  }
  await workspace.commit(request(snapshot,changes));
  const profiles=[];
  for(const [index,[baseUrl,modelId]] of [[urls.main,ownerExecutionData.mainModel],[urls.a,ownerExecutionData.models[0]],[urls.b,ownerExecutionData.models[1]]].entries()){
    const definition:LlmDefinition={name:'Owner execution explicit '+index,api:'openai-completions',baseUrl,auth:'none',defaultModel:modelId,models:[{id:modelId,name:'Owner execution '+index,enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,vision:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]};
    const result=await app.models.save({profile:definition}),saved=result.profiles.find(item=>item.name===definition.name);assert.ok(saved);profiles.push({id:saved.id,modelId,definition});
  }
  const positions=[];
  for(const index of [0,1])positions.push(await registerFixtureOwner(app,entry.id,{
    agentId:team.input.agentId,moduleIds:index===0?[modules[0],extraModule]:[modules[1]],
    name:ownerExecutionData.names[index],profileId:profiles[index+1].id,modelId:profiles[index+1].modelId,
    adaptation:{instructions:ownerExecutionData.adaptations[index],references:[modules[index],team.shared]},
  }));
  assert.notEqual(positions[0].member.memberId,positions[1].member.memberId);
  assert.equal(positions[0].member.adoption.configuration.agentId,positions[1].member.adoption.configuration.agentId);
  assert.equal(positions[0].member.adoption.capabilityHash,positions[1].member.adoption.capabilityHash);
  for(const index of [0,1])await fs.writeFile(path.join(project,ownerExecutionData.files[index]),ownerExecutionData.facts[index]);
  return {entry,team,modules,extraModule,profiles,positions,mainOptions:{profileId:profiles[0].id,model:profiles[0].modelId,permission:'read' as const,turnTimeoutMs:60000}};
}
