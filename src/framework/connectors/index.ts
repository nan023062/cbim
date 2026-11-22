/**
 * 作用定位：外部办公工具的声明、目录与运行端口。
 * 设计原因：公开声明、使用模式和运行端口，宿主账号连接与具体工具传输由适配实现提供。
 */
export * from './definition';

export { registerConnector, listActiveConnectors, subscribeConnectorActivity } from './activity';

export { ExclusiveConnector, ConcurrentConnector, type Connector, type ConnectorSession, type ConnectorTaskContext } from './connector';

export { ConnectorRegistry } from './registry';

export type { ConnectorServer, ConnectorTool } from './service';
