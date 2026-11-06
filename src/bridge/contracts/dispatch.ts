/**
 * 作用定位：向桌面消费者公开成员派发、执行增量、主会话图以及独立目标周期摘要/详情，并导出无 IO 的投影校验及归并函数。
 * 设计原因：前端经 Bridge 消费 Core 契约与显式补充的请求/回执Schema，不导入调度或文件存储；目标刷新不改证据图游标，恢复只携带公开身份和配置，不包含凭据或原生会话。
 */
export type {GraphIdentity,GraphCursor,GraphSnapshot,GraphDelta,GraphEventBatch,GraphChange,TaskNode,GraphEdge,AgentGraphView} from '../../backend/core/tasks/graph-types';
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
