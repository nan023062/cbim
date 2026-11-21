import { nativeToolsDisabled, type EngineCapabilities } from '../logic-new/execution/rules/engine-tools';

import { nativeToolNames } from '../logic-new/tools/rules/native-tools';

import type { LoopEngine } from '../logic-new/engines';

/** 启动时按本轮能力、Office 执行权限和引擎支持范围生成原生工具清单。实际调用由 beforeTool 授权。 */
export function allowedNativeTools(context: EngineCapabilities, allowExecution: boolean, engine: LoopEngine)
{
  return nativeToolsDisabled(context) ? [] : nativeToolNames(allowExecution, engine);
}
