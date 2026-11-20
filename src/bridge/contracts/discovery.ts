/** 新桌面菜单只公开显示字段及原生目录选择操作。 */
export type DiscoveryPage = 'engines' | 'connectors' | 'talent' | 'templates';

export interface ProjectItem
{
  id: string;

  name: string;

  path: string
}

export interface DiscoveryResult
{
  source: string;

  items:
  {
    id: string;

    name: string;

    kind: string;

    summary: string
  }[]
}

export interface RuntimeLoad
{
  total: number;

  threshold: number;

  weights:
  {
    agents: number;

    engines: number;

    workspaces: number;

    connectors: number
  }
}

export interface MonitorResult
{
  load: RuntimeLoad;

  tokensPerSecond: number;

  counts:
  {
    offices: number;

    agents: number;

    engines: number;

    workspaces: number;

    connectors: number
  };

  offices:
  {
    id: string;

    workspaceId: string;

    totalTokens: number;

    tokensPerSecond: number
  }[];

  host?:
  {
    pid: number;

    rssBytes: number;

    cpuMicros: number
  };
}

export type DesktopModelAction = 'models.list' | 'models.save' | 'models.select' | 'models.remove' | 'models.testConnection' | 'models.discoverDetails';

export interface OfficeSelection
{
  engine?: string;

  profileId?: string;

  modelId?: string
}

export interface TransferState
{
  identity: string;
  name: string;
  phase: 'queued' | 'downloading' | 'verifying';
  bytes: number;
  total: number;
}

export interface DesktopMenu
{
  EngineCatalog(): Promise<{ id: string; label: string; logo: string; businessTypes: readonly string[]; supportedApis: readonly string[] }[]>;

  Engines(action: 'list' | 'check' | 'install' | 'configure', target?: { kind: string; revision: number; identity: string } | { kind: string; revision: number; action: 'enable' | 'disable' | 'remove' }): Promise<import('./desktop-engines').EnginePackageSettings>;

  Model<K extends DesktopModelAction>(action: K, ...args: K extends 'models.list' ? [] : [import('./desktop-models').ModelActionInput<K>]): Promise<import('./desktop-models').ModelActionResults[K]>;

  ReadOfficeTurn(project: string, session: string, file: string): Promise<OfficeMessage[]>;

  Transfers(): Promise<TransferState[]>;
  WatchTransfers(listener: () => void): () => void;
  CancelTransfer(identity: string): Promise<void>;
  Connector(id: string, install: boolean): Promise<{ installed: boolean; identity: string }>;
  Update(action: 'status' | 'check' | 'download' | 'install'): Promise<{ phase: string; progress?: number; error?: string; version?: string }>;
  OpenOffice(project: string, action: 'latest' | 'create' | 'select', session?: string): Promise<OfficeConversation>;

  WatchOffice(listener: (event: OfficeProgress) => void): () => void;

  StopOffice(project: string, session: string): Promise<void>;

  SendOffice(project: string, session: string, text: string, permission: 'read' | 'ask' | 'execute', selection: Required<OfficeSelection>): Promise<OfficeMessage[]>;

  OpenMonitor(): Promise<void>;

  Projects(): Promise<ProjectItem[]>;

  AddProject(): Promise<ProjectItem | null>;

  Resources(page: DiscoveryPage): Promise<DiscoveryResult>;

  Monitor(): Promise<MonitorResult>;
}

export interface OfficeProgress
{
  text?: string;

  project: string;

  session: string;

  phase: 'thinking' | 'connecting' | 'writing';

  model: string;

  rate?: number;

  estimated?: boolean
}

export interface OfficeMessage
{
  metrics?:
  {
    elapsed: number;

    model: string;

    capacity: number;

    used?: number;

    cost?: number;

    output?: number
  };

  role: 'user' | 'assistant';

  id: string;

  created: number;

  text: string
}

export interface OfficeConversation
{
  earlier?: string[];

  earlierUsage?: { elapsed: number; cost: number; complete: boolean };

  id: string;

  officeId: string;

  sessions:
  {
    id: string;

    title: string
  }[];

  messages: OfficeMessage[]
}

export interface ProcessRow
{
  logo?: string;

  id: string;

  name: string;

  detail?: string;

  pid?: number;

  cpu?: number;

  memoryKiB?: number;
}

export type ProcessGroup =
  {
    group: 'app';

    rows: ProcessRow[]
  } |
  {
    group: 'runtime';

    agents: ProcessRow[];

    engines: ProcessRow[];

    disks: ProcessRow[];

    peripherals: ProcessRow[];

    load: RuntimeLoad;

    traffic: number;
  };

declare global
{
  interface Window
  {
    WatchProcesses(listener: (group: ProcessGroup) => void): () => void
  }
}

declare global
{
  interface Window
  {
    desktopMenu: DesktopMenu
  }
}
