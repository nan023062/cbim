/**
 * 作用定位：向桌面消费者公开成员派发、执行增量、主会话图以及独立目标周期摘要/详情，并导出无 IO 的投影校验及归并函数。
 * 设计原因：前端经 Bridge 消费 Core 契约，不导入调度或文件存储；前置原子增删和检查点只公开原审计，均不代表执行许可、业务成果或回滚。
 * 恢复来源：公开严格主／成员联合及兼容历史辅助函数；新的处置引用必须显式提供，不能给旧无 kind 记录补造来源。
 */
export type {GraphIdentity,GraphCursor,GraphSnapshot,GraphDelta,GraphEventBatch,GraphChange,TaskNode,GraphEdge,AgentGraphView} from '../../backend/core/tasks/graph-types';
export type {DependencyReplacement} from '../../backend/core/tasks/queued-dependency-replacement';
export {dependencyReplacementSchema} from '../../backend/core/tasks/queued-dependency-replacement';
export type {DependencyAddition} from '../../backend/core/tasks/queued-dependency-addition';
export {dependencyAdditionSchema} from '../../backend/core/tasks/queued-dependency-addition';
export type {DependencyRevision} from '../../backend/core/tasks/queued-dependency-revision';
export {dependencyRevisionSchema} from '../../backend/core/tasks/queued-dependency-revision';
export type {MemberCheckpointRecord} from '../../backend/core/tasks/member-checkpoint';
export {memberCheckpointRecordSchema} from '../../backend/core/tasks/member-checkpoint';
export type {AbandonCheckpointInput,CheckpointAbandonment,AbandonCheckpointReceipt} from '../../backend/core/tasks/checkpoint-handoff';
export {abandonCheckpointInputSchema,checkpointAbandonmentSchema,abandonCheckpointReceiptSchema} from '../../backend/core/tasks/checkpoint-handoff';
export type {MemberResumeRequest} from '../../backend/core/tasks/queued-member-resume';
export {memberResumeRequestSchema} from '../../backend/core/tasks/queued-member-resume';
export type {OpenGraphInput,CreateMemberInput,DispatchTaskInput,OpenGraphReceipt,CreateMemberReceipt,DispatchReceipt} from '../../backend/core/tasks/dispatch-commands';
export type {MemberStartOptions,MemberStartReceipt,MemberExecutionView} from '../../backend/core/tasks/member-commands';
export type {MemberEventsInput,MemberEventCursor,MemberRunView,MemberEventsRead} from '../../backend/core/tasks/member-events';
export {applyGraphBatch} from '../../backend/core/tasks/graph-reducer';
export {validateGraph} from '../../backend/core/tasks/graph-rules';
export type {DispatchScope,DispatchScopeOutcome} from '../../backend/core/tasks/dispatch-scope';
export type {PublicDispatchScope} from '../../backend/core/tasks/scope-public';
export type {DispatchSessionReadInput,DispatchSessionRead,ScopeCursor,ScopeDetailStamp,ScopeSummary,ScopeSnapshot,ScopeEventBatch,ScopeDelta,ScopeDetailRead,ScopeResetReason} from '../../backend/core/tasks/scope-view';
export {applyScopeBatch,validateScopeSnapshot} from '../../backend/core/tasks/scope-view';
export type {GoalContinuationRequest,GoalContinuationReceipt} from '../../backend/core/tasks/scope-continuation';
export {goalContinuationRequestSchema,goalContinuationReceiptSchema} from '../../backend/core/tasks/scope-continuation';
export type {ExecutionReportInput,ExecutionReport} from '../../backend/core/tasks/execution-report';
export {executionReportInputSchema,executionReportSchema} from '../../backend/core/tasks/execution-report';
export type {ArtifactReportInput,ArtifactReport,ArtifactBaselineRef,ArtifactFileCheck} from '../../backend/core/tasks/artifact-baseline';
export {artifactReportInputSchema,artifactReportSchema} from '../../backend/core/tasks/artifact-baseline';
export type {RecoveryRequest,RecoveryLookup,RecoveryReceipt,RecoverySourceSelection} from '../../backend/core/tasks/scope-recovery';
export {recoveryRequestSchema,recoveryLookupSchema,recoveryReceiptSchema,recoverySourceSelectionSchema,recoverySourceSelection,recoverySourceKey,recoveryRequestSource,isMainRecoverySource} from '../../backend/core/tasks/scope-recovery';
export type {ReplanPreviewInput,ReplanPreview,ReplanRequest,ReplanLookup,ReplanReceipt} from '../../backend/core/tasks/scope-replan';
export {replanPreviewInputSchema,replanPreviewSchema,replanRequestSchema,replanLookupSchema,replanReceiptSchema} from '../../backend/core/tasks/scope-replan';
/** 运行中插入仅报告真实接收状态，不授予恢复或业务验收；hash/事务校验保留在后端。 */
export {scopeActiveInputSchema,scopeActiveInputStatus,scopeHasUnresolvedActiveInput,scopeActiveInputLimits} from '../../backend/core/tasks/scope-active-input';
export type {ScopeActiveInput} from '../../backend/core/tasks/scope-active-input';
/** 已受理附件清单的纯公开契约；来源证明不授予重新联网或执行权。 */
export type {ContinuationAttachmentManifest,ContinuationAttachmentItem} from '../../backend/core/tasks/scope-continuation-attachments';
