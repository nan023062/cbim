/**
 * during_execution表示宿主可终止实际执行并等待收束；与仅前置取消或等待交互分别声明，不承诺回滚。
 * 作用定位：工具取消、恢复说明及按需契约发现的纯协议，不导入具体领域或执行服务。
 * 设计原因：真实能力必须可查询且有边界；external-write 区分外部提交，Schema 与恢复说明不签发权限、不自动重试或承诺回滚。
 */
import {z} from 'zod';

const text=z.string().min(1),name=z.string().regex(/^cbim_[A-Za-z0-9_]+$/);
export const toolEffectsSchema=z.array(z.enum(['read','preview','maintenance','business-write','knowledge-write','external-write','command'])).min(1).refine(values=>new Set(values).size===values.length);
/** preflight_only 不承诺中断已开始事务；during_wait 仅表示未完成的用户交互可以取消，已消费答案不回滚。 */
export const toolCancellationSchema=z.object({mode:z.enum(['preflight_only','during_wait','during_execution']),description:text}).strict();
/** 恢复类别是操作说明而非调度策略；同 ID 重试仍必须符合原领域版本、身份与幂等规则。 */
export const toolRecoverySchema=z.object({mode:z.enum(['read_again','new_preview','same_request','same_plan','query_task','inspect_before_retry']),description:text,keyFields:z.array(text).min(1).optional(),queryTool:name.optional()}).strict();
export type ToolCancellation=z.infer<typeof toolCancellationSchema>;
export type ToolRecovery=z.infer<typeof toolRecoverySchema>;
export const toolMetadataSchema=z.object({version:z.number().int().positive(),effects:toolEffectsSchema,cancellation:toolCancellationSchema,recovery:toolRecoverySchema}).strict();
/** JSON Schema 是有限的 JSON 描述，可含 $ref；不嵌套另一次工具描述，也不运行工具函数。 */
const jsonValue:z.ZodType<unknown>=z.lazy(()=>z.union([z.null(),z.boolean(),z.number().finite(),z.string(),z.array(jsonValue),z.record(jsonValue)]));
const summary=z.object({name,description:z.string().optional(),version:z.number().int().positive(),effects:toolEffectsSchema}).strict();
export const knowledgeToolCatalogOutputSchema=z.object({family:z.literal('knowledge'),tools:z.array(summary)}).strict();
export const knowledgeToolDescribeOutputSchema=z.object({family:z.literal('knowledge'),tool:summary.extend({inputSchema:z.record(jsonValue),outputSchema:z.record(jsonValue),cancellation:toolCancellationSchema,recovery:toolRecoverySchema}).strict()}).strict();
export type KnowledgeToolCatalog=z.infer<typeof knowledgeToolCatalogOutputSchema>;
export type KnowledgeToolDescription=z.infer<typeof knowledgeToolDescribeOutputSchema>;
