/**
 * 作用定位：桌面启动装配函数，连接 Application、主窗口及页面就绪确认。
 * 设计原因：由可信 Electron 入口统一装配窗口、IPC 与应用生命周期，页面只提交受限命令。
 */
import { navigationChangeSchema } from '../../../logic/projects/navigation-contract';

/** 新桌面宿主负责窗口、应用生命周期和启动确认。 */
import { localRegistry,registryPublication,registryVersion } from '../../../logic/resource-management';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

import path from 'node:path';

import fs from 'node:fs/promises';

import type { DesktopRuntimeHost } from '../../../logic/updates/service/runtime-host';

import { PluginInstallations } from '../../../logic/resource-management/plugin-installations';

import { managedConnectorPackages } from '../../../resource/connectors/connector-runtime';

import { agentConfigurationSchema, agentSettingsTargetSchema } from '../../../logic/projects/agent-configuration';

import { officeQueueActionSchema } from '../../../logic/projects/office-queue-contract';

import { businessChangeSchema } from '../../../logic/projects/business-contract';

import { organizationChangeSchema } from '../../../logic/projects/organization-contract';

import { z } from 'zod';

import { Application } from '../../../logic/application';

import { LlmProfiles } from '../../../logic/models/service';

import { systemSecretCipher } from '../../../core/io/electron';

import { modelActionSchemas, selectProviderConnection } from '../../contracts/desktop-models';

import { EnginePackages } from '../../../resource/engines';

import { engineCatalog } from '../../../logic/resource-management/engine-catalog';

import { engineDescriptor, loopEngineSchema } from '../../../logic/engines';

import { runOfficePlugin } from './office-plugin';

import { createMonitorOpener } from './monitor-window';

import { updateUserRoot } from '../../../logic/updates/service/restart-profile';

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
  }, host?.engineArtifacts, packages ? (...args) => runOfficePlugin(packages, profiles, ...args, async (call, root, signal) => { signal.throwIfAborted(); if (!window || window.isDestroyed()) return false; const result = await dialog.showMessageBox(window, { type: 'question', title: 'Office 操作审批', message: '允许本次 ' + call.name + ' 操作？', detail: '工作目录：' + root + '\n\n' + JSON.stringify(call.input, null, 2), buttons: ['拒绝', '允许本次'], defaultId: 0, cancelId: 0, noLink: true, signal }); return !signal.aborted && result.response === 1; }, connectorRuntime, app.isPackaged || process.env.CBIM_REGISTRY_PORT ? undefined : path.join(app.getAppPath(), 'node_modules/.cache/cbim/engine-adapters')) : undefined, async () => { if (!packages) return undefined; const items = (await packages.List()).filter(item => item.active || item.candidate || item.installed.length); const engine = items.find(item => item.active && item.enabled) ?? items[0]; if (!engine) return undefined; for (const profile of (await profiles.List()).profiles) { const model = profile.models.find(item => item.enabled && selectProviderConnection(profile, engineDescriptor(engine.kind), item.id)); if (model) return { engine: engine.kind, profileId: profile.id, modelId: model.id }; } return undefined; });

  const brands = new Map<string,
    {
      name: string;

      logo: string
    }>(engineCatalog.map(product => [product.id, { name: product.label, logo: product.logo }]));

  let picked:
    {
      attempt: string;

      directory: string;

      start: number
    } | undefined;

  let registered:
    {
      attempt: string;

      start: number
    } | undefined;

  let logWrites = Promise.resolve();

  function projectTiming(attempt: string, stage: string, at: number, start: number)
  {
    const line = JSON.stringify({ attempt, stage, at: new Date(at).toISOString(), elapsedMs: at - start });

    logWrites = logWrites.then(() => fs.appendFile(path.join(userRoot, 'project-add.jsonl'), line + '\n', 'utf8')).catch(error => console.warn('项目计时日志写入失败', error));
  }

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

  app.whenReady().then(async () => { if (closing) return; app.setAppUserModelId('com.cbim.assistant.desktop'); await application.Init(); if (closing) return; window = new BrowserWindow({ width: 1320, height: 860, title: 'CBIM', autoHideMenuBar: true, ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#202124', symbolColor: '#eeeeee', height: 32 } } : {}), webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }, }); window.on('closed', () => { window = undefined; }); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault()); const handle = (channel: string, run: (value: unknown) => unknown) => ipcMain.handle(channel, (event, value) => { if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的桌面窗口'); return run(value); }); const registry=()=>localRegistry(path.join(userRoot,'registry-cache'),process.env.CBIM_REGISTRY_PORT,process.env.REGISTRY_TOKEN); handle('registry:list',()=>registry().List()); handle('registry:pull',raw=>registry().Pull(raw)); handle('registry:history',()=>registry().History());
    handle('registry:inventory',async ()=>{
      const entries=[];
      for(const kind of ['engine','connector'] as const){
        const manager=kind==='engine'?packages:connectors;
        if(!manager)continue;
        for(const item of (await manager.Read()).items){
          entries.push({kind,id:item.kind,installed:item.installed.map(x=>({version:x.version,identity:x.identity})),candidate:item.candidate?.identity});
        }
      }
      return entries;
    });
    handle('registry:plugin',async raw=>{
      const {project,version:row,action}=z.object({project:z.string().regex(/^[a-f0-9]{64}$/).optional(),version:registryVersion,action:z.enum(['read','install','remove'])}).strict().parse(raw);
      if(row.kind!=='engine'&&row.kind!=='connector')throw Error('请选择共享插件');
      const manager=row.kind==='engine'?packages:connectors;
      if(!manager)throw Error('当前宿主没有此类插件安装器');
      const id=row.kind==='engine'?loopEngineSchema.parse(row.id):row.id;
      const group=row.kind==='engine'?'engines':'connectors';
      const target=project?await application.projects.Open(project):undefined;
      const pins=await target?.references.Read();
      const pinned=pins?.items[group]?.[id];
      const snapshot=await manager.Read(),item=snapshot.items.find(x=>x.kind===id);
      const installed=item?.installed.some(x=>x.identity===row.sha256&&x.version===row.version)??false;
      const candidate=item?.candidate?.identity===row.sha256&&item.candidate.version===row.version;
      if(action==='read')return {installed,referenced:pinned===row.sha256,candidate,removed:!item?.installed.length};
      async function pin(from:string|undefined,to:string|undefined,revision:string|undefined){
        if(!target||!revision||from===to)return;
        const change=to?{action:from?'update' as const:'create' as const,kind:row.kind==='engine'?'engines' as const:'connectors' as const,id,digest:to,revision}:{action:'delete' as const,kind:row.kind==='engine'?'engines' as const:'connectors' as const,id,revision};
        return target.references.Change(change,items=>target.runtime.shared.Replace(items));
      }
      if(action==='install'){
        if(row.kind==='connector'&&target&&pinned!==row.sha256){
          const consent=await dialog.showMessageBox(window!,{type:'question',title:'连接器项目授权',message:'允许项目引用连接器 '+row.id+' v'+row.version+'？',detail:target.entry.name+' 将可选择此连接器。外部服务账号的登录与授权由连接器提供方处理。',buttons:['取消','允许此项目引用'],defaultId:0,cancelId:0,noLink:true});
          if(consent.response!==1)throw Error('已取消连接器项目授权');
        }
        if(!installed){
          if(!candidate)throw Error('版本不在当前签名安装清单');
          await registry().Pull(row);
          await installations.Install(row.kind,id,row.sha256,snapshot.revision);
        }
        await pin(pinned,row.sha256,pins?.revision);
        await registry().Remember(row,false);
        return {installed:true,referenced:!!target,candidate,removed:false};
      }
      if(!installed)throw Error('所选版本未安装');
      for(const entry of (await application.projects.Read()).entries){
        if(entry.id===project)continue;
        const other=await application.projects.Open(entry.id);
        if((await other.references.Read()).items[group]?.[id]===row.sha256)throw Error('另一个项目仍引用此版本：'+entry.name);
      }
      const fallback=item?.installed.filter(x=>x.identity!==row.sha256).sort((a,b)=>b.version.localeCompare(a.version,'en',{numeric:true}))[0]?.identity;
      const replacement=pinned===row.sha256?fallback:pinned;
      const switched=await pin(pinned,replacement,pins?.revision);
      try{await manager.RemoveVersion(id,row.sha256,snapshot.revision);}
      catch(error){if(switched)await pin(replacement,pinned,switched.revision);throw error;}
      await registry().Remember(row,true);
      return {installed:false,referenced:false,candidate,removed:!fallback};
    });
    handle('registry:import', async raw => {
      const {project,version:key,mode,choice}=z.object({project:z.string().regex(/^[a-f0-9]{64}$/),version:registryVersion,mode:z.enum(['import','preview','merge']).default('import'),choice:z.object({instance:z.string().uuid(),revision:z.number().int().nonnegative(),fields:z.array(z.string().max(300)).max(20000)}).strict().optional()}).strict().parse(raw);
      const template=await registry().ReadTemplate(key);
      if(key.kind!=='talent'&&key.kind!=='business')throw Error('请选择项目模板');
      return application.projects.MarketTemplate(project,key.kind,key,template,mode,choice);
    }); handle('registry:publish',async raw=>{const key=registryPublication.parse(raw);const choice=await dialog.showOpenDialog(window!,{properties:['openFile'],title:'选择发布到本机资源库的文件：'+key.id+' '+key.version,buttonLabel:'发布此文件'});return choice.canceled||!choice.filePaths[0]?null:registry().Publish(key,choice.filePaths[0]);}); handle('downloads:list', () => host?.downloads?.Snapshot() ?? []); handle('downloads:cancel', value => host?.downloads?.Cancel(z.string().regex(/^[a-f0-9]{64}$/).parse(value))); handle('agent:members', value => application.offices.settings.Members(z.string().parse(value))); handle('project:organization', value => { const { project, change } = z.object({ project: z.string().min(1).max(160), change: organizationChangeSchema.optional() }).strict().parse(value); return change ? application.offices.settings.organization.Change(project, change) : application.offices.settings.organization.Read(project); }); handle('project:business', value => { const { project, change } = z.object({ project: z.string().min(1).max(160), change: businessChangeSchema.optional() }).strict().parse(value); return change ? application.offices.business.Change(project, change) : application.offices.business.Read(project); }); application.officeQueue.Progress = (project, session, sample) => { if (window && !window.isDestroyed()) window.webContents.send('office:progress', { project, session, ...sample }); }; handle('office:queue', value => { const { project, session, action } = z.object({ project: z.string().min(1).max(160), session: z.string().uuid(), action: officeQueueActionSchema.optional() }).strict().parse(value); return action ? application.officeQueue.Change(project, session, action) : application.officeQueue.Read(project, session); }); handle('office:insert', value => { const { project, session, text } = z.object({ project: z.string().min(1).max(160), session: z.string().uuid(), text: z.string().trim().min(1).max(32000) }).strict().parse(value); return application.offices.Insert(project, session, text); }); handle('agent:settings', value => { const { project, target, save } = z.object({ project: z.string(), target: agentSettingsTargetSchema, save: z.object({ revision: z.number().int().nonnegative(), configuration: agentConfigurationSchema }).strict().optional() }).strict().parse(value); return save ? application.offices.settings.Save(project, target, save.revision, save.configuration) : application.offices.settings.Read(project, target); }); handle('agent:connectors', async () => { if (!connectors) return []; await connectors.Init(); return (await connectors.Read()).items.map(item => ({ id: item.kind, name: item.kind, available: !!item.active && item.enabled })); }); handle('menu:connector', async value => { const { id, install,digest } = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), install: z.boolean(),digest:z.string().regex(/^[a-f0-9]{64}$/) }).parse(value); if (!connectors) throw Error('当前宿主未提供连接器目录'); await connectors.Init(); const snapshot = await connectors.Read(); const item = snapshot.items.find(v => v.kind === id); if (!item?.candidate) throw Error('没有可安装的兼容连接器'); if (install) { if(digest!==item.candidate.identity)throw Error('请刷新商城后选择当前签名版本'); try { await installations.Install('connector', id, item.candidate.identity, snapshot.revision); } finally { changed(); } } return { installed: install || item.active?.identity === item.candidate.identity, identity: item.candidate.identity }; }); if (host?.Updates && app.isPackaged && process.platform === 'win32') { const release = await fs.readFile(path.join(process.resourcesPath, 'desktop-release.json'), 'utf8').then(JSON.parse).catch(() => undefined); const installed = process.arch === 'x64' && release?.version === app.getVersion() && release.channel === 'desktop-stable' && await fs.access(path.join(path.dirname(app.getPath('exe')), 'Uninstall CBIM Desktop.exe')).then(() => true, () => false); updates = host.Updates(async () => { host.StopPreparingEngines(); await application.Shutdown(); closed = true; }, installed); updates.Start(); } handle('menu:update', async value => { const action = z.enum(['status', 'check', 'download', 'install']).parse(value); if (!updates) return { phase: 'disabled' }; if (action === 'install' && updates.Status().phase === 'ready') { const answer = await dialog.showMessageBox(window!, { type: 'question', message: '重启 CBIM 并安装已下载的更新？', buttons: ['暂不重启', '重启安装'], defaultId: 0, cancelId: 0 }); if (answer.response === 1) await updates.Install(); } if (action === 'check') await updates.Check(); if (action === 'download') await updates.Download(); const state = updates.Status(); return { phase: state.phase, progress: state.progress, error: state.error, version: state.release?.version }; }); handle('menu:engine-catalog', () => engineCatalog.map(({ id, label, logo, businessTypes, supportedApis }) => ({ id, label, logo, businessTypes, supportedApis }))); handle('menu:engines', async raw => { const { action, target } = z.object({ action: z.enum(['list', 'check', 'install', 'configure']), target: z.unknown().optional() }).parse(raw); if (!packages) { if (action === 'list') return { managed: false, revision: 0, items: [] }; throw Error('当前宿主未提供签名引擎目录'); } await packages.Init(); if (action === 'check') await packages.Check(); if (action === 'install') { const candidate = z.object({ kind: loopEngineSchema, revision: z.number().int().nonnegative(), identity: z.string().regex(/^[a-f0-9]{64}$/) }).parse(target); try { await installations.Install('engine', candidate.kind, candidate.identity, candidate.revision); } finally { changed(); } } if (action === 'configure') { const config = z.object({ kind: loopEngineSchema, revision: z.number().int().nonnegative(), action: z.enum(['enable', 'disable', 'remove']) }).strict().parse(target); await packages.SetEnabled(config.kind, config.action === 'enable', config.action === 'remove', config.revision); } const settings = await packages.Read(); return { ...settings, items: settings.items.filter(item => item.candidate || item.active || item.installed.length).map(item => { const { label, supportedApis, fallbackApi } = engineDescriptor(item.kind); const artifact = item.candidate ?? item.active; const product = engineCatalog.find(p => p.id === item.kind); const logo = artifact?.plugin?.type === 'engine' && 'logo' in artifact.plugin ? String(artifact.plugin.logo) : product?.logo ?? engineCatalog.find(p => artifact?.plugin?.type === 'engine' && p.id === artifact.plugin.profile)?.logo; if (logo) brands.set(item.kind, { name: label, logo }); return { ...item, logo, label, requirement: { supportedApis, fallbackApi } }; }) }; }); handle('settings:model', raw => { const { action, input } = z.object({ action: z.enum(['models.list', 'models.save', 'models.remove', 'models.select', 'models.discoverDetails', 'models.testConnection']), input: z.unknown().optional() }).parse(raw); switch (action) { case 'models.list': modelActionSchemas[action].parse(input); return profiles.List(); case 'models.save': return profiles.Save(modelActionSchemas[action].parse(input)); case 'models.remove': return profiles.Remove(modelActionSchemas[action].parse(input).id); case 'models.select': return profiles.Select(modelActionSchemas[action].parse(input).id); case 'models.discoverDetails': return profiles.DiscoverDetails(modelActionSchemas[action].parse(input)); case 'models.testConnection': { const args = modelActionSchemas[action].parse(input); return args.kind === 'embedding' ? profiles.TestEmbedding(args.id, args.modelId) : profiles.Test(args.id, args.modelId, { supportedApis: [args.api], fallbackApi: args.api }); } } }); handle('menu:navigation', raw => raw === undefined ? application.navigation.Read() : application.navigation.Change(navigationChangeSchema.parse(raw))); handle('project:reveal', async raw => { const id = z.string().regex(/^[a-f0-9]{64}$/).parse(raw); const entry = (await application.projects.Read()).entries.find(item => item.id === id); if (!entry) throw Error('项目未登记'); const error = await shell.openPath(entry.path); if (error) throw Error(error); }); handle('menu:projects', async () => (await application.projects.Read()).entries); handle('office:turn', raw => { const { project, session, file } = z.object({ project: z.string(), session: z.string().uuid(), file: z.string().max(160).regex(/^[a-zA-Z0-9_-]+\.json$/) }).parse(raw); return application.offices.ReadTurn(project, session, file); }); handle('office:open', input => { const { project, action, session } = z.object({ project: z.string(), action: z.enum(['latest', 'select', 'create']), session: z.string().uuid().optional() }).parse(input); return application.offices.Open(project, action, session); }); handle('office:stop', input => { const { project, session } = z.object({ project: z.string(), session: z.string().uuid() }).parse(input); return application.officeQueue.Change(project, session, { action: 'stop' }); }); handle('office:send', input => { const { project, session, text, permission, selection } = z.object({ project: z.string(), session: z.string().uuid(), text: z.string().max(32000), selection: z.object({ engine: z.string().min(1).max(48), profileId: z.string().uuid(), modelId: z.string().trim().min(1).max(160) }), permission: z.enum(['read', 'ask', 'execute']).default('ask') }).parse(input); return application.offices.Send(project, session, text, sample => window?.webContents.send('office:progress', { project, session, ...sample }), permission, selection); }); handle('menu:pick-project', async () => { const choice = await dialog.showOpenDialog(window!, { properties: ['openDirectory'], title: '选择项目目录' }); if (choice.canceled || !choice.filePaths.length) return null; const attempt = crypto.randomUUID(), directory = choice.filePaths[0], start = Date.now(); picked = { attempt, directory, start }; projectTiming(attempt, 'directory_selected', start, start); return { attempt, name: path.basename(directory) }; }); handle('menu:add-project', async raw => { const attempt = z.string().uuid().parse(raw), pick = picked; if (!pick || pick.attempt !== attempt) throw Error('请重新选择项目目录'); picked = undefined; await application.projects.Init(); const entry = await application.projects.Add(pick.directory); const alias = await application.navigation.RevealRegistered(entry.id); registered = { attempt, start: pick.start }; projectTiming(attempt, 'registered', Date.now(), pick.start); return { ...entry, name: alias || entry.name }; }); handle('menu:project-displayed', raw => { const { attempt, at } = z.object({ attempt: z.string().uuid(), at: z.number().int().min(0).max(8640000000000000) }).parse(raw); if (registered?.attempt !== attempt) return; projectTiming(attempt, 'sidebar_displayed', at, registered.start); registered = undefined; }); handle('menu:monitor', () => application.monitor.GetSnapshot()); handle('menu:open-monitor', createMonitorOpener(window, application, kind => kind ? brands.get(kind) : undefined)); if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL); else await window.loadFile(path.join(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME, 'index.html')); if (closing || !window) return; if (!await window.webContents.executeJavaScript("document.getElementById('application-home') !== null")) throw new Error('应用首页未完成加载'); host?.Confirm(); void packages?.Check().catch(error => console.warn('后台引擎更新检查失败', error)); void installations.Restore().catch(console.error); }).catch(error => { if (!closing) { console.error(error); app.exit(1); } });
}
