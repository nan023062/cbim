/**
 * 作用定位：公开按已保存人工决定继续原目标的严格请求与回执，连接桌面和调度入口。
 * 设计原因：与普通文本补充和决定保存区分；不暴露可信主体生成、文件核实或执行服务实例。
 */
export type {HumanContinuationRequest,HumanContinuationLookup,HumanContinuationReceipt,ScopeHumanContinuation,HumanContinuationSubject} from '../../backend/core/tasks/human-continue';
export {humanContinuationRequestSchema,humanContinuationLookupSchema,humanContinuationReceiptSchema,scopeHumanContinuationSchema} from '../../backend/core/tasks/human-continue';
export {isHumanContinuation} from '../../backend/core/tasks/scope-continuation-record';
