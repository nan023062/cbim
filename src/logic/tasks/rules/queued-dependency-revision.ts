/**
 * 作用定位：声明未领取目标多条前置增删的输入、不可变审计和原命令回执，供图与工具共享。
 * 设计原因：删除和新增必须一次提交；叶子契约不依赖图实现，原任务计划与执行身份不因依赖变化重建。
 */
import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),revision=z.number().int().positive().safe();
const cursor=z.object({streamId:id,seq:z.number().int().nonnegative().safe()}).strict();
const task=z.object({taskId:id,expectedRevision:revision,expectedPlanRevision:revision}).strict();
const edge=z.object({edgeId:id,expectedRevision:revision}).strict();
/** 只指定一个原目标；闭包与新图由服务计算，不接收模型声明的执行结果或可运行集合。 */
export const reviseQueuedDependenciesInputSchema=z.object({expectedGraphCursor:cursor,expectedGoalRevision:revision,target:task,remove:z.array(edge).max(32),add:z.array(task).max(32),reason:z.string().trim().min(1).max(4000)}).strict().superRefine((v,c)=>{
 if(!v.remove.length&&!v.add.length)c.addIssue({code:'custom',message:'修订必须包含实际增删'});
 if(new Set(v.remove.map(x=>x.edgeId)).size!==v.remove.length||new Set(v.add.map(x=>x.taskId)).size!==v.add.length)c.addIssue({code:'custom',message:'增删来源不能重复'});
});
export type ReviseQueuedDependenciesInput=z.infer<typeof reviseQueuedDependenciesInputSchema>;
const source=z.object({edgeId:id,sourceTaskId:id,sourceTaskRevision:revision,sourcePlanRevision:revision}).strict();
/** 原边只退役，新边只固定原来源计划；所有历史事实保持，后续领取才固定结果。 */
export const dependencyRevisionSchema=z.object({commandId:id,scopeId:id,mainRunId:id,revisedAt:z.string().datetime(),request:reviseQueuedDependenciesInputSchema,goalPlanRevision:revision,knowledgeRevision:id,removed:z.array(source.extend({edgeRevision:revision}).strict()).max(32),added:z.array(source).max(32),trackedTaskIds:z.array(id).min(2).max(500).refine(v=>new Set(v).size===v.length)}).strict().superRefine((r,c)=>{
 const q=r.request,edges=[...r.removed,...r.added];
 if(r.goalPlanRevision!==q.expectedGoalRevision||new Set(edges.map(e=>e.edgeId)).size!==edges.length||new Set(edges.map(e=>e.sourceTaskId)).size!==edges.length||!r.trackedTaskIds.includes(q.target.taskId)||edges.some(e=>e.sourceTaskId===q.target.taskId||!r.trackedTaskIds.includes(e.sourceTaskId))||r.removed.length!==q.remove.length||r.added.length!==q.add.length||r.removed.some((e,i)=>e.edgeId!==q.remove[i].edgeId||e.edgeRevision!==q.remove[i].expectedRevision)||r.added.some((e,i)=>e.sourceTaskId!==q.add[i].taskId||e.sourceTaskRevision!==q.add[i].expectedRevision||e.sourcePlanRevision!==q.add[i].expectedPlanRevision))c.addIssue({code:'custom',message:'修订审计不匹配原增删请求或闭包身份'});
});
export type DependencyRevision=z.infer<typeof dependencyRevisionSchema>;
/** 只表示依赖已保存；不代表领取、启动、成果或业务验收。 */
export const reviseQueuedDependenciesReceiptSchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id,mainRunId:id,commandId:id,taskId:id,status:z.enum(['queued','waiting']),trackedTaskIds:z.array(id).min(2).max(500).refine(v=>new Set(v).size===v.length),revision:dependencyRevisionSchema,graphCursor:cursor}).strict();
export type ReviseQueuedDependenciesReceipt=z.infer<typeof reviseQueuedDependenciesReceiptSchema>;
