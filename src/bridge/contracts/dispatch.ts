/**
 * 公开纯检查点链与逐段预约投影，不把后端文件及原生会话核实端口带到前端。
 * 作用定位：向桌面消费者公开成员派发、执行增量、主会话图以及独立目标周期摘要/详情，并导出无 IO 的投影校验及归并函数。
 * 设计原因：前端经 Bridge 消费 Core 契约，不导入调度或文件存储；前置原子增删和检查点只公开原审计，均不代表执行许可、业务成果或回滚。
 * 恢复来源：公开严格主／成员联合及兼容历史辅助函数；新的处置引用必须显式提供，不能给旧无 kind 记录补造来源。
 */
export type {GraphIdentity,GraphCursor,GraphSnapshot,GraphDelta,GraphEventBatch,GraphChange,TaskNode,GraphEdge,AgentGraphView} from '../../logic/tasks/rules/graph-types';
/** 稳定对话登记与执行实例分离；纯校验不授予派发或模型执行权限。 */
export {teamSessionSchema} from '../../logic/team/rules/team-session';
export type {TeamSession} from '../../logic/team/rules/team-session';
export type {DependencyReplacement} from '../../logic/tasks/rules/queued-dependency-replacement';
export {dependencyReplacementSchema} from '../../logic/tasks/rules/queued-dependency-replacement';
export type {DependencyAddition} from '../../logic/tasks/rules/queued-dependency-addition';
export {dependencyAdditionSchema} from '../../logic/tasks/rules/queued-dependency-addition';
export type {DependencyRevision} from '../../logic/tasks/rules/queued-dependency-revision';
export {dependencyRevisionSchema} from '../../logic/tasks/rules/queued-dependency-revision';
export type {MemberCheckpointRecord} from '../../logic/tasks/rules/member-checkpoint';
export {memberCheckpointRecordSchema,memberCheckpointLimit} from '../../logic/tasks/rules/member-checkpoint';
export {memberResumeRequests,currentMemberResumeRequest,validMemberCheckpointChain} from '../../logic/tasks/rules/member-checkpoint-chain';
export type {AbandonCheckpointInput,CheckpointAbandonment,AbandonCheckpointReceipt} from '../../logic/tasks/rules/checkpoint-handoff';
export {abandonCheckpointInputSchema,checkpointAbandonmentSchema,abandonCheckpointReceiptSchema} from '../../logic/tasks/rules/checkpoint-handoff';
export type {MemberResumeRequest} from '../../logic/tasks/rules/queued-member-resume';
export {memberResumeRequestSchema} from '../../logic/tasks/rules/queued-member-resume';
export type {OpenGraphInput,CreateMemberInput,DispatchTaskInput,OpenGraphReceipt,CreateMemberReceipt,DispatchReceipt} from '../../logic/tasks/rules/dispatch-commands';
/** 主对话关联原派发时复用纯输出契约；结构通过不替代运行归属和图游标核对。 */
export {dispatchTaskOutputSchema} from '../../logic/tasks/rules/dispatch-receipt';
export {toolReceiptSchema} from '../../logic/tools/rules/receipt-schema';
export type {MemberStartOptions,MemberStartReceipt,MemberExecutionView} from '../../logic/tasks/rules/member-commands';
export type {MemberEventsInput,MemberEventCursor,MemberRunView,MemberEventsRead} from '../../logic/tasks/rules/member-events';
export {applyGraphBatch} from '../../logic/tasks/rules/graph-reducer';
export {validateGraph} from '../../logic/tasks/rules/graph-rules';
export type {DispatchScope,DispatchScopeOutcome} from '../../logic/tasks/rules/dispatch-scope';
export type {PublicDispatchScope} from '../../logic/tasks/rules/scope-public';
export type {DispatchSessionReadInput,DispatchSessionRead,ScopeCursor,ScopeDetailStamp,ScopeSummary,ScopeSnapshot,ScopeEventBatch,ScopeDelta,ScopeDetailRead,ScopeResetReason} from '../../logic/tasks/rules/scope-view';
export {applyScopeBatch,validateScopeSnapshot} from '../../logic/tasks/rules/scope-view';
export type {GoalContinuationRequest,GoalContinuationReceipt} from '../../logic/tasks/rules/scope-continuation';
export {goalContinuationRequestSchema,goalContinuationReceiptSchema} from '../../logic/tasks/rules/scope-continuation';
export {topicInterruptionRequestSchema,topicInterruptionSchema,pendingTopicInterruption} from '../../logic/tasks/rules/topic-interruption';
export type {TopicInterruptionRequest,TopicInterruption} from '../../logic/tasks/rules/topic-interruption';
export type {ExecutionReportInput,ExecutionReport} from '../../logic/tasks/rules/execution-report';
export {executionReportInputSchema,executionReportSchema} from '../../logic/tasks/rules/execution-report';
export type {ArtifactReportInput,ArtifactReport,ArtifactBaselineRef,ArtifactFileCheck} from '../../logic/evidence/rules/artifact-baseline';
export {artifactReportInputSchema,artifactReportSchema} from '../../logic/evidence/rules/artifact-baseline';
export type {RecoveryRequest,RecoveryLookup,RecoveryReceipt,RecoverySourceSelection} from '../../logic/tasks/rules/scope-recovery';
export {recoveryRequestSchema,recoveryLookupSchema,recoveryReceiptSchema,recoverySourceSelectionSchema,recoverySourceSelection,recoverySourceKey,recoveryRequestSource,isMainRecoverySource} from '../../logic/tasks/rules/scope-recovery';
export type {ReplanPreviewInput,ReplanPreview,ReplanRequest,ReplanLookup,ReplanReceipt} from '../../logic/tasks/rules/scope-replan';
export {replanPreviewInputSchema,replanPreviewSchema,replanRequestSchema,replanLookupSchema,replanReceiptSchema} from '../../logic/tasks/rules/scope-replan';
/** 运行中插入仅报告真实接收状态，不授予恢复或业务验收；hash/事务校验保留在后端。 */
export {scopeActiveInputSchema,scopeActiveInputStatus,scopeHasUnresolvedActiveInput,scopeActiveInputLimits} from '../../logic/tasks/rules/scope-active-input';
export type {ScopeActiveInput} from '../../logic/tasks/rules/scope-active-input';
/** 已受理附件清单的纯公开契约；来源证明不授予重新联网或执行权。 */
export type {ContinuationAttachmentManifest,ContinuationAttachmentItem} from '../../logic/tasks/rules/scope-continuation-attachments';
