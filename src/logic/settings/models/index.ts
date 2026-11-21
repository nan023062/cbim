/**
 * 作用定位：模型设置表单的公开配置和协议选择规则。
 * 设计原因：复用公开配置与协议规则供表单使用，凭据存储和真实连接不在聚合入口执行。
 */
export { definition, connectionSchema, llmApiSchema, type LlmApi, type LlmDefinition, type LlmModel, type LlmProfile, type LlmSettings } from './config';

export type { EmbeddingConnection, EmbeddingModel } from './embedding';

export { selectProviderConnection, type ModelConnectionRequirement } from './provider-connections';

export { identifyProvider, providerPresets } from './provider-presets';

export interface DiscoveredModel
{
  id: string;

  name?: string;

  /** 供应商声明的完整上下文容量，不是用户的工作预算。 */
  contextWindow?: number;

  /** 供应商允许的输出上限；同步时不自动提高用户单次请求预算。 */
  maxOutputTokens?: number;

  reasoning?: boolean;

  /** 输入模态声明；缺失保持未知，由用户在模型设置中确认。 */
  vision?: boolean;
}
