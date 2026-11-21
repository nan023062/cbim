/**
 * 作用定位：引擎适配、实例和扩展协议的公开导出入口。
 * 设计原因：聚合无供应商实现的协议，使编排依赖端口而非具体 SDK。
 */
export { engineAdapterProtocol, type EngineAdapter } from './adapter';

export { enginePluginPackageHeader, enginePluginAdapterEntry, type EnginePluginManifest, type EnginePluginModule } from './plugin-package';

export type { AgentEngine } from './agent-engine';

export type { EngineInstance, EngineTurn, EngineTurnResult } from './instance';

export type { EngineExtension } from './extensions';
