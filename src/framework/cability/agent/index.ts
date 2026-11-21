/**
 * 作用定位：Agent 能力模块的公开导出入口。
 * 设计原因：聚合角色、任务、身份与用量的公共能力，具体引擎装配不在此入口执行。
 */
export { AgentRole, type AgentConversation, type OfficeObservation } from './agent';

export { runAgentTask, type AgentStep, type AgentStepResult, type AgentTaskExecution, type AgentTaskDispatcher, type AgentTaskResult } from './execution';

export * from './identity';

export * from './questions';

export { readRoleSkill, agentRoleInstructions, type AgentDefinition, type AgentDescription } from './description';

export { AgentTokenUsage, type AgentChange } from './token-usage';
