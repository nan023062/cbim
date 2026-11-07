/**
 * 作用定位：向桌面消费者公开成员派发、执行增量、主会话图以及独立目标周期摘要/详情，并导出无 IO 的投影校验及归并函数。
 * 设计原因：前端经 Bridge 消费 Core 契约，不导入调度或文件存储；文件基线复核与执行报告分开，只公开有界事实，不包含执行许可、正文、凭据或原生会话隔离清单。
 */
export type {GraphIdentity,GraphCursor,GraphSnapshot,GraphDelta,GraphEventBatch,GraphChange,TaskNode,GraphEdge,AgentGraphView} from '../../backend/core/tasks/graph-types';
export type {DependencyReplacement} from '../../backend/core/tasks/queued-dependency-replacement';
export {dependencyReplacementSchema} from '../../backend/core/tasks/queued-dependency-replacement';
export type {OpenGraphInput,CreateMemberInput,DispatchTaskInput,OpenGraphReceipt,CreateMemberReceipt,DispatchReceipt} from '../../backend/core/tasks/dispatch-commands';
export type {MemberStartOptions,MemberStartReceipt,MemberExecutionView} from '../../backend/core/tasks/member-commands';
export type {MemberEventsInput,MemberEventCursor,MemberRunView,MemberEventsRead} from '../../backend/core/tasks/member-events';
export {applyGraphBatch} from '../../backend/core/tasks/graph-reducer';
export {validateGraph} from '../../backend/core/tasks/graph-rules';
export type {DispatchScope,DispatchScopeOutcome} from '../../backend/core/tasks/dispatch-scope';
export type {DispatchSessionReadInput,DispatchSessionRead,ScopeCursor,ScopeDetailStamp,ScopeSummary,ScopeSnapshot,ScopeEventBatch,ScopeDelta,ScopeDetailRead,ScopeResetReason} from '../../backend/core/tasks/scope-view';
export {applyScopeBatch,validateScopeSnapshot} from '../../backend/core/tasks/scope-view';
export type {GoalContinuationRequest,GoalContinuationReceipt} from '../../backend/core/tasks/scope-continuation';
export {goalContinuationRequestSchema,goalContinuationReceiptSchema} from '../../backend/core/tasks/scope-continuation';
export type {ExecutionReportInput,ExecutionReport} from '../../backend/core/tasks/execution-report';
export {executionReportInputSchema,executionReportSchema} from '../../backend/core/tasks/execution-report';
export type {ArtifactReportInput,ArtifactReport,ArtifactBaselineRef,ArtifactFileCheck} from '../../backend/core/tasks/artifact-baseline';
export {artifactReportInputSchema,artifactReportSchema} from '../../backend/core/tasks/artifact-baseline';
export type {RecoveryRequest,RecoveryLookup,RecoveryReceipt} from '../../backend/core/tasks/scope-recovery';
export {recoveryRequestSchema,recoveryLookupSchema,recoveryReceiptSchema} from '../../backend/core/tasks/scope-recovery';
export type {ReplanPreviewInput,ReplanPreview,ReplanRequest,ReplanLookup,ReplanReceipt} from '../../backend/core/tasks/scope-replan';
export {replanPreviewInputSchema,replanPreviewSchema,replanRequestSchema,replanLookupSchema,replanReceiptSchema} from '../../backend/core/tasks/scope-replan';
