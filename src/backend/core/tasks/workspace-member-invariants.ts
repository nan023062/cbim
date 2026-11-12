/**
 * 作用定位：将岗位登记的单条审计规则接到工作区 DispatchStore 的提交与重放边界。
 * 设计原因：岗位仅可凭预先完整核验的许可附带其首次来源捕获；不能混入执行变化，退休须先解除责任，当前头只由审计派生；主工具必须绑定当时的活动周期、主实例与对话通道。
 */
import {fail} from '../foundation/errors';
import {applyWorkspaceMemberChange,workspaceMemberCanonical,workspaceMemberCommand,workspaceMemberReceipt} from '../team/workspace-member-rules';
import type {WorkspaceMember,WorkspaceMemberChange,WorkspaceRegistryCursor} from '../team/workspace-member';
import type {DispatchState,DispatchMutation,DispatchCommand} from '../dispatch/dispatch-storage';
import type {KnowledgeSourceCapturePermit} from './knowledge-source-invariants';

/** 返回登记候选投影；调用方仍须先验证全部事务、可靠落盘后再发布。 */
export function projectWorkspaceMemberMutation(previous:DispatchState,mutation:DispatchMutation,command:DispatchCommand,sourcePermit?:KnowledgeSourceCapturePermit):{workspaceMembers:WorkspaceMember[];workspaceMemberChanges:WorkspaceMemberChange[];registryCursor:WorkspaceRegistryCursor|null}{
  const invalid=(condition:unknown,message:string)=>{if(condition)fail('MEMBER_AUDIT',message)};
  invalid(Object.hasOwn(mutation,'workspaceMembers')||Object.hasOwn(mutation,'registryCursor'),'不能直接写入岗位头或登记游标');
  if(mutation.workspaceMemberChanges===undefined){
    invalid(command.commandId.startsWith('workspace-member-'),'岗位命令缺少唯一登记审计');
    return {workspaceMembers:previous.workspaceMembers??[],workspaceMemberChanges:previous.workspaceMemberChanges??[],registryCursor:previous.registryCursor??null};
  }
  invalid(!Array.isArray(mutation.workspaceMemberChanges)||mutation.workspaceMemberChanges.length!==1,'登记事务必须恰好追加一条审计');
  const captureAllowed=sourcePermit?.kind==='workspace_member'&&sourcePermit.changeId===mutation.workspaceMemberChanges[0]?.changeId&&sourcePermit.captureChangeId===mutation.knowledgeSourceChanges?.[0]?.changeId;
  invalid(Object.keys(mutation).some(key=>!['workspaceMemberChanges','receipt',...(captureAllowed?['knowledgeSourceChanges']:[])].includes(key)),'岗位登记不能夹带执行、任务或周期变更');
  const event=mutation.workspaceMemberChanges[0];
  // 和责任登记一样，审计重放也核对当时的真实主周期/实例/会话，不能仅凭 actor 字段放行。
  if(event.actor.kind==='main_agent'){
    const a=event.actor,scope=previous.scopes?.find(s=>s.scopeId===a.scopeId),graph=previous.graphs.find(g=>g.identity.rootSessionId===a.rootSessionId),member=previous.members.find(m=>m.agentInstanceId===a.agentInstanceId),session=previous.sessions.find(s=>s.agentSessionId===a.agentSessionId);
    invalid(!scope||scope.workspaceId!==previous.workspaceId||scope.rootSessionId!==a.rootSessionId||scope.status!=='active'||scope.runTracking?.mainRunIds.at(-1)!==a.runId,'主岗位操作缺少当前活动运行');
    invalid(graph?.root.agent.agentId!=='cbim:main'||graph.root.agent.agentInstanceId!==a.agentInstanceId||member?.agentId!=='cbim:main'||member.workspaceId!==previous.workspaceId||member.lifecycle==='released','主岗位操作实例不一致');
    invalid(session?.workspaceId!==previous.workspaceId||session.rootSessionId!==a.rootSessionId||session.agentInstanceId!==a.agentInstanceId||session.agentId!=='cbim:main'||session.purpose!=='conversation'||!member?.agentSessionIds.includes(a.agentSessionId),'主岗位操作通道不一致');
  }
  const next=applyWorkspaceMemberChange(previous,event),expected=workspaceMemberCommand(event.request,event.actor);
  if(event.next.state==='retired'&&(previous.moduleOwnerships??[]).some(binding=>binding.ownerMemberId===event.next.memberId))fail('MEMBER_OWNERSHIP_ACTIVE','岗位仍负责模块，请先明确解除或更换负责人');
  invalid(command.commandId!==expected.commandId||command.fingerprint!==expected.fingerprint,'岗位审计与原命令指纹不一致');
  invalid(workspaceMemberCanonical(mutation.receipt)!==workspaceMemberCanonical(workspaceMemberReceipt(event)),'岗位回执不能脱离真实审计结果');
  return next;
}
