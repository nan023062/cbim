/**
 * 作用定位：将办公室长期子 Session 投影为共享的角色、状态与任务引用，供侧栏、成员对话和办公室使用。
 * 设计原因：同一角色的执行实例可以变化，导航始终使用唯一逻辑 Session；只接受原办公室登记，不从名字猜身份。
 */
import type {GraphSnapshot,TeamSession,TaskNode} from '../../bridge/contracts/dispatch';

export interface TeamConversation {session:TeamSession;name:string;running:boolean;taskIds:string[]}
/** 缺少图或正式登记时返回空列表，旧执行历史仍从原任务视图查阅。 */
export function teamConversations(sessions:readonly TeamSession[]|undefined,graph?:GraphSnapshot):TeamConversation[]{
  if(!graph)return [];
  return (sessions??[]).filter(session=>session.workspaceId===graph.identity.workspaceId&&session.rootSessionId===graph.identity.rootSessionId&&session.agentId!==graph.root.agent.agentId).map(session=>{
    const tasks=memberConversationTasks(session,graph),agent=graph.agents.find(agent=>agent.agentId===session.agentId);
    return {session,name:tasks.at(-1)?.assignee.name??agent?.name??session.agentId,running:tasks.some(task=>!!task.activeRunId||task.status==='running'),taskIds:tasks.map(task=>task.taskId)};
  });
}
/** 返回逻辑成员在该办公室的任务引用，实际正文仍沿每个 task/run 的公开读取入口。 */
export function memberConversationTasks(session:TeamSession,graph?:GraphSnapshot):TaskNode[]{
  if(!graph||graph.identity.workspaceId!==session.workspaceId||graph.identity.rootSessionId!==session.rootSessionId)return [];
  return graph.tasks.filter(task=>task.identity.workspaceId===session.workspaceId&&task.identity.rootSessionId===session.rootSessionId&&task.assignee.agentId===session.agentId);
}
/** 缓存仅服务本机视图；重开工作区更换实例后不沿用旧动态。 */
export const teamConversationKey=(workspaceId:string,instanceId:string|undefined,rootSessionId:string|undefined)=>JSON.stringify([workspaceId,instanceId,rootSessionId]);
