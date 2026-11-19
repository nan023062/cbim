/**
 * 引擎菜单仅调用固定 status/prepare 端口；只允许主 Frame 和已签名版本，查看不安装。
 * 资源边界：业务规范随当前 R 的业务代码编译，窗口品牌仍按安装边界读取。
 * 原生窗口及页面标题显示 CBIM，原 productName/EXE/用户目录和更新通道保留兼容。
 * 文件工人边界：app.ready 后装配独立打包 utility 入口，不复用窗口主入口作为工人；退出等待所有原文件操作排空。
 * 作用定位：本机后端的 Electron 装配入口，区分开发与打包品牌资源路径，管理窗口、固定 IPC、原生文件选择、附件预览与打包验证；前端只通过 bridge/preload 请求服务。
 * 设计原因：把 Electron 窗口与 IPC 留在唯一桌面入口，服务层可以脱离窗口验证；模型凭据加密通过系统 safeStorage 注入；手动终端固定工作区目录，退出时释放子进程。
 * 附件边界：原生多选超过12项时在任何快照导入前拒绝；安全等待的 importId 贯穿选择器，取消后迟到路径不读取、不返回给另一目标。
 * GitHub 登录只在桌面点击后打开固定官方 Device Flow 页面，不接收重定向地址或令牌。
 * 桌面更新只装配在正式 NSIS 包中；后台检查、预下载并校验，等待用户确认重启后才拒绝新请求、排空业务并安装。
 * 资源入口：由固定冷壳调用 startDesktop；所有业务入口来自同一 R，先显示窗口再按原策略恢复工作区。
 * 窗口图标开发态读取 assets/branding，打包态保留 resources/branding，Forge 同源写入 EXE；保留原应用身份与卸载器名称以兼容更新。
 * 网页读取：ready 后注入独立匿名 Chromium 适配，仅静态读取不足时创建有界后台窗口，不共享应用登录态。
 */
import { parseIpcRequest, ipcSuccess } from '../contracts/ipc-call';

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';

import { createControlledFileTransport } from './platform/controlled-file-transport';

import path from 'node:path';

import fs from 'node:fs/promises';

import { TerminalSessions } from '../../logic/terminal/service/terminal';

import { Application } from './application';

import { ElectronBrowserReader } from '../../core/web/electron';

import { ChatInputs } from '../../logic/materials/service/chat-inputs';

import { systemSecretCipher } from '../../core/io/electron';

import { Paths } from '../../logic/workspace/service/paths';

import { json } from '../../core/io/serialization';

import { knowledgeTools } from '../../logic/tools/runtime/knowledge-tools';

import { DesktopUpdates } from '../../logic/updates/service/desktop-updates';

import { latestDesktopRelease } from '../../logic/updates/service/desktop-releases';

import { NsisUpdateInstaller } from '../../logic/updates/service/nsis-updater';

import { updateUserRoot } from '../../logic/updates/service/restart-profile';

import type { DesktopRuntimeHost } from '../../logic/updates/service/runtime-host';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;

declare const MAIN_WINDOW_VITE_NAME: string;

/** 只由可信启动器调用；runtime 是私有端口，不来自 renderer、模型或工作区配置。 */
export function startDesktop(runtime?: DesktopRuntimeHost)
{
  const terminals = new TerminalSessions();

  let application: Application;

  let quitting = false;

  let window: BrowserWindow;

  let updates: DesktopUpdates | undefined;

  let windowLoaded = false,
    rendererResponded = false,
    confirmed = false;

  // loadFile 成功还不足以证明 React 运行；同时等待挂载后的目录请求成功。
  const confirmStartup = () => { if (windowLoaded && rendererResponded && !confirmed) { runtime?.Confirm(); confirmed = true } };

  // 安装器通过显式参数保留自定义目录；重新设置环境供下一次更新继续传递，不读取或传递任何凭据。
  const userRoot = updateUserRoot(process.argv, process.env.CBIM_USER_DATA_ROOT);

  if (userRoot)
    process.env.CBIM_USER_DATA_ROOT = userRoot;

  if (userRoot)
  {
    app.setPath('userData', path.join(userRoot, 'desktop'));

    app.setPath('sessionData', path.join(userRoot, 'desktop'))
  }
  else
  {
    const root = path.join(app.getPath('home'), '.cbim');

    app.setPath('userData', path.join(root, 'desktop'));

    app.setPath('sessionData', path.join(root, 'desktop'))
  }

  app.whenReady().then(async () =>
  {
    const install = app.isPackaged ? process.resourcesPath : app.getAppPath();

    app.setAppUserModelId('com.cbim.assistant.desktop');

    let release:
      {
        channel?: string;

        version?: string;

        notes?: string
      } = {};

    try
    {
      release = JSON.parse(await fs.readFile(path.join(install, 'desktop-release.json'), 'utf8'))
    }
    catch
    {
    }

    const installed = app.isPackaged && process.platform === 'win32' && process.arch === 'x64' && release.channel === 'desktop-stable' && release.version === app.getVersion() && await fs.access(path.join(path.dirname(app.getPath('exe')), 'Uninstall CBIM Desktop.exe')).then(() => true, () => false);

    if (installed && !runtime && !app.requestSingleInstanceLock())
    {
      app.quit();

      return
    }

    const beforeInstall = async () => { runtime?.StopPreparingEngines(); terminals.CloseAll(); await application.Shutdown(); quitting = true };

    updates = runtime ? runtime.Updates(beforeInstall, installed) : new DesktopUpdates(app.getVersion(), typeof release.notes === 'string' ? release.notes : '', installed, latestDesktopRelease, new NsisUpdateInstaller(), beforeInstall);

    application = new Application(new Paths(userRoot, app.isPackaged ? path.dirname(app.getPath('exe')) : install, runtime ? [runtime.cacheRoot] : []), systemSecretCipher, { controlledFiles: createControlledFileTransport(), engineArtifacts: runtime?.engineArtifacts, webBrowser: new ElectronBrowserReader() });

    await application.Init({ restore: false });

    window = new BrowserWindow({ width: 1320, height: 860, minWidth: 760, minHeight: 520, title: 'CBIM', icon: path.join(install, app.isPackaged ? 'branding' : 'assets/branding', 'cbim.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });

    // 后台网页窗口不应延迟主窗口退出；统一走 before-quit 的取消与排空，失败时仍保留主窗口。
    window.on('close', event => { if (!quitting) { event.preventDefault(); app.quit() } });

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    window.webContents.on('will-navigate', (event) => event.preventDefault());

    app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.focus() });

    // 拖放走独立 IPC；与原生选择器共用快照和 .cbim 边界检查。
    ipcMain.handle('cbim:drop', async (event, request: { id: string; paths: string[] }) => { if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('UNAUTHORIZED'); if (updates?.Status().phase === 'installing') return { ok: false, error: { code: 'UPDATING', message: '正在关闭任务并安装更新，请稍后重新打开。' } }; try { if (!request || !Array.isArray(request.paths) || !request.paths.length || request.paths.length > 12 || request.paths.some(p => typeof p !== 'string')) throw Error('无效文件列表'); const inputs = new ChatInputs(application.Workspace(request.id)); const items = []; for (const file of request.paths) { const stat = await fs.stat(file); items.push(await inputs.Path(stat.isDirectory() ? 'folder' : 'file', file)) } return { ok: true, value: items }; } catch (e: any) { return { ok: false, error: { message: e.message } } } });

    let monitorSubscription: { id: string; cancel(): void } | undefined;
    const stopMonitor = () => { monitorSubscription?.cancel(); monitorSubscription = undefined; };
    window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) stopMonitor(); });
    window.webContents.on('destroyed', stopMonitor);
    window.webContents.on('render-process-gone', stopMonitor);
    ipcMain.on('cbim:monitor-watch', (event, id, start) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || typeof id !== 'string' || id.length !== 36 || typeof start !== 'boolean') return;
      if (!start) { if (monitorSubscription?.id === id) stopMonitor(); return; }
      stopMonitor();
      const cancel = application.monitor.WatchRows(row => event.sender.send('cbim:monitor-row', id, row));
      monitorSubscription = { id, cancel };
    });

    ipcMain.handle('cbim:call', async (event, action: unknown, args: unknown) =>
    {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
        throw Error('UNAUTHORIZED');

      if (typeof action !== 'string')
        return { ok: false, error: { code: 'ACTION', message: '未知操作' } };

      if (action.startsWith('desktop.updates.'))
      {
        try
        {
          if (action !== 'desktop.updates.status' && action !== 'desktop.updates.check' && action !== 'desktop.updates.download' && action !== 'desktop.updates.install')
            throw Error('未知更新操作');

          parseIpcRequest(action, args);

          const value = action === 'desktop.updates.status' ? updates!.Status() : action === 'desktop.updates.check' ? await updates!.Check() : action === 'desktop.updates.download' ? await updates!.Download() : action === 'desktop.updates.install' ? await updates!.Install() : (() => { throw Error('未知更新操作') })();

          return ipcSuccess(action, value);
        }
        catch
        {
          return { ok: false, error: { code: 'DESKTOP_UPDATE', message: '更新操作未能完成，请检查当前状态后重试。' } }
        }
      }

      if (updates?.Status().phase === 'installing')
        return { ok: false, error: { code: 'UPDATING', message: '正在关闭任务并安装更新，请稍后重新打开。' } };

      // 对话菜单复用 Application 的唯一引擎安装账本；冷壳仅提供验签制品，不维护第二份安装状态。
      if (action === 'desktop.engines.status' || action === 'desktop.engines.prepare')
      {
        try
        {
          const request = action === 'desktop.engines.prepare' ? parseIpcRequest(action, args) : (parseIpcRequest(action, args), undefined);

          const packages = application.enginePackages;

          if (request)
          {
            if (!packages)
              throw Error('当前宿主不支持引擎安装');

            const state = await packages.Read(),
              item = state.items.find(item => item.kind === request.engine);

            if (!item?.candidate)
              throw Error('没有可安装的兼容版本');

            await packages.Install(request.engine, { revision: state.revision, identity: item.candidate.identity });
          }

          const state = await packages?.Read();

          const value = state ? state.items.map(item => ({ engine: item.kind, state: item.preparing ? 'preparing' as const : item.error ? 'failed' as const : !item.active ? 'install' as const : !item.enabled ? 'failed' as const : item.candidate?.identity !== item.active.identity ? 'update' as const : 'ready' as const, version: item.candidate?.version, installedVersion: item.active?.version, progress: item.preparation?.progress, error: item.error ?? (!item.enabled ? '引擎已停用，可重新安装启用' : undefined) })) : (['pi', 'claude-code', 'codex', 'memory'] as const).map(engine => ({ engine, state: runtime ? 'unavailable' as const : 'bundled' as const }));

          return action === 'desktop.engines.status' ? ipcSuccess(action, value) : ipcSuccess(action, value.find(item => item.engine === request!.engine)!);
        }
        catch
        {
          return { ok: false, error: { code: 'ENGINE_PREPARE', message: '引擎操作未完成，请检查引擎菜单状态后重试。' } }
        }
      }

      if (action.startsWith('terminal.'))
      {
        try
        {
          if (action === 'terminal.close')
          {
            const request = parseIpcRequest(action, args);

            terminals.Close(request.id + ':' + request.tabId);

            return ipcSuccess(action, undefined)
          }

          if (action === 'terminal.start')
          {
            const request = parseIpcRequest(action, args),
              ws = application.Workspace(request.id);

            ws.Assert();

            return ipcSuccess(action, terminals.Start(request.id + ':' + request.tabId, ws.entry.path, request.command))
          }

          if (action === 'terminal.read')
          {
            const request = parseIpcRequest(action, args),
              ws = application.Workspace(request.id);

            ws.Assert();

            return ipcSuccess(action, terminals.Read(request.id + ':' + request.tabId))
          }

          throw Error('未知终端操作');
        }
        catch (e: any)
        {
          return { ok: false, error: { message: e.message } }
        }
      }

      if (action === 'github.feedback.openLogin')
      {
        try
        {
          parseIpcRequest(action, args);

          await shell.openExternal('https://github.com/login/device');

          return ipcSuccess(action, true)
        }
        catch
        {
          return { ok: false, error: { code: 'GITHUB_LOGIN_PAGE', message: 'GitHub 登录页未能打开，请在浏览器访问 https://github.com/login/device' } }
        }
      }

      if (action === 'chat.openLink')
      {
        try
        {
          // 只有用户点击才打开链接；业务产物必须属于当前工作区且不是可执行程序。
          const request = parseIpcRequest(action, args);

          const owner = application.Workspace(request.id);

          if (typeof request.target !== 'string')
            throw Error('无效链接');

          if (/^https?:\/\//i.test(request.target))
          {
            const url = new URL(request.target);

            if (url.username || url.password)
              throw Error('不支持包含凭据的链接');

            await shell.openExternal(url.href)
          }
          else
          {
            const root = await fs.realpath(owner.entry.path),
              file = await fs.realpath(path.resolve(root, decodeURIComponent(request.target)));

            const relative = path.relative(root, file);

            if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p.toLowerCase() === '.cbim'))
              throw Error('只能打开当前工作区的业务产物');

            if (!/\.(html?|txt|md|pdf|png|jpe?g|gif|webp|svg)$/i.test(file))
              throw Error('该文件类型暂不支持直接打开');

            const error = await shell.openPath(file);

            if (error)
              throw Error(error);
          }

          return ipcSuccess(action, true);
        }
        catch (e: any)
        {
          return { ok: false, error: { code: 'OPEN_LINK', message: e.message } }
        }
      }

      if (action === 'chat.pick')
      {
        try
        {
          const request = parseIpcRequest(action, args);

          if (!['file', 'folder'].includes(request.kind))
            throw Error('未知附件类型');

          if (request.importId !== undefined)
          {
            const value = await application.chatMaterials.Pick(request, async () => { const result = await dialog.showOpenDialog(window, { properties: request.kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'] }); return result.canceled ? [] : result.filePaths });

            return ipcSuccess(action, value)
          }

          const inputs = new ChatInputs(application.Workspace(request.id));

          const result = await dialog.showOpenDialog(window, { properties: request.kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'] });

          // 在导入第一份快照前拒绝超量选择，不能静默裁剪用户明确选中的资料。
          if (!result.canceled && result.filePaths.length > 12)
            throw Error('最多选择12个附件，请减少选择后重试');

          const items = [];

          if (!result.canceled)
          {
            for (const file of result.filePaths)
              items.push(await inputs.Path(request.kind, file));
          }

          return ipcSuccess(action, items);
        }
        catch (e: any)
        {
          return { ok: false, error: { code: e.code || 'ATTACHMENT', message: e.message } }
        }
      }

      try
      {
        if (action === 'chooseFolder')
        {
          parseIpcRequest(action, args);

          const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });

          return ipcSuccess(action, result.canceled ? null : result.filePaths[0])
        }

        const value = await application.Dispatch(action, args);

        if (action === 'list')
        {
          rendererResponded = true;

          confirmStartup()
        }

        return { ok: true, value }
      }
      catch (e: any)
      {
        return { ok: false, error: { code: e.code || 'ERROR', message: e.message } }
      }
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
      await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    else
      await window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));

    windowLoaded = true;

    confirmStartup();

    updates.Start();

    void application.Restore().catch(error => { dialog.showErrorBox('工作区恢复失败', String(error) + '\n程序窗口已打开，可在工作区中重试。') });

    // 仅隔离数据目录下的显式打包测试可写入样本；正常启动走运行授权策略。
    if (process.env.CBIM_SMOKE_ROOT && userRoot)
    {
      const entry = await application.catalog.Add(process.env.CBIM_SMOKE_ROOT),
        ws = await application.Open(entry.id),
        snap = await ws.Snapshot();

      const tools = knowledgeTools(ws),
        identity = { workspaceId: entry.id, instanceId: ws.instanceId };

      const invoke = async (name: string, args: Record<string, unknown> = {}, write = false) => { const result = await tools.CallFromRun(name, name === 'cbim_workspace_identity' ? {} : { ...identity, ...args }, write); return JSON.parse(result.content[0].text); };

      const current = await invoke('cbim_workspace_identity');

      if (current.workspaceId !== entry.id || current.instanceId !== ws.instanceId || !tools.List().some(t => t.name === 'cbim_knowledge_snapshot'))
        throw Error('Packaged internal knowledge verification failed');

      for (const tool of ['cbim_skill_knowledge_query', 'cbim_skill_business_execution', 'cbim_skill_knowledge_governance', 'cbim_skill_architecture_governance', 'cbim_skill_create_agent_skill', 'cbim_skill_create_workflow', 'cbim_skill_core_check'])
        await invoke(tool);

      const plan = await invoke('cbim_object_preview', { revision: snap.revision, operations: [{ kind: 'agent', action: 'create', parentId: '.cbim/team', slug: 'smoke_agent', data: { name: 'Smoke', summary: 'portabletest'.repeat(12), capabilities: ['test'] }, body: '# Principles' }] });

      await invoke('cbim_object_commit', { planId: plan.planId }, true);

      const agent = await invoke('cbim_agent_get', { id: plan.objects[0] });

      if (!agent.principles.available)
        throw Error('Packaged object CRUD failed');

      const catalog = await invoke('cbim_builtin_catalog');

      for (const item of catalog.items)
      {
        const document = await invoke('cbim_builtin_read', { id: item.id, expectedVersion: item.version });

        if (!document.text)
          throw Error('Packaged builtin read failed: ' + item.id)
      }

      await fs.writeFile(path.join(userRoot, 'smoke-result.json'), json({ packaged: app.isPackaged, workspaceId: entry.id, files: snap.files.length, internalKnowledge: true, builtins: true, objectCrud: true, workspaceState: ws.state, structural: snap.validation?.structural }));

      await application.Shutdown();

      app.quit();
    }
  }).catch(e => { dialog.showErrorBox('CBIM 启动失败', e.message + '\n请检查用户数据目录权限及程序资源。'); app.exit(1) });

  // 普通退出先取消更新流程，不能等排空完成后的 will-quit，避免排空期间自动安装继续推进。
  app.on('before-quit', event => { if (!quitting && application) { event.preventDefault(); quitting = true; updates?.Close(); runtime?.StopPreparingEngines(); terminals.CloseAll(); void application.Shutdown().then(() => app.quit()).catch(e => { quitting = false; dialog.showErrorBox('工作区关闭失败', e.message + '\n请保留运行窗口并重试。') }) } });

  app.on('window-all-closed', () => app.quit());

  app.on('will-quit', () => updates?.Close());
}
