/**
 * 作用定位：将任务节点的前置追加和替换审计转换为主对话和任务详情共用的只读历史投影。
 * 设计原因：依赖调整不等于执行或验收，后续运行不会抹掉原记录；仅展示匹配当前节点的后端事实，损坏记录明确提示，不按文字或连线猜测补做。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {dependencyReplacementSchema,dependencyAdditionSchema,type DependencyReplacement,type DependencyAddition} from '../../bridge/contracts/dispatch';

export interface MemberDependencyHistory {records:DependencyReplacement[];invalid:boolean}
/** 缺字段是旧节点；空数组或不匹配的审计是坏记录，不应显示为没有历史。 */
export interface MemberDependencyAdditionHistory {records:DependencyAddition[];invalid:boolean}

/** 调用方先核对工作区/会话身份。这里不读取日志、核验证据或签发执行许可；完整语义由后端事务保证。 */
export function memberDependencyHistory(task:TaskNode):MemberDependencyHistory {
  if(task.dependencyReplacements===undefined)return {records:[],invalid:false};
  const parsed=dependencyReplacementSchema.array().min(1).max(32).safeParse(task.dependencyReplacements);
  if(!parsed.success||!task.scopeId)return {records:[],invalid:true};
  const records=parsed.data,commands=new Set<string>();let revision=0;
  for(const record of records){
    if(record.scopeId!==task.scopeId||record.previousTaskRevision<=revision||record.previousTaskRevision>=task.revision||record.targetPlanRevision>task.planRevision||!record.trackedTaskIds.includes(task.taskId)||commands.has(record.commandId))return {records:[],invalid:true};
    commands.add(record.commandId);revision=record.previousTaskRevision;
  }
  return {records,invalid:false};
}

/** 追加只锁定当时的前置任务与计划，不能在此查询或补造其后产生的 run/result。 */
export function memberDependencyAdditionHistory(task:TaskNode):MemberDependencyAdditionHistory {
  if(task.dependencyAdditions===undefined)return {records:[],invalid:false};
  const parsed=dependencyAdditionSchema.array().min(1).max(32).safeParse(task.dependencyAdditions);
  if(!parsed.success||!task.scopeId)return {records:[],invalid:true};
  const records=parsed.data,commands=new Set<string>();let revision=0;
  for(const record of records){
    if(record.scopeId!==task.scopeId||record.previousTaskRevision<=revision||record.previousTaskRevision>=task.revision||record.targetPlanRevision>task.planRevision||record.dependency.sourceTaskId===task.taskId||!record.trackedTaskIds.includes(task.taskId)||!record.trackedTaskIds.includes(record.dependency.sourceTaskId)||commands.has(record.commandId))return {records:[],invalid:true};
    commands.add(record.commandId);revision=record.previousTaskRevision;
  }
  return {records,invalid:false};
}
