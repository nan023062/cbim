/**
 * 目录归属：backend/core/models；模型配置与预算端口。
 * 作用定位：定义自定义供应商及其模型目录的持久化与界面契约。
 * 设计原因：视觉能力可选，旧配置保持纯文本；供应商共享接口和凭据，目录输出能力上限与请求预算分离，模型分别管理能力、容量、思考意图、工作预算和可选计价；运行时只取选定模型的快照。
 * 供应商只定义接口和模型；旧 engine 字段仅兼容读取，不限制供应商协议，也不决定运行引擎。
 */
import {z} from 'zod';
import {loopEngineSchema} from './engine';
const endpoint=z.string().trim().url().refine(value=>{const u=new URL(value);return !u.username&&!u.password&&!u.search&&!u.hash&&(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))},'接口地址须为 HTTPS，或本机 HTTP；不能包含凭据、查询参数或片段');
export const connectionSchema=z.object({name:z.string().trim().min(1).max(80),api:z.enum(['openai-completions','openai-responses','anthropic-messages']),baseUrl:endpoint,auth:z.enum(['api-key','none'])});
export const modelSchema=z.object({id:z.string().trim().min(1).max(160),name:z.string().trim().max(160),enabled:z.boolean(),contextWindow:z.number().int().min(1024).max(2000000),maxTokens:z.number().int().min(64).max(2000000),reasoning:z.boolean(),
  /** 仅供应商声明或用户明确确认后开启；旧配置缺省为纯文本，不按型号猜测。 */
  vision:z.boolean().optional(),
  /** 供应商支持推理与用户选择关闭推理是不同状态；Pi 缺省采用 medium；Claude Code 使用原生推理开关。 */
  /** 目录声明的输出能力上限，与 maxTokens 请求预算独立。 */
  outputLimit:z.number().int().min(1).max(2000000).optional(),
  thinkingLevel:z.enum(['off','minimal','low','medium','high','xhigh']).optional(),
  /** 只影响压缩，不覆盖供应商真实上下文容量。 */
  workingContextWindow:z.number().int().min(1024).max(2000000).optional(),
  compactionPercent:z.number().int().min(10).max(95).optional(),
  /** USD / 百万 token；缺失表示未知价格，显式全零才表示免费。 */
  pricing:z.object({input:z.number().finite().min(0),output:z.number().finite().min(0),cacheRead:z.number().finite().min(0),cacheWrite:z.number().finite().min(0)}).strict().optional()}).strict().refine(p=>p.maxTokens<=p.contextWindow,'最大输出不能超过上下文窗口').refine(p=>!p.outputLimit||p.maxTokens<=p.outputLimit,'请求输出不能超过供应商声明上限').refine(p=>!p.workingContextWindow||p.workingContextWindow<=p.contextWindow,'工作上下文预算不能超过模型容量');
/** engine 仅为 0.1.5 文件兼容保留，新设置表单不生成，执行选择不得从此字段推断。 */
export const definition=connectionSchema.extend({engine:loopEngineSchema.optional(),models:z.array(modelSchema).min(1).max(200),defaultModel:z.string().min(1)}).strict().superRefine((p,c)=>{

  if(new Set(p.models.map(m=>m.id)).size!==p.models.length)c.addIssue({code:'custom',message:'模型 ID 不能重复'});
  if(!p.models.some(m=>m.id===p.defaultModel&&m.enabled))c.addIssue({code:'custom',message:'请选择一个已启用的默认模型'});
});
export type LlmModel=z.infer<typeof modelSchema>;
export type LlmDefinition=z.infer<typeof definition>;
/** 公开视图仅说明是否保存密钥，不含密文或明文。 */
export interface LlmProfile extends LlmDefinition {id:string;hasKey:boolean}
export interface LlmSettings {profiles:LlmProfile[];selectedId?:string;secureStorage:boolean}
