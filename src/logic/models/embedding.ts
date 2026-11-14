/**
 * 作用定位：向量模型的独立配置、公开快照与凭据类型，不复用生成输出预算字段。
 * 设计原因：embedding 只有输入容量、向量维度与输入计价；同一供应商的生成和向量操作可共用凭据，但端点必须明确配置。
 */
import {z} from 'zod';
import {modelEndpointSchema} from './endpoint';

export const embeddingModelSchema=z.object({id:z.string().trim().min(1).max(160),name:z.string().trim().max(160),enabled:z.boolean(),inputTokens:z.number().int().min(1).max(2000000),dimensions:z.number().int().min(1).max(65536),
  /** USD / 百万输入 token；缺省为未知，0 才表示免费。 */
  inputPrice:z.number().finite().nonnegative().optional()}).strict();
export type EmbeddingModel=z.infer<typeof embeddingModelSchema>;
/** 端点显式指定，不从品牌或生成接口推导；模型名保持供应商原值。 */
export const embeddingConnectionSchema=z.object({api:z.literal('openai-embeddings'),baseUrl:modelEndpointSchema,models:z.array(embeddingModelSchema).min(1).max(200)}).strict().refine(value=>new Set(value.models.map(model=>model.id)).size===value.models.length,'向量模型 ID 不能重复');
export type EmbeddingConnection=z.infer<typeof embeddingConnectionSchema>;
export const embeddingSnapshotSchema=embeddingModelSchema.omit({id:true,name:true,enabled:true}).extend({kind:z.literal('embedding'),id:z.string().uuid(),name:z.string().trim().min(1).max(80),api:z.literal('openai-embeddings'),baseUrl:modelEndpointSchema,auth:z.enum(['api-key','none']),model:z.string().trim().min(1).max(160)}).strict();
export type EmbeddingSnapshot=z.infer<typeof embeddingSnapshotSchema>;
/** 明文凭据只在受控执行准备回调内解析，不写入 Agent/岗位/任务快照。 */
export interface ResolvedEmbedding {profile:EmbeddingSnapshot;apiKey:string}
