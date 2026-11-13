/**
 * 作用定位：关联角色历史四个只读 IPC 操作的请求、响应与运行时输入解析。
 * 设计原因：客户端按操作名获得准确返回类型，主进程复用领域 Schema 核实不可信请求；不从具体服务推导公共接口。
 */
import type {z} from 'zod';
import {agentHistoryRolesInput,agentHistorySessionsInput,agentHistoryRunsInput,agentHistoryEventsInput} from '../../logic/team/rules/session-history';
import type {AgentHistoryRoles,AgentHistoryPage,AgentHistorySession,AgentHistoryRun,AgentHistoryEventsRead} from './agent-history';

export const agentHistoryRequests={
  'agentHistory.roles':agentHistoryRolesInput,
  'agentHistory.sessions':agentHistorySessionsInput,
  'agentHistory.runs':agentHistoryRunsInput,
  'agentHistory.events':agentHistoryEventsInput,
};
export interface AgentHistoryResponses {
  'agentHistory.roles':AgentHistoryRoles;
  'agentHistory.sessions':AgentHistoryPage<AgentHistorySession>;
  'agentHistory.runs':AgentHistoryPage<AgentHistoryRun>;
  'agentHistory.events':AgentHistoryEventsRead;
}
export type AgentHistoryAction=keyof AgentHistoryResponses;
export type AgentHistoryRequest<A extends AgentHistoryAction>=z.input<(typeof agentHistoryRequests)[A]>;
/** 联合元组保持操作与参数配对；不能通过推断更宽的操作联合绕过必填身份。 */
export type AgentHistoryCall={[A in AgentHistoryAction]:[action:A,args:AgentHistoryRequest<A>]}[AgentHistoryAction];
export function isAgentHistoryAction(action:string):action is AgentHistoryAction{return Object.hasOwn(agentHistoryRequests,action)}
