/**
 * 目录归属：logic/models；模型目录与纯选型规则。
 * 作用定位：定义自定义供应商的生成与向量模型目录，保持旧生成配置字节与字段缺省。
 * 设计原因：视觉能力可选，旧配置保持纯文本；供应商共享凭据、按操作显式配置接口，生成输出与向量输入/维度分别校验，模型分别管理能力、容量、思考意图、工作预算和可选计价；运行时只取选定模型的快照。
 * 供应商只定义接口和模型；旧 engine 字段仅兼容读取，不限制供应商协议，也不决定运行引擎。
 * 兼容接口共用本供应商凭据；自动识别只补官方预设，实际运行快照只保留选中的单一接口。
 */
import {z} from 'zod';
import {modelEndpointSchema as endpoint} from './endpoint';
import {embeddingConnectionSchema} from './embedding';
/** 仅保留旧配置文件可读范围；不是当前引擎目录，新增引擎不扩充此遗留字段。 */
const legacyProviderEngineSchema=z.enum(['pi','claude-code','codex']);
export const llmApiSchema=z.enum(['openai-completions','openai-responses','anthropic-messages']);
export type LlmApi=z.infer<typeof llmApiSchema>;
export const connectionSchema=z.object({name:z.string().trim().min(1).max(80),api:llmApiSchema,baseUrl:endpoint,auth:z.enum(['api-key','none'])});
/** 用户明确提供的同凭据接口；modelIds 缺省表示共用全部模型 ID，不做型号转换。 */
export const alternateConnectionSchema=z.object({api:llmApiSchema,baseUrl:endpoint,modelIds:z.array(z.string().trim().min(1).max(160)).min(1,'兼容接口至少选择一个适用型号，或取消型号限制').max(200).optional()}).strict();
export type AlternateConnection=z.infer<typeof alternateConnectionSchema>;
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
export const definition=connectionSchema.extend({engine:legacyProviderEngineSchema.optional(),autoDetect:z.boolean().optional(),alternateConnections:z.array(alternateConnectionSchema).max(2).optional(),models:z.array(modelSchema).max(200),defaultModel:z.string(),embedding:embeddingConnectionSchema.optional()}).strict().superRefine((p,c)=>{

  const apis=[p.api,...(p.alternateConnections??[]).map(connection=>connection.api)];
  if(new Set(apis).size!==apis.length)c.addIssue({code:'custom',message:'每种接口协议只能配置一个地址'});
  if(p.alternateConnections?.some(connection=>connection.modelIds?.some(id=>!p.models.some(model=>model.id===id))))c.addIssue({code:'custom',message:'兼容接口的适用模型必须来自当前模型目录'});

  if(new Set(p.models.map(m=>m.id)).size!==p.models.length)c.addIssue({code:'custom',message:'模型 ID 不能重复'});
  if(p.models.length?!p.models.some(m=>m.id===p.defaultModel&&m.enabled):p.defaultModel!==''||!p.embedding?.models.some(m=>m.enabled))c.addIssue({code:'custom',message:'请选择一个已启用的默认模型'});
});
export type LlmModel=z.infer<typeof modelSchema>;
export type LlmDefinition=z.infer<typeof definition>;
/** 公开视图仅说明是否保存密钥，不含密文或明文。 */
export interface LlmProfile extends LlmDefinition {id:string;hasKey:boolean}
export interface LlmSettings {profiles:LlmProfile[];selectedId?:string;secureStorage:boolean}
