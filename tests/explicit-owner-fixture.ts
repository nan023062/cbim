import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Application} from '../src/backend/main/assembly/application';
import {workspaceMemberDetailSchema,workspaceMemberPreviewSchema,workspaceMemberReceiptSchema} from '../src/logic/team/rules/workspace-member';
import {moduleOwnershipDetailSchema,moduleOwnershipPreviewSchema,moduleOwnershipReceiptSchema} from '../src/logic/workspace/rules/module-ownership';
import {ownerExecutionDiscoverySchema} from '../src/logic/team/rules/owner-execution-discovery';

/** Explicit test setup after knowledge/profile seeding. Uses real public commands without changing global seedTeam or adding model turns. */
export async function registerExplicitFixtureOwner(app:Application,workspaceId:string,input:{agentId:string;moduleIds:string[];profileId:string;modelId:string;name?:string}){
  assert.ok(input.moduleIds.length);assert.equal(new Set(input.moduleIds).size,input.moduleIds.length);
  const identity={workspaceId,instanceId:app.workspace(workspaceId).instanceId};
  const change={kind:'register' as const,agentId:input.agentId,name:input.name??'显式业务测试岗位',position:'按本测试实际模块责任执行已授权任务并提交真实证据。',adaptation:{instructions:'保持原测试业务范围、工具权限与验收要求；岗位登记不替代业务证据。',references:[...input.moduleIds]},runtimePolicy:{profileId:input.profileId,modelId:input.modelId},reason:'测试显式登记实际岗位及其模型，不从静态 Agent 或主会话推测负责人。'};
  const preview=workspaceMemberPreviewSchema.parse(await app.dispatch('workspace.members.preview',{...identity,change}));
  const request={...identity,change,commandId:randomUUID(),expectedRegistryCursor:preview.registryCursor,expectedBasis:preview.basis};
  const receipt=workspaceMemberReceiptSchema.parse(await app.dispatch('workspace.members.commit',request));
  const detail=workspaceMemberDetailSchema.parse(await app.dispatch('workspace.members.get',{...identity,memberId:receipt.memberId}));
  assert.equal(detail.sourceStatus?.status,'current');
  const ownerships=[];
  for(const moduleId of input.moduleIds){
    const {view}=moduleOwnershipDetailSchema.parse(await app.dispatch('workspace.ownerships.get',{...identity,moduleId}));
    assert.ok(!view.binding?.ownerMemberId,'Fixture must explicitly choose a fresh/unassigned module, not silently replace another owner');
    const binding=view.binding;
    const ownershipChange={moduleId,expectedBinding:binding?{bindingId:binding.bindingId,revision:binding.revision,ownerMemberId:binding.ownerMemberId}:null,nextOwner:{memberId:detail.member.memberId,expectedRevision:detail.member.revision},reason:'本测试明确绑定真实模块负责人，后续计划与领取仍须重新核验。'};
    const ownershipPreview=moduleOwnershipPreviewSchema.parse(await app.dispatch('workspace.ownerships.preview',{...identity,change:ownershipChange}));
    const ownershipRequest={...identity,change:ownershipChange,commandId:randomUUID(),expectedOwnershipCursor:ownershipPreview.ownershipCursor,expectedBasis:ownershipPreview.basis};
    ownerships.push(moduleOwnershipReceiptSchema.parse(await app.dispatch('workspace.ownerships.commit',ownershipRequest)));
  }
  const discovery=ownerExecutionDiscoverySchema.parse(await app.memberDispatch(workspaceId).owners.discover(input.moduleIds));
  assert.equal(discovery.groups.length,1);const group=discovery.groups[0];assert.deepEqual(group.issues,[]);assert.ok(group.selection);
  assert.equal(group.selection.memberId,detail.member.memberId);
  return {selection:group.selection,member:detail.member,registration:{preview,input:request,receipt},ownerships};
}
