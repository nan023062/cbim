/**
 * 作用定位：模型目录、配置和连接规则的公开导出入口。
 * 设计原因：模型协议与连接规则保持便携，凭据读取和实际请求在独立服务完成。
 */
export { parseModelCatalog } from './protocol';

export { modelEndpointSchema } from './protocol';

export type { DiscoveredModel } from './protocol';

export { llmApiSchema, connectionSchema, alternateConnectionSchema, modelSchema, definition } from './protocol';

export type { LlmApi, AlternateConnection, LlmModel, LlmDefinition, LlmProfile, LlmSettings } from './protocol';

export { selectProviderConnection } from './protocol';

export type { ProviderConnections, SelectedConnection, ModelConnectionRequirement } from './protocol';

export { providerPresets, identifyProvider } from './protocol';

export type { ProviderPreset } from './protocol';

export type { ResolvedLlm, ResolvedModelOperation } from './protocol';

export { embeddingModelSchema, embeddingConnectionSchema, embeddingSnapshotSchema } from './protocol';

export type { EmbeddingModel, EmbeddingConnection, EmbeddingSnapshot, ResolvedEmbedding } from './protocol';

export { generationSnapshotFields, generationSnapshotSchema, checkGenerationSnapshot } from './protocol';

export type { SecretCipher } from '../../core/io/electron';

export { modelRequestUrl } from './protocol';
