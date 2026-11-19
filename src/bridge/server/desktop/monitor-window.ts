/** 资源监视器窗口由桌面宿主持有。窗口关闭时释放订阅及进程采样器。 */
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import type { Application } from '../../../logic-new/application';
import type { ProcessGroup } from '../../contracts/discovery';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

export function createMonitorOpener(owner: BrowserWindow, application: Application)
{
  let current: BrowserWindow | undefined;
  return async () => {
    if (current) {
      if (current.isMinimized()) current.restore();
      current.focus();
      return;
    }
    const win = new BrowserWindow({
      parent: owner, width: 580, height: 520, useContentSize: true, resizable: false, maximizable: false,
      fullscreenable: false, show: false, title: '资源监视器', backgroundColor: '#191919',
      ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { height: 40, color: '#191919', symbolColor: '#eeeeee' } } : {}),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    current = win;
    win.removeMenu();
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('page-title-updated', event => event.preventDefault());
    const send = (data: ProcessGroup) => { if (!win.isDestroyed()) win.webContents.send('monitor:rows', data); };
    const sample = () => send({ group: 'app', rows: app.getAppMetrics().map(row => ({
      id: row.pid + ':' + row.creationTime, name: row.type === 'Browser' ? '主进程' : row.type === 'Tab' ? 'CBIM' : row.type === 'GPU' ? 'GPU 进程' : row.name || row.type,
      detail: row.type === 'Tab' ? '界面进程' : undefined, pid: row.pid, cpu: row.cpu.percentCPUUsage, memoryKiB: row.memory.workingSetSize,
    })) });
    let stop: (() => void) | undefined;
    const authorized = (event: Electron.IpcMainEvent) => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
    const start = (event: Electron.IpcMainEvent) => {
      if (!authorized(event)) return;
      stop?.();
      const detach = application.monitor.Subscribe(snapshot => send({ group: 'agents', rows: snapshot.offices.flatMap(o => o.agents.map(a => ({
        id: JSON.stringify([o.id,a.id]), name: a.id, detail: (a.running ? '执行任务' : '空闲') + ' · ' + o.workspaceId + (a.reported ? ' · '+a.totalTokens+' tokens' : ''),
      }))) }));
      sample();
      const timer = setInterval(sample, 2000);
      stop = () => { detach(); clearInterval(timer); stop = undefined; };
    };
    const end = (event: Electron.IpcMainEvent) => { if (authorized(event)) stop?.(); };
    ipcMain.on('monitor:start', start);
    ipcMain.on('monitor:stop', end);
    win.webContents.on('render-process-gone', () => stop?.());
    win.on('closed', () => { stop?.(); current = undefined; ipcMain.off('monitor:start', start); ipcMain.off('monitor:stop', end); });
    try {
      if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL + '#monitor');
      else await win.loadFile(path.join(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME, 'index.html'), { hash: 'monitor' });
      if (!win.isDestroyed()) win.show();
    } catch (error) {
      if (!win.isDestroyed()) win.destroy();
      throw error;
    }
  };
}
