/**
 * 作用定位：引擎领域的公开目录、协议类型及包状态导出入口。
 * 设计原因：向消费者提供领域选型与执行协议，具体引擎实现仍由包加载器选择。
 */
export * from './catalog';

export { engineAdapterProtocol, type AgentEngine } from '../../framework/kernel';

export type { EnginePackageStatus, EnginePackageSettings } from './package-status';
