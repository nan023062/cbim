/**
 * 作用定位：用户模型目录和 Agent 运行选型共用的引擎标识与纯选择规则。
 * 设计原因：引擎跟随供应商配置冻结；旧文件缺省为 Pi，不回写默认值而改变历史快照指纹。
 */
import {z} from 'zod';

export const loopEngineSchema=z.enum(['pi','claude-code','codex']);
export type LoopEngine=z.infer<typeof loopEngineSchema>;
export const engineLabel=(engine:LoopEngine)=>({pi:'Pi','claude-code':'Claude Code',codex:'Codex'})[engine];
/** 原生协议约束在供应商、岗位快照和界面共用；Pi 支持目录中的三种 API。 */
export const engineApi=(engine:LoopEngine)=>engine==='claude-code'?'anthropic-messages':engine==='codex'?'openai-responses':undefined;
/** 静态 Agent 的本机默认选型；只引用公开身份，实际运行仍由岗位独立采纳。 */
export const agentModelSelectionSchema=z.object({engine:loopEngineSchema,profileId:z.string().uuid(),modelId:z.string().trim().min(1).max(160)}).strict();
export type AgentModelSelection=z.infer<typeof agentModelSelectionSchema>;
/** 下拉选项只来自用户已保存且含启用模型的配置，不加入未配置的引擎。 */
export function configuredEngines(profiles:readonly {engine?:LoopEngine;models:readonly {enabled:boolean}[]}[]):LoopEngine[]{
  return [...new Set(profiles.filter(p=>p.models.some(m=>m.enabled)).map(p=>p.engine??'pi'))];
}
