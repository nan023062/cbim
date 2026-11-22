/**
 * 作用定位：连接器是外部办公工具服务。宿主负责建立连接，本轮 Agent 通过已连接的服务发现并调用工具。
 * 设计原因：工具描述与执行绑定同一服务器连接，避免目录来自一个连接而调用落到另一连接。
 */
export interface ConnectorTool
{
  name: string;

  description?: string;

  inputSchema: Record<string, unknown>;
}

/** 单个已连接的服务器端口。调用描述与执行必须使用同一个连接。 */
export interface ConnectorServer<Descriptor, Result>
{
  List(): readonly ConnectorTool[];

  Describe(name: string, input: unknown): Descriptor;

  Call(name: string, input: unknown, signal: AbortSignal): Promise<Result>;
}
