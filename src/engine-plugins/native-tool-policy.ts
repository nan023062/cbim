/**
 * 作用定位：按引擎支持范围和本轮能力生成原生工具清单的纯函数。
 * 设计原因：启动清单只决定候选工具，实际调用仍须经过 beforeTool 授权，不能以清单替代权限检查。
 */
import { nativeToolsDisabled, type EngineCapabilities } from '../logic/execution/rules/engine-tools';

import { nativeToolNames } from '../logic/tools/rules/native-tools';

import type { LoopEngine } from '../logic/engines';

/** 启动时按本轮能力、Office 执行权限和引擎支持范围生成原生工具清单。实际调用由 beforeTool 授权。 */
export function allowedNativeTools(context: EngineCapabilities, allowExecution: boolean, engine: LoopEngine)
{
  return nativeToolsDisabled(context) ? [] : nativeToolNames(allowExecution && context.taskPermission?.level !== 'read', engine).filter(name => name !== 'bash' || context.taskPermission?.commands !== 'denied');
}
