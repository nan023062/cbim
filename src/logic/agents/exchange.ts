import { AgentCallExchange as Exchange } from '../../framework/cability/agent/exchange';
import type { ToolResult } from '../tools/rules/results';

export const AgentCallExchange = Exchange<ToolResult>;
export type AgentCallExchange = Exchange<ToolResult>;
