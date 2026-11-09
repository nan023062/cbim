/**
 * 作用定位：为成员动态、任务节点和详情提供同一份求助交接投影与中文分类。
 * 设计原因：只有后端结算后写入的 task.help 才是交接事实；工具 staged 输出、普通 blocked 或失败正文不能替代它，历史轮次也不能借用其他运行的求助。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';

export type MemberHelp=NonNullable<TaskNode['help']>;
export const memberHelpKindLabels:Record<MemberHelp['input']['kind'],string>={missing_input:'缺少信息',dependency:'依赖协作',permission:'权限受限',capability:'能力不足',scope:'任务范围问题'};

/** 只返回已结束且与节点、实例、计划及可选选中轮次匹配的交接；这不是恢复或批准接口。 */
export function committedMemberHelp(task:TaskNode,runId?:string):MemberHelp|undefined{
  const help=task.help,binding=help?.binding;
  if(!help||!binding||task.status!=='blocked'||task.activeRunId||task.result)return;
  if(binding.workspaceId!==task.identity.workspaceId||binding.rootSessionId!==task.identity.rootSessionId||binding.taskId!==task.taskId||binding.planRevision!==task.planRevision)return;
  if(binding.agentId!==task.assignee.agentId||binding.agentInstanceId!==task.assignee.agentInstanceId||binding.agentSessionId!==task.assignee.agentSessionId)return;
  if(!task.runIds.includes(binding.runId)||runId!==undefined&&binding.runId!==runId)return;
  return help;
}
