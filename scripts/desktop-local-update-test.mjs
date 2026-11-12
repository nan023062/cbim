// 在独立 Windows 测试机启动已安装的 A；不安装 A、不发布、不更改 hosts/证书/产品文件。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {_electron} from 'playwright-core';
import {readTestCandidate, verifyTestExecutable, startLocalUpdateFixture, attachLocalUpdateTransport, payloadSummary, fileDigest} from './desktop-local-update-fixture.mjs';

const {values} = parseArgs({options: {
  exe: {type: 'string'}, a: {type: 'string'}, b: {type: 'string'}, profile: {type: 'string'}, report: {type: 'string'}, help: {type: 'boolean'},
  'allow-install-on-isolated-machine': {type: 'boolean', default: false},
}});
if (values.help) {
  console.log('用法：desktop-local-update-test.mjs --exe <已安装的 A/CBIM Desktop.exe> --a <A 附件目录> --b <B 附件目录> --profile <专用测试数据目录> --report <不存在的报告目录> [--allow-install-on-isolated-machine]\n默认只测下载并阻止安装；完整安装仅在独立 Windows 测试机显式启用。');
  process.exit(0);
}
assert.equal(process.platform, 'win32', '仅支持 Windows x64 测试机');
for (const key of ['exe', 'a', 'b', 'profile', 'report']) assert.ok(values[key], `缺少 --${key}`);
const a = await readTestCandidate(values.a, '0.1.10'), b = await readTestCandidate(values.b, '0.1.11');
const executable = path.resolve(values.exe), profile = path.resolve(values.profile), report = path.resolve(values.report);
await verifyTestExecutable(executable, a);
await fs.access(path.join(path.dirname(executable), 'Uninstall CBIM Desktop.exe'));
const running = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-Process -Name 'CBIM Desktop' -ErrorAction SilentlyContinue).Count"], {encoding: 'utf8', windowsHide: true}).trim();
assert.equal(running, '0', '请先退出测试机上的 CBIM，再用本工具启动 A');
const cache = path.join(process.env.LOCALAPPDATA, 'cbim-desktop-updater');
const cacheHash = await fileDigest(path.join(cache, 'installer.exe')).catch(error => {
  if (error.code === 'ENOENT') throw Error('A/B 已知缓存目录不一致：重新安装同一 A 不能修复。请查看缓存衔接调查与修复候选；本工具不会补造旧包缓存。');
  throw error;
});
assert.ok([a.receipt.artifacts[0].sha256, b.receipt.artifacts[0].sha256].includes(cacheHash), '更新缓存不是本次 A/B，换用干净测试机重新安装 A；本工具不会覆盖现有缓存');
const marker = path.join(profile, '.cbim-local-update-test.json');
const identity = {kind: 'cbim-local-update-test', executable, from: a.version, to: b.version};
try { assert.deepEqual(JSON.parse(await fs.readFile(marker, 'utf8')), identity); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await fs.mkdir(profile, {recursive: false});
  await fs.writeFile(marker, JSON.stringify(identity, null, 2), {flag: 'wx'});
}
// 报告目录必须新建，测试资料目录只能新建或复用本工具自己的标记目录。
await fs.mkdir(report, {recursive: false});
const fixture = await startLocalUpdateFixture(a, b);
const env = {...process.env, CBIM_USER_DATA_ROOT: profile};
for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'GH_TOKEN', 'GITHUB_TOKEN', 'CBIM_SMOKE_ROOT']) delete env[name];
let application, timer, lastStatus, lastTransport, failure;
try {
  application = await _electron.launch({executablePath: executable, env, timeout: 60000});
  const closed = new Promise(resolve => application.once('close', resolve));
  await attachLocalUpdateTransport(application, fixture, {allowInstall: values['allow-install-on-isolated-machine']});
  const page = await application.firstWindow();
  await page.getByRole('button', {name: '用户菜单', exact: true}).waitFor();
  lastStatus = await page.evaluate(() => window.cbim.call('desktop.updates.status'));
  assert.equal(lastStatus.currentVersion, a.version); assert.equal(lastStatus.enabled, true);
  console.log(`本地测试已启动：${a.version} → ${b.version}。请在 A 界面观察后台下载；退出 A 后本工具保存请求记录并结束。`);
  console.log(values['allow-install-on-isolated-machine'] ? '允许用户点击“重启安装”启动真实安装器：仅用于独立测试机。' : '当前仅观察下载：安装器被测试工具阻止。完整安装请在独立测试机显式传入 --allow-install-on-isolated-machine。');
  console.log(`测试数据：${profile}\n报告：${report}`);
  let sampling = false;
  timer = setInterval(async () => {
    if (sampling) return; sampling = true;
    try {
      lastStatus = await page.evaluate(() => window.cbim.call('desktop.updates.status'));
      lastTransport = await application.evaluate(() => ({...globalThis.__cbimLocalUpdateFixture}));
    } catch { /* 应用退出时保留最后一份状态，不把断开连接当成安装成功。 */ }
    finally { sampling = false; }
  }, 500);
  process.once('SIGINT', () => {void application.close().catch(() => {});});
  await closed;
} catch (error) { failure = String(error.stack ?? error); process.exitCode = 1; }
finally {
  clearInterval(timer);
  await application?.close().catch(() => {});
  await fixture.close();
  const record = {mode: 'manual-installed-local-transport', a: a.version, b: b.version, executable, profile, allowInstall: values['allow-install-on-isolated-machine'], cacheHashBefore: cacheHash, lastStatus, lastTransport, payload: payloadSummary(fixture, b), requests: fixture.requests, installationResult: '请在重启的新进程核对 B 版本和数据；进程退出本身不证明安装成功', failure, completedAt: new Date().toISOString()};
  await fs.writeFile(path.join(report, 'report.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({report: path.join(report, 'report.json'), payload: record.payload, failure}));
}
