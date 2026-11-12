// 在启动安装器之前核实验收输入；旧版必须明确给出，不能把固定旧包冒充上一公开版本。
import assert from 'node:assert/strict';

export function acceptanceInputs(env) {
  const version = env.CBIM_ACCEPTANCE_VERSION, previousVersion = env.CBIM_ACCEPTANCE_PREVIOUS_VERSION;
  const commit = env.CBIM_ACCEPTANCE_COMMIT, expected = env.CBIM_ACCEPTANCE_SHA256, mode = env.CBIM_ACCEPTANCE_MODE;
  assert.match(version, /^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  // 已核实的旧界面显式枚举；不能把任意未来版本猜成已覆盖的更新交互。
  assert.ok(['0.1.1', '0.1.2', '0.1.3', '0.1.4', '0.1.5', '0.1.6', '0.1.7', '0.1.8', '0.1.9', '0.1.10'].includes(previousVersion), 'Unsupported previous desktop version for upgrade acceptance');
  const previousUpdateFlow = previousVersion === '0.1.10' ? 'prefetch' : ['0.1.3', '0.1.4', '0.1.5', '0.1.6', '0.1.7', '0.1.8', '0.1.9'].includes(previousVersion) ? 'automatic' : 'two-step';
  const target = version.split('.').map(Number), previous = previousVersion.split('.').map(Number);
  assert.ok(target[1] > previous[1] || (target[1] === previous[1] && target[2] > previous[2]), 'Target version must be newer than previous version');
  assert.match(commit, /^[a-f0-9]{40}$/); assert.match(expected, /^[a-f0-9]{64}$/);
  assert.ok(['candidate', 'online'].includes(mode));
  return {version, previousVersion, previousUpdateFlow, commit, expected, mode};
}

// 全量回退只能作为明确命名的诊断场景；默认仍严格要求差分，不能用此入口把回退报告成差分通过。
export function acceptanceTransferExpectation(env, {mode, previousUpdateFlow}) {
  const value = env.CBIM_ACCEPTANCE_TRANSFER || 'differential';
  assert.ok(['differential', 'full-fallback'].includes(value), 'Unsupported transfer expectation');
  if (value === 'full-fallback') assert.ok(mode === 'online' && previousUpdateFlow === 'prefetch', 'Fallback diagnosis requires an online prefetch client');
  return value;
}
