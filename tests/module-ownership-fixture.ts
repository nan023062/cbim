import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import type {Application} from '../src/backend/main/application';
import type {RunSummary} from '../src/backend/core/brain/types';
import {seedWorkspaceMembers,commitWorkspaceMember,workspaceMemberFixture} from './workspace-member-fixture';
import {moduleFiles,summary} from './helpers';
import {moduleOwnershipDetailSchema,moduleOwnershipPreviewSchema,moduleOwnershipReceiptSchema,type ModuleOwnershipChangeInput} from '../src/backend/core/workspace/module-ownership';
export {workspaceMemberHttpProbe as moduleOwnershipHttpProbe,workspaceMemberKnowledgeEvidence as moduleOwnershipKnowledgeEvidence,workspaceMemberRuntimeEvidence as moduleOwnershipRuntimeEvidence,workspaceMemberRunFiles as moduleOwnershipRunFiles} from './workspace-member-fixture';
export {workflowConditionRecords as moduleOwnershipRunRecords,workflowConditionLogBytes as moduleOwnershipLogBytes} from './workflow-condition-fixture';

export const moduleOwnershipFixture={
  model:'member-explicit-a',goal:'MODULE_OWNERSHIP_CONTROL_MAIN：核实当前模块与岗位，预览并登记模块负责人，保留原命令回执；不派发或实施业务。',
  reason:'明确单模块的项目岗位责任；不变更模块正文、旧任务身份或模型执行。',
  draft:'模块负责人控制面操作期间保留普通主会话草稿。',
  otherDraft:'另一个工作区的普通草稿与负责人登记独立。',
  final:'本次责任控制面操作已核实。负责人登记不代表任务派发、业务交付或实际执行资格。',
} as const;

/** Actual static capability, two independently registered positions and a disposable leaf module. No ownership is pre-forged. */
export async function seedModuleOwnership(app:Application,temp:string,baseUrl:string){
  const seeded=await seedWorkspaceMembers(app,temp,baseUrl),workspace=app.workspace(seeded.entry.id),snapshot=await workspace.snapshot();
  const preview=await seeded.team.call('cbim_object_preview',{revision:snapshot.revision,operations:[{kind:'module',action:'create',parentId:'.cbim/workspace',slug:'ownership_leaf',data:{summary},body:moduleFiles('ownership_leaf')[1].text}]});
  if(!preview.validation.structural)throw Error('Actual ownership fixture module failed validation');await seeded.team.call('cbim_object_commit',{planId:preview.planId},true);
  const first=await commitWorkspaceMember(app,seeded.entry.id,seeded.register(workspaceMemberFixture.firstName)),second=await commitWorkspaceMember(app,seeded.entry.id,seeded.register(workspaceMemberFixture.secondName));
  return {...seeded,first,second,moduleId:seeded.team.input.moduleId,missingModuleId:'.cbim/workspace/ownership_leaf'};
}

/** Real object deletion is an explicit source mutation for the missing-source test, not an effect of releasing responsibility. */
export async function deleteOwnershipFixtureModule(app:Application,seeded:Awaited<ReturnType<typeof seedModuleOwnership>>){
  const snapshot=await app.workspace(seeded.entry.id).snapshot(),preview=await seeded.team.call('cbim_object_preview',{revision:snapshot.revision,operations:[{kind:'module',action:'delete',id:seeded.missingModuleId}]});
  if(!preview.validation.structural)throw Error('Actual leaf deletion failed validation');await seeded.team.call('cbim_object_commit',{planId:preview.planId},true);
}

/** Audit bytes remain authoritative; tests count actual persisted ownership commands rather than returned text. */
export async function moduleOwnershipJournal(user:string,workspaceId:string){
  const file=path.join(user,workspaceId,'dispatch','dispatch.jsonl'),bytes=await fs.readFile(file);
  const records=bytes.toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line) as {body:{workspaceId:string;command:{commandId:string};mutation:Record<string,unknown>}});
  for(const record of records)if(record.body.workspaceId!==workspaceId)throw Error('Ownership fixture read another workspace journal');
  return {file,bytes,sha256:createHash('sha256').update(bytes).digest('hex'),records};
}

export async function moduleOwnershipDetail(app:Application,workspaceId:string,moduleId:string){return moduleOwnershipDetailSchema.parse(await app.dispatch('workspace.ownerships.get',{workspaceId,instanceId:app.workspace(workspaceId).instanceId,moduleId}))}

/** The request's expected relation is obtained from the actual current public detail, never synthesized from a task or Agent name. */
export async function moduleOwnershipChange(app:Application,workspaceId:string,moduleId:string,nextOwner:ModuleOwnershipChangeInput['nextOwner'],reason:string=moduleOwnershipFixture.reason):Promise<ModuleOwnershipChangeInput>{
  const {view}=await moduleOwnershipDetail(app,workspaceId,moduleId),binding=view.binding;
  return {moduleId,expectedBinding:binding?{bindingId:binding.bindingId,revision:binding.revision,ownerMemberId:binding.ownerMemberId}:null,nextOwner,reason};
}
export async function commitModuleOwnership(app:Application,workspaceId:string,change:ModuleOwnershipChangeInput){
  const identity={workspaceId,instanceId:app.workspace(workspaceId).instanceId},preview=moduleOwnershipPreviewSchema.parse(await app.dispatch('workspace.ownerships.preview',{...identity,change}));
  const input={...identity,commandId:randomUUID(),change,expectedOwnershipCursor:preview.ownershipCursor,expectedBasis:preview.basis};
  const receipt=moduleOwnershipReceiptSchema.parse(await app.dispatch('workspace.ownerships.commit',input));return {input,preview,receipt};
}

/** Actual Pi runs must expose a real canonical/native binding; absence is a failure, never a reason to skip no-replay checks. */
export async function moduleOwnershipNativeBytes(user:string,workspaceId:string,summary:RunSummary){
  assert.equal(summary.task.workspaceId,workspaceId);assert.equal(summary.logIntegrity?.partialTail,false);const sessionFile=summary.sessionFile;assert.ok(sessionFile);assert.ok(sessionFile.trim());
  const bounds=summary.events.filter(event=>event.type==='session.bound');assert.ok(bounds.length>0);
  for(const event of bounds){assert.equal(typeof event.data.sessionId,'string');assert.ok(String(event.data.sessionId).trim());assert.equal(event.data.sessionFile,summary.sessionFile)}
  const canonical=await fs.readFile(path.join(user,workspaceId,'loop-engine','tasks',summary.task.taskId,summary.runId,'events.jsonl')),native=await fs.readFile(sessionFile);assert.ok(canonical.length>0&&native.length>0);
  return {sessionFile,nativeSessionId:String(bounds.at(-1)!.data.sessionId),canonical,native};
}
