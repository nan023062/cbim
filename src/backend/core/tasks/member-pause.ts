/**
 * 作用定位：定义可靠成员检查点及未领取后继的显式持久等待清单，供目标审阅与等待归档共用。
 * 设计原因：保留原任务必须是可核对的申请，不能靠状态名称推断恢复许可；清单只带公开身份和版本，不接收原生路径或执行权限。
 */
import {z} from 'zod';
const id=z.string().min(1).max(512),revision=z.number().int().positive().safe();
const task={taskId:id,expectedRevision:revision,expectedPlanRevision:revision};
/** 精确覆盖全部未完成工作；checkpointId 只指向已冻结且尚未预约/消费的原检查点。 */
export const memberPauseSchema=z.object({version:z.literal(1),expectedGraphCursor:z.object({streamId:id,seq:z.number().int().nonnegative().safe()}).strict(),tasks:z.array(z.discriminatedUnion('kind',[
  z.object({...task,kind:z.literal('checkpoint'),checkpointId:id}).strict(),
  z.object({...task,kind:z.literal('unstarted')}).strict(),
])).min(1).max(500).refine(tasks=>new Set(tasks.map(task=>task.taskId)).size===tasks.length&&tasks.some(task=>task.kind==='checkpoint'),'等待清单不能重复且至少包含一个检查点')}).strict();
export type MemberPause=z.infer<typeof memberPauseSchema>;
