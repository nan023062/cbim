/**
 * 作用定位：将任务节点的前置追加、替换和原子增删转换为主对话与详情共用的只读历史投影。
 * 设计原因：依赖调整不等于执行或验收，后续运行不会抹掉原记录；仅展示匹配当前节点的后端事实，损坏记录明确提示，不按文字或连线猜测补做。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {dependencyReplacementSchema,dependencyAdditionSchema,dependencyRevisionSchema,type DependencyReplacement,type DependencyAddition,type DependencyRevision} from '../../bridge/contracts/dispatch';

export interface MemberDependencyHistory {records:DependencyReplacement[];invalid:boolean}
/** 缺字段是旧节点；空数组或不匹配的审计是坏记录，不应显示为没有历史。 */
export interface MemberDependencyAdditionHistory {records:DependencyAddition[];invalid:boolean}
export interface MemberDependencyRevisionHistory {records:DependencyRevision[];invalid:boolean}

/** 原子增删仅显示原请求与审计；跨图和原边事实仍由后端完整图核实，不在视图重建。 */
export function memberDependencyRevisionHistory(task:TaskNode):MemberDependencyRevisionHistory {
  if(task.dependencyRevisions===undefined)return {records:[],invalid:false};
  const parsed=dependencyRevisionSchema.array().min(1).max(32).safeParse(task.dependencyRevisions);
  if(!parsed.success||!task.scopeId)return {records:[],invalid:true};
  const records=parsed.data,commands=new Set<string>();let revision=0;
  for(const r of records){const target=r.request.target;
    if(r.scopeId!==task.scopeId||target.taskId!==task.taskId||target.expectedRevision<=revision||target.expectedRevision>=task.revision||target.expectedPlanRevision>task.planRevision||!r.trackedTaskIds.includes(task.taskId)||[...r.removed,...r.added].some(e=>e.sourceTaskId===task.taskId||!r.trackedTaskIds.includes(e.sourceTaskId))||commands.has(r.commandId))return {records:[],invalid:true};
    commands.add(r.commandId);revision=target.expectedRevision;
  }
  return {records,invalid:false};
}

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
