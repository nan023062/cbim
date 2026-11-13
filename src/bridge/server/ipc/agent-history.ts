/**
 * 作用定位：将角色历史 IPC 请求解析后交给已打开工作区的只读查询端口。
 * 设计原因：操作名、输入与输出在桥契约中对应；此处每个处理函数都须满足响应类型，解析失败不进入服务或访问文件。
 * 职责边界：调用方先核实 Electron 主 Frame；这里不签发权限、不打开工作区、不重放历史执行。
 */
import type { AgentHistoryAction,AgentHistoryRequest,AgentHistoryResponses} from '../../contracts/agent-history-ipc';
import type {IpcHandlers} from '../../contracts/ipc-call';

/** 仅四项查询，不能通过 IPC 取得索引写入、观察或执行服务生命周期。 */
export interface AgentHistoryQueryPort {
  roles(input:AgentHistoryRequest<'agentHistory.roles'>):Promise<AgentHistoryResponses['agentHistory.roles']>;
  sessions(input:AgentHistoryRequest<'agentHistory.sessions'>):Promise<AgentHistoryResponses['agentHistory.sessions']>;
  runs(input:AgentHistoryRequest<'agentHistory.runs'>):Promise<AgentHistoryResponses['agentHistory.runs']>;
  events(input:AgentHistoryRequest<'agentHistory.events'>):Promise<AgentHistoryResponses['agentHistory.events']>;
}
/** 查询已打开的工作区；查找失败沿原错误向调用方传播，不创建实例。 */
export interface AgentHistoryIpcServices {agentHistory(workspaceId:string):AgentHistoryQueryPort}
/** 与其余业务组共同装配；请求已由主分派解析，服务继续核实工作区身份与日志。 */
export function agentHistoryIpcHandlers(app:AgentHistoryIpcServices):IpcHandlers<AgentHistoryAction>{return {
  'agentHistory.roles':input=>app.agentHistory(input.workspaceId).roles(input),
  'agentHistory.sessions':input=>app.agentHistory(input.workspaceId).sessions(input),
  'agentHistory.runs':input=>app.agentHistory(input.workspaceId).runs(input),
  'agentHistory.events':input=>app.agentHistory(input.workspaceId).events(input),
}}
