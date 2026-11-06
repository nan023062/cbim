/**
 * 作用定位：向桌面消费者公开成员派发、按白名单筛选的执行增量、回执和主会话图 Snapshot/Delta，并导出无 IO 的图校验及归并函数。
 * 设计原因：前端经 Bridge 消费 Core 公开类型与无 IO 的图校验/归并函数，不导入调度或文件存储；邮箱、凭据与其他成员的原生上下文不在图 DTO 中。
 */
export type {GraphIdentity,GraphCursor,GraphSnapshot,GraphDelta,GraphEventBatch,GraphChange,TaskNode,GraphEdge,AgentGraphView} from '../../backend/core/tasks/graph-types';
export type {OpenGraphInput,CreateMemberInput,DispatchTaskInput,OpenGraphReceipt,CreateMemberReceipt,DispatchReceipt} from '../../backend/core/tasks/dispatch-commands';
export type {MemberStartOptions,MemberStartReceipt,MemberExecutionView} from '../../backend/core/tasks/member-commands';
export type {MemberEventsInput,MemberEventCursor,MemberRunView,MemberEventsRead} from '../../backend/core/tasks/member-events';
export {applyGraphBatch} from '../../backend/core/tasks/graph-reducer';
export {validateGraph} from '../../backend/core/tasks/graph-rules';
