// 在启动安装器之前核实验收输入；旧版必须明确给出，指定历史版验收与实际上一公开版验收分别记录。
import assert from 'node:assert/strict';
const verifiedPreviousVersions=['0.1.0', '0.1.1', '0.1.2', '0.1.3', '0.1.4', '0.1.5', '0.1.6', '0.1.7', '0.1.8', '0.1.9', '0.1.10', '0.1.11', '0.1.12', '0.1.13', '0.1.14', '0.1.15', '0.1.16', '0.1.17'];

export function acceptanceInputs(env) {
  const version = env.CBIM_ACCEPTANCE_VERSION, previousVersion = env.CBIM_ACCEPTANCE_PREVIOUS_VERSION;
  const commit = env.CBIM_ACCEPTANCE_COMMIT, expected = env.CBIM_ACCEPTANCE_SHA256, mode = env.CBIM_ACCEPTANCE_MODE;
  assert.match(version, /^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  // 已核实的旧界面显式枚举；不能把任意未来版本猜成已覆盖的更新交互。
  assert.ok(verifiedPreviousVersions.includes(previousVersion), 'Unsupported previous desktop version for upgrade acceptance');
  const previousUpdateFlow = ['0.1.10', '0.1.11', '0.1.12', '0.1.13', '0.1.14', '0.1.15', '0.1.16', '0.1.17'].includes(previousVersion) ? 'prefetch' : ['0.1.3', '0.1.4', '0.1.5', '0.1.6', '0.1.7', '0.1.8', '0.1.9'].includes(previousVersion) ? 'automatic' : 'two-step';
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

// 已核实 0.1.15 会每分钟自动重试检查；只允许观察这一明确状态，不把下载、校验或安装失败当作成功。
export function acceptanceCanAwaitCheckRetry(status, requestedPhase) {
  return status.currentVersion==='0.1.15' && status.enabled===true
    && ['ready','available','current'].includes(requestedPhase) && ['idle','available'].includes(status.phase)
    && status.error==='暂时无法检查更新，将在下一分钟自动重试，也可手动检查。';
}

// 真实旧冷壳优先应用同 C 的已公开 R（0.1.15/R4、0.1.17/R3）；仅接受已核实的通道，仍须继续安装新版 C。
export function acceptanceReadyTarget(status, previousVersion, version) {
  assert.equal(status.currentVersion, previousVersion); assert.equal(status.phase, 'ready'); assert.ok(!status.error);
  const release = status.release; assert.ok(release);
  if (release.delivery === 'resources') {
    const resourceVersion = {'0.1.15':4,'0.1.17':3}[previousVersion];
    assert.ok(resourceVersion, 'Unverified intermediate resource channel'); assert.equal(release.version, previousVersion);
    assert.equal(release.tag, 'runtime-c'+previousVersion); assert.equal(release.resourceVersion, resourceVersion);
    assert.ok(Number.isSafeInteger(status.currentResourceVersion) && status.currentResourceVersion >= 1 && status.currentResourceVersion < resourceVersion);
    return {kind:'resources',resourceVersion};
  }
  assert.ok(release.delivery === undefined || release.delivery === 'installer'); assert.equal(release.version, version);
  return {kind:'installer'};
}

// 接受旧版本时同时启用该版本已有的数据保留检查，避免新版本只进入安装白名单却跳过验收。
export function acceptanceRetentionChecks(previousVersion) {
  assert.ok(verifiedPreviousVersions.includes(previousVersion), 'Unsupported retention source version');
  const patch=Number(previousVersion.split('.')[2]);
  return {installerCache:patch>=12,mainAgentAndAutomation:patch>=7};
}
