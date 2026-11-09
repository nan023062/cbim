import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import type {Application} from '../src/backend/main/application';
import type {ObjectOperation} from '../src/backend/core/knowledge/object-crud';
import type {Snapshot} from '../src/backend/core/knowledge/types';
import type {WorkspaceMemberChangeInput} from '../src/backend/core/team/workspace-member';
import type {ModuleOwnershipChangeInput} from '../src/backend/core/workspace/module-ownership';
import {WorkspacePackages} from '../src/backend/main/resources/workspace-packages';
import {moduleFiles,summary} from './helpers';
export {workspaceMemberHttpProbe as knowledgeSourceHttpProbe,workspaceMemberRuntimeEvidence as knowledgeSourceRuntimeEvidence} from './workspace-member-fixture';

export type KnowledgeSourceCall=(action:string,input?:any)=>Promise<any>;
export const knowledgeSourceFixture={
  agentId:'.cbim/team/source_worker',moduleId:'.cbim/workspace/source_module',siblingId:'.cbim/workspace/source_sibling',
  agentName:'受控来源执行能力',memberName:'来源采纳验证岗位',model:'source-fixture',
  principles:'# 受控来源原则\n\n明确当前对象身份，实际读取后记录结果。',
  changedPrinciples:'# 受控来源原则\n\n明确当前对象身份，实际读取后记录结果。\n\n普通正文编辑，必须保留原对象代次。',
  draft:'受控来源变更期间保留普通主会话草稿，不启动模型。',
  otherDraft:'另一个工作区的独立草稿不受来源采纳影响。',
  reason:'明确采纳当前受控来源；保留原岗位、责任和历史回执。',
} as const;

/** The same public IPC setup can run against the fixed pre-source EXE or the current actual Application. It never manufactures registry or knowledge journals. */
export async function seedKnowledgeSource(call:KnowledgeSourceCall,temp:string,baseUrl:string,legacyMaintenance=false){
  const project=path.join(temp,'source-lifecycle-alpha'),otherProject=path.join(temp,'source-lifecycle-beta');
  await fs.mkdir(project,{recursive:true});await fs.mkdir(otherProject,{recursive:true});
  const entry=await call('add',{path:project}),other=await call('add',{path:otherProject});
  const definition={name:'来源生命周期隔离配置',api:'openai-completions',baseUrl,auth:'none',defaultModel:knowledgeSourceFixture.model,models:[{id:knowledgeSourceFixture.model,name:'仅检查意外调用',enabled:true,contextWindow:65536,maxTokens:2048,reasoning:false,vision:false}]};
  const settings=await call('models.save',{profile:definition}),profile=settings.profiles.find((item:{name:string})=>item.name===definition.name);assert.ok(profile);
  const initial=await knowledgeSourceObjectChange(call,entry.id,[
    {kind:'agent',action:'create',parentId:'.cbim/team',slug:'source_worker',data:{name:knowledgeSourceFixture.agentName,summary,capabilities:['核实']},body:knowledgeSourceFixture.principles},
    {kind:'module',action:'create',parentId:'.cbim/workspace',slug:'source_module',data:{summary},body:moduleFiles('source_module')[1].text},
  ],legacyMaintenance);
  await knowledgeSourceObjectChange(call,entry.id,[{kind:'module',action:'create',parentId:'.cbim/workspace',slug:'source_sibling',data:{summary},body:moduleFiles('source_sibling')[1].text}],legacyMaintenance);
  const registered=await knowledgeSourceMemberChange(call,entry.id,{kind:'register',agentId:knowledgeSourceFixture.agentId,name:knowledgeSourceFixture.memberName,position:'核实受控来源采纳；本轮不启动业务任务。',adaptation:{instructions:'对象换代必须明确采纳，不按路径或同字节推断连续。',references:[knowledgeSourceFixture.moduleId]},runtimePolicy:{profileId:profile.id,modelId:knowledgeSourceFixture.model},reason:knowledgeSourceFixture.reason});
  const assigned=await knowledgeSourceOwnershipChange(call,entry.id,{moduleId:knowledgeSourceFixture.moduleId,expectedBinding:null,nextOwner:{memberId:registered.receipt.memberId,expectedRevision:registered.receipt.memberRevision},reason:knowledgeSourceFixture.reason});
  return {entry,other,project,otherProject,profileId:profile.id,definition,initial,registered,assigned};
}

/** 当前应用使用退役花名册后的契约；只有固定历史 EXE 的调用方显式选择旧维护字段，不按失败自动降级。 */
export async function knowledgeSourceObjectChange(call:KnowledgeSourceCall,id:string,operations:ObjectOperation[],legacyMaintenance=false){
  const snapshot=await call('snapshot',{id}) as Snapshot,modules=operations.filter(operation=>operation.kind==='module'&&operation.action!=='delete');
  assert.ok(modules.length<=1);
  const extra=legacyMaintenance&&modules.length?{peopleUpserts:[{id:'source_owner',name:'隔离测试维护人',team:'.cbim/team'}],maintenance:{maintainerPersonIds:['source_owner'],confirmed:true}}:{};
  const input={workspaceId:id,instanceId:snapshot.instanceId,revision:snapshot.revision,operations,...extra},preview=await call('architecture.preview',input);
  assert.equal(preview.validation.structural,true,JSON.stringify(preview.validation.issues));
  const commitInput={workspaceId:id,instanceId:snapshot.instanceId,planId:preview.planId},receipt=await call('architecture.commit',commitInput);
  assert.equal(receipt.state,'committed');return {input,preview,commitInput,receipt};
}

export async function knowledgeSourceMemberChange(call:KnowledgeSourceCall,id:string,change:WorkspaceMemberChangeInput){
  const {instanceId}=await call('snapshot',{id}),input={workspaceId:id,instanceId,change},preview=await call('workspace.members.preview',input);
  const request={...input,commandId:randomUUID(),expectedRegistryCursor:preview.registryCursor,expectedBasis:preview.basis},receipt=await call('workspace.members.commit',request);
  return {preview,request,receipt};
}

export async function knowledgeSourceOwnershipChange(call:KnowledgeSourceCall,id:string,change:ModuleOwnershipChangeInput){
  const {instanceId}=await call('snapshot',{id}),input={workspaceId:id,instanceId,change},preview=await call('workspace.ownerships.preview',input);
  const request={...input,commandId:randomUUID(),expectedOwnershipCursor:preview.ownershipCursor,expectedBasis:preview.basis},receipt=await call('workspace.ownerships.commit',request);
  return {preview,request,receipt};
}

/** Publish and import the real complete architecture through the existing package service and isolated local resource repository. */
export async function knowledgeSourceArchitecturePackage(app:Application,id:string,repositoryDirectory:string){
  await fs.mkdir(repositoryDirectory,{recursive:true});await app.resources.configure({mode:'local',location:repositoryDirectory});
  const workspace=app.workspace(id),service=new WorkspacePackages(workspace,app.resources),snapshot=await workspace.snapshot(),repository=await app.resources.read();
  const published=await service.publish({workspaceId:id,instanceId:workspace.instanceId,revision:snapshot.revision,repositoryId:repository.repositoryId,repositoryRevision:repository.revision,kind:'architecture',name:'来源生命周期真实架构包',summary:'目标模块正文与包中完全一致，兄弟正文形成实际差异。'});
  const preview=async()=>{const current=await workspace.snapshot(),repo=await app.resources.read();return service.preview({workspaceId:id,instanceId:workspace.instanceId,revision:current.revision,repositoryId:repo.repositoryId,repositoryRevision:repo.revision,resourceId:published.resourceId,mode:'replace'})};
  return {published,service,preview,commit:(planId:string)=>service.commit({workspaceId:id,instanceId:workspace.instanceId,planId})};
}

/** Read full durable bytes without opening a competing writer; corruption injections must target the returned exact owned paths. */
export async function knowledgeSourceDiskEvidence(user:string,id:string){
  const dispatchFile=path.join(user,id,'dispatch','dispatch.jsonl');let dispatchBytes=Buffer.alloc(0);
  try{dispatchBytes=await fs.readFile(dispatchFile)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const directory=path.join(user,id,'transactions'),names=(await fs.readdir(directory)).filter(name=>name.endsWith('.json')).sort();
  const journals=await Promise.all(names.map(async name=>{const file=path.join(directory,name),bytes=await fs.readFile(file);return {file,name,bytes,sha256:createHash('sha256').update(bytes).digest('hex'),journal:JSON.parse(bytes.toString('utf8'))}}));
  return {dispatchFile,dispatchBytes,journals};
}
