// 在独立 Windows runner 安装实际附件，避免 NSIS 通过注册表卸载开发者正在使用的客户端。
// 只读取 GitHub，不发布；固定仓库、版本、构建提交和制品摘要，测试数据不包含真实账号凭据。
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn, execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {_electron as electron, chromium} from 'playwright-core';
import {acceptanceInputs, acceptanceTransferExpectation, acceptanceReadyTarget, acceptanceCanAwaitCheckRetry, acceptanceRetentionChecks} from './desktop-acceptance-inputs.mjs';
import {observeUpdaterNetwork, readUpdaterNetwork, summarizeUpdaterNetwork} from './desktop-update-network-evidence.mjs';
import {connectDesktopInspector} from './desktop-inspector-connection.mjs';
import {DesktopAcceptanceProcess, ownLaunchedDesktop} from './desktop-acceptance-process.mjs';
import {parse} from 'yaml';

assert.equal(process.platform, 'win32');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only run on an isolated GitHub Actions runner');
assert.equal(process.env.GITHUB_REPOSITORY, 'nan023062/cbim');
const {version, previousVersion, previousUpdateFlow, commit, expected, mode} = acceptanceInputs(process.env);
const retentionChecks = acceptanceRetentionChecks(previousVersion);
const transferExpectation = acceptanceTransferExpectation(process.env, {mode, previousUpdateFlow});
const repo = 'nan023062/cbim', root = path.resolve('test-results/desktop-acceptance');
const install = path.join(root, 'app'), exe = path.join(install, 'CBIM Desktop.exe'), userRoot = path.join(root, 'user');
await fs.mkdir(root, {recursive: true});
const run = (command, args) => execFileSync(command, args, {encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024}).trim();
// runner 的父 shell 是 PowerShell 7；使用同一版本，避免继承的 PSModulePath 让 5.1 错载安全模块。
const ps = script => run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
const gh = args => run('gh', args);
const sha = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (name, data) => fs.writeFile(path.join(root, name + '.json'), JSON.stringify(data, null, 2) + '\n');
assert.equal(ps("@(Get-Process -Name 'CBIM Desktop' -ErrorAction SilentlyContinue).Count"), '0');
assert.equal(ps("$key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'; if (Test-Path -LiteralPath $key) { @(Get-ChildItem -LiteralPath $key -ErrorAction Stop | Get-ItemProperty -ErrorAction Stop | Where-Object DisplayName -Like '*CBIM*').Count } else { 0 }"), '0', 'Existing installation must not be replaced by acceptance');
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
const candidate = await download(version), old = await download(previousVersion);
async function setup(file, target) {
  await save(`install-intent-${target}`, {file, install, sha256: await sha(file), at: new Date().toISOString()});
  await new Promise((resolve, reject) => {
    const child = spawn(file, ['/S', `/D=${install}`], {windowsHide: true, env, stdio: 'ignore'});
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`NSIS exit ${code}`)));
  });
  assert.equal(JSON.parse(await fs.readFile(path.join(install, 'resources/desktop-release.json'), 'utf8')).version, target);
}
// 只读 NSIS 实际落盘的缓存，不从测试下载目录复制/补造旧包；配置路径缺失必须留下明确证据。
async function recordInstallerCache(stage) {
  const config = parse(await fs.readFile(path.join(install, 'resources/app-update.yml'), 'utf8'));
  assert.match(config.updaterCacheDirName, /^[a-z0-9-]+$/);
  const entries = [];
  for (const name of new Set([config.updaterCacheDirName, 'cbim-assistant-updater'])) {
    const file = path.join(process.env.LOCALAPPDATA, name, 'installer.exe');
    const stat = await fs.stat(file).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    entries.push({directory: name, configured: name === config.updaterCacheDirName, exists: !!stat, ...(stat ? {bytes: stat.size, sha256: await sha(file)} : {})});
  }
  const result = {configuredDirectory: config.updaterCacheDirName, entries};
  await save(`installer-cache-${stage}`, result); return result;
}
let app, requests = 0, differential, freshEngine; const errors = [], phases = [], resourcePrelude = [], checkRetries = [], processLifecycle = [];
// 仅观察已核实安装路径的 PID。已退出返回成功；不按进程名关闭或终止其它进程。
async function waitForDesktopExit(pid, {signal, timeoutMs}) {
  const script = fileURLToPath(new URL('./desktop-acceptance-process.ps1', import.meta.url));
  await promisify(execFile)('pwsh.exe', ['-NoProfile','-NonInteractive','-File',script,
    '-TargetProcessId',String(pid),'-ExpectedPath',exe,'-TimeoutMilliseconds',String(timeoutMs)],
    {windowsHide: true, signal, timeout: timeoutMs + 5000});
}
function ownProcess(pid, transport) {
  return new DesktopAcceptanceProcess({pid, transport, waitForExit: waitForDesktopExit,
    record: event => processLifecycle.push(event)});
}
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
  assert.ok(!app, 'Previous desktop connection must be released before launch');
  const launched = await electron.launch({executablePath: exe, env: {...env, CBIM_USER_DATA_ROOT: profile}, timeout: 60000});
  try {
    app = await ownLaunchedDesktop(launched, {executablePath: exe, waitForExit: waitForDesktopExit,
      record: event => processLifecycle.push(event)});
  } catch(error) { await launched.close().catch(()=>{}); throw error; }
  if (mode === 'online' && previousUpdateFlow === 'prefetch') await observeUpdaterNetwork(app);
  const page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', {name: '用户菜单', exact: true}).waitFor(); return page;
}
async function close() {
  const current = app;
  try { await current?.close(); } finally { app = undefined; }
}
async function exitAfter(action, reason) {
  const current = app;
  try { return await current.exitAfter(action, reason); } finally { app = undefined; }
}
async function waitPhase(page, phase, interval = 1000) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const value = await status(page); phases.push({version: value.currentVersion, phase: value.phase,...(value.error?{error:value.error}:{})});
    if (value.error) {
      if(!acceptanceCanAwaitCheckRetry(value,phase))throw Error(value.error);
      if(checkRetries.at(-1)?.checkedAt!==value.checkedAt){checkRetries.push({version:value.currentVersion,phase:value.phase,checkedAt:value.checkedAt,error:value.error});await save('automatic-check-retries',checkRetries)}
    } else if (value.phase === phase) return value;
    await pause(interval);
  } throw Error(`Update timeout: ${phase}`);
}
// R 与 C 都由真实 UI 重启；只定位本验收安装路径的新主进程。
async function findRestart(oldPid, requireUpdated, evidenceName) {
  const quoted = exe.replaceAll("'", "''"); let restarted;
  for (let n = 0; n < 120; n++) {
    const text = ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${quoted}' -and $_.ProcessId -ne ${oldPid} ${requireUpdated ? "-and $_.CommandLine -like '*--updated*'" : ''} -and $_.CommandLine -notlike '*--type=*' } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`);
    if (text) { restarted = JSON.parse(text); break; } await pause(1000);
  }
  assert.ok(restarted); assert.ok(!Array.isArray(restarted));
  if (requireUpdated) assert.ok(restarted.CommandLine.toLowerCase().includes(userRoot.toLowerCase()));
  await save(evidenceName, restarted);
  return restarted;
}
async function observeRestart(oldPid, requireUpdated, evidenceName) {
  const restarted=await findRestart(oldPid,requireUpdated,evidenceName),quoted=exe.replaceAll("'","''");
  await pause(15000);
  assert.ok(!app);
  app=ownProcess(restarted.ProcessId, {
    evaluate(){throw Error('Native installation restart has no debugger')},
    firstWindow(){throw Error('Native installation restart has no debugger')},
    quit:async()=>{ps(`$p=Get-Process -Id ${restarted.ProcessId}; if ($p.Path -ne '${quoted}' -or $p.MainWindowHandle -eq 0) { throw 'Restarted app identity/window mismatch' }; if (-not $p.CloseMainWindow()) { throw 'Normal close refused' }`)},
    disconnect:async()=>{},
  });
  await close();
  return restarted;
}
// 原生资源重启后直接接回同一进程：先接主进程网络观测，再接页面，避免下载发生在无人观测的交接窗口。
async function attachResourceRestart(restarted) {
  let inspector,browser,browserEndpoint;const deadline=Date.now()+60000;
  try {
    while(Date.now()<deadline&&(!inspector||!browserEndpoint)){
      const ports=JSON.parse(ps(`@(Get-NetTCPConnection -OwningProcess ${restarted.ProcessId} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique) | ConvertTo-Json -Compress`)||'[]');
      for(const port of Array.isArray(ports)?ports:[ports]){
        const base=`http://127.0.0.1:${port}`;
        const targets=await fetch(base+'/json/list',{signal:AbortSignal.timeout(1000)}).then(r=>r.ok?r.json():[]).catch(()=>[]);
        const target=Array.isArray(targets)?targets.find(item=>item.type==='node'):undefined;
        if(target&&!inspector){
          inspector=await connectDesktopInspector(target.webSocketDebuggerUrl);
          assert.equal(await inspector.evaluate('process.pid'),restarted.ProcessId);
          assert.equal(await inspector.evaluate("require('electron').app.getPath('exe')"),exe);
          const evaluate=fn=>inspector.evaluate(`(${fn.toString()})(require('electron'))`);
          await observeUpdaterNetwork({evaluate});
          await save('resource-restart-observer',{processId:restarted.ProcessId,attachedAt:new Date().toISOString()});
        }else if(!target&&!browserEndpoint){
          const version=await fetch(base+'/json/version',{signal:AbortSignal.timeout(1000)}).then(r=>r.ok?r.json():{}).catch(()=>({}));
          if(version.webSocketDebuggerUrl?.includes('/devtools/browser/'))browserEndpoint=version.webSocketDebuggerUrl;
        }
      }
      if(!inspector||!browserEndpoint)await pause(100);
    }
    assert.ok(inspector&&browserEndpoint,'Restarted desktop debug endpoints not available');
    browser=await chromium.connectOverCDP(browserEndpoint);
    app=ownProcess(restarted.ProcessId, {
      evaluate:fn=>inspector.evaluate(`(${fn.toString()})(require('electron'))`),
      async firstWindow(){const context=browser.contexts()[0];return context.pages()[0]??await context.waitForEvent('page')},
      async quit(){
        // 使用与 ElectronApplication.close 相同的正常退出入口，由所有者统一释放连接和等待退出。
        await inspector.evaluate("((app)=>{setImmediate(()=>app.quit())})(require('electron').app);undefined");
      },
      async disconnect(){ try { await inspector.close(); } finally { await browser.close(); } },
    });
    const page=await app.firstWindow();
    page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
    await page.getByRole('button',{name:'用户菜单',exact:true}).waitFor();return page;
  }catch(error){
    // 连接只完成一半时也必须释放两端；清理异常不能掩盖最初失败。
    if(app?.pid===restarted.ProcessId)await close().catch(()=>{});
    else await Promise.allSettled([Promise.resolve().then(()=>inspector?.close()),Promise.resolve().then(()=>browser?.close())]);
    throw error;
  }
}
async function prepareColdUpgrade(page) {
  let ready = await waitPhase(page, 'ready');
  const target = acceptanceReadyTarget(ready, previousVersion, version);
  if (target.kind === 'resources') {
    await save('resource-prelude-ready', ready);
    await page.getByRole('button', {name:'版本与更新',exact:true}).hover();
    await page.screenshot({path:path.join(root,'resource-prelude-ready.png')});
    // 准备资源不会激活；普通退出后仍是原 R，再显式点击旧版侧栏的就绪入口。
    await close(); page = await launch(); assert.equal((await status(page)).currentResourceVersion, ready.currentResourceVersion);
    const again = await waitPhase(page,'ready'); assert.deepEqual(acceptanceReadyTarget(again,previousVersion,version),target);
    await page.waitForFunction(()=>document.querySelector('.software-update-button')?.getAttribute('aria-disabled')==='false');
    const oldPid = await exitAfter(()=>page.getByRole('button',{name:'版本与更新',exact:true}).click(), 'resource-restart');
    const restarted = await findRestart(oldPid,false,'resource-prelude-restart');
    page=await attachResourceRestart(restarted); const activated=await status(page);
    assert.equal(activated.currentVersion,previousVersion); assert.equal(activated.currentResourceVersion,target.resourceVersion);
    assert.equal((await app.evaluate(({app})=>app.getPath('userData'))),path.join(userRoot,'desktop'));
    resourcePrelude.push({from:ready.currentResourceVersion,to:activated.currentResourceVersion,codeVersion:previousVersion,normalQuitDidNotApply:true,restarted});
    await save('resource-prelude',resourcePrelude);
    ready=await waitPhase(page,'ready');
  }
  assert.deepEqual(acceptanceReadyTarget(ready,previousVersion,version),{kind:'installer'});
  return {page,ready};
}
async function notes(page) {
  const snapshot = await status(page);
  if (snapshot.currentResourceVersion !== undefined) {
    assert.equal(snapshot.currentVersion, version); assert.equal(snapshot.currentResourceVersion, 1);
    assert.match(snapshot.currentNotes, /未签名/);
    const icon = page.getByRole('button', {name: '版本与更新', exact: true}); await icon.hover();
    const tooltip = page.getByRole('tooltip'); await tooltip.waitFor();
    assert.ok((await tooltip.innerText()).includes(`C ${version} · R 1`));
    await page.screenshot({path: path.join(root, `${mode}-notes.png`)}); await page.keyboard.press('Escape'); return;
  }
  await page.getByRole('button', {name: '用户菜单', exact: true}).click();
  const combined = page.getByRole('menuitem', {name: '版本与更新', exact: true});
  const title = await combined.count() ? '版本与更新' : '最近一次更新';
  await page.getByRole('menuitem', {name: title, exact: true}).click();
  const dialog = page.getByRole('dialog', {name: title, exact: true}); await dialog.waitFor();
  assert.ok((await dialog.innerText()).includes(`当前版本 ${version}`)); assert.match(await dialog.innerText(), /未签名/);
  await page.screenshot({path: path.join(root, `${mode}-notes.png`)}); await page.keyboard.press('Escape');
}
// 新版先显示窗口再恢复工程；等待真实生命周期就绪，不用测试主动打开来掩盖恢复失败。
async function restoredCatalog(page, id) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const catalog = await page.evaluate(() => window.cbim.call('list'));
    if (catalog.entries.some(item => item.id === id && item.state === 'running' && item.instanceId)) return catalog;
    await pause(500);
  }
  throw Error('Original workspace did not restore after the update');
}
// 读取已安装 Pi 的原共享目录和文件元数据；升级不能重写安装清单或以重新解压掩盖缓存丢失。
async function retainedEngineSnapshot(page) {
  const initial=JSON.parse(JSON.parse(await fs.readFile(path.join(install,'resources/runtime-initial.json'),'utf8')).payload);
  const descriptor=initial.engines.find(engine=>engine.kind==='pi');assert.ok(descriptor?.adapter);
  const appData=await app.evaluate(({app})=>app.getPath('appData'));
  const identity=createHash('sha256').update(path.resolve(exe).toLowerCase()+'\n'+path.resolve(userRoot).toLowerCase()).digest('hex').slice(0,24);
  const directory=path.join(appData,'CBIM-runtime',identity,'engines','packages',descriptor.package.sha256);
  const files=[];
  for(const item of descriptor.package.files){const file=path.join(directory,item.path),stat=await fs.stat(file);assert.equal(stat.size,item.bytes);assert.equal(await sha(file),item.sha256);files.push({path:item.path,bytes:stat.size,sha256:item.sha256,mtimeMs:stat.mtimeMs})}
  const state=await page.evaluate(()=>window.cbim.call('engines.settings'));
  const pi=state.items.find(item=>item.kind==='pi');assert.equal(pi?.active?.identity,descriptor.package.sha256);
  return {identity:descriptor.package.sha256,files,installation:await fs.readFile(path.join(userRoot,'engine-installations.json'),'utf8'),enabled:pi.enabled};
}
// 首次冷包必须从真实固定公开源取得 E；不写缓存、不改下载地址、不向客户端传入 GitHub 凭据。
async function verifyFreshEngine(page, profileRoot) {
  const initial = JSON.parse(JSON.parse(await fs.readFile(path.join(install, 'resources/runtime-initial.json'), 'utf8')).payload);
  const before = requests;
  const profile = {name:'Fresh engine acceptance',api:'openai-completions',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,auth:'none',defaultModel:'acceptance',models:[{id:'acceptance',name:'Acceptance',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false}]};
  await page.evaluate(profile => window.cbim.call('models.save',{profile}), profile);
  const workspace = path.join(root,'fresh-project'); await fs.mkdir(workspace);
  const entry = await page.evaluate(path => window.cbim.call('add',{path}), workspace);
  const run = await page.evaluate(id => window.cbim.call('loop.chat',{id,message:'Verify the downloaded engine.',options:{permission:'read',turnTimeoutMs:60000}}), entry.id);
  let summary;
  for (let attempt=0;attempt<360;attempt++) {
    summary=await page.evaluate(args=>window.cbim.call('loop.inspect',args),{id:entry.id,taskId:run.taskId,runId:run.runId});
    if(summary.status==='completed')break;
    if(['failed','interrupted','cancelled'].includes(summary.status))throw Error(JSON.stringify(summary));
    await pause(500);
  }
  assert.equal(summary.status,'completed');assert.equal(requests-before,1);
  const appData=await app.evaluate(({app})=>app.getPath('appData'));
  const identity=createHash('sha256').update(path.resolve(exe).toLowerCase()+'\n'+path.resolve(profileRoot).toLowerCase()).digest('hex').slice(0,24);
  const descriptor=initial.engines.find(engine=>engine.kind==='pi');assert.ok(descriptor);
  const directory=path.join(appData,'CBIM-runtime',identity,descriptor.adapter?'engines':version,'packages',descriptor.package.sha256);
  for(const file of descriptor.package.files){const target=path.join(directory,file.path);assert.equal((await fs.stat(target)).size,file.bytes);assert.equal(await sha(target),file.sha256)}
  const result={engine:'pi',version:descriptor.version,packageSha256:descriptor.package.sha256,filesVerified:descriptor.package.files.length,modelRequests:requests-before,taskId:run.taskId,runId:run.runId};
  await save('fresh-engine',result);return result;
}
let acceptanceError;
try {
  // 公开复验也先做独立全新安装，复用同一冻结制品；不为重验创建草稿或替换公开附件。
  {
    await setup(candidate, version);
    const cachedInstaller = (await recordInstallerCache('fresh')).entries.find(item => item.configured);
    assert.equal(cachedInstaller.sha256, expected, 'NSIS must populate the cache configured for differential updates');
    let page = await launch(path.join(root, 'fresh-user'));
    assert.equal((await status(page)).currentVersion, version); assert.equal((await status(page)).enabled, true); await notes(page);
    if((await status(page)).currentResourceVersion!==undefined)freshEngine=await verifyFreshEngine(page,path.join(root,'fresh-user'));
    await close();requests=0; // 全新安装与旧版迁移是两个独立 profile，分别记录模型请求计数。
  }
  await setup(old, previousVersion); const previousCache = await recordInstallerCache('previous');
  // 0.1.12 已修正 NSIS 缓存归属；先证明真实安装产生了准确旧包，不能手动补足差分前提。
  if (retentionChecks.installerCache) assert.equal(previousCache.entries.find(item => item.configured)?.sha256, await sha(old));
  let page = await launch(); assert.equal((await status(page)).currentVersion, previousVersion);
  const profile = {name: 'Release acceptance', api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, auth: 'none', defaultModel: 'acceptance', models: [{id: 'acceptance', name: 'Acceptance', enabled: true, contextWindow: 32768, maxTokens: 1024, reasoning: false, pricing: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}}]};
  const savedModels = await page.evaluate(profile => window.cbim.call('models.save', {profile}), profile);
  const workspace = path.join(root, 'project'); await fs.mkdir(workspace);
  const entry = await page.evaluate(path => window.cbim.call('add', {path}), workspace);
  // 0.1.7 的新增持久数据也必须沿真实旧版 IPC 创建；不能只证明旧聊天没有丢失。
  let priorMainSettings, priorAutomation;
  if (retentionChecks.mainAgentAndAutomation) {
    const opened = (await page.evaluate(() => window.cbim.call('list'))).entries.find(item => item.id === entry.id);
    assert.ok(opened?.instanceId);
    const identity = {workspaceId: entry.id, instanceId: opened.instanceId};
    const initial = await page.evaluate(args => window.cbim.call('agent.mainSettings', args), identity);
    priorMainSettings = await page.evaluate(args => window.cbim.call('agent.configureMain', args), {...initial, selection: {engine: 'pi', profileId: savedModels.selectedId, modelId: 'acceptance'}});
    priorAutomation = await page.evaluate(args => window.cbim.call('automation.save', args), {...identity, expectedRevision: 0, definition: {name: 'Retained manual automation', enabled: true, executor: {kind: 'main'}, moduleIds: [], workflowSelections: [], skillIds: [], prompt: 'Preserve this task without running it during upgrade.', permission: 'read', schedule: {kind: 'manual'}}});
    // save 返回内存对象，手动任务的 nextRunAt:undefined 不属于 JSON 持久格式。
    // 升级基线取旧版真实持久读取；先完整核对保存结果，再与新版逐字段比较，不忽略有效字段。
    const persistedAutomation = await page.evaluate(args => window.cbim.call('automation.list', args), identity);
    assert.deepEqual(persistedAutomation.jobs, [JSON.parse(JSON.stringify(priorAutomation))]);
    assert.deepEqual(persistedAutomation.runs, []);
    priorAutomation = persistedAutomation.jobs[0];
    assert.equal(priorAutomation.nextRunAt, undefined);
    await save('baseline-persistent-features', {mainAgent: priorMainSettings, automation: persistedAutomation});
    assert.equal(requests, 0);
  }
  const priorKnowledge = await page.evaluate(id => window.cbim.call('snapshot', {id}), entry.id);
  const businessFile = path.join(workspace, 'retained-business.txt'), businessText = 'Business data preserved from '+previousVersion;
  await fs.writeFile(businessFile, businessText);
  const run = await page.evaluate(id => window.cbim.call('loop.chat', {id, message: 'Record release acceptance.', options: {permission: 'ask', turnTimeoutMs: 60000}}), entry.id);
  let summary;
  for (let n = 0; n < 120; n++) {
    summary = await page.evaluate(args => window.cbim.call('loop.inspect', args), {id: entry.id, taskId: run.taskId, runId: run.runId});
    if (summary.status === 'completed') break; if (['failed', 'interrupted', 'cancelled'].includes(summary.status)) throw Error(JSON.stringify(summary)); await pause(500);
  }
  assert.equal(summary.status, 'completed'); assert.equal(requests, 1);
  let previousEngine;
  if(previousVersion==='0.1.17'){
    const state=await page.evaluate(()=>window.cbim.call('engines.settings'));
    await page.evaluate(revision=>window.cbim.call('engines.configure',{kind:'pi',revision,action:'disable'}),state.revision);
    previousEngine=await retainedEngineSnapshot(page);assert.equal(previousEngine.enabled,false);
    await save('engine-cache-before',previousEngine);
  }
  const marker = `from-${previousVersion}-to-${version}`;
  await page.evaluate(marker => localStorage.setItem('cbim.release-retention', marker), marker);
  await fs.writeFile(path.join(userRoot, 'acceptance-marker.txt'), marker);
  let restarted,installingPid;
  if (mode === 'candidate') { await close(); await setup(candidate, version); }
  else {
    const cache = path.join(process.env.LOCALAPPDATA, previousCache.configuredDirectory, 'pending', path.basename(candidate));
    if (previousUpdateFlow === 'prefetch') {
      // 不点检查或下载，也不替换网络：由真实上一安装版的原定时器发现并下载本次公开版本。
      const prepared = await prepareColdUpgrade(page); page=prepared.page; const ready=prepared.ready;
      assert.equal(requests,1,'Resource activation must not replay the completed model request');
      // 0.1.17 的侧栏图标直接安装；查看就绪时只悬停，不提前授权重启。
      if(previousVersion==='0.1.17'){
        await page.waitForFunction(()=>document.querySelector('.software-update-button')?.getAttribute('aria-disabled')==='false');
        await page.getByRole('button',{name:'版本与更新',exact:true}).hover();
        await page.getByRole('tooltip').waitFor();
      }else{
        await page.getByRole('button', {name: '查看更新', exact: true}).click();
        const dialog = page.getByRole('dialog', {name: '版本与更新', exact: true});
        await dialog.getByRole('button', {name: '重启安装', exact: true}).waitFor();
      }
      await page.screenshot({path: path.join(root, 'prefetch-ready.png')});
      await page.keyboard.press('Escape');
      await pause(3500); assert.equal((await status(page)).phase, 'ready');
      assert.equal(await app.evaluate(({app}) => app.getVersion()), previousVersion);
      const firstNetwork = await readUpdaterNetwork(app);
      differential = summarizeUpdaterNetwork(firstNetwork, path.basename(candidate));
      await save('online-differential', {summary: differential, records: firstNetwork, fullBytes: (await fs.stat(candidate)).size, installerSha256: await sha(cache)});
      if (transferExpectation === 'differential') {
        assert.ok(differential.ranges > 0); assert.equal(differential.fullDownloads, 0);
        assert.ok(differential.completedPayloadBytes > 0 && differential.completedPayloadBytes < (await fs.stat(candidate)).size);
      } else {
        assert.equal(differential.ranges, 0); assert.equal(differential.fullDownloads, 1);
        assert.equal(differential.completedPayloadBytes, (await fs.stat(candidate)).size);
      }
      assert.equal(await sha(cache), expected);
      await close(); await pause(3000);
      assert.equal(JSON.parse(await fs.readFile(path.join(install, 'resources/desktop-release.json'), 'utf8')).version, previousVersion);
      await save('normal-quit-cancelled', {previousVersion, previousUpdateFlow, cachedSha256: expected, at: new Date().toISOString()});
      page = await launch(); assert.equal((await status(page)).currentVersion, previousVersion);
      const cachedReady = await waitPhase(page, 'ready'); assert.equal(cachedReady.release.version, version);
      assert.equal(await sha(cache), expected);
      const cachedNetwork = await readUpdaterNetwork(app);
      const cachedSummary = summarizeUpdaterNetwork(cachedNetwork, path.basename(candidate));
      await save('online-cache-reuse', {summary: cachedSummary, records: cachedNetwork});
      assert.equal(cachedSummary.requests, 0);
      await save('online-install-intent', {from: previousVersion, to: version, previousUpdateFlow, sha256: expected, install, userRoot});
      if(previousVersion!=='0.1.17')await page.getByRole('button', {name: '查看更新', exact: true}).click();
      else await page.waitForFunction(()=>document.querySelector('.software-update-button')?.getAttribute('aria-disabled')==='false');
      // R4 关闭业务 IPC 后才交给固定壳安装；页面可能先关闭，不能继续查询已退出的业务状态。
      // 预先订阅实际进程关闭，再由下方检查 NSIS 新进程、版本与原目录，关闭本身不计为升级成功。
      installingPid=await exitAfter(()=>previousVersion==='0.1.17'
        ?page.getByRole('button',{name:'版本与更新',exact:true}).click()
        :page.getByRole('dialog', {name: '版本与更新', exact: true}).getByRole('button', {name: '重启安装', exact: true}).click(), 'installer-restart');
      await save('online-ui-install',{clicked:true,previousPid:installingPid,processClosed:true,at:new Date().toISOString()});
    } else {
    const available = await waitPhase(page, 'available'); assert.equal(available.release.version, version);
    const download = async () => {
      await page.getByRole('button', {name: '查看更新', exact: true}).click();
      // 0.1.0 的真实入口位于设置页 region；0.1.1 起改为独立 dialog，不把新界面套到历史安装包。
      const updateSurface = previousVersion === '0.1.0'
        ? page.getByRole('region', {name: '软件更新', exact: true})
        : page.getByRole('dialog', {name: '版本与更新', exact: true});
      await updateSurface.getByRole('button', {name: '下载更新', exact: true}).click();
      // 0.1.3 的 ready 立即进入 installing；观察真实自动安装进度，不寻找已移除的第二次点击。
      await waitPhase(page, previousUpdateFlow === 'automatic' ? 'installing' : 'ready', 100);
    };
    await download();
    // 独立取消场景：自动安装的两秒窗口内正常退出，不能先等待安装或改变产品计时器。
    await close(); await pause(3000);
    assert.equal(await sha(cache), expected);
    assert.equal(JSON.parse(await fs.readFile(path.join(install, 'resources/desktop-release.json'), 'utf8')).version, previousVersion);
    await save('normal-quit-cancelled', {previousVersion, previousUpdateFlow, cachedSha256: expected, at: new Date().toISOString()});
    page = await launch(); assert.equal((await status(page)).currentVersion, previousVersion);
    await waitPhase(page, 'available');
    await save('online-install-intent', {from: previousVersion, to: version, previousUpdateFlow, sha256: expected, install, userRoot});
    await download();
    assert.equal(await sha(cache), expected);
    installingPid=await exitAfter(async()=>{
      if (previousUpdateFlow === 'two-step') await page.getByRole('button', {name: '停止任务并重启安装', exact: true}).click();
    }, 'legacy-installer-restart');
    }
    // Playwright 在进程关闭后释放底层对象；使用点击前记录的原生 PID，不再访问已销毁连接。
    restarted = await observeRestart(installingPid,true,'online-restart');
  }
  page = await launch();
  const native = await app.evaluate(({app}) => ({version: app.getVersion(), packaged: app.isPackaged, exe: app.getPath('exe'), userData: app.getPath('userData')}));
  assert.equal(native.version, version); assert.equal(native.packaged, true); assert.equal(native.userData, path.join(userRoot, 'desktop'));
  assert.equal(await page.evaluate(() => localStorage.getItem('cbim.release-retention')), marker);
  assert.equal(await fs.readFile(path.join(userRoot, 'acceptance-marker.txt'), 'utf8'), marker);
  if(previousEngine){const retained=await retainedEngineSnapshot(page);assert.deepEqual(retained,previousEngine,'Cold upgrade must retain the disabled installation and exact shared engine files');await save('engine-cache-after',retained)}
  const models = await page.evaluate(() => window.cbim.call('models.list')); assert.deepEqual(models, savedModels);
  const catalog = await restoredCatalog(page,entry.id); assert.ok(catalog.entries.some(e => e.id === entry.id));
  const afterKnowledge = await page.evaluate(id => window.cbim.call('snapshot', {id}), entry.id);
  assert.equal(afterKnowledge.revision, priorKnowledge.revision); assert.deepEqual(afterKnowledge.files, priorKnowledge.files);
  assert.equal(await fs.readFile(businessFile, 'utf8'), businessText);
  if (priorMainSettings) {
    const reopened = catalog.entries.find(item => item.id === entry.id); assert.ok(reopened?.instanceId);
    const identity = {workspaceId: entry.id, instanceId: reopened.instanceId};
    const settings = await page.evaluate(args => window.cbim.call('agent.mainSettings', args), identity);
    assert.equal(settings.revision, priorMainSettings.revision); assert.deepEqual(settings.selection, priorMainSettings.selection);
    const automation = await page.evaluate(args => window.cbim.call('automation.list', args), identity);
    assert.deepEqual(automation.jobs, [priorAutomation]); assert.deepEqual(automation.runs, []);
    await save('retained-017-features', {mainAgent: {revision: settings.revision, selection: settings.selection}, automation: {id: priorAutomation.id, revision: priorAutomation.revision, unchanged: true, runs: 0}, knowledgeRevision: afterKnowledge.revision, knowledgeFileCount: afterKnowledge.files.length, businessFileSha256: await sha(businessFile)});
  }
  const history = await page.evaluate(id => window.cbim.call('loop.list', {id}), entry.id); assert.equal(history.length, 1); assert.equal(history[0].task.taskId, run.taskId); assert.equal(history[0].runId, run.runId);
  summary = await page.evaluate(args => window.cbim.call('loop.inspect', args), {id: entry.id, taskId: run.taskId, runId: run.runId}); assert.equal(summary.status, 'completed'); assert.equal(requests, 1);
  await notes(page); assert.deepEqual(errors, []);
  const signature = ps(`(Get-AuthenticodeSignature -LiteralPath '${exe.replaceAll("'", "''")}').Status.ToString()`); assert.equal(signature, 'NotSigned');
  assert.equal((await status(page)).enabled, true);
  if (mode === 'online') { const current = await page.evaluate(() => window.cbim.call('desktop.updates.check')); assert.equal(current.phase, 'current'); }
  const installedCache = await recordInstallerCache('final');
  await close();
  await save('report', {success: true, mode, version, commit, installerSha256: expected, native, signature, from: previousVersion, previousUpdateFlow, resourcePrelude, checkRetries, transferExpectation, installedCache, freshInstall: true, freshEngine, onlineDiscoveryDownloadAndInstall: mode === 'online', normalQuitDidNotInstall: mode === 'online', backgroundPrefetchAndExplicitInstall: mode === 'online' && previousUpdateFlow === 'prefetch', differentialDownload: mode === 'online' && previousUpdateFlow === 'prefetch' && transferExpectation === 'differential', differential, retained: {workspace: true, model: true, completedConversation: true, localStorage: true, marker: true, knowledge: true, businessFile: true, engineInstallationAndCache: previousEngine ? true : 'not-applicable', mainAgentSettings: priorMainSettings ? true : 'not-applicable', automation: priorAutomation ? true : 'not-applicable', noReplay: true}, modelRequests: requests+(freshEngine?.modelRequests??0), migrationModelRequests: requests, restarted, pageErrors: errors, phases, completedAt: new Date().toISOString()});
  console.log(JSON.stringify({success: true, mode, version, sha256: expected, retained: true}));
} catch (error) {
  acceptanceError=error;
  let updateState;
  if (app) { try { const page = await app.firstWindow(); updateState = await status(page); await page.screenshot({path: path.join(root, 'failure.png')}); } catch { /* 保留原失败，诊断不能替代业务结果。 */ }
    try{await save('failure-network',await readUpdaterNetwork(app))}catch{ /* 旧交互和未接入阶段可能没有网络记录。 */ }
  }
  await save('failure', {error: String(error), stack: error.stack, phases, requests, pageErrors: errors, updateState}); throw error;
}
finally {
  try { await close(); }
  catch(error){ await save('cleanup-failure',{error:String(error)}); if(!acceptanceError)throw error; }
  finally {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    await save('process-lifecycle',processLifecycle);
  }
}
