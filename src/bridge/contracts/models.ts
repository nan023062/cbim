/**
 * 作用定位：模型配置界面消费的公开模型信息与停止原因格式化。
 * 设计原因：仅重导出无凭据公开契约和纯函数，不向渲染进程暴露配置存储或密钥端口。
 * 供应商预设和单接口解析为纯配置投影，与后端启动共用；不暴露凭据解析或联网能力。
 * 迁移兼容：这是唯一允许重导出 Logic 模型纯入口的桥文件；后续 DTO/预览迁移后退出，不开放服务或任意星号导出。
 */
export type {LlmDefinition,LlmModel,LlmProfile,LlmSettings,LlmApi,AlternateConnection} from '../../logic/models';
export {llmApiSchema,connectionSchema,definition} from '../../logic/models';
export {providerPresets,identifyProvider} from '../../logic/models';
export type {DiscoveredModel} from '../../logic/models';
export {modelStopError} from '../../logic/execution/rules/model-errors';
