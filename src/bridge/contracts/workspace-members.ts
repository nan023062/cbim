/**
 * 作用定位：公开项目岗位登记、预览与原命令回执的数据协议，供 Main IPC 和团队页面核对身份。
 * 设计原因：界面只依赖无副作用的 Core DTO，不接触知识读取、模型凭据、调度事务或岗位审计写入实现。
 */
export {
  workspaceMemberChangeInputSchema,workspaceMemberPreviewInputSchema,workspaceMemberPreviewSchema,
  workspaceMemberCommitInputSchema,workspaceMemberReceiptSchema,workspaceMemberListSchema,workspaceMemberDetailSchema,
} from '../../logic/team/rules/workspace-member';
export type {
  WorkspaceMember,WorkspaceMemberState,WorkspaceMemberIdentity,WorkspaceRegistryCursor,
  WorkspaceMemberChangeInput,WorkspaceMemberPreviewInput,WorkspaceMemberPreview,WorkspaceMemberCommitInput,
  WorkspaceMemberReceipt,WorkspaceMemberListInput,WorkspaceMemberList,WorkspaceMemberGetInput,WorkspaceMemberDetail,
  WorkspaceMemberLookup,
} from '../../logic/team/rules/workspace-member';
