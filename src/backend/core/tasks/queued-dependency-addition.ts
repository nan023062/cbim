/**
 * 作用定位：声明主调度为未领取任务追加单条结果前置的严格输入、不可变审计和提交回执。
 * 设计原因：先创建的任务也可依赖后来创建的任务；新增边仅改变等待条件，不改变任务计划、执行实例或伪造来源结果。
 * 职责边界：叶子协议不依赖任务图实现，避免 TaskNode 引用审计产生循环；模型不能提供周期、主运行或已执行结果。
 */
import {z} from 'zod';
// 沿用图与派发协议的 ID 域；不是文件路径专用的 safeId 100 字符限制。
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const revision=z.number().int().positive().safe();
const cursor=z.object({streamId:id,seq:z.number().int().nonnegative().safe()}).strict();
const reason=z.string().trim().min(1).max(4000);
const task=z.object({taskId:id,expectedRevision:revision,expectedPlanRevision:revision}).strict();
/** 一次只添加模型明确选择的一条边；闭包由真实图计算，不能由模型省略后继。 */
export const addQueuedDependencyInputSchema=z.object({expectedGraphCursor:cursor,expectedGoalRevision:revision,source:task,target:task,reason}).strict();
export type AddQueuedDependencyInput=z.infer<typeof addQueuedDependencyInputSchema>;
/** target 身份来自持有本记录的 TaskNode；后续领取可给边固定真实 resultId，历史记录自身不变。 */
export const dependencyAdditionSchema=z.object({
  commandId:id,scopeId:id,mainRunId:id,addedAt:z.string().datetime(),reason,graphCursor:cursor,
  goalRevision:revision,goalPlanRevision:revision,knowledgeRevision:id,previousTaskRevision:revision,targetPlanRevision:revision,
  dependency:z.object({edgeId:id,sourceTaskId:id,sourceTaskRevision:revision,sourcePlanRevision:revision}).strict(),
  /** 两端及启用后继的去重并集，按图的持久任务顺序排列；首项不一定是 target。 */
  trackedTaskIds:z.array(id).min(2).max(500).refine(ids=>new Set(ids).size===ids.length),
}).strict();
export type DependencyAddition=z.infer<typeof dependencyAdditionSchema>;
/** 仅证明依赖已保存、目标等待来源结果；不是成员已经启动或业务完成的事实。 */
export type AddQueuedDependencyReceipt={workspaceId:string;rootSessionId:string;scopeId:string;mainRunId:string;commandId:string;taskId:string;status:'waiting';trackedTaskIds:string[];addition:DependencyAddition;graphCursor:{streamId:string;seq:number}};
