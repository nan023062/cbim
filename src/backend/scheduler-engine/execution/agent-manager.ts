/**
 * 作用定位：根据已核实角色配置注册持久化成员，按主会话分配独立逻辑 Session。
 * 设计原因：成员身份在工作区内复用而上下文按会话隔离；返回待提交数据，由调度事务统一保存，不能半途修改共享状态。
 * 职责边界：目前只管理身份与注册，不分配 Pi 进程、执行槽或宣布 working。
 */
import {randomUUID} from 'node:crypto';
import {fail} from '../../core/foundation/errors';
import type {AgentConfigurationSnapshot} from '../../core/team/agent-types';
import type {DispatchState} from '../../core/tasks/dispatch-storage';
import type {AgentRef} from '../../core/tasks/graph-types';

/** 输入来自知识解析器；同角色每个工作区恰好一个成员，每个根会话复用自己的通道。 */
export function prepareMember(state:DispatchState,configuration:AgentConfigurationSnapshot,rootSessionId:string){
  if(state.workspaceId!==configuration.workspaceId)fail('GRAPH_IDENTITY_MISMATCH','角色不属于当前工作区');
  const existing=state.members.find(m=>m.agentId===configuration.agentId);
  if(existing&&existing.teamId!==configuration.teamId)fail('AGENT_IDENTITY_CONFLICT','成员的 Team 绑定已变化');
  if(existing?.activeRunId&&existing.configurationRevision!==configuration.knowledgeRevision)fail('AGENT_BUSY','成员正在运行，不能覆盖其固定配置');
  const member=existing?structuredClone(existing):{
    workspaceId:configuration.workspaceId,teamId:configuration.teamId,agentId:configuration.agentId,
    agentInstanceId:randomUUID(),leaseEpoch:1,configurationRevision:configuration.knowledgeRevision,
    agentSessionIds:[],activity:'idle' as const,waitingTaskIds:[],communicatingMessageIds:[],
  };
  member.configurationRevision=configuration.knowledgeRevision;
  const session=state.sessions.find(s=>s.agentInstanceId===member.agentInstanceId&&s.rootSessionId===rootSessionId)??{
    workspaceId:member.workspaceId,teamId:member.teamId,agentId:member.agentId,
    agentInstanceId:member.agentInstanceId,agentSessionId:randomUUID(),rootSessionId,
  };
  if(!member.agentSessionIds.includes(session.agentSessionId))member.agentSessionIds.push(session.agentSessionId);
  const agent:AgentRef={agentId:member.agentId,agentInstanceId:member.agentInstanceId,agentSessionId:session.agentSessionId,name:configuration.name};
  return {member,session:structuredClone(session),agent};
}
