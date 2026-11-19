/**
 * 作用定位：开发者维护的官方 Agent Loop 引擎静态清单，随 Logic 资源发布。
 * 设计原因：身份、业务专长和模型协议声明集中维护；清单不加载具体 SDK，也不开放用户注册或配置文件覆盖。
 * 职责边界：协议兼容表示可以选择，不代表模型工具调用能力、凭据或运行环境已经验证；不属于冷启动框架。
 */
import type { LlmApi } from '../../models';

import type { ModelRoleDescriptor } from './model-roles';

/** 单引擎的便携能力声明；fallbackApi 只在主接口不兼容时使用，不转换模型 ID 或请求。 */
interface EngineDeclaration
{
  id: string;

  storageDirectory: string;

  nativeHistoryFormat: 'pi' | 'claude' | 'codex' | 'cbim';

  packageDependencies?: readonly string[];

  label: string;

  businessTypes: readonly string[];

  supportedApis: readonly LlmApi[];

  fallbackApi?: LlmApi;

  additionalModelRoles?: readonly ModelRoleDescriptor[]
}

/** 仅开发者通过代码增加引擎；运行时无法修改清单或其中的能力数组。 */
function declareEngine<const T extends EngineDeclaration>(value: T): Readonly<T>
{
  for (const role of value.additionalModelRoles ?? [])
  {
    if (role.modelIds)
      Object.freeze(role.modelIds);

    if (role.kind === 'generation')
    {
      Object.freeze(role.connection.supportedApis);

      Object.freeze(role.connection)
    }

    Object.freeze(role)
  }

  if (value.additionalModelRoles)
    Object.freeze(value.additionalModelRoles);

  if (value.packageDependencies)
    Object.freeze(value.packageDependencies);

  Object.freeze(value.businessTypes);

  Object.freeze(value.supportedApis);

  return Object.freeze(value);
}

export const builtInEngines = Object.freeze([declareEngine({ id: 'pi', storageDirectory: 'pi', nativeHistoryFormat: 'pi', label: 'Pi', businessTypes: ['通用任务', '代码开发'], supportedApis: ['openai-completions', 'openai-responses', 'anthropic-messages'] }), declareEngine({ id: 'claude-code', storageDirectory: 'claude', nativeHistoryFormat: 'claude', label: 'Claude Code', businessTypes: ['代码开发', '代码审查'], supportedApis: ['anthropic-messages'], fallbackApi: 'anthropic-messages' }), declareEngine({ id: 'codex', storageDirectory: 'codex', nativeHistoryFormat: 'codex', packageDependencies: ['pi'], label: 'Codex', businessTypes: ['代码开发', '代码审查'], supportedApis: ['openai-responses'], fallbackApi: 'openai-responses' }), declareEngine({ id: 'memory', storageDirectory: 'memory', nativeHistoryFormat: 'cbim', label: '记忆引擎', businessTypes: ['知识库管理', '语义检索', '摘要与压缩'], supportedApis: ['openai-completions'], additionalModelRoles: [{ id: 'embedding', label: '记忆向量模型', kind: 'embedding', required: true }] }),] as const);

export type LoopEngine = string;
export let supportedEngines: readonly EngineDescriptor[] = builtInEngines;

/** 从已验签制品或宿主设置快照登记兼容引擎。内置 ID 与存储目录保持保留。 */
export function registerPackageEngines(artifacts: readonly { kind: string; plugin?: {type: string; profile?: string; label?: string} }[])
{
  const entries = new Map<string, EngineDescriptor>();
  for (const { kind, plugin } of artifacts) {
    if (plugin?.type !== 'engine') continue;
    const base = builtInEngines.find(item => item.id === plugin.profile);
    if (!base || !plugin.label || !/^[a-z][a-z0-9-]{0,47}$/.test(kind) || builtInEngines.some(item => item.id === kind)) throw Error('插件引擎声明无效');
    const descriptor = Object.freeze({ ...base, id: kind, storageDirectory: 'plugin-' + kind, label: plugin.label });
    const previous = entries.get(kind);
    if (previous && previous.nativeHistoryFormat !== descriptor.nativeHistoryFormat) throw Error('插件引擎版本间协议冲突');
    entries.set(kind, descriptor);
  }
  supportedEngines = Object.freeze([...builtInEngines, ...entries.values()]);
}

/** 公共描述保留可选 fallbackApi，消费者不依赖各条目字面量结构。 */
export type EngineDescriptor = Readonly<Omit<EngineDeclaration, 'id'> &
{
  id: LoopEngine
}>;
