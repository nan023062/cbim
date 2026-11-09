/**
 * 作用定位：公开模块负责人控制面的纯数据协议，供业务架构、项目岗位与 Main IPC 使用。
 * 设计原因：责任登记引用稳定岗位，界面只核对协议及原命令，不接触知识文件、存储事务或实际派发实现。
 */
export {
  moduleOwnershipChangeInputSchema,moduleOwnershipPreviewInputSchema,moduleOwnershipPreviewSchema,
  moduleOwnershipCommitInputSchema,moduleOwnershipReceiptSchema,moduleOwnershipPageSchema,moduleOwnershipDetailSchema,isModuleOwnershipSourceAdoption,
} from '../../backend/core/workspace/module-ownership';
export type {
  ModuleOwnership,ModuleOwnershipIdentity,ModuleOwnershipReadBasis,ModuleOwnershipView,
  ModuleOwnershipChangeInput,ModuleOwnershipPreviewInput,ModuleOwnershipPreview,ModuleOwnershipCommitInput,
  ModuleOwnershipReceipt,ModuleOwnershipPage,ModuleOwnershipDetail,ModuleOwnershipListInput,ModuleOwnershipGetInput,
  ModuleOwnershipByMemberInput,ModuleOwnershipLookup,
} from '../../backend/core/workspace/module-ownership';
