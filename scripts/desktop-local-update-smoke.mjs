// 用实际 A/B 字节和 Electron 网络层验证外部夹具；不执行 NSIS，不伪造已安装标记。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {_electron} from 'playwright-core';
import {readTestCandidate, verifyTestExecutable, startLocalUpdateFixture, attachLocalUpdateTransport, payloadSummary, fileDigest} from './desktop-local-update-fixture.mjs';

const {values} = parseArgs({options: {a: {type: 'string'}, b: {type: 'string'}, exe: {type: 'string'}, report: {type: 'string'}}});
for (const key of ['a', 'b', 'exe', 'report']) assert.ok(values[key], `缺少 --${key}`);
const a = await readTestCandidate(values.a, '0.1.10'), b = await readTestCandidate(values.b, '0.1.11');
const executable = path.resolve(values.exe), root = path.resolve(values.report);
await verifyTestExecutable(executable, a);
await fs.mkdir(root, {recursive: false});
const local = path.join(root, 'local'), user = path.join(root, 'user'), cache = path.join(local, 'cbim-desktop-updater');
await fs.mkdir(cache, {recursive: true});
await fs.copyFile(a.installer, path.join(cache, 'installer.exe'));
const fixture = await startLocalUpdateFixture(a, b);
const env = {...process.env, LOCALAPPDATA: local, CBIM_USER_DATA_ROOT: user};
for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'GH_TOKEN', 'GITHUB_TOKEN', 'CBIM_SMOKE_ROOT']) delete env[name];
let application, result, failure;
try {
  application = await _electron.launch({executablePath: executable, env, timeout: 60000});
  await attachLocalUpdateTransport(application, fixture);
  await application.evaluate(({BrowserWindow}) => {for (const window of BrowserWindow.getAllWindows()) window.hide();});
  // 真实打包主程序的安装态门禁保持关闭；只在外部测试空间运行同锁定版本的下载器。
  result = await application.evaluate(async ({app}, input) => {
    const require = process.getBuiltinModule('module').createRequire(input.packageJson);
    const {NsisUpdater} = require('electron-updater');
    const response = await fetch('https://api.github.com/repos/nan023062/cbim/releases?per_page=30&page=1');
    const releases = await response.json();
    if (releases[0]?.tag_name !== 'desktop-v0.1.11') throw Error('Local discovery was not routed');
    const logs = [], progress = [];
    const adapter = {version: '0.1.10', name: 'cbim-local-test', isPackaged: true, appUpdateConfigPath: process.resourcesPath + '/app-update.yml', userDataPath: app.getPath('userData'), baseCachePath: process.env.LOCALAPPDATA, whenReady: async () => {}, quit: () => {throw Error('Unexpected quit');}, relaunch: () => {throw Error('Unexpected relaunch');}, onQuit: () => {}};
    const updater = new NsisUpdater(undefined, adapter);
    const {ElectronHttpExecutor} = require('electron-updater/out/electronHttpExecutor');
    updater.httpExecutor = new ElectronHttpExecutor();
    updater.setFeedURL({provider: 'generic', url: 'https://github.com/nan023062/cbim/releases/download/desktop-v0.1.11/', useMultipleRangeRequest: false});
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.disableDifferentialDownload = false;
    updater.logger = {info: x => logs.push(String(x)), warn: x => logs.push(String(x)), error: x => logs.push(String(x))};
    updater.on('error', error => logs.push(String(error)));
    updater.on('download-progress', value => progress.push(value.percent));
    const check = await updater.checkForUpdates();
    if (!check?.isUpdateAvailable || check.updateInfo.version !== '0.1.11') throw Error('B not available');
    const downloaded = await updater.downloadUpdate(check.cancellationToken);
    return {version: app.getVersion(), downloaded, progress, logs, transport: {...globalThis.__cbimLocalUpdateFixture}, updaterVersion: require('electron-updater/package.json').version};
  }, {packageJson: path.resolve('package.json')});
  assert.equal(result.version, '0.1.10'); assert.equal(result.updaterVersion, '6.8.11');
  assert.equal(result.transport.installationAttempts, 0);
  const pending = path.join(cache, 'pending', path.basename(b.installer));
  assert.equal(await fileDigest(pending), b.receipt.artifacts[0].sha256);
  const first = payloadSummary(fixture, b);
  assert.ok(first.ranges > 0); assert.equal(first.fullDownloads, 0);
  assert.ok(first.transferredBytes < first.fullBytes); assert.equal(first.allResponsesComplete, true);
  // HTTP 夹具拒绝越界和未列出的文件；不会通过路径穿越泄露目录。
  const bPath = `/nan023062/cbim/releases/download/desktop-v0.1.11/${path.basename(b.installer)}`;
  assert.equal((await fetch(fixture.origin + bPath, {headers: {Range: 'bytes=0-999999999999'}})).status, 416);
  assert.equal((await fetch(fixture.origin + '/package.json')).status, 404);
  result.payload = first;
  result.pendingSha256 = await fileDigest(pending);
  result.actualInstallerExecuted = false;
  result.appInstalledStateSimulated = false;
  result.scope = 'Real A/B installer bytes, pinned downloader and Electron transport; not installed UI/state-machine/NSIS acceptance';
} catch (error) { failure = String(error.stack ?? error); process.exitCode = 1; }
finally {
  await application?.close().catch(() => {});
  await fixture.close();
  const report = {success: !failure, ...result, failure, requests: fixture.requests, completedAt: new Date().toISOString()};
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({success: report.success, payload: report.payload, report: path.join(root, 'report.json'), failure}));
}
