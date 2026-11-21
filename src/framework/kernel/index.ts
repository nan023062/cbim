/**
 * 作用定位：执行内核的公共导出入口。
 * 设计原因：统一暴露模型和引擎装配契约，供应商实现由外部注入。
 */
export type { ModelConfiguration, ModelInstance, ModelLoader, ModelAdapter, ModelAdapterRegistry } from './models';

export * from './engines';

export { kernel, type EngineDescription, type EngineConfigurationRef } from './kernel';
