/** 新桌面主菜单的隔离桥，仅开放固定操作。 */
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopMenu, ProcessGroup } from '../contracts/discovery';

const menu: DesktopMenu = {
  openOffice: (project, action, session) => ipcRenderer.invoke('office:open', { project, action, session }),
  watchOffice: listener => {
    const receive = (_: unknown, value: Parameters<typeof listener>[0]) => listener(value);
    ipcRenderer.on('office:progress', receive);
    return () => { ipcRenderer.removeListener('office:progress', receive); };
  },
  stopOffice: (project,session) => ipcRenderer.invoke('office:stop',{ project, session }),
  sendOffice: (project, session, text, permission) => ipcRenderer.invoke('office:send', { project, session, text, permission }),
  openMonitor: () => ipcRenderer.invoke('menu:open-monitor'),
  projects: () => ipcRenderer.invoke('menu:projects'),
  addProject: () => ipcRenderer.invoke('menu:add-project'),
  resources: page => ipcRenderer.invoke('menu:resources', page),
  monitor: () => ipcRenderer.invoke('menu:monitor'),
};
if (location.hash === '#monitor') {
  contextBridge.exposeInMainWorld('watchProcesses', (listener: (group: ProcessGroup) => void) => {
    const receive = (_event: unknown, group: ProcessGroup) => listener(group);
    ipcRenderer.on('monitor:rows', receive);
    ipcRenderer.send('monitor:start');
    return () => { ipcRenderer.removeListener('monitor:rows', receive); ipcRenderer.send('monitor:stop'); };
  });
} else contextBridge.exposeInMainWorld('desktopMenu', menu);
