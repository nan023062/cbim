/** 连接器是外部办公工具服务。宿主负责建立连接，本轮 Agent 通过已连接的服务发现并调用工具。 */
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

/** 每轮固定工具目录，将策略查询和调用路由到提供该工具的服务器。 */
export class ConnectorService<Descriptor, Result>
{
  private readonly _routes = new Map<string, ConnectorServer<Descriptor, Result>>();

  private readonly _tools: ConnectorTool[] = [];

  public constructor(servers: readonly ConnectorServer<Descriptor, Result>[])
  {
    for (const server of servers)
    {
      for (const tool of server.List())
      {
        if (!tool.name || this._routes.has(tool.name))
          throw new Error('连接器工具名称为空或重复：' + tool.name);

        this._routes.set(tool.name, server);
        this._tools.push(structuredClone(tool));
      }
    }
  }

  private Resolve(name: string): ConnectorServer<Descriptor, Result>
  {
    const server = this._routes.get(name);

    if (!server)
      throw new Error('当前 Agent 没有该连接器工具：' + name);

    return server;
  }

  public Has(name: string): boolean
  {
    return this._routes.has(name);
  }

  public List(): ConnectorTool[]
  {
    return structuredClone(this._tools);
  }

  public Describe(name: string, input: unknown): Descriptor
  {
    return this.Resolve(name).Describe(name, input);
  }

  public async Call(name: string, input: unknown, signal: AbortSignal): Promise<Result>
  {
    signal.throwIfAborted();
    const result = await this.Resolve(name).Call(name, input, signal);
    signal.throwIfAborted();
    return result;
  }
}
