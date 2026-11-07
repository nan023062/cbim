/**
 * 作用定位：将任务节点的前置替换审计转换为主对话和任务详情共用的只读历史投影。
 * 设计原因：替换不等于执行或验收，后续运行不会抹掉原记录；仅展示匹配当前节点的后端事实，损坏记录明确提示，不按文字或连线猜测补做。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {dependencyReplacementSchema,type DependencyReplacement} from '../../bridge/contracts/dispatch';

export interface MemberDependencyHistory {records:DependencyReplacement[];invalid:boolean}

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
