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
  openMonitor(): Promise<void>;
  projects(): Promise<ProjectItem[]>;
  addProject(): Promise<ProjectItem | null>;
  resources(page: DiscoveryPage): Promise<DiscoveryResult>;
  monitor(): Promise<MonitorResult>;
}
export interface ProcessRow {
  id: string; name: string; detail?: string; pid?: number; cpu?: number; memoryKiB?: number;
}
export interface ProcessGroup { group: 'agents' | 'app'; rows: ProcessRow[] }
declare global { interface Window { watchProcesses(listener: (group: ProcessGroup) => void): () => void } }
declare global { interface Window { desktopMenu: DesktopMenu } }
