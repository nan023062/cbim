/**
 * 作用定位：资源监视器窗口由桌面宿主持有。窗口关闭时释放订阅及进程采样器。
 * 设计原因：监控订阅与采样器随独立窗口释放，避免关闭窗口后继续持有观测资源。
 */
import { app, BrowserWindow, ipcMain } from 'electron';

import path from 'node:path';

import type { Application } from '../../../logic/application';

import type { ProcessGroup } from '../../contracts/discovery';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;

declare const MAIN_WINDOW_VITE_NAME: string;

export function createMonitorOpener(owner: BrowserWindow, application: Application, brand: (kind: string | undefined) => { name: string; logo?: string } | undefined)
{
  let current: BrowserWindow | undefined;

  return async () => { if (current) { if (current.isMinimized()) current.restore(); current.focus(); return; } const win = new BrowserWindow({ parent: owner, width: 580, height: 520, useContentSize: true, resizable: false, maximizable: false, fullscreenable: false, show: false, title: '资源监视器', backgroundColor: '#191919', ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { height: 40, color: '#191919', symbolColor: '#eeeeee' } } : {}), webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }, }); current = win; win.removeMenu(); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', event => event.preventDefault()); win.on('page-title-updated', event => event.preventDefault()); const send = (data: ProcessGroup) => { if (!win.isDestroyed()) win.webContents.send('monitor:rows', data); }; const sample = () => send({ group: 'app', rows: app.getAppMetrics().map(row => ({ id: row.pid + ':' + row.creationTime, name: row.type === 'Browser' ? '主进程' : row.type === 'Tab' ? 'CBIM' : row.type === 'GPU' ? 'GPU 进程' : row.name || row.type, detail: row.type === 'Tab' ? '界面进程' : undefined, pid: row.pid, cpu: row.cpu.percentCPUUsage, memoryKiB: row.memory.workingSetSize, })) }); let stop: (() => void) | undefined; const authorized = (event: Electron.IpcMainEvent) => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame; const start = (event: Electron.IpcMainEvent) => { if (!authorized(event)) return; stop?.(); const detach = application.monitor.Subscribe(snapshot => send({ group: 'runtime', load: snapshot.load, traffic: snapshot.tokensPerSecond, peripherals: snapshot.peripherals.map(device => ({ id: device.id, name: device.productId, detail: !device.sessions.length ? '空闲' : device.mode === 'exclusive' ? '独占 · Agent ' + device.sessions[0].agentInstanceId + ' · Office ' + device.sessions[0].officeId : '可并发 · ' + device.sessions.length + ' 个会话', })), agents: snapshot.offices.flatMap(o => o.agents.map(a => ({ id: a.id, name: a.name, detail: (a.running ? '执行中' : '空闲') + ' · Agent ' + a.id + ' · Office ' + o.rootSessionId + (a.reported ? ' · ' + a.totalTokens + ' tokens · ' + a.tokensPerSecond.toFixed(1) + ' tok/s' : ''), }))), engines: snapshot.offices.flatMap(o => o.cores.map(core => ({ id: core.id, name: core.engine || '未知引擎', ...brand((core.main ? application.offices.ActiveEngine(o.id) : undefined) ?? core.engine), detail: core.name + ' · Agent ' + core.agentId + ' · Office ' + o.rootSessionId, }))), disks: snapshot.offices.flatMap(o => o.workspaces.map(w => ({ id: w.id, name: w.workspaceId, detail: w.directory + ' · Office ' + o.rootSessionId, }))), })); sample(); const timer = setInterval(sample, 2000); stop = () => { detach(); clearInterval(timer); stop = undefined; }; }; const end = (event: Electron.IpcMainEvent) => { if (authorized(event)) stop?.(); }; ipcMain.on('monitor:start', start); ipcMain.on('monitor:stop', end); win.webContents.on('render-process-gone', () => stop?.()); win.on('closed', () => { stop?.(); current = undefined; ipcMain.off('monitor:start', start); ipcMain.off('monitor:stop', end); }); try { if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL + '#monitor'); else await win.loadFile(path.join(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME, 'index.html'), { hash: 'monitor' }); if (!win.isDestroyed()) win.show(); } catch (error) { if (!win.isDestroyed()) win.destroy(); throw error; } };
}
