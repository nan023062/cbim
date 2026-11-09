// 在启动安装器之前核实验收输入；旧版必须明确给出，不能把固定旧包冒充上一公开版本。
import assert from 'node:assert/strict';

export function acceptanceInputs(env) {
  const version = env.CBIM_ACCEPTANCE_VERSION, previousVersion = env.CBIM_ACCEPTANCE_PREVIOUS_VERSION;
  const commit = env.CBIM_ACCEPTANCE_COMMIT, expected = env.CBIM_ACCEPTANCE_SHA256, mode = env.CBIM_ACCEPTANCE_MODE;
  assert.match(version, /^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  // 这两版使用下载后显式重启的界面。后续自动安装旧版需要另行实现并验证交互，不能静默套用。
  assert.ok(['0.1.1', '0.1.2'].includes(previousVersion), 'Unsupported previous desktop version for two-step upgrade acceptance');
  const target = version.split('.').map(Number), previous = previousVersion.split('.').map(Number);
  assert.ok(target[1] > previous[1] || (target[1] === previous[1] && target[2] > previous[2]), 'Target version must be newer than previous version');
  assert.match(commit, /^[a-f0-9]{40}$/); assert.match(expected, /^[a-f0-9]{64}$/);
  assert.ok(['candidate', 'online'].includes(mode));
  return {version, previousVersion, commit, expected, mode};
}
