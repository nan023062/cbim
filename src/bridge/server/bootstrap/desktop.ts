/**
 * 作用定位：固定冷壳的桌面启动入口，选择已签名资源、持有更新与引擎缓存，并把窄端口交给业务入口。
 * 设计原因：日常 TS / UI 更新不替换 Electron 或冷壳；启动失败先保留原数据，恢复界面不加载失败的业务代码。
 * 引擎目录和准备委托 ManagedEngines；对话菜单与执行工厂共享固定版本及在途下载。
 * 加载边界：唯一计算式应用入口由已验证清单固定为 .vite/build/main.js；依赖检查显式记录该装配边。
 */
import { app, dialog } from 'electron';

import fs from 'node:fs';

import path from 'node:path';

import { createHash } from 'node:crypto';

import { createRequire } from 'node:module';

import { selectBootResources } from './selection';

import { RuntimeJournal } from '../../../logic/updates/service/runtime-journal';

import { verifyRuntimeManifest, type ColdRuntime } from '../../../logic/updates/service/runtime-manifest';

import { EngineArtifacts } from '../../../logic/updates/service/engine-artifacts';

import { RuntimeStore } from '../../../logic/updates/service/runtime-store';

import { RuntimeUpdates } from '../../../logic/updates/service/runtime-updates';

import { DesktopUpdates } from '../../../logic/updates/service/desktop-updates';

import { NsisUpdateInstaller } from '../../../logic/updates/service/nsis-updater';

import { updateUserRoot } from '../../../logic/updates/service/restart-profile';

import type { DesktopRuntimeHost } from '../../../logic/updates/service/runtime-host';

const loadApplication = createRequire(__filename);

const configFile = path.join(__dirname, '../../runtime-cold.json');

/** 0.1.15–0.1.18 的既有资源身份：仅重验本地历史 E 来源，新 R 与远程 E 索引仍只接受当前公钥。 */
const historicalEngineKeys = ['-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEARyGX/2Q2gSX62kl4XtdXa7VlTlPv1M0oZanAtydMzrE=\n-----END PUBLIC KEY-----\n'];

/** 安装身份和用户数据身份共同隔离缓存；不会切换账号、默认用户目录或工作区。 */
function boot()
{
  if (!app.isPackaged)
  {
    const entry = path.join(__dirname, 'main.js');

    const implementation = loadApplication(entry) as
      {
        StartDesktop(runtime?: DesktopRuntimeHost): void
      };
    implementation.StartDesktop();

    return;
  }
  const cold: ColdRuntime = JSON.parse(fs.readFileSync(configFile, 'utf8'));

  if (cold.schema !== 1 || cold.codeVersion !== app.getVersion() || cold.platform !== process.platform + '-' + process.arch)

    throw Error('冷壳版本或平台不匹配');

  const userRoot = updateUserRoot(process.argv, process.env.CBIM_USER_DATA_ROOT) ?? path.join(app.getPath('home'), '.cbim');

  const identity = createHash('sha256').update(path.resolve(app.getPath('exe')).toLowerCase() + '\n' + path.resolve(userRoot).toLowerCase()).digest('hex').slice(0, 24);

  const cacheIdentityRoot = path.join(app.getPath('appData'), 'CBIM-runtime', identity);

  const cacheRoot = path.join(cacheIdentityRoot, cold.codeVersion);

  // 选择日志属于原用户身份，不放在可清理的下载缓存中；清缓存不能把已升级用户静默降回 R1。
  const stateDirectory = path.join(userRoot, 'desktop-runtime', identity, cold.codeVersion);

  // 沿用旧版 profile 身份取得 OS 单实例锁；这里只做冷壳互斥，不创建 BrowserWindow/session。
  // 验证过程同步完成，失败时在 Electron ready 前改到恢复 profile，候选尚未获得原数据访问权。
  app.setPath('userData', path.join(userRoot, 'desktop'));

  app.setPath('sessionData', path.join(userRoot, 'desktop'));

  if (!app.requestSingleInstanceLock())
  {
    app.quit();

    return;
  }
  // 前置校验完成后才导入业务代码；失败分支使用独立恢复 profile。
  const bundledRoot = path.join(process.resourcesPath, 'bundled-resources'),

    bundledManifest = path.join(process.resourcesPath, 'runtime-initial.json');

  let selection: ReturnType<typeof selectBootResources>;

  try
  {
    selection = selectBootResources(cold, cacheRoot, bundledRoot, bundledManifest, stateDirectory)
  }
  catch (error)
  {
    app.setPath('userData', path.join(cacheRoot, 'recovery-profile'));

    app.setPath('sessionData', path.join(cacheRoot, 'recovery-profile'));

    void app.whenReady().then(async () => { const initial = verifyRuntimeManifest(JSON.parse(fs.readFileSync(bundledManifest, 'utf8')), cold, { installed: true }); const journal = new RuntimeJournal(stateDirectory, { digest: initial.digest, resourceVersion: initial.manifest.resourceVersion }); let retry = false; try { retry = !!journal.Read().pending } catch { } const result = await dialog.showMessageBox({ type: 'error', title: 'CBIM 更新恢复', message: '更新尚未确认完成，已保留原用户数据。', detail: String(error) + '\n可以重试同一资源版本；不要删除用户数据或用旧代码强行打开。', buttons: retry ? ['退出', '重试原候选'] : ['退出'], defaultId: 0, cancelId: 0 }); if (retry && result.response === 1) { journal.RetryPending(); app.relaunch(); } app.exit(1); }).catch(error => { dialog.showErrorBox('CBIM 更新恢复失败', String(error)); app.exit(1) });

    return;
  }
  if (selection.pending)

    selection.journal.AccessData(selection.digest);

  app.setPath('userData', path.join(userRoot, 'desktop'));

  app.setPath('sessionData', path.join(userRoot, 'desktop'));

  const reuseRoots = fs.existsSync(cacheIdentityRoot) ? fs.readdirSync(cacheIdentityRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name)).map(entry => path.join(cacheIdentityRoot, entry.name)) : [];

  const store = new RuntimeStore(cacheRoot, cold),

    engineStore = new RuntimeStore(path.join(cacheIdentityRoot, 'engines'), cold, undefined, reuseRoots),

    controller = new AbortController();

  const preparation = new Map<string,
    {
      engine: string;

      version: string;

      progress?: number;

      error?: string
    }>();

  const engineArtifacts = new EngineArtifacts(path.join(userRoot, 'desktop-runtime', identity, 'engine-index.json'), engineStore, selection.envelope, controller.signal, undefined, (engine, version, progress, error) => { if (progress === undefined && !error) preparation.delete(engine); else preparation.set(engine, { engine, version, progress, error }) }, historicalEngineKeys);

  const host: DesktopRuntimeHost = {
    assetsRoot: selection.root, cacheRoot: cacheIdentityRoot, codeVersion: cold.codeVersion, resourceVersion: selection.manifest.resourceVersion,

    engineArtifacts,

    StopPreparingEngines()
    {
      controller.abort()
    },
    Updates(beforeInstall, enabled)
    {
      const installer = new RuntimeUpdates(store, selection.journal, selection.manifest, new NsisUpdateInstaller(), () => { app.relaunch(); app.exit(0) }, undefined, () => []);

      return new DesktopUpdates(cold.codeVersion, selection.manifest.notes, enabled, signal => installer.Latest(signal), installer, beforeInstall, selection.manifest.resourceVersion, () => [...preparation.values()]);
    },
    Confirm()
    {
      selection.journal.Confirm(selection.digest)
    },
  };
  app.on('will-quit', () => controller.abort());

  const entry = path.join(selection.root, '.vite/build/main.js');

  const implementation = loadApplication(entry) as
    {
      StartDesktop(runtime?: DesktopRuntimeHost): void
    };
  implementation.StartDesktop(host);
}
try
{
  boot()
}
catch (error)
{
  dialog.showErrorBox('CBIM 启动资源验证失败', String(error) + '\n未自动降级。请保留用户数据，重新安装兼容的正式版本以修复程序资源。');

  app.exit(1)
}
