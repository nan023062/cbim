/**
 * 作用定位：模型配置界面消费的公开模型信息与停止原因格式化。
 * 设计原因：仅重导出无凭据公开契约和纯函数，不向渲染进程暴露配置存储或密钥端口。
 */
export type {LlmDefinition,LlmModel,LlmProfile,LlmSettings} from '../../backend/core/brain/llm/config';
export type {DiscoveredModel} from '../../backend/core/brain/llm/catalog';
export {modelStopError} from '../../backend/core/brain/model-errors';
