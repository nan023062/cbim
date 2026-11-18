/**
 * 作用定位：向业务装配公开 Agent 对象与调用契约，不导出 Application 或具体引擎。
 * 设计原因：运行与调度归 execution；仅需数据契约的调用方直接引用 contracts，避免加载运行实现。
 */
export { Agent, agentRoleInstructions, type AgentDescription, type AgentDefinition, type AgentConversation } from '../../framework/cability/agent';

export { agentCallToolName, agentListToolName, agentReplyToolName } from './contracts';

export type { AgentCallReference, AgentCallLimits, AgentToolContext, AgentToolsBinding, AgentLifecycle } from './contracts';
