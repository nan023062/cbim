/**
 * 作用定位：把已核实的工具调用、授权和终态整理为可追溯回执。
 * 设计原因：身份和哈希由运行时生成，模型返回的 approved、receipt 或验收结论不能替代执行事实。
 * 职责边界：未知结果不能当成失败重试；结果哈希也不证明业务产物已经验收。
 */
import {hash} from '../../../core/platform/node/serialization';
import type {ToolCall,ToolDecision,ToolReceipt} from './types';

/** 调用者须先核对工具 ID；返回值与相应事件一起持久化后才可发布。 */
export function toolReceipt(identity:{workspaceId:string;taskId:string;runId:string},call:ToolCall,decision:ToolDecision,outcome:ToolReceipt['outcome'],result?:unknown):ToolReceipt{
  return {version:1,...identity,toolCallId:call.id,toolName:call.name,outcome,
    inputHash:hash(JSON.stringify(call.input)),...(result===undefined?{}:{resultHash:hash(JSON.stringify(result))}),
    effects:decision.effects??[],scope:decision.scope??{kind:'unknown',workspaceId:identity.workspaceId},recordedAt:new Date().toISOString()};
}
