/**
 * 作用定位：主 Agent 与自定义 Agent 的执行选型公开契约。
 * 设计原因：选型属于团队角色；对话栏和 Agent 编辑界面共享同一契约，不把引擎选择归入供应商配置。
 */
export {agentModelSelectionSchema,mainAgentSettingsSchema} from '../../logic/team/rules/agent-runtime';
export type {AgentModelSelection,MainAgentSettingsView} from '../../logic/team/rules/agent-runtime';
