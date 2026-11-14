// 在启动安装器之前核实验收输入；旧版必须明确给出，指定历史版验收与实际上一公开版验收分别记录。
import assert from 'node:assert/strict';

export function acceptanceInputs(env) {
  const version = env.CBIM_ACCEPTANCE_VERSION, previousVersion = env.CBIM_ACCEPTANCE_PREVIOUS_VERSION;
  const commit = env.CBIM_ACCEPTANCE_COMMIT, expected = env.CBIM_ACCEPTANCE_SHA256, mode = env.CBIM_ACCEPTANCE_MODE;
  assert.match(version, /^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  // 已核实的旧界面显式枚举；不能把任意未来版本猜成已覆盖的更新交互。
  assert.ok(['0.1.0', '0.1.1', '0.1.2', '0.1.3', '0.1.4', '0.1.5', '0.1.6', '0.1.7', '0.1.8', '0.1.9', '0.1.10', '0.1.11', '0.1.12', '0.1.13', '0.1.14', '0.1.15'].includes(previousVersion), 'Unsupported previous desktop version for upgrade acceptance');
  const previousUpdateFlow = ['0.1.10', '0.1.11', '0.1.12', '0.1.13', '0.1.14', '0.1.15'].includes(previousVersion) ? 'prefetch' : ['0.1.3', '0.1.4', '0.1.5', '0.1.6', '0.1.7', '0.1.8', '0.1.9'].includes(previousVersion) ? 'automatic' : 'two-step';
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

// 0.1.15 的真实 R1 客户端优先发现已公开 R4；只接受核实过的中间跳转，不把资源就绪当成安装器就绪。
export function acceptanceReadyTarget(status, previousVersion, version) {
  assert.equal(status.currentVersion, previousVersion); assert.equal(status.phase, 'ready'); assert.ok(!status.error);
  const release = status.release; assert.ok(release);
  if (release.delivery === 'resources') {
    assert.equal(previousVersion, '0.1.15'); assert.equal(release.version, previousVersion);
    assert.equal(release.tag, 'runtime-c0.1.15'); assert.equal(release.resourceVersion, 4);
    assert.ok(Number.isSafeInteger(status.currentResourceVersion) && status.currentResourceVersion >= 1 && status.currentResourceVersion < 4);
    return {kind:'resources',resourceVersion:4};
  }
  assert.ok(release.delivery === undefined || release.delivery === 'installer'); assert.equal(release.version, version);
  return {kind:'installer'};
}
