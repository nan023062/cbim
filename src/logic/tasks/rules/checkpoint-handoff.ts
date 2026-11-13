/**
 * 作用定位：定义主调度明确放弃未消费检查点的严格请求、不可变处置审计和回执。
 * 设计原因：放弃只终止原待办，不迁移负责人、消费检查点或证明业务成功；叶子协议不引用任务图实现，供持久节点和工具共用。
 */
import {z} from 'zod';

// 与任务图相同的逻辑 ID 域；不把来源任务误收窄成文件路径专用 safeId。
const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const revision=z.number().int().positive().safe(),sequence=z.number().int().nonnegative().safe();
const cursor=z.object({streamId:id,seq:sequence}).strict();
const reason=z.string().min(1).max(4000).refine(value=>value.trim()===value,'请提供明确的交接放弃原因');
/** null 明确表示未预约；模型不能补充主身份、原生路径、证明或新的负责人。 */
export const abandonCheckpointInputSchema=z.object({
  expectedGraphCursor:cursor,expectedGoalRevision:revision,
  taskId:id,expectedRevision:revision,expectedPlanRevision:revision,checkpointId:id,
  expectedResumeRequestId:id.nullable(),reason,
}).strict();
export type AbandonCheckpointInput=z.infer<typeof abandonCheckpointInputSchema>;

/** 只冻结处置时的租约变化；之后关闭周期可再递增，不改写本记录或原运行租约。 */
export const checkpointAbandonmentSchema=z.object({
  kind:z.literal('abandoned_by_handoff'),commandId:id,scopeId:id,mainRunId:id,
  graphCursor:cursor,goalRevision:revision,previousTaskRevision:revision,planRevision:revision,
  checkpointId:id,sourceRunId:id,resumeRequestId:id.nullable(),
  previousLeaseEpoch:sequence,nextLeaseEpoch:sequence,reason,abandonedAt:z.string().datetime(),
}).strict().refine(value=>value.nextLeaseEpoch===value.previousLeaseEpoch+1,'交接放弃必须恰好递增一次原租约');
export type CheckpointAbandonment=z.infer<typeof checkpointAbandonmentSchema>;

/** 回执只证明原任务已取消；没有新 run、业务完成或副作用回滚的含义。 */
export const abandonCheckpointReceiptSchema=z.object({
  workspaceId:id,rootSessionId:id,scopeId:id,mainRunId:id,commandId:id,
  taskId:id,status:z.literal('cancelled'),abandonment:checkpointAbandonmentSchema,graphCursor:cursor,
}).strict();
export type AbandonCheckpointReceipt=z.infer<typeof abandonCheckpointReceiptSchema>;
