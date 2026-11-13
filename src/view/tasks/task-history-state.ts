/**
 * 作用定位：为任务流程图划分默认折叠的历史任务，并统计被折叠的真实关联。
 * 设计原因：完成依据来自同会话周期的可靠关闭，不能把成员候选或单轮结束当作目标完成；展示分类不修改持久节点、边或调度状态。
 */
import type {GraphSnapshot,ScopeSummary,TaskNode} from '../../bridge/contracts/dispatch';
import {scopeGoalView} from './scope-state';

/** 只读展示结果；taskIds 使用业务任务 ID，关联数仅计算可见节点与历史之间的启用边。 */
export interface TaskHistoryView {tasks:TaskNode[];taskIds:ReadonlySet<string>;relatedEdgeCount:number}

/**
 * 已停止/撤销任务与已可靠完成周期的交付节点进入历史。在途、失败、受阻及待审阅节点仍可见。
 * 缺少周期或完成依据的旧记录保持可见；不借其他事件流的同名周期隐藏任务。
 */
export function taskHistoryView(graph:GraphSnapshot|undefined,scopes:readonly ScopeSummary[]=[]):TaskHistoryView {
  const completedScopes=new Set(scopes.filter(scope=>
    scope.stamp.streamId==='scopes:'+graph?.cursor.streamId&&scopeGoalView(scope).phase==='completed'
  ).map(scope=>scope.scopeId));
  const tasks=graph?.tasks.filter(task=>{
    if(task.activeRunId)return false;
    if(task.status==='cancelled')return true;
    return task.status==='result_ready'&&!!task.scopeId&&completedScopes.has(task.scopeId)
      &&!!task.result&&task.result.planRevision===task.planRevision&&task.candidateReview?.decision!=='reject';
  })??[];
  const nodeIds=new Set(tasks.map(task=>task.nodeId));
  const relatedEdgeCount=graph?.edges.filter(edge=>edge.enabled&&edge.fromNodeId!==graph.root.nodeId
    &&nodeIds.has(edge.fromNodeId)!==nodeIds.has(edge.toNodeId)).length??0;
  return {tasks,taskIds:new Set(tasks.map(task=>task.taskId)),relatedEdgeCount};
}
