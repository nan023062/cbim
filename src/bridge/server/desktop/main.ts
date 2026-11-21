import { navigationChangeSchema } from '../../../logic-new/projects/navigation-contract';

/** 新桌面宿主负责窗口、应用生命周期和启动确认。 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

import path from 'node:path';

import fs from 'node:fs/promises';

import type { DesktopRuntimeHost } from '../../../logic-new/updates/service/runtime-host';

import { PluginInstallations } from '../../../logic-new/resource-management/plugin-installations';

import { managedConnectorPackages } from '../../../logic/application/assembly/connector-packages';

import { agentConfigurationSchema, agentSettingsTargetSchema } from '../../../logic-new/projects/agent-configuration';

import { officeQueueActionSchema } from '../../../logic-new/projects/office-queue-contract';

import { businessChangeSchema } from '../../../logic-new/projects/business-contract';

import { organizationChangeSchema } from '../../../logic-new/projects/organization-contract';

import { dataArchitectureChangeSchema } from '../../../logic-new/projects/data-architecture-contract';

import { z } from 'zod';

import { Application } from '../../../logic-new/application';

import { LlmProfiles } from '../../../logic-new/models/service';

import { systemSecretCipher } from '../../../core/io/electron';

import { modelActionSchemas } from '../../contracts/desktop-models';

import { EnginePackages } from '../../../logic-new/engines/packages';

import { engineCatalog } from '../../../logic-new/resource-management/engine-catalog';

import { engineDescriptor, loopEngineSchema } from '../../../logic-new/engines';

import { runOfficePlugin } from './office-plugin';

import { createMonitorOpener } from './monitor-window';

import { updateUserRoot } from '../../../logic-new/updates/service/restart-profile';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;

declare const MAIN_WINDOW_VITE_NAME: string;

interface StartupHost
{
  engineArtifacts?: ConstructorParameters<typeof EnginePackages>[1];

  downloads?: DesktopRuntimeHost['downloads'];

  Updates?: DesktopRuntimeHost['Updates'];

  cacheRoot: string;

  Confirm(): void;

  StopPreparingEngines(): void;
}

export function startDesktop(host?: StartupHost)
{
  const userRoot = updateUserRoot(process.argv, process.env.CBIM_USER_DATA_ROOT) ?? path.join(app.getPath('home'), '.cbim');

  const desktopRoot = path.join(userRoot, 'desktop');

  app.setPath('userData', desktopRoot);

  app.setPath('sessionData', desktopRoot);

  const profiles = new LlmProfiles(path.join(userRoot, 'llm.json'), systemSecretCipher);

  const packages = host?.engineArtifacts && new EnginePackages(path.join(userRoot, 'engine-installations.json'), host.engineArtifacts);

  const connectorRuntime = host?.engineArtifacts && managedConnectorPackages(path.join(userRoot, 'connector-installations.json'), host.engineArtifacts);

  const application = new Application({
    userRoot,
    installRoot: app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
    protectedRoots: host ? [host.cacheRoot] : [],
  }, host?.engineArtifacts, packages ? (...args) => runOfficePlugin(packages, profiles, ...args, async (call, root, signal) => { signal.throwIfAborted(); if (!window || window.isDestroyed()) return false; const result = await dialog.showMessageBox(window, { type: 'question', title: 'Office 操作审批', message: '允许本次 ' + call.name + ' 操作？', detail: '工作目录：' + root + '\n\n' + JSON.stringify(call.input, null, 2), buttons: ['拒绝', '允许本次'], defaultId: 0, cancelId: 0, noLink: true, signal }); return !signal.aborted && result.response === 1; }, connectorRuntime) : undefined);

  const brands = new Map<string,
    {
      name: string;

      logo: string
    }>(engineCatalog.map(product => [product.id, { name: product.label, logo: product.logo }]));

  let window: BrowserWindow | undefined;

  const connectors = connectorRuntime?.manager;

  let updates: ReturnType<DesktopRuntimeHost['Updates']> | undefined;

  const changed = () => { if (window && !window.isDestroyed()) window.webContents.send('downloads:changed'); };

  const unsubscribe = host?.downloads?.Subscribe(changed);

  let closing = false;

  let closed = false;

  const installations = new PluginInstallations(path.join(userRoot, 'pending-plugin-installs'), { engine: packages, connector: connectors }, () => closing, changed);

  app.on('before-quit', event => { if (closed) return; event.preventDefault(); if (closing) return; closing = true; unsubscribe?.(); updates?.Close(); host?.StopPreparingEngines(); application.Shutdown().then(() => { closed = true; app.quit(); }).catch(error => { console.error(error); app.exit(1); }); });

  app.on('window-all-closed', () => app.quit());

  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });

  app.whenReady().then(async () => { if (closing) return; app.setAppUserModelId('com.cbim.assistant.desktop'); await application.Init(); if (closing) return; window = new BrowserWindow({ width: 1320, height: 860, title: 'CBIM', autoHideMenuBar: true, ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#202124', symbolColor: '#eeeeee', height: 32 } } : {}), webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }, }); window.on('closed', () => { window = undefined; }); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault()); const handle = (channel: string, run: (value: unknown) => unknown) => ipcMain.handle(channel, (event, value) => { if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的桌面窗口'); return run(value); }); handle('downloads:list', () => host?.downloads?.Snapshot() ?? []); handle('downloads:cancel', value => host?.downloads?.Cancel(z.string().regex(/^[a-f0-9]{64}$/).parse(value))); handle('agent:members', value => application.offices.settings.Members(z.string().parse(value))); handle('project:organization', value => { const { project, change } = z.object({ project: z.string().min(1).max(160), change: organizationChangeSchema.optional() }).strict().parse(value); return change ? application.offices.settings.organization.Change(project, change) : application.offices.settings.organization.Read(project); }); handle('project:business', value => { const { project, change } = z.object({ project: z.string().min(1).max(160), change: businessChangeSchema.optional() }).strict().parse(value); return change ? application.offices.business.Change(project, change) : application.offices.business.Read(project); }); application.officeQueue.Progress = (project, session, sample) => { if (window && !window.isDestroyed()) window.webContents.send('office:progress', { project, session, ...sample }); }; handle('office:queue', value => { const { project, session, action } = z.object({ project: z.string().min(1).max(160), session: z.string().uuid(), action: officeQueueActionSchema.optional() }).strict().parse(value); return action ? application.officeQueue.Change(project, session, action) : application.officeQueue.Read(project, session); }); handle('office:insert', value => { const { project, session, text } = z.object({ project: z.string().min(1).max(160), session: z.string().uuid(), text: z.string().trim().min(1).max(32000) }).strict().parse(value); return application.offices.Insert(project, session, text); }); handle('project:data-architecture', value => { const { project, change } = z.object({ project: z.string().min(1).max(160), change: dataArchitectureChangeSchema.optional() }).strict().parse(value); return change ? application.dataArchitecture.Change(project, change) : application.dataArchitecture.Read(project); }); handle('agent:settings', value => { const { project, target, save } = z.object({ project: z.string(), target: agentSettingsTargetSchema, save: z.object({ revision: z.number().int().nonnegative(), configuration: agentConfigurationSchema }).strict().optional() }).strict().parse(value); return save ? application.offices.settings.Save(project, target, save.revision, save.configuration) : application.offices.settings.Read(project, target); }); handle('agent:connectors', async () => { if (!connectors) return []; await connectors.Init(); return (await connectors.Read()).items.map(item => ({ id: item.kind, name: item.kind, available: !!item.active && item.enabled })); }); handle('menu:connector', async value => { const { id, install } = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), install: z.boolean() }).parse(value); if (!connectors) throw Error('当前宿主未提供连接器目录'); await connectors.Init(); const snapshot = await connectors.Read(); const item = snapshot.items.find(v => v.kind === id); if (!item?.candidate) throw Error('没有可安装的兼容连接器'); if (install) { try { await installations.Install('connector', id, item.candidate.identity, snapshot.revision); } finally { changed(); } } return { installed: install || item.active?.identity === item.candidate.identity, identity: item.candidate.identity }; }); if (host?.Updates && app.isPackaged && process.platform === 'win32') { const release = await fs.readFile(path.join(process.resourcesPath, 'desktop-release.json'), 'utf8').then(JSON.parse).catch(() => undefined); const installed = process.arch === 'x64' && release?.version === app.getVersion() && release.channel === 'desktop-stable' && await fs.access(path.join(path.dirname(app.getPath('exe')), 'Uninstall CBIM Desktop.exe')).then(() => true, () => false); updates = host.Updates(async () => { host.StopPreparingEngines(); await application.Shutdown(); closed = true; }, installed); updates.Start(); } handle('menu:update', async value => { const action = z.enum(['status', 'check', 'download', 'install']).parse(value); if (!updates) return { phase: 'disabled' }; if (action === 'install' && updates.Status().phase === 'ready') { const answer = await dialog.showMessageBox(window!, { type: 'question', message: '重启 CBIM 并安装已下载的更新？', buttons: ['暂不重启', '重启安装'], defaultId: 0, cancelId: 0 }); if (answer.response === 1) await updates.Install(); } if (action === 'check') await updates.Check(); if (action === 'download') await updates.Download(); const state = updates.Status(); return { phase: state.phase, progress: state.progress, error: state.error, version: state.release?.version }; }); handle('menu:engine-catalog', () => engineCatalog.map(({ id, label, logo, businessTypes, supportedApis }) => ({ id, label, logo, businessTypes, supportedApis }))); handle('menu:engines', async raw => { const { action, target } = z.object({ action: z.enum(['list', 'check', 'install', 'configure']), target: z.unknown().optional() }).parse(raw); if (!packages) { if (action === 'list') return { managed: false, revision: 0, items: [] }; throw Error('当前宿主未提供签名引擎目录'); } await packages.Init(); if (action === 'check') await packages.Check(); if (action === 'install') { const candidate = z.object({ kind: loopEngineSchema, revision: z.number().int().nonnegative(), identity: z.string().regex(/^[a-f0-9]{64}$/) }).parse(target); try { await installations.Install('engine', candidate.kind, candidate.identity, candidate.revision); } finally { changed(); } } if (action === 'configure') { const config = z.object({ kind: loopEngineSchema, revision: z.number().int().nonnegative(), action: z.enum(['enable', 'disable', 'remove']) }).strict().parse(target); await packages.SetEnabled(config.kind, config.action === 'enable', config.action === 'remove', config.revision); } const settings = await packages.Read(); return { ...settings, items: settings.items.filter(item => item.candidate || item.active || item.installed.length).map(item => { const { label, supportedApis, fallbackApi } = engineDescriptor(item.kind); const artifact = item.candidate ?? item.active; const product = engineCatalog.find(p => p.id === item.kind); const logo = artifact?.plugin?.type === 'engine' && 'logo' in artifact.plugin ? String(artifact.plugin.logo) : product?.logo ?? engineCatalog.find(p => artifact?.plugin?.type === 'engine' && p.id === artifact.plugin.profile)?.logo; if (logo) brands.set(item.kind, { name: label, logo }); return { ...item, logo, label, requirement: { supportedApis, fallbackApi } }; }) }; }); handle('settings:model', raw => { const { action, input } = z.object({ action: z.enum(['models.list', 'models.save', 'models.remove', 'models.select', 'models.discoverDetails', 'models.testConnection']), input: z.unknown().optional() }).parse(raw); switch (action) { case 'models.list': modelActionSchemas[action].parse(input); return profiles.List(); case 'models.save': return profiles.Save(modelActionSchemas[action].parse(input)); case 'models.remove': return profiles.Remove(modelActionSchemas[action].parse(input).id); case 'models.select': return profiles.Select(modelActionSchemas[action].parse(input).id); case 'models.discoverDetails': return profiles.DiscoverDetails(modelActionSchemas[action].parse(input)); case 'models.testConnection': { const args = modelActionSchemas[action].parse(input); return args.kind === 'embedding' ? profiles.TestEmbedding(args.id, args.modelId) : profiles.Test(args.id, args.modelId, { supportedApis: [args.api], fallbackApi: args.api }); } } }); handle('menu:navigation', raw => raw === undefined ? application.navigation.Read() : application.navigation.Change(navigationChangeSchema.parse(raw))); handle('project:reveal', async raw => { const id = z.string().regex(/^[a-f0-9]{64}$/).parse(raw); const entry = (await application.projects.Read()).entries.find(item => item.id === id); if (!entry) throw Error('项目未登记'); const error = await shell.openPath(entry.path); if (error) throw Error(error); }); handle('menu:projects', async () => (await application.projects.Read()).entries); handle('office:turn', raw => { const { project, session, file } = z.object({ project: z.string(), session: z.string().uuid(), file: z.string().max(160).regex(/^[a-zA-Z0-9_-]+\.json$/) }).parse(raw); return application.offices.ReadTurn(project, session, file); }); handle('office:open', input => { const { project, action, session } = z.object({ project: z.string(), action: z.enum(['latest', 'select', 'create']), session: z.string().uuid().optional() }).parse(input); return application.offices.Open(project, action, session); }); handle('office:stop', input => { const { project, session } = z.object({ project: z.string(), session: z.string().uuid() }).parse(input); return application.officeQueue.Change(project, session, { action: 'stop' }); }); handle('office:send', input => { const { project, session, text, permission, selection } = z.object({ project: z.string(), session: z.string().uuid(), text: z.string().max(32000), selection: z.object({ engine: z.string().min(1).max(48), profileId: z.string().uuid(), modelId: z.string().trim().min(1).max(160) }), permission: z.enum(['read', 'ask', 'execute']).default('ask') }).parse(input); return application.offices.Send(project, session, text, sample => window?.webContents.send('office:progress', { project, session, ...sample }), permission, selection); }); handle('menu:add-project', async () => { const choice = await dialog.showOpenDialog(window!, { properties: ['openDirectory'], title: '选择项目目录' }); if (choice.canceled || !choice.filePaths.length) return null; await application.projects.Init(); const entry = await application.projects.Add(choice.filePaths[0]); const navigation = await application.navigation.Read(); if (navigation.projects.find(project => project.id === entry.id)?.removed) await application.navigation.Change({ revision: navigation.revision, project: entry.id, action: 'restore' }); return entry; }); handle('menu:resources', page => { if (page === 'engines' || page === 'connectors') return application.discovery.Plugins(page === 'engines' ? 'engine' : 'connector'); if (page === 'talent' || page === 'templates') return application.discovery.Library(page); throw new Error('未知资源分类'); }); handle('menu:monitor', () => application.monitor.GetSnapshot()); handle('menu:open-monitor', createMonitorOpener(window, application, kind => kind ? brands.get(kind) : undefined)); if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL); else await window.loadFile(path.join(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME, 'index.html')); if (closing || !window) return; if (!await window.webContents.executeJavaScript("document.getElementById('application-home') !== null")) throw new Error('应用首页未完成加载'); host?.Confirm(); void installations.Restore().catch(console.error); }).catch(error => { if (!closing) { console.error(error); app.exit(1); } });
}
