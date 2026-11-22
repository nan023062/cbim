/**
 * 作用定位：导出本机连接器服务和运行时。
 * 设计原因：统一公开本机运行时入口。
 */
export { ConnectorRuntime, type ConnectorProduct } from './runtime';

export { ConnectorService } from './service';
