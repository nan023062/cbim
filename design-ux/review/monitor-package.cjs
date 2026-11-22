// Local Windows review only. Run with test-results/node-v22.19.0/node.exe.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

async function run() {
  assert.equal(process.versions.node, '22.19.0');
  assert.equal(process.platform, 'win32');
  const dir = fs.mkdtempSync(path.resolve('test-results', 'monitor-pack-'));
  console.log('Review output:', dir);
  const out = path.join(dir, 'build');
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbim-review-key-'));
  const key = path.join(keyDir, 'test.pem');
  try {
    fs.writeFileSync(key, crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
    const env = { ...process.env, CBIM_BUILD_OUT: out, CBIM_DESKTOP_RELEASE: '0', CBIM_RUNTIME_SIGNING_KEY: key };
    const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path');
    env[pathKey] = [path.dirname(process.execPath), path.resolve('node_modules/.bin'), env[pathKey]].join(path.delimiter);
    const forge = require.resolve('@electron-forge/cli/dist/electron-forge.js');
    const result = spawnSync(process.execPath, [forge, 'package', '--platform=win32', '--arch=x64'], { env, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Forge package failed');
  } finally {
    if (fs.existsSync(key)) fs.unlinkSync(key);
    fs.rmdirSync(keyDir);
  }
  const { executable: exe } = JSON.parse(fs.readFileSync(path.join(out, 'build-info.json'), 'utf8'));
  assert.equal(path.relative(out, exe).split(path.sep)[0].endsWith('win32-x64'), true);
  const asar = fs.readFileSync(path.join(path.dirname(exe), 'resources', 'app.asar'));
  assert.ok(asar.includes(Buffer.from('100cqi')), 'Missing workspace-relative chat width in packaged resources');
  console.log('PASS Forge package:', exe);
  const snapshotPath = path.join(dir, 'test-snapshot.json');
  const { check } = require('./monitor-names.cjs');
  await check(async rows => { fs.writeFileSync(snapshotPath, JSON.stringify(rows, null, 2)); });
  const rows = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const app = await require('playwright-core')._electron.launch({
    executablePath: exe, args: ['--user-data-dir=' + path.join(dir, 'chromium')],
    env: { ...process.env, CBIM_USER_DATA_ROOT: path.join(dir, 'data') }, timeout: 45000
  });
  try {
    const home = await app.firstWindow();
    await home.locator('#application-home').waitFor();
    const [monitor] = await Promise.all([app.waitForEvent('window'), home.evaluate(() => window.desktopMenu.OpenMonitor())]);
    await monitor.locator('.process-monitor').waitFor();
    await monitor.locator('.host-processes .process-name').first().waitFor();
    const packaged = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath }));
    assert.ok(packaged.packaged);
    assert.equal(path.resolve(packaged.executable).toLowerCase(), path.resolve(exe).toLowerCase());
    await app.evaluate(({ BrowserWindow }, rows) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#monitor'));
      win.setContentSize(780, 780);
      win.webContents.send('monitor:rows', rows);
    }, rows);
    for (const agent of rows.agents) await monitor.getByText(agent.name, { exact: true }).waitFor();
    for (const core of rows.engines) {
      const rect = await monitor.getByText(core.detail, { exact: true }).boundingBox();
      assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= await monitor.evaluate(() => innerHeight), 'Engine association outside screenshot');
    }
    const png = path.join(dir, 'resource-monitor-demo.png');
    await monitor.screenshot({ path: png });
    const receipt = { ...packaged, png, snapshotPath, source: '新包监视器通过正式 IPC 显示两个演示项目的测试快照；引擎为测试实例。', asarSha256: crypto.createHash('sha256').update(asar).digest('hex') };
    fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2));
    console.log('PASS packaged monitor screenshot:', JSON.stringify(receipt));
  } finally {
    await app.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
