/**
 * 目录归属：backend/core/models；模型配置与预算端口。
 * 作用定位：用户模型目录和 Agent 运行选型共用的引擎标识与纯选择规则。
 * 设计原因：执行引擎内置且独立于供应商；统一按真实适配器协议筛选模型，界面和运行前校验共用规则，不按模型名称猜测兼容性。
 */
import {z} from 'zod';

export const loopEngineSchema=z.enum(['pi','claude-code','codex']);
export type LoopEngine=z.infer<typeof loopEngineSchema>;
export const engineLabel=(engine:LoopEngine)=>({pi:'Pi','claude-code':'Claude Code',codex:'Codex'})[engine];
/** 当前原生适配器的协议要求；undefined 表示 Pi 支持全部已声明协议。 */
export const engineApi=(engine:LoopEngine)=>engine==='claude-code'?'anthropic-messages':engine==='codex'?'openai-responses':undefined;
/** 同一供应商模型可供多个兼容引擎选择；旧供应商 engine 字段不参与判断。 */
export function engineSupportsApi(engine:LoopEngine,api:string):boolean{
  return ['openai-completions','openai-responses','anthropic-messages'].includes(api)&&(!engineApi(engine)||engineApi(engine)===api);
}
/** 静态 Agent 的本机默认选型；只引用公开身份，实际运行仍由岗位独立采纳。 */
export const agentModelSelectionSchema=z.object({engine:loopEngineSchema,profileId:z.string().uuid(),modelId:z.string().trim().min(1).max(160)}).strict();
export type AgentModelSelection=z.infer<typeof agentModelSelectionSchema>;
