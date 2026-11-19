/** 运行监控的只读增量，身份在一次订阅内稳定。 */
export type MonitorUpdate =
  | { kind: 'host'; rssBytes: number; cpuPercent?: number }
  | { kind: 'office'; officeId: string; workspaceId: string; sessionId: string; workspaceCount: number }
  | { kind: 'agent'; officeId: string; agentId: string; running: boolean; tokens?: number; rate: number }
  | { kind: 'remove-agent'; officeId: string; agentId: string }
  | { kind: 'remove-office'; officeId: string };
