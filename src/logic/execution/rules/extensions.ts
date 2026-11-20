import type { EngineToolSchema, EngineToolsPort } from './engine-tools';

export interface ExtensionTool extends EngineToolSchema
{
  effects: readonly import('../../tools/rules/types').ToolEffect[];

  Call(args: Record<string, unknown>, signal: AbortSignal, toolCallId: string): Promise<unknown>;
}

export type ExecutionExtension = import('../../../framework/kernel').EngineExtension<ExtensionTool, import('./types').StoredEvent>;

/** 每次派发固定工具名称、效果和调用目标，避免与内置工具混淆。 */
export function prepareExtensionTools(extensions: readonly ExecutionExtension[])
{
  const tools = new Map<string, ExtensionTool>();

  const ids = new Set<string>();

  for (const extension of extensions)
  {
    if (!extension.id || ids.has(extension.id))
      throw new Error('扩展身份缺失或重复');

    ids.add(extension.id);

    for (const tool of extension.tools ?? [])
    {
      if (!/^cbim_plugin_[a-z0-9_]+$/.test(tool.name) || tools.has(tool.name) || !tool.effects.length)
        throw new Error('扩展工具名称、效果或注册关系无效');

      tools.set(tool.name, { ...tool, inputSchema: structuredClone(tool.inputSchema), effects: [...tool.effects], Call: tool.Call.bind(tool) });
    }
  }

  const port: EngineToolsPort = {
    list: async () => [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema: structuredClone(inputSchema) })),
    call: async (name, args, signal, id) => { signal.throwIfAborted(); const tool = tools.get(name); if (!tool || !id) throw new Error('扩展工具缺少调用身份'); return tool.Call(args, signal, id); },
  };

  return { tools, capability: tools.size ? { id: 'extension-tools', tools: port } : undefined };
}
