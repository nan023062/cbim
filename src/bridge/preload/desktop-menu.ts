/** 新桌面主菜单的隔离桥，仅开放固定操作。 */
import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopMenu, ProcessGroup } from '../contracts/discovery';

const menu: DesktopMenu = {
  EngineCatalog: () => ipcRenderer.invoke('menu:engine-catalog'),

  Engines: (action, target) => ipcRenderer.invoke('menu:engines', { action, target }),
  Model: (action, ...args) => ipcRenderer.invoke('settings:model', { action, input: args[0] }),
  ReadOfficeTurn: (project, session, file) => ipcRenderer.invoke('office:turn', { project, session, file }),
  Transfers: () => ipcRenderer.invoke('downloads:list'),
  WatchTransfers: listener => { const receive = () => listener(); ipcRenderer.on('downloads:changed', receive); return () => { ipcRenderer.removeListener('downloads:changed', receive); }; },
  CancelTransfer: identity => ipcRenderer.invoke('downloads:cancel', identity),
  Connector: (id, install) => ipcRenderer.invoke('menu:connector', {id, install}),
  Update: action => ipcRenderer.invoke('menu:update', action),
  OpenOffice: (project, action, session) => ipcRenderer.invoke('office:open', { project, action, session }),
  WatchOffice: listener => { const receive = (_: unknown, value: Parameters<typeof listener>[0]) => listener(value); ipcRenderer.on('office:progress', receive); return () => { ipcRenderer.removeListener('office:progress', receive); }; },
  StopOffice: (project, session) => ipcRenderer.invoke('office:stop', { project, session }),
  SendOffice: (project, session, text, permission, selection) => ipcRenderer.invoke('office:send', { project, session, text, permission, selection }),
  OpenMonitor: () => ipcRenderer.invoke('menu:open-monitor'),
  Projects: () => ipcRenderer.invoke('menu:projects'),
  AddProject: () => ipcRenderer.invoke('menu:add-project'),
  Resources: page => ipcRenderer.invoke('menu:resources', page),
  Monitor: () => ipcRenderer.invoke('menu:monitor'),
};

if (location.hash === '#monitor')
  contextBridge.exposeInMainWorld('WatchProcesses', (listener: (group: ProcessGroup) => void) => { const receive = (_event: unknown, group: ProcessGroup) => listener(group); ipcRenderer.on('monitor:rows', receive); ipcRenderer.send('monitor:start'); return () => { ipcRenderer.removeListener('monitor:rows', receive); ipcRenderer.send('monitor:stop'); }; });
else
  contextBridge.exposeInMainWorld('desktopMenu', menu);
