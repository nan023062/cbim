/** 新桌面宿主负责窗口、应用生命周期和启动确认。 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import path from 'node:path';

import { z } from 'zod';

import { Application } from '../../../logic-new/application';

import { LlmProfiles } from '../../../logic/models/service';

import { systemSecretCipher } from '../../../core/io/electron';

import { modelActionSchemas } from '../../contracts/desktop-models';

import { EnginePackages } from '../../../logic/engines/packages';

import { engineDescriptor, loopEngineSchema } from '../../../logic/engines';

import { desktopOfficeChat } from './office-chat';

import { createMonitorOpener } from './monitor-window';

import { updateUserRoot } from '../../../logic/updates/service/restart-profile';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;

declare const MAIN_WINDOW_VITE_NAME: string;

interface StartupHost
{
  engineArtifacts?: ConstructorParameters<typeof EnginePackages>[1];

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

  const application = new Application({
    userRoot,
    installRoot: app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
    protectedRoots: host ? [host.cacheRoot] : [],
  }, host?.engineArtifacts, desktopOfficeChat(profiles, packages));

  let window: BrowserWindow | undefined;

  let closing = false;

  let closed = false;

  app.on('before-quit', event => { if (closed) return; event.preventDefault(); if (closing) return; closing = true; host?.StopPreparingEngines(); application.Shutdown().then(() => { closed = true; app.quit(); }).catch(error => { console.error(error); app.exit(1); }); });

  app.on('window-all-closed', () => app.quit());

  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });

  app.whenReady().then(async () => { if (closing) return; app.setAppUserModelId('com.cbim.assistant.desktop'); await application.Init(); if (closing) return; window = new BrowserWindow({ width: 1320, height: 860, title: 'CBIM', autoHideMenuBar: true, ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#202124', symbolColor: '#eeeeee', height: 32 } } : {}), webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }, }); window.on('closed', () => { window = undefined; }); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault()); const handle = (channel: string, run: (value: unknown) => unknown) => ipcMain.handle(channel, (event, value) => { if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的桌面窗口'); return run(value); }); handle('menu:engines', async raw => { const { action, target } = z.object({ action: z.enum(['list', 'check', 'install']), target: z.unknown().optional() }).parse(raw); if (!packages) { if (action === 'list') return { managed: false, revision: 0, items: [] }; throw Error('当前宿主未提供签名引擎目录'); } await packages.Init(); if (action === 'check') await packages.Check(); if (action === 'install') { const candidate = z.object({ kind: loopEngineSchema, revision: z.number().int().nonnegative(), identity: z.string().regex(/^[a-f0-9]{64}$/) }).parse(target); await packages.Install(candidate.kind, candidate); } const settings = await packages.Read(); return { ...settings, items: settings.items.map(item => { const { label, supportedApis, fallbackApi } = engineDescriptor(item.kind); return { ...item, label, requirement: { supportedApis, fallbackApi } }; }) }; }); handle('settings:model', raw => { const { action, input } = z.object({ action: z.enum(['models.list', 'models.save', 'models.remove', 'models.select', 'models.discoverDetails', 'models.testConnection']), input: z.unknown().optional() }).parse(raw); switch (action) { case 'models.list': modelActionSchemas[action].parse(input); return profiles.List(); case 'models.save': return profiles.Save(modelActionSchemas[action].parse(input)); case 'models.remove': return profiles.Remove(modelActionSchemas[action].parse(input).id); case 'models.select': return profiles.Select(modelActionSchemas[action].parse(input).id); case 'models.discoverDetails': return profiles.DiscoverDetails(modelActionSchemas[action].parse(input)); case 'models.testConnection': { const args = modelActionSchemas[action].parse(input); return args.kind === 'embedding' ? profiles.TestEmbedding(args.id, args.modelId) : profiles.Test(args.id, args.modelId, { supportedApis: [args.api], fallbackApi: args.api }); } } }); handle('menu:projects', async () => (await application.projects.Read()).entries); handle('office:open', input => { const { project, action, session } = z.object({ project: z.string(), action: z.enum(['latest', 'select', 'create']), session: z.string().uuid().optional() }).parse(input); return application.offices.Open(project, action, session); }); handle('office:stop', input => { const { project, session } = z.object({ project: z.string(), session: z.string().uuid() }).parse(input); application.offices.Stop(project, session); }); handle('office:send', input => { const { project, session, text, permission, selection } = z.object({ project: z.string(), session: z.string().uuid(), text: z.string().max(32000), selection: z.object({ engine: z.string().max(48).optional(), profileId: z.string().uuid().optional(), modelId: z.string().min(1).max(160).optional() }).optional(), permission: z.enum(['read', 'ask', 'execute']).default('ask') }).parse(input); return application.offices.Send(project, session, text, sample => window?.webContents.send('office:progress', { project, session, ...sample }), permission, selection); }); handle('menu:add-project', async () => { const choice = await dialog.showOpenDialog(window!, { properties: ['openDirectory'], title: '选择项目目录' }); if (choice.canceled || !choice.filePaths.length) return null; await application.projects.Init(); return application.projects.Add(choice.filePaths[0]); }); handle('menu:resources', page => { if (page === 'engines' || page === 'connectors') return application.discovery.Plugins(page === 'engines' ? 'engine' : 'connector'); if (page === 'talent' || page === 'templates') return application.discovery.Library(page); throw new Error('未知资源分类'); }); handle('menu:monitor', () => application.monitor.GetSnapshot()); handle('menu:open-monitor', createMonitorOpener(window, application)); if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL); else await window.loadFile(path.join(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME, 'index.html')); if (closing || !window) return; if (!await window.webContents.executeJavaScript("document.getElementById('application-home') !== null")) throw new Error('应用首页未完成加载'); host?.Confirm(); }).catch(error => { if (!closing) { console.error(error); app.exit(1); } });
}
