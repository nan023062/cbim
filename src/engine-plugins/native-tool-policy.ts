import { nativeToolsDisabled, type EngineCapabilities } from '../logic/execution/rules/engine-tools';

import { nativeToolNames } from '../logic/tools/rules/native-tools';

import type { LoopEngine } from '../logic/engines';

/** 启动时按本轮能力、Office 执行权限和引擎支持范围生成原生工具清单。实际调用由 beforeTool 授权。 */
export function allowedNativeTools(context: EngineCapabilities, allowExecution: boolean, engine: LoopEngine)
{
  return nativeToolsDisabled(context) ? [] : nativeToolNames(allowExecution, engine);
}
