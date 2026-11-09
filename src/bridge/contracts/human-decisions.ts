/**
 * 公开完整清单选择、跨等待原意见引用和逐项对照；客户端不能提交观察结论或借旧批准省略新决定。
 * 作用定位：向桌面公开人工决定的序列化请求、依据预览与不可变记录。
 * 设计原因：界面复用 Core 的严格校验，不能导入调度或文件端口；本机显式决定不等于账号认证、模型授权或目标完成。
 */
export type {HumanDecisionKind,HumanDecisionBaselineSelection,HumanDecisionManifestSelection,HumanDecisionPreviewInput,HumanDecisionPreview,HumanReconsideration,HumanDecisionRequest,HumanDecisionLookup,HumanDecisionReceipt,HumanDecisionRecord,HumanDecisionHistory,ScopeHumanDecisions} from '../../backend/core/tasks/human-decisions';
export {humanDecisionCoverageLimitation,humanDecisionPreviewInputSchema,humanDecisionPreviewSchema,humanDecisionRequestSchema,humanDecisionReceiptSchema,humanDecisionRecordSchema,humanDecisionHistorySchema} from '../../backend/core/tasks/human-decisions';
