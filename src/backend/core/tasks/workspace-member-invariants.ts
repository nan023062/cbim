/**
 * 作用定位：将岗位登记的单条审计规则接到工作区 DispatchStore 的提交与重放边界。
 * 设计原因：长期岗位使用同一串行事务，但不能借登记混入派发、创建实例或改写已有执行；当前头只能从审计派生。
 */
import {fail} from '../foundation/errors';
import {applyWorkspaceMemberChange,workspaceMemberCanonical,workspaceMemberCommand,workspaceMemberReceipt} from '../team/workspace-member-rules';
import type {WorkspaceMember,WorkspaceMemberChange,WorkspaceRegistryCursor} from '../team/workspace-member';
import type {DispatchState,DispatchMutation,DispatchCommand} from './dispatch-storage';

/** 返回登记候选投影；调用方仍须先验证全部事务、可靠落盘后再发布。 */
export function projectWorkspaceMemberMutation(previous:DispatchState,mutation:DispatchMutation,command:DispatchCommand):{workspaceMembers:WorkspaceMember[];workspaceMemberChanges:WorkspaceMemberChange[];registryCursor:WorkspaceRegistryCursor|null}{
  const invalid=(condition:unknown,message:string)=>{if(condition)fail('MEMBER_AUDIT',message)};
  invalid(Object.hasOwn(mutation,'workspaceMembers')||Object.hasOwn(mutation,'registryCursor'),'不能直接写入岗位头或登记游标');
  if(mutation.workspaceMemberChanges===undefined){
    invalid(command.commandId.startsWith('workspace-member-'),'岗位命令缺少唯一登记审计');
    return {workspaceMembers:previous.workspaceMembers??[],workspaceMemberChanges:previous.workspaceMemberChanges??[],registryCursor:previous.registryCursor??null};
  }
  invalid(!Array.isArray(mutation.workspaceMemberChanges)||mutation.workspaceMemberChanges.length!==1,'登记事务必须恰好追加一条审计');
  invalid(Object.keys(mutation).some(key=>!['workspaceMemberChanges','receipt'].includes(key)),'岗位登记不能夹带执行、任务或周期变更');
  const event=mutation.workspaceMemberChanges[0];
  const next=applyWorkspaceMemberChange(previous,event),expected=workspaceMemberCommand(event.request);
  invalid(command.commandId!==expected.commandId||command.fingerprint!==expected.fingerprint,'岗位审计与原命令指纹不一致');
  invalid(workspaceMemberCanonical(mutation.receipt)!==workspaceMemberCanonical(workspaceMemberReceipt(event)),'岗位回执不能脱离真实审计结果');
  return next;
}
