/**
 * 目录归属：logic/budget/rules/budget；请求与周期预算规则。
 * 作用定位：定义逐模型请求预留、发送意图和结算的不可变事实，以及只读预算摘要。
 * 设计原因：请求与运行不是同一计量单位；重试和摘要各有独立请求，缺用量或恢复遗留不能按零释放。
 * 职责边界：不保存请求正文、凭据或推理，不发网络请求；金额仅为冻结价格下的本地估算。
 */
import {z} from 'zod';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),hash=z.string().regex(/^[a-f0-9]{64}$/),integer=z.number().int().nonnegative().safe();
const money=z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** 同一工作区日志不淘汰原请求；新请求提前为后续两条阶段及其字节预留空间。 */
export const modelRequestBudgetLimits={requests:16384,requestsPerScope:4096,storedBytes:32*1024*1024,terminalReserveBytes:2048} as const;
export const requestBudgetBindingSchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id,taskId:id,runId:id,kind:z.enum(['main','member']),ownerInstanceId:id}).strict();
export type RequestBudgetBinding=z.infer<typeof requestBudgetBindingSchema>;
/** 配置指纹绑定完整已解析模型；公开计价分量不包含供应商地址或密钥。 */
export const requestBudgetModelSchema=z.object({profileId:id,modelId:z.string().min(1).max(160),configurationHash:hash,api:z.enum(['openai-completions','openai-responses','anthropic-messages']),contextWindow:integer.min(1024).max(2000000),maxTokens:integer.min(1).max(2000000),pricing:z.object({input:money,output:money,cacheRead:money,cacheWrite:money}).strict().optional()}).strict();
export type RequestBudgetModel=z.infer<typeof requestBudgetModelSchema>;
/** input 为非缓存输入；output 已含推理分量，不能再把 reasoning token 加一次。 */
export const requestBudgetUsageSchema=z.object({input:integer,output:integer,cacheRead:integer,cacheWrite:integer,totalTokens:integer}).strict().refine(v=>v.totalTokens===v.input+v.output+v.cacheRead+v.cacheWrite,'请求用量总数与分量不一致');
export type RequestBudgetUsage=z.infer<typeof requestBudgetUsageSchema>;
/** tokens/cost 是发送前保守预留；未发送的拒绝意图也可记录这份申请，但不占用额度。 */
export const requestBudgetIntentSchema=z.object({version:z.literal(1),requestId:id,binding:requestBudgetBindingSchema,policyRevision:integer.min(1),model:requestBudgetModelSchema,requestHash:hash,maxOutputTokens:integer.min(1).max(2000000),tokens:integer.min(1),estimatedCostUsd:money.optional(),createdAt:z.string().datetime()}).strict();
export type RequestBudgetIntent=z.infer<typeof requestBudgetIntentSchema>;
export const requestBudgetDenialSchema=z.enum(['token_reserve','cost_reserve','usage_unverifiable','unpriced','capacity']);
export type RequestBudgetDenial=z.infer<typeof requestBudgetDenialSchema>;
const base={requestId:id,revision:integer.min(1),recordedAt:z.string().datetime()};
/** issuing 只证明发送意图已落盘，不证明供应商执行；只有当前实际 IO 所有者可明确记录未发送。 */
export const modelRequestBudgetChangeSchema=z.discriminatedUnion('phase',[
  z.object({...base,phase:z.literal('reserved'),intent:requestBudgetIntentSchema}).strict(),
  z.object({...base,phase:z.literal('denied'),intent:requestBudgetIntentSchema,reason:requestBudgetDenialSchema}).strict(),
  z.object({...base,phase:z.literal('issuing')}).strict(),
  z.object({...base,phase:z.literal('reported'),usage:requestBudgetUsageSchema,estimatedCostUsd:money.optional()}).strict(),
  z.object({...base,phase:z.literal('not_sent'),reason:z.enum(['cancelled_before_send','closed_before_send'])}).strict(),
  z.object({...base,phase:z.literal('unknown'),reason:z.enum(['transport_failed','incomplete_usage','cancelled','response_limit','protocol_unverifiable','closing'])}).strict(),
]);
export type ModelRequestBudgetChange=z.infer<typeof modelRequestBudgetChangeSchema>;
/** 一份申请及其最新阶段；历史原事件保留在 Store，不用更新行覆盖过去的预留或错误。 */
export interface RequestBudgetRecord {intent:RequestBudgetIntent;change:ModelRequestBudgetChange}
export const requestBudgetQuerySchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id}).strict();
export const requestBudgetReportSchema=requestBudgetQuerySchema.extend({policyRevision:integer.min(1),requests:integer,reported:integer,inFlight:integer,unknown:integer,denied:integer,notSent:integer,tokens:integer,reservedTokens:integer,estimatedCostUsd:money,costComplete:z.boolean(),reservedCostUsd:money,overrun:integer,lastDenial:requestBudgetDenialSchema.optional(),lastDeniedTokens:integer.optional(),lastDeniedCostUsd:money.optional()}).strict();
export type RequestBudgetReport=z.infer<typeof requestBudgetReportSchema>;
