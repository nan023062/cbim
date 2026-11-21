/**
 * 作用定位：桌面菜单通信接口及项目、队列和架构快照的公开类型入口。
 * 设计原因：集中重导出页面所需的数据契约，宿主服务和平台句柄不进入渲染进程。
 */
export type { NavigationSnapshot, NavigationChange, NavigationProject, NavigationSession } from '../../logic/projects/navigation-contract';

export type { OfficeQueueAction, OfficeQueueSnapshot, OfficeQueueItem } from '../../logic/projects/office-queue-contract';

export type { BusinessSnapshot, BusinessChange } from '../../logic/projects/business-contract';

/** 新桌面菜单只公开显示字段及原生目录选择操作。 */
export { SkillCommands } from '../../logic/projects/agent-configuration';

export type { AgentConfiguration, AgentSettingsTarget } from '../../logic/projects/agent-configuration';

export type { OrganizationNode, OrganizationSnapshot, OrganizationChange } from '../../logic/projects/organization-contract';

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
  Navigation(change?: import('../../logic/projects/navigation-contract').NavigationChange): Promise<import('../../logic/projects/navigation-contract').NavigationSnapshot>;

  RevealProject(project: string): Promise<void>;

  Organization(project: string, change?: import('../../logic/projects/organization-contract').OrganizationChange): Promise<import('../../logic/projects/organization-contract').OrganizationSnapshot>;

  BusinessArchitecture(project: string, change?: import('../../logic/projects/business-contract').BusinessChange): Promise<import('../../logic/projects/business-contract').BusinessSnapshot>;

  OfficeQueue(project: string, session: string, action?: import('../../logic/projects/office-queue-contract').OfficeQueueAction): Promise<import('../../logic/projects/office-queue-contract').OfficeQueueSnapshot>;

  InsertOffice(project: string, session: string, text: string): Promise<{ id: string; status: 'queued' }>;

  AgentMembers(project: string): Promise<{ id: string; name: string; position: string; revision: number; configuration: import('../../logic/projects/agent-configuration').AgentConfiguration }[]>;

  AgentSettings(project: string, target: import('../../logic/projects/agent-configuration').AgentSettingsTarget, save?: { revision: number; configuration: import('../../logic/projects/agent-configuration').AgentConfiguration }): Promise<{ revision: number; configuration: import('../../logic/projects/agent-configuration').AgentConfiguration }>;

  AgentConnectors(): Promise<{ id: string; name: string; available: boolean }[]>;

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

/** 业务树只读快照，不包含运行时或文件访问能力。 */
export interface BusinessArchitecture
{
  roots: string[];

  nodes:
  {
    id: string;

    name: string;

    summary: string;

    children: string[];

    sources:
    {
      location: string;

      scope: string
    }[];

    virtual: boolean
  }[];
}

export interface OfficeActivity
{
  id: string;

  label: string;

  input?: string;

  result?: string;

  alert?: string;
}

export interface OfficeProgress
{
  workLog?: OfficeActivity[];

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
  workLog?: OfficeActivity[];

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

  earlierUsage?:
  {
    elapsed: number;

    cost: number;

    complete: boolean
  };

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
