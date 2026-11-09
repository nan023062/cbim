/**
 * 作用定位：向团队静态节点公开只读的角色 Session 历史协议。
 * 设计原因：前端通过明确角色/会话/任务/运行身份读取归档，不导入后端日志或复用带执行副作用的任务操作。
 */
export type {AgentHistoryIdentity,AgentHistorySessionIdentity,AgentHistoryRunIdentity,AgentHistoryStatus,AgentHistoryRole,AgentHistorySession,AgentHistoryRun,AgentHistoryRoles,AgentHistoryPage,AgentHistoryEventsRead,AgentHistorySessionsInput,AgentHistoryRunsInput,AgentHistoryEventsInput} from '../../backend/core/team/session-history';
