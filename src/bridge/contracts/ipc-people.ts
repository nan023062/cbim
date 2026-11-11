/**
 * 作用定位：岗位登记与模块责任的公开 IPC 请求与响应。
 * 设计原因：只注入本机提交来源；岗位配置和模块绑定由各自服务维护，不借登记启动模型。类型不替代身份和权限校验。
 */
import {type WorkspaceMemberDetail,type WorkspaceMemberList,type WorkspaceMemberPreview,type WorkspaceMemberReceipt,workspaceMemberCommitInputSchema,workspaceMemberGetInputSchema,workspaceMemberListInputSchema,workspaceMemberLookupSchema,workspaceMemberPreviewInputSchema} from '../../backend/core/team/workspace-member';
import {type ModuleOwnershipDetail,type ModuleOwnershipPage,type ModuleOwnershipPreview,type ModuleOwnershipReceipt,moduleOwnershipByMemberInputSchema,moduleOwnershipCommitInputSchema,moduleOwnershipGetInputSchema,moduleOwnershipListInputSchema,moduleOwnershipLookupSchema,moduleOwnershipPreviewInputSchema} from '../../backend/core/workspace/module-ownership';

export const peopleIpcRequests={
  'workspace.members.list':workspaceMemberListInputSchema,
  'workspace.members.get':workspaceMemberGetInputSchema,
  'workspace.members.preview':workspaceMemberPreviewInputSchema,
  'workspace.members.receipt':workspaceMemberLookupSchema,
  'workspace.members.commit':workspaceMemberCommitInputSchema,
  'workspace.ownerships.list':moduleOwnershipListInputSchema,
  'workspace.ownerships.get':moduleOwnershipGetInputSchema,
  'workspace.ownerships.byMember':moduleOwnershipByMemberInputSchema,
  'workspace.ownerships.preview':moduleOwnershipPreviewInputSchema,
  'workspace.ownerships.receipt':moduleOwnershipLookupSchema,
  'workspace.ownerships.commit':moduleOwnershipCommitInputSchema,
};
export interface PeopleIpcResponses {
  'workspace.members.list':WorkspaceMemberList;
  'workspace.members.get':WorkspaceMemberDetail;
  'workspace.members.preview':WorkspaceMemberPreview;
  'workspace.members.receipt':WorkspaceMemberReceipt|undefined;
  'workspace.members.commit':WorkspaceMemberReceipt;
  'workspace.ownerships.list':ModuleOwnershipPage;
  'workspace.ownerships.get':ModuleOwnershipDetail;
  'workspace.ownerships.byMember':ModuleOwnershipPage;
  'workspace.ownerships.preview':ModuleOwnershipPreview;
  'workspace.ownerships.receipt':ModuleOwnershipReceipt|undefined;
  'workspace.ownerships.commit':ModuleOwnershipReceipt;
}
