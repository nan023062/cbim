/**
 * 作用定位：向桌面消费者公开成员派发命令回执及主会话图 Snapshot/Delta。
 * 设计原因：前端只依赖无实现的 Core 契约，不导入调度或文件存储；邮箱、凭据与其他成员的原生上下文不在图 DTO 中。
 */
export type {GraphIdentity,GraphCursor,GraphSnapshot,GraphDelta,GraphEventBatch,GraphChange,TaskNode,GraphEdge,AgentGraphView} from '../../backend/core/tasks/graph-types';
export type {OpenGraphInput,CreateMemberInput,DispatchTaskInput,OpenGraphReceipt,CreateMemberReceipt,DispatchReceipt} from '../../backend/core/tasks/dispatch-commands';
