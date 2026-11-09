// 在独立 Windows runner 安装实际附件，避免 NSIS 通过注册表卸载开发者正在使用的客户端。
// 只读取 GitHub，不发布；固定仓库、版本、构建提交和制品摘要，测试数据不包含真实账号凭据。
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {_electron as electron} from 'playwright-core';

assert.equal(process.platform, 'win32');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only run on an isolated GitHub Actions runner');
assert.equal(process.env.GITHUB_REPOSITORY, 'nan023062/cbim');
const version = process.env.CBIM_ACCEPTANCE_VERSION, commit = process.env.CBIM_ACCEPTANCE_COMMIT;
const expected = process.env.CBIM_ACCEPTANCE_SHA256, mode = process.env.CBIM_ACCEPTANCE_MODE;
assert.match(version, /^0\.\d+\.\d+$/); assert.notEqual(version, '0.1.1');
assert.match(commit, /^[a-f0-9]{40}$/); assert.match(expected, /^[a-f0-9]{64}$/); assert.ok(['candidate', 'online'].includes(mode));
const repo = 'nan023062/cbim', root = path.resolve('test-results/desktop-acceptance');
const install = path.join(root, 'app'), exe = path.join(install, 'CBIM Desktop.exe'), userRoot = path.join(root, 'user');
await fs.mkdir(root, {recursive: true});
const run = (command, args) => execFileSync(command, args, {encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024}).trim();
const ps = script => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
const gh = args => run('gh', args);
const sha = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (name, data) => fs.writeFile(path.join(root, name + '.json'), JSON.stringify(data, null, 2) + '\n');
assert.equal(ps("@(Get-Process -Name 'CBIM Desktop' -ErrorAction SilentlyContinue).Count"), '0');
assert.equal(ps("@(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Get-ItemProperty | Where-Object DisplayName -Like '*CBIM*').Count"), '0', 'Existing installation must not be replaced by acceptance');
const env = {...process.env, CBIM_USER_DATA_ROOT: userRoot};
for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'ELECTRON_RUN_AS_NODE', 'CBIM_GITHUB_CLIENT_ID']) delete env[name];
async function download(target) {
  const releases = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`])).flat();
  const release = releases.find(item => item.tag_name === `desktop-v${target}`); assert.ok(release); assert.equal(release.prerelease, false);
  const name = `CBIM-Setup-${target}-x64.exe`, asset = release.assets.find(item => item.name === name); assert.ok(asset);
  if (target === version) {
    assert.equal(asset.digest, `sha256:${expected}`);
    assert.equal(release.draft, mode === 'candidate');
    if (release.draft) assert.equal(release.target_commitish, commit);
    else assert.equal(JSON.parse(gh(['api', `repos/${repo}/commits/desktop-v${target}`])).sha, commit);
  } else assert.equal(release.draft, false);
  gh(['release', 'download', release.tag_name, '--repo', repo, '--pattern', name, '--dir', root]);
  const file = path.join(root, name); assert.equal('sha256:' + await sha(file), asset.digest); assert.equal((await fs.stat(file)).size, asset.size);
  await save(`release-${target}`, {id: release.id, tag: release.tag_name, draft: release.draft, asset: {name, size: asset.size, digest: asset.digest}});
  return file;
}
const candidate = await download(version), old = await download('0.1.1');
async function setup(file, target) {
  await save(`install-intent-${target}`, {file, install, sha256: await sha(file), at: new Date().toISOString()});
  await new Promise((resolve, reject) => {
    const child = spawn(file, ['/S', `/D=${install}`], {windowsHide: true, env, stdio: 'ignore'});
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`NSIS exit ${code}`)));
  });
  assert.equal(JSON.parse(await fs.readFile(path.join(install, 'resources/desktop-release.json'), 'utf8')).version, target);
}
let app, requests = 0; const errors = [], phases = [];
const server = http.createServer(async (req, res) => {
  for await (const _ of req) { /* consume the deterministic model request */ }
  requests++;
  res.writeHead(200, {'Content-Type': 'text/event-stream'});
  const base = {id: 'release-acceptance', object: 'chat.completion.chunk', created: 1, model: 'acceptance'};
  for (const [delta, finish_reason] of [[{role: 'assistant', content: 'Release acceptance record.'}, null], [{}, 'stop']]) res.write('data: ' + JSON.stringify({...base, choices: [{index: 0, delta, finish_reason}]}) + '\n\n');
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const status = page => page.evaluate(() => window.cbim.call('desktop.updates.status'));
async function launch(profile = userRoot) {
  app = await electron.launch({executablePath: exe, env: {...env, CBIM_USER_DATA_ROOT: profile}, timeout: 60000});
  const page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', {name: '用户菜单', exact: true}).waitFor(); return page;
}
async function close() { await app?.close(); app = undefined; }
async function waitPhase(page, phase) {
  for (let n = 0; n < 300; n++) {
    const value = await status(page); phases.push({version: value.currentVersion, phase: value.phase});
    if (value.error) throw Error(value.error); if (value.phase === phase) return value; await pause(1000);
  } throw Error(`Update timeout: ${phase}`);
}
async function notes(page) {
  await page.getByRole('button', {name: '用户菜单', exact: true}).click();
  await page.getByRole('menuitem', {name: '最近一次更新', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '最近一次更新', exact: true}); await dialog.waitFor();
  assert.ok((await dialog.innerText()).includes(`当前版本 ${version}`)); assert.match(await dialog.innerText(), /未签名/);
  await page.screenshot({path: path.join(root, `${mode}-notes.png`)}); await page.keyboard.press('Escape');
}
try {
  if (mode === 'candidate') {
    await setup(candidate, version); let page = await launch(path.join(root, 'fresh-user'));
    assert.equal((await status(page)).currentVersion, version); assert.equal((await status(page)).enabled, true); await notes(page); await close();
  }
  await setup(old, '0.1.1'); let page = await launch(); assert.equal((await status(page)).currentVersion, '0.1.1');
  const profile = {name: 'Release acceptance', api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, auth: 'none', defaultModel: 'acceptance', models: [{id: 'acceptance', name: 'Acceptance', enabled: true, contextWindow: 32768, maxTokens: 1024, reasoning: false, pricing: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}}]};
  await page.evaluate(profile => window.cbim.call('models.save', {profile}), profile);
  const workspace = path.join(root, 'project'); await fs.mkdir(workspace);
  const entry = await page.evaluate(path => window.cbim.call('add', {path}), workspace);
  const run = await page.evaluate(id => window.cbim.call('loop.chat', {id, message: 'Record release acceptance.', options: {permission: 'ask', turnTimeoutMs: 60000}}), entry.id);
  let summary;
  for (let n = 0; n < 120; n++) {
    summary = await page.evaluate(args => window.cbim.call('loop.inspect', args), {id: entry.id, ...run});
    if (summary.status === 'completed') break; if (['failed', 'interrupted', 'cancelled'].includes(summary.status)) throw Error(JSON.stringify(summary)); await pause(500);
  }
  assert.equal(summary.status, 'completed'); assert.equal(requests, 1);
  const marker = `from-0.1.1-to-${version}`;
  await page.evaluate(marker => localStorage.setItem('cbim.release-retention', marker), marker);
  await fs.writeFile(path.join(userRoot, 'acceptance-marker.txt'), marker);
  let restarted;
  if (mode === 'candidate') { await close(); await setup(candidate, version); }
  else {
    const available = await waitPhase(page, 'available'); assert.equal(available.release.version, version);
    const download = async () => {
      await page.getByRole('button', {name: '查看更新', exact: true}).click();
      await page.getByRole('region', {name: '软件更新', exact: true}).getByRole('button', {name: '下载更新', exact: true}).click();
      await waitPhase(page, 'ready');
    };
    await download();
    const cache = path.join(process.env.LOCALAPPDATA, 'cbim-desktop-updater/pending', path.basename(candidate)); assert.equal(await sha(cache), expected);
    await close(); await pause(1000); page = await launch(); assert.equal((await status(page)).currentVersion, '0.1.1');
    await waitPhase(page, 'available'); await download();
    await save('online-install-intent', {from: '0.1.1', to: version, sha256: expected, install, userRoot});
    await page.getByRole('button', {name: '停止任务并重启安装', exact: true}).click(); app = undefined;
    const quoted = exe.replaceAll("'", "''");
    for (let n = 0; n < 120; n++) {
      const text = ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${quoted}' -and $_.CommandLine -like '*--updated*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`);
      if (text) { restarted = JSON.parse(text); break; } await pause(1000);
    }
    assert.ok(restarted); assert.ok(restarted.CommandLine.toLowerCase().includes(userRoot.toLowerCase()));
    await save('online-restart', restarted);
    // 等待自动启动的渲染进程与窗口稳定后正常关闭，再由 Playwright 验证已安装版本和保留数据。
    await pause(15000);
    ps(`$p=Get-Process -Id ${restarted.ProcessId}; if ($p.Path -ne '${quoted}' -or $p.MainWindowHandle -eq 0) { throw 'Restarted app identity/window mismatch' }; if (-not $p.CloseMainWindow()) { throw 'Normal close refused' }; if (-not $p.WaitForExit(30000)) { throw 'Normal close timed out' }`);
  }
  page = await launch();
  const native = await app.evaluate(({app}) => ({version: app.getVersion(), packaged: app.isPackaged, exe: app.getPath('exe'), userData: app.getPath('userData')}));
  assert.equal(native.version, version); assert.equal(native.packaged, true); assert.equal(native.userData, path.join(userRoot, 'desktop'));
  assert.equal(await page.evaluate(() => localStorage.getItem('cbim.release-retention')), marker);
  assert.equal(await fs.readFile(path.join(userRoot, 'acceptance-marker.txt'), 'utf8'), marker);
  const models = await page.evaluate(() => window.cbim.call('models.list')); assert.ok(models.profiles.some(p => p.name === profile.name));
  const catalog = await page.evaluate(() => window.cbim.call('list')); assert.ok(catalog.entries.some(e => e.id === entry.id));
  const history = await page.evaluate(id => window.cbim.call('loop.list', {id}), entry.id); assert.equal(history.length, 1); assert.equal(history[0].task.taskId, run.taskId); assert.equal(history[0].runId, run.runId);
  summary = await page.evaluate(args => window.cbim.call('loop.inspect', args), {id: entry.id, ...run}); assert.equal(summary.status, 'completed'); assert.equal(requests, 1);
  await notes(page); assert.deepEqual(errors, []);
  const signature = ps(`(Get-AuthenticodeSignature -LiteralPath '${exe.replaceAll("'", "''")}').Status.ToString()`); assert.equal(signature, 'NotSigned');
  assert.equal((await status(page)).enabled, true);
  if (mode === 'online') { const current = await page.evaluate(() => window.cbim.call('desktop.updates.check')); assert.equal(current.phase, 'current'); }
  await close();
  await save('report', {success: true, mode, version, commit, installerSha256: expected, native, signature, from: '0.1.1', freshInstall: mode === 'candidate', onlineDiscoveryDownloadAndInstall: mode === 'online', normalQuitDidNotInstall: mode === 'online', retained: {workspace: true, model: true, completedConversation: true, localStorage: true, marker: true, noReplay: true}, modelRequests: requests, restarted, pageErrors: errors, phases, completedAt: new Date().toISOString()});
  console.log(JSON.stringify({success: true, mode, version, sha256: expected, retained: true}));
} catch (error) { await save('failure', {error: String(error), stack: error.stack, phases, requests, pageErrors: errors}); throw error; }
finally { await close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
