/** 新桌面菜单只公开显示字段及原生目录选择操作。 */
export type DiscoveryPage = 'engines' | 'connectors' | 'talent' | 'templates';
export interface ProjectItem { id: string; name: string; path: string }
export interface DiscoveryResult { source: string; items: { id: string; name: string; kind: string; summary: string }[] }
export interface MonitorResult {
  counts: { offices: number; agents: number; engines: number; workspaces: number };
  offices: { id: string; workspaceId: string; totalTokens: number; tokensPerSecond: number }[];
  host?: { pid: number; rssBytes: number; cpuMicros: number };
}
export interface DesktopMenu {
  openOffice(project: string, action: 'latest' | 'create' | 'select', session?: string): Promise<OfficeConversation>;
  watchOffice(listener: (event: OfficeProgress) => void): () => void;
  stopOffice(project: string, session: string): Promise<void>;
  sendOffice(project: string, session: string, text: string, permission?: 'read' | 'ask' | 'execute'): Promise<OfficeMessage[]>;
  openMonitor(): Promise<void>;
  projects(): Promise<ProjectItem[]>;
  addProject(): Promise<ProjectItem | null>;
  resources(page: DiscoveryPage): Promise<DiscoveryResult>;
  monitor(): Promise<MonitorResult>;
}
export interface OfficeProgress { project: string; session: string; phase: 'thinking' | 'connecting' | 'writing'; model: string; rate?: number; estimated?: boolean }
export interface OfficeMessage { metrics?: { elapsed: number; model: string; capacity: number; used?: number; cost?: number; output?: number }; role: 'user' | 'assistant'; id: string; created: number; text: string }
export interface OfficeConversation { id: string; officeId: string; sessions: { id: string; title: string }[]; messages: OfficeMessage[] }
export interface ProcessRow {
  id: string; name: string; detail?: string; pid?: number; cpu?: number; memoryKiB?: number;
}
export interface ProcessGroup { group: 'agents' | 'app'; rows: ProcessRow[] }
declare global { interface Window { watchProcesses(listener: (group: ProcessGroup) => void): () => void } }
declare global { interface Window { desktopMenu: DesktopMenu } }
