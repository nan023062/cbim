/**
 * 公开可选manifests选择及原清单证明；客户端不提交完整条目或观察结论，也不把旧基线请求转换为完整接受。
 * 作用定位：向桌面公开人工决定的序列化请求、依据预览与不可变记录。
 * 设计原因：界面复用 Core 的严格校验，不能导入调度或文件端口；本机显式决定不等于账号认证、模型授权或目标完成。
 */
export type {HumanDecisionKind,HumanDecisionBaselineSelection,HumanDecisionManifestSelection,HumanDecisionPreviewInput,HumanDecisionPreview,HumanDecisionRequest,HumanDecisionLookup,HumanDecisionReceipt,HumanDecisionRecord,HumanDecisionHistory,ScopeHumanDecisions} from '../../backend/core/tasks/human-decisions';
export {humanDecisionCoverageLimitation,humanDecisionPreviewInputSchema,humanDecisionPreviewSchema,humanDecisionRequestSchema,humanDecisionReceiptSchema,humanDecisionRecordSchema,humanDecisionHistorySchema} from '../../backend/core/tasks/human-decisions';
