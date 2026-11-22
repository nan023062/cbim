/**
 * 目录归属：logic/execution/rules/execution；运行协议与计量。
 * 作用定位：将可信装配注入的能力组装成 SDK 与自定义 Loop 共用的目录与调用端口。
 * 设计原因：厂商 SDK 与自定义领域 Loop 只适配传输；真实调用 ID、取消信号和能力归属保持同一契约。
 */
export interface EngineToolSchema
{
  name: string;

  description?: string;

  inputSchema: Record<string, unknown>
}

/** 已发布引擎包直接消费 list/call；保留固定协议名，不改动模型可见的工具名称。 */
export interface EngineToolsPort
{
  list(): Promise<EngineToolSchema[]>;

  /** 身份来自已授权的原生工具调用，不能从模型参数推断。 */
  call(name: string, args: Record<string, unknown>, signal: AbortSignal, toolCallId?: string): Promise<unknown>;
}

/** 一轮运行的可信能力声明；id 仅用于诊断，指令不能授予工具目录以外的权限。 */
export interface EngineCapability
{
  id: string;

  tools: EngineToolsPort;

  instructions?: readonly string[];

  /** 本轮只能使用显式能力工具时关闭全部原生文件与命令，不能由模型输入更改。 */
  disableNativeTools?: boolean;
}

/** 宿主签发的能力说明；只用于适配器裁剪工具，调用授权仍由宿主执行。 */
export interface EngineTaskPermission
{
  readonly projectId: string;

  readonly officeId: string;

  readonly agentId: string;

  readonly taskId: string;

  readonly level: 'read' | 'ask' | 'execute';

  readonly commands: 'denied';

  readonly readDirectories: readonly string[];

  readonly writeDirectories: readonly string[];

  readonly excludedDirectories: readonly string[];

  readonly readResources: readonly string[];

  readonly writeResources: readonly string[];
}

export interface EngineCapabilities
{
  taskPermission?: EngineTaskPermission;

  capabilities?: readonly EngineCapability[]
}

export function nativeToolsDisabled(context: EngineCapabilities): boolean
{
  return context.capabilities?.some(capability => capability.disableNativeTools === true) ?? false;
}

/** 一个公开名称绑定一个端口和原始工具名；别名也参与同一目录的冲突检查。 */
export async function collectToolRoutes(sources: readonly { port: EngineToolsPort; prefix?: string }[])
{
  const routes = new Map<string,
    {
      name: string;

      port: EngineToolsPort;

      schema: EngineToolSchema
    }>();

  for (const { port, prefix = '' } of sources)
  {
    for (const tool of await port.list())
    {
      const name = prefix + tool.name;

      if (!/^cbim_[a-z0-9_]+$/.test(name) || routes.has(name))
        throw Error('运行工具名称无效或重复：' + name);

      routes.set(name, { name: tool.name, port, schema: structuredClone(tool) });
    }
  }

  return routes;
}

/** 能力目录只读取一次；领域引擎可以限制知识工具，同时保留本轮注入的工具。 */
export async function runtimeEngineTools(context: EngineCapabilities, knowledge: EngineToolsPort, includeKnowledge?: (name: string) => boolean): Promise<EngineToolsPort>
{
  const sources = [{ port: knowledge }, ...(context.capabilities ?? []).map(capability => ({ port: capability.tools }))];

  const routes = await collectToolRoutes(sources);

  if (includeKnowledge)
  {
    for (const [name, route] of routes)
      if (route.port === knowledge && !includeKnowledge(name))
        routes.delete(name);
  }

  return {
    list: async () => Array.from(routes.values(), route => structuredClone(route.schema)),
    call: (name, args, signal, id) => { const route = routes.get(name); if (!route) throw Error('本轮未注册该工具'); return route.port.call(route.name, args, signal, id); },
  };
}
