import assert from 'node:assert/strict';

// 只接受已核实冷包的升级交互；输入不能指定任意下载源、安装路径或未经检查的未来 C。
export function runtimeAcceptanceInputs(env) {
  const mode=env.CBIM_R_MODE,tag=env.CBIM_R_CANDIDATE,source=env.CBIM_R_SOURCE,expected=env.CBIM_R_DIGEST;
  assert.ok(['candidate','online'].includes(mode));
  assert.equal(typeof tag,'string');
  const match=/^runtime-c(0\.1\.(?:15|17))-r([1-9][0-9]*)-candidate(?:-([2-9]|[1-9][0-9]+))?$/.exec(tag);
  assert.ok(match,'Unsupported cold version or candidate tag');
  const resourceVersion=Number(match[2]);assert.ok(Number.isSafeInteger(resourceVersion)&&resourceVersion>=2);
  assert.match(source,/^[a-f0-9]{40}$/);assert.match(expected,/^[a-f0-9]{64}$/);
  const coldVersion=match[1];
  return {mode,tag,source,expected,coldVersion,resourceVersion,coldTag:`desktop-v${coldVersion}`,installerName:`CBIM-Setup-${coldVersion}-x64.exe`};
}
