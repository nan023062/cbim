import { JsonUtils } from '../../../core/io';
import { engineAdapterProtocol, type EngineAdapter as KernelAdapter } from '../../../framework/kernel';
import type { EngineDescriptor } from './supported-engines';

export type EngineAdapter<Options, Engine> = KernelAdapter<Options, Engine, EngineDescriptor>;

/** 先核身份与协议再取工厂；正式加载传入 R 声明以拒绝不匹配的 E，不执行安装脚本、回退或重试。 */
export function checkedEngineAdapter<Options, Engine>(value: unknown, expected: { id: string; version?: string; descriptor?: EngineDescriptor }): EngineAdapter<Options, Engine>
{
  const adapter = value as Partial<EngineAdapter<Options, Engine>> | null;

  if (!adapter || adapter.protocol !== engineAdapterProtocol || adapter.id !== expected.id || typeof adapter.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(adapter.version) || expected.version !== undefined && adapter.version !== expected.version || typeof adapter.create !== 'function')
    throw Error('引擎包身份、版本或运行协议不兼容');

  if (expected.descriptor)
  {
    let matches = false;

    try
    {
      matches = !!adapter.descriptor && descriptorContract(adapter.descriptor) === descriptorContract(expected.descriptor)
    }
    catch
    {
      /* 损坏声明不是可执行包，不透传原对象或解析细节。 */
    }

    if (!matches)
      throw Error('引擎包的模型或历史协议声明与当前应用不匹配，请更新匹配的引擎包；未启动或自动重试');
  }

  return adapter as EngineAdapter<Options, Engine>;
}

/** 仅比较执行语义；业务介绍、显示名与角色标签更新不强迫更换仍兼容的 E。 */
function descriptorContract(value: EngineDescriptor)
{
  const policy = { id: value.id, storageDirectory: value.storageDirectory, nativeHistoryFormat: value.nativeHistoryFormat, supportedApis: value.supportedApis, fallbackApi: value.fallbackApi, packageDependencies: value.packageDependencies ?? [], additionalModelRoles: (value.additionalModelRoles ?? []).map(({ label: _label, ...role }) => role) };

  return JSON.stringify(JsonUtils.OrderJsonValue(policy, { compareKeys: (a, b) => a < b ? -1 : a > b ? 1 : 0, omitUndefinedProperties: true }));
}
