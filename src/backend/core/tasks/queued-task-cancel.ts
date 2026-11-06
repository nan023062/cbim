/**
 * 作用定位：定义主调度显式撤销未启动任务的输入、冻结记录及原子提交回执。
 * 设计原因：撤销仅处理从未领取的排队节点；模型不能提供主运行身份或静默扩大目标，也不能把撤销当作执行成功。
 */
import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const revision=z.number().int().positive().safe();
const cursor=z.object({streamId:id,seq:z.number().int().nonnegative().safe()}).strict();
/** 模型仅提供当前图基线与明确目标；运行、周期和命令身份由主调度闭包注入。 */
export const cancelQueuedTasksInputSchema=z.object({
  expectedGraphCursor:cursor,
  targets:z.array(z.object({taskId:id,expectedRevision:revision}).strict()).min(1).max(100).refine(values=>new Set(values.map(item=>item.taskId)).size===values.length,'撤销任务不能重复'),
  reason:z.string().trim().min(1).max(4000),
}).strict();
export type CancelQueuedTasksInput=z.infer<typeof cancelQueuedTasksInputSchema>;
/** graphCursor 是撤销前基线，previousRevision 是原节点版本；整条记录创建后不可改写。 */
export const queuedTaskCancellationSchema=z.object({
  commandId:id,scopeId:id,mainRunId:id,reason:z.string().trim().min(1).max(4000),cancelledAt:z.string().datetime(),previousRevision:revision,graphCursor:cursor,
}).strict();
export type QueuedTaskCancellation=z.infer<typeof queuedTaskCancellationSchema>;
/** 回执仅证明明确集合已撤销；graphCursor 指向提交后的图，既不启动模型也不代表业务验收。 */
export type CancelQueuedTasksReceipt={workspaceId:string;rootSessionId:string;scopeId:string;mainRunId:string;commandId:string;cancelledTaskIds:string[];graphCursor:{streamId:string;seq:number}};
