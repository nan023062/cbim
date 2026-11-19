import { AgentCallExchange as Exchange } from '../../framework/office/exchange';
import type { ToolResult } from '../tools/rules/results';

export const AgentCallExchange = Exchange<ToolResult>;
export type AgentCallExchange = Exchange<ToolResult>;
