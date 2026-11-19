/**
 * 作用定位：将办公室长期子 Session 投影为共享的角色、状态与任务引用，供侧栏、成员对话和办公室使用。
 * 设计原因：同一角色的执行实例可以变化，导航始终使用唯一逻辑 Session；只接受原办公室登记，不从名字猜身份。
 */
import { defaultWorkerId, taskWorkerId } from '../../bridge/contracts/dispatch';
import type { GraphSnapshot, OfficeMemberSession, TaskNode } from '../../bridge/contracts/dispatch';

export interface TeamConversation
{
  session: OfficeMemberSession;

  name: string;

  running: boolean;

  taskIds: string[]
}

/** 缺少图或正式登记时返回空列表，旧执行历史仍从原任务视图查阅。 */
export function teamConversations(sessions: readonly OfficeMemberSession[] | undefined, graph?: GraphSnapshot): TeamConversation[]
{
  if (!graph)
    return [];

  return (sessions ?? []).filter(session => session.workspaceId === graph.identity.workspaceId && session.officeId === graph.identity.rootSessionId && session.workerId !== defaultWorkerId(graph.root.agent.agentId)).map(session => { const tasks = memberConversationTasks(session, graph), agent = graph.agents.find(agent => defaultWorkerId(agent.agentId) === session.workerId); return { session, name: tasks.at(-1)?.assignee.name ?? agent?.name ?? session.workerId, running: tasks.some(task => !!task.activeRunId || task.status === 'running'), taskIds: tasks.map(task => task.taskId) }; });
}

/** 返回逻辑成员在该办公室的任务引用，实际正文仍沿每个 task/run 的公开读取入口。 */
export function memberConversationTasks(session: OfficeMemberSession, graph?: GraphSnapshot): TaskNode[]
{
  if (!graph || graph.identity.workspaceId !== session.workspaceId || graph.identity.rootSessionId !== session.officeId)
    return [];

  return graph.tasks.filter(task => task.identity.workspaceId === session.workspaceId && task.identity.rootSessionId === session.officeId && taskWorkerId(task) === session.workerId);
}

/** 缓存仅服务本机视图；重开工作区更换实例后不沿用旧动态。 */
export const teamConversationKey = (workspaceId: string, instanceId: string | undefined, rootSessionId: string | undefined) => JSON.stringify([workspaceId, instanceId, rootSessionId]);

/** 只把已核实原任务映射为逻辑对话；缺登记、重复登记或身份不一致时拒绝，不改派到主 Agent。 */
export function taskConversationTarget(identity: GraphSnapshot['identity'], graph: GraphSnapshot | undefined, sessions: readonly OfficeMemberSession[] | undefined, taskId: string): { sessionId?: string; scopeId?: string; taskId?: string }
{
  if (graph && (graph.identity.workspaceId !== identity.workspaceId || graph.identity.rootSessionId !== identity.rootSessionId))
    throw Error('任务不属于当前办公室，请重新同步。');

  if (taskId === (graph?.root.nodeId ?? 'session:' + identity.rootSessionId))
    return {};

  const matches = graph?.tasks.filter(task => task.taskId === taskId) ?? [];

  if (matches.length !== 1)
    throw Error('原任务暂不可读取，未跳转其他任务。');

  const task = matches[0];

  if (task.identity.workspaceId !== identity.workspaceId || task.identity.rootSessionId !== identity.rootSessionId)
    throw Error('任务不属于当前办公室，请重新同步。');

  if (task.assignee.agentId === graph!.root.agent.agentId)
    return { scopeId: task.scopeId };

  const owners = (sessions ?? []).filter(session => session.workspaceId === identity.workspaceId && session.officeId === identity.rootSessionId && session.workerId === taskWorkerId(task));

  if (owners.length !== 1)
    throw Error('原任务缺少唯一的成员对话登记，请重新同步后查看。');

  return { sessionId: owners[0].sessionId, scopeId: task.scopeId, taskId: task.taskId };
}
