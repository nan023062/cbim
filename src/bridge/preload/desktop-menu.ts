/**
 * 作用定位：新桌面主菜单的隔离桥，仅开放固定操作。
 * 设计原因：通过固定 IPC 方法和订阅封装跨进程通信，页面不能取得任意 Node 或 Electron 能力。
 */
import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopMenu, ProcessGroup } from '../contracts/discovery';

const menu: DesktopMenu = {
  RegistryList:()=>ipcRenderer.invoke('registry:list'),
  RegistryHistory:()=>ipcRenderer.invoke('registry:history'),
  RegistryInventory:()=>ipcRenderer.invoke('registry:inventory'),
  RegistryPublish:key=>ipcRenderer.invoke('registry:publish',key),
  RegistryPull:version=>ipcRenderer.invoke('registry:pull',version),
  RegistryImport:(version,project,mode,choice)=>ipcRenderer.invoke('registry:import',{version,project,mode,choice}),
  RegistryPlugin:(project,version,action)=>ipcRenderer.invoke('registry:plugin',{project,version,action}),
  Navigation: change => ipcRenderer.invoke('menu:navigation', change),
  RevealProject: project => ipcRenderer.invoke('project:reveal', project),
  Organization: (project, change) => ipcRenderer.invoke('project:organization', { project, change }),
  BusinessArchitecture: (project, change) => ipcRenderer.invoke('project:business', { project, change }),
  OfficeQueue: (project, session, action) => ipcRenderer.invoke('office:queue', { project, session, action }),
  InsertOffice: (project, session, text) => ipcRenderer.invoke('office:insert', { project, session, text }),
  AgentMembers: project => ipcRenderer.invoke('agent:members', project),
  AgentSettings: (project, target, save) => ipcRenderer.invoke('agent:settings', { project, target, save }),
  AgentConnectors: () => ipcRenderer.invoke('agent:connectors'),
  EngineCatalog: () => ipcRenderer.invoke('menu:engine-catalog'),
  Engines: (action, target) => ipcRenderer.invoke('menu:engines', { action, target }),
  Model: (action, ...args) => ipcRenderer.invoke('settings:model', { action, input: args[0] }),
  ReadOfficeTurn: (project, session, file) => ipcRenderer.invoke('office:turn', { project, session, file }),
  Transfers: () => ipcRenderer.invoke('downloads:list'),
  WatchTransfers: listener => { const receive = () => listener(); ipcRenderer.on('downloads:changed', receive); return () => { ipcRenderer.removeListener('downloads:changed', receive); }; },
  CancelTransfer: identity => ipcRenderer.invoke('downloads:cancel', identity),
  Connector: (id, install,digest) => ipcRenderer.invoke('menu:connector', { id, install,digest }),
  Update: action => ipcRenderer.invoke('menu:update', action),
  OpenOffice: (project, action, session) => ipcRenderer.invoke('office:open', { project, action, session }),
  WatchOffice: listener => { const receive = (_: unknown, value: Parameters<typeof listener>[0]) => listener(value); ipcRenderer.on('office:progress', receive); return () => { ipcRenderer.removeListener('office:progress', receive); }; },
  StopOffice: (project, session) => ipcRenderer.invoke('office:stop', { project, session }),
  SendOffice: (project, session, text, permission, selection) => ipcRenderer.invoke('office:send', { project, session, text, permission, selection }),
  OpenMonitor: () => ipcRenderer.invoke('menu:open-monitor'),
  Projects: () => ipcRenderer.invoke('menu:projects'),
  PickProject: () => ipcRenderer.invoke('menu:pick-project'),
  AddProject: attempt => ipcRenderer.invoke('menu:add-project', attempt),
  ProjectDisplayed: (attempt, at) => ipcRenderer.invoke('menu:project-displayed', { attempt, at }),
  Monitor: () => ipcRenderer.invoke('menu:monitor'),
};

if (location.hash === '#monitor')
  contextBridge.exposeInMainWorld('WatchProcesses', (listener: (group: ProcessGroup) => void) => { const receive = (_event: unknown, group: ProcessGroup) => listener(group); ipcRenderer.on('monitor:rows', receive); ipcRenderer.send('monitor:start'); return () => { ipcRenderer.removeListener('monitor:rows', receive); ipcRenderer.send('monitor:stop'); }; });
else
  contextBridge.exposeInMainWorld('desktopMenu', menu);
