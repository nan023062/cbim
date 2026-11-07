/**
 * 作用定位：把工作区责任服务绑定真实主运行及当前协作周期，提供四项模型窄端口。
 * 设计原因：scope 必须在 beforeRun 完成后从原批次取得；actor 和原命令由闭包生成，模型不能自报身份、权限或重放来源。
 * 停止边界：原命令查询与提交全程纳入周期在途集合；保存之后不再抛明确未受理错误，回包失败保留原 commandId。
 */
import {fail} from '../../core/foundation/errors';
import {checkedConversationAgentBinding,type ConversationAgentBinding} from '../../core/brain/conversation-binding';
import type {TaskSpec} from '../../core/tasks/types';
import {moduleOwnershipMainActorSchema} from '../../core/workspace/module-ownership';
import {moduleOwnershipMainCommandId} from '../../core/workspace/module-ownership-rules';
import {moduleOwnerInspectInputSchema,moduleOwnerPreviewInputSchema,moduleOwnerCommitInputSchema,moduleOwnerReceiptInputSchema,type ModuleOwnershipToolsPort} from '../../core/workspace/module-ownership-tools';
import type {MainToolContext} from '../../scheduler-engine/execution/auto-collaboration';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {ModuleOwnerships} from './module-ownerships';
import type {WorkspaceMembers} from './workspace-members';

/** 只在本轮 createEngine 同步工厂装配；调用方已经建立真实主 scope，未装配成员没有入口。 */
export function mainModuleOwnershipTools(owner:KnowledgeWorkspace,service:ModuleOwnerships,members:WorkspaceMembers,task:TaskSpec,runId:string,binding:ConversationAgentBinding,context:MainToolContext):ModuleOwnershipToolsPort{
  const main=checkedConversationAgentBinding(binding,task),identity={workspaceId:owner.entry.id,instanceId:owner.instanceId},publicIdentity={workspaceId:owner.entry.id,rootSessionId:main.rootSessionId},fixed=Object.freeze({...context.binding});
  if(fixed.workspaceId!==owner.entry.id||fixed.rootSessionId!==main.rootSessionId||fixed.runId!==runId||task.root!==owner.entry.path)fail('OWNERSHIP_ACTOR','负责人端口与本轮真实主身份不一致');
  const current=(signal:AbortSignal)=>{signal.throwIfAborted();owner.assert(identity);context.assertCurrent(signal)};
  return {
    inspect:async(raw,signal)=>{
      current(signal);const input=moduleOwnerInspectInputSchema.parse(raw);
      if('members' in input){const {members:_,...query}=input,memberPage=await members.list({...identity,...query,limit:query.limit??20});current(signal);return {identity:publicIdentity,readOnly:true,selection:input,memberPage}}
      const page='moduleIds' in input?await service.inspectModules(identity,input.moduleIds):await service.byMember({...identity,...input});current(signal);
      return {identity:publicIdentity,readOnly:true,selection:input,page};
    },
    preview:async(raw,signal)=>{current(signal);const input=moduleOwnerPreviewInputSchema.parse(raw),preview=await service.preview({...identity,...input});current(signal);return {identity:publicIdentity,preview}},
    commit:(raw,toolCallId,signal)=>{
      const input=moduleOwnerCommitInputSchema.parse(raw),actor=moduleOwnershipMainActorSchema.parse({kind:'main_agent',rootSessionId:fixed.rootSessionId,scopeId:fixed.scopeId,agentInstanceId:main.agentInstanceId,agentSessionId:main.agentSessionId,runId:fixed.runId,toolCallId,toolName:'cbim_module_owner_change_commit'});
      const commandId=moduleOwnershipMainCommandId(identity.workspaceId,actor),request={...identity,...input,commandId};
      // 先登记 pending Promise 再启动异步查询/保存，关闭必须排空原请求；fresh 的停止检查由服务受理前执行。
      return context.track(async()=>{const receipt=await service.commit(request,actor,()=>current(signal));return {identity:publicIdentity,status:'recorded',commandId,receipt}});
    },
    receipt:async(raw,signal)=>{
      current(signal);const input=moduleOwnerReceiptInputSchema.parse(raw),receipt=await service.receipt({...input,workspaceId:identity.workspaceId});current(signal);
      if(receipt&&(receipt.actor.kind!=='main_agent'||receipt.actor.rootSessionId!==main.rootSessionId))fail('OWNERSHIP_IDENTITY','只能查询本根会话主工具的原责任命令');
      return receipt?{identity:publicIdentity,status:'recorded',commandId:input.commandId,receipt}:{identity:publicIdentity,status:'unknown',commandId:input.commandId};
    },
  };
}
