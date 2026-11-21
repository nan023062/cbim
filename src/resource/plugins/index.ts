/**
 * 作用定位：通用插件版本管理模块的公开导出入口。
 * 设计原因：集中公开管理器及制品端口，产品类别差异留给调用方的目录和兼容策略。
 */
export { PluginManager } from './manager';

export type { PluginArtifact, PluginArtifacts, PluginCatalog } from './artifacts';
