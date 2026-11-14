/**
 * 作用定位：模型目录和供应商连接的便携公共入口。
 * 设计原因：业务规则由 Logic 拥有；公开纯入口不加载配置存储、凭据实现或 Node，供执行消费者及迁移期桥契约使用。
 * 职责边界：兼容性只表示规则允许选择，不保证认证、额度或实际调用成功；配置服务使用独立 service 入口。
 */
export {parseModelCatalog} from './catalog';
export type {DiscoveredModel} from './catalog';
export {llmApiSchema,connectionSchema,alternateConnectionSchema,modelSchema,definition} from './config';
export type {LlmApi,AlternateConnection,LlmModel,LlmDefinition,LlmProfile,LlmSettings} from './config';

export {selectProviderConnection} from './provider-connections';
export type {ProviderConnections,SelectedConnection,ModelConnectionRequirement} from './provider-connections';
export {providerPresets,identifyProvider} from './provider-presets';
export type {ProviderPreset} from './provider-presets';
export type {SecretCipher,ResolvedLlm,ResolvedModelOperation} from './ports';

export {embeddingModelSchema,embeddingConnectionSchema,embeddingSnapshotSchema} from './embedding';
export type {EmbeddingModel,EmbeddingConnection,EmbeddingSnapshot,ResolvedEmbedding} from './embedding';
