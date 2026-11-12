/**
 * 目录归属：backend/main/registry；岗位、责任与来源协调。
 * 作用定位：把岗位服务装配到真实主运行；工作区、actor 和命令身份由闭包持有。
 * 设计原因：登记/采纳复用唯一 Store，不建立第二份成员表；模型选型继承静态 Agent，停止排空与回执核实沿原周期。
 */
import {fail} from '../../core/foundation/errors';
import {checkedConversationAgentBinding,type ConversationAgentBinding} from '../../core/execution/conversation-binding';
import {agentModelSelectionSchema} from '../../core/models/engine';
import {data} from '../../core/knowledge/read-models';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {TaskSpec} from '../../core/tasks/types';
import {workspaceMemberMainCommandId} from '../../core/team/workspace-member-rules';
import {workspaceMemberMainActorSchema,type WorkspaceMemberChangeInput} from '../../core/team/workspace-member';
import {memberToolInspectSchema,memberToolPreviewSchema,memberToolCommitSchema,memberToolReceiptSchema,type MemberToolChange,type WorkspaceMemberToolsPort} from '../../core/team/workspace-member-tools';
import type {MainToolContext} from '../../scheduler-engine/dispatch/auto-collaboration';
import type {WorkspaceMembers} from './workspace-members';

/** 只有主运行工厂可装配；模型不能指定根会话、权限或“本机用户”来源。 */
export function mainWorkspaceMemberTools(owner:KnowledgeWorkspace,members:WorkspaceMembers,task:TaskSpec,runId:string,binding:ConversationAgentBinding,context:MainToolContext):WorkspaceMemberToolsPort{
 const main=checkedConversationAgentBinding(binding,task),identity={workspaceId:owner.entry.id,instanceId:owner.instanceId},fixed=Object.freeze({...context.binding});
 if(fixed.workspaceId!==identity.workspaceId||fixed.rootSessionId!==main.rootSessionId||fixed.runId!==runId||task.root!==owner.entry.path)fail('MEMBER_ACTOR','岗位端口与真实主运行不一致');
 const current=(signal:AbortSignal)=>{signal.throwIfAborted();owner.assert(identity);context.assertCurrent(signal)};
 const change=async(value:MemberToolChange):Promise<WorkspaceMemberChangeInput>=>{
  if(value.kind!=='register')return value;
  const selection=agentModelSelectionSchema.safeParse(data(await owner.snapshot(),value.agentId+'/agent.json').runtime);
  if(!selection.success)fail('MEMBER_MODEL_MANUAL','请先由用户为静态 Agent 配置模型，岗位登记不会自动选型');
  return {...value,runtimePolicy:selection.data};
 };
 return {call:async(name,raw,signal,toolCallId)=>{
  current(signal);
  if(name==='cbim_member_inspect'){
   const input=memberToolInspectSchema.parse(raw);
   if(!('memberId' in input)){const page=await members.list({...identity,...input});current(signal);return {identity,page}}
   const detail=await members.get({...identity,...input});current(signal);
   return {identity,detail:{memberId:detail.member.memberId,revision:detail.member.revision,agentId:detail.member.adoption.configuration.agentId,state:detail.member.state,currentDiff:detail.currentDiff,repair:[...(detail.currentDiff.capability.status==='changed'?['cbim_member_change_preview: adopt target=capability']:[]),...(detail.currentDiff.model.status!=='same'?['请由用户核实并采纳模型配置']:[]),...(detail.currentDiff.capability.status==='missing'||detail.currentDiff.capability.status==='invalid'?['恢复静态 Agent 定义，或解除责任后停用/退役岗位']:[])]}};
  }
  if(name==='cbim_member_change_preview'){
   const input=memberToolPreviewSchema.parse(raw),resolved=await change(input.change);current(signal);
   const preview=await members.preview({...identity,change:resolved});current(signal);
   return {identity,change:input.change,basis:preview.basis,registryCursor:preview.registryCursor,previousRevision:preview.previousRevision,capabilityHash:preview.proposed.capability.capabilityHash,configurationHash:preview.proposed.runtimePolicy.configurationHash,changedFields:preview.changedFields};
  }
  if(name==='cbim_member_change_commit'){
   const input=memberToolCommitSchema.parse(raw),actor=workspaceMemberMainActorSchema.parse({kind:'main_agent',rootSessionId:fixed.rootSessionId,scopeId:fixed.scopeId,agentInstanceId:main.agentInstanceId,agentSessionId:main.agentSessionId,runId,toolCallId,toolName:name});
   const commandId=workspaceMemberMainCommandId(identity.workspaceId,actor);
   return context.track(async()=>{
    const resolved=await change(input.change);current(signal);
    const receipt=await members.commit({...identity,...input,change:resolved,commandId},actor,()=>current(signal));
    return {identity,status:'recorded',commandId,receipt};
   });
  }
  const input=memberToolReceiptSchema.parse(raw),receipt=await members.mainReceipt(identity.workspaceId,input.commandId,main.rootSessionId);current(signal);
  return receipt?{identity,status:'recorded',commandId:input.commandId,receipt}:{identity,status:'unknown',commandId:input.commandId};
 }};
}
