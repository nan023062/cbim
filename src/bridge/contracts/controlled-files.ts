/**
 * 作用定位：向桌面公开受控文件原操作查询和显式补偿的纯协议。
 * 设计原因：界面只使用运行身份、版本及字节摘要；真实 before、文件句柄和私有阶段事件不跨 Bridge。
 */
export {
  controlledFileWriteToolName,controlledFileLimits,controlledFileUtf8Bytes,
  controlledFileReportInputSchema,controlledFileReportSchema,controlledFileOperationSummarySchema,
  fileCompensationPreviewInputSchema,fileCompensationPreviewSchema,fileCompensationInputSchema,
  fileCompensationLookupSchema,fileCompensationReceiptSchema,
} from '../../backend/core/tasks/controlled-file-operation';
export type {
  ControlledFileReportInput,ControlledFileReport,ControlledFileOperationSummary,ControlledFilePhase,
  FileCompensationPreviewInput,FileCompensationPreview,FileCompensationInput,FileCompensationLookup,FileCompensationReceipt,FileCompensationSummary,
} from '../../backend/core/tasks/controlled-file-operation';
