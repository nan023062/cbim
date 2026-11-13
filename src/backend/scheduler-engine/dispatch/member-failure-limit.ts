/**
 * 作用定位：从同一目标的持久任务终态判断是否停止自动接续，供实时协调和重启核实共用。
 * 设计原因：失败后另派新任务不能重置额度；不另存内存计数，也不把文字输出、换编号或其它成功任务当作消除失败的依据。
 */
import type {GraphSnapshot} from '../../../logic/tasks/rules/graph-types';

/** 每个目标累计最多三次异常成员终态；用户取消、可靠检查点和业务求助不属于执行异常。 */
const memberFailureLimit=3;

/**
 * 只读可信任务图。failed/interrupted 是不可重跑的终态，每个已启动任务只计一次；
 * 关闭周期保留这些节点，因此重读磁盘、换实例及增加替代任务均不能刷新额度。
 * 返回的理由用于目标卡和暂停队列；各任务的具体 waitReason 仍保留在原卡上。
 */
export function memberFailureStopReason(graph:Pick<GraphSnapshot,'tasks'>,scopeId:string):string|undefined{
  const failed=graph.tasks.filter(task=>task.scopeId===scopeId&&!task.activeRunId&&task.runIds.length>0&&(task.status==='failed'||task.status==='interrupted'));
  if(failed.length<memberFailureLimit)return;
  return `本次目标累计 ${failed.length} 次成员执行失败或中断，已达到 ${memberFailureLimit} 次自动接续上限。已停止自动派发、重试和返工；请查看任务卡的具体原因，核实未确认的操作与产物后再由用户决定下一步。`;
}
