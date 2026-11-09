/**
 * 作用定位：根据已核实角色配置注册持久化成员，按主会话分配独立逻辑 Session。
 * 设计原因：主实例随主会话保留；周期执行者按任务隔离实例，旧无周期登记仍按原规则恢复。返回待提交对象，由调度事务统一保存。
 * 职责边界：目前只管理身份与注册，不分配 Pi 进程、执行槽或宣布 working。
 */
import {randomUUID} from 'node:crypto';
import {fail} from '../../core/foundation/errors';
import type {AgentConfigurationSnapshot,AgentSessionBinding} from '../../core/team/agent-types';
import type {DispatchState} from '../../core/tasks/dispatch-storage';
import type {AgentRef} from '../../core/tasks/graph-types';

/** 先尊重既有图根身份；新主会话创建独立主实例。同实例按根会话和用途复用通道，缺省用途兼容旧 task 记录。 */
export function prepareMember(state:DispatchState,configuration:AgentConfigurationSnapshot,rootSessionId:string,purpose:NonNullable<AgentSessionBinding['purpose']>='task',execution?:{scopeId:string;taskId:string}){
  if(state.workspaceId!==configuration.workspaceId)fail('GRAPH_IDENTITY_MISMATCH','角色不属于当前工作区');
  const main=configuration.agentId==='cbim:main';
  if(main&&execution)fail('AGENT_NOT_EXECUTABLE','主 Agent 管理知识与调度，不能创建业务执行实例');
  if(purpose==='conversation'&&!main)fail('AGENT_IDENTITY_CONFLICT','主对话通道只能绑定内置主角色');
  const root=main?state.graphs.find(g=>g.identity.rootSessionId===rootSessionId)?.root:undefined;
  const existing=root
    ?state.members.find(m=>m.agentInstanceId===root.agent.agentInstanceId)
    :state.members.find(m=>m.agentId===configuration.agentId&&(main?m.mainRootSessionId===rootSessionId:execution?m.executionScopeId===execution.scopeId&&m.executionTaskId===execution.taskId:!m.executionScopeId&&!m.executionTaskId));
  if(existing?.lifecycle==='released')fail('MEMBER_RELEASED','执行实例已随调度周期释放，不能重新使用');
  if(root&&(!existing||existing.agentId!==configuration.agentId))fail('AGENT_IDENTITY_CONFLICT','任务图根的主实例不存在或角色不一致');
  if(existing?.mainRootSessionId&&existing.mainRootSessionId!==rootSessionId)fail('AGENT_IDENTITY_CONFLICT','主实例不能跨主会话复用');
  if(existing&&existing.teamId!==configuration.teamId)fail('AGENT_IDENTITY_CONFLICT','成员的 Team 绑定已变化');
  if(existing?.activeRunId&&existing.configurationRevision!==configuration.knowledgeRevision)fail('AGENT_BUSY','成员正在运行，不能覆盖其固定配置');
  const member=existing?structuredClone(existing):{
    workspaceId:configuration.workspaceId,teamId:configuration.teamId,agentId:configuration.agentId,
    agentInstanceId:randomUUID(),...(main?{mainRootSessionId:rootSessionId}:execution?{executionScopeId:execution.scopeId,executionTaskId:execution.taskId,lifecycle:'active' as const}:{}),leaseEpoch:1,configurationRevision:configuration.knowledgeRevision,
    agentSessionIds:[],activity:'idle' as const,waitingTaskIds:[],communicatingMessageIds:[],
  };
  member.configurationRevision=configuration.knowledgeRevision;
  const session=state.sessions.find(s=>s.agentInstanceId===member.agentInstanceId&&s.rootSessionId===rootSessionId&&(s.purpose??'task')===purpose)??{
    workspaceId:member.workspaceId,teamId:member.teamId,agentId:member.agentId,
    agentInstanceId:member.agentInstanceId,agentSessionId:randomUUID(),rootSessionId,purpose,
  };
  if(!member.agentSessionIds.includes(session.agentSessionId))member.agentSessionIds.push(session.agentSessionId);
  const agent:AgentRef={agentId:member.agentId,agentInstanceId:member.agentInstanceId,agentSessionId:session.agentSessionId,name:configuration.name};
  return {member,session:structuredClone(session),agent};
}
