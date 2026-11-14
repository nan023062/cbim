/**
 * 作用定位：定义已结算主轮等待成员结果的不可变批次，供调度存储与重启接收共用。
 * 设计原因：只记录明确的原批次、选项和日志指纹；重启不得按任务状态猜测原权限或重放成员命令。
 */
import {z} from 'zod';
import {fail} from '../../../core/errors';
import type {GraphSnapshot} from './graph-types';
import {sameGoalValue} from './scope-goal';
import {loopEngineSchema} from '../../engines';

const id=z.string().min(1).max(512),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const automaticReturnSchema=z.object({mainRunId:id,taskIds:z.array(id).min(1).max(100).refine(ids=>new Set(ids).size===ids.length),sourceLogHash:digest,modelHash:digest,recordedAt:z.string().datetime(),options:z.object({engine:loopEngineSchema.optional(),collaborationMode:z.enum(['auto','team']).optional(),provider:id,model:id,profileId:id,permission:z.enum(['read','ask','execute']),allowNativeExecution:z.boolean(),turnTimeoutMs:z.number().positive().optional()}).strict()}).strict();
export type AutomaticReturn=z.infer<typeof automaticReturnSchema>;
type ReturnScope={scopeId:string;status:'active'|'waiting'|'closed';runTracking?:{mainRunIds:string[]};automaticReturns?:AutomaticReturn[]};
/** 提交与重放共用：已有批次永不改写；新批次只能绑定最新真实主轮及同周期已存在任务。 */
export function validateAutomaticReturns(previous:ReturnScope|undefined,next:ReturnScope,graph:GraphSnapshot):void{
  const before=previous?.automaticReturns??[],after=next.automaticReturns??[];
  const valid=(condition:unknown)=>{if(!condition)fail('GRAPH_INPUT_INVALID','自动回传批次必须保留原身份、选项和不可变历史')};
  valid(after.length<=32&&after.length>=before.length&&after.length<=before.length+1&&before.every((entry,index)=>sameGoalValue(entry,after[index])));
  valid(new Set(after.map(entry=>entry.mainRunId)).size===after.length);
  for(const entry of after){valid(automaticReturnSchema.safeParse(entry).success&&entry.options.allowNativeExecution===(entry.options.permission!=='read')&&next.runTracking?.mainRunIds.includes(entry.mainRunId)&&entry.taskIds.every(id=>graph.tasks.some(task=>task.taskId===id&&task.scopeId===next.scopeId)))}
  if(after.length>before.length)valid(previous?.status==='active'&&next.status==='active'&&after.at(-1)!.mainRunId===previous.runTracking?.mainRunIds.at(-1));
}
