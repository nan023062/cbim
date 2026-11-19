/** 对运行时进行只读采样。宿主提供进程指标，业务对象只提供自身实例和已上报用量。 */
import type { CbimRuntime } from '../framework/cbim-runtime';
import type { MonitorUpdate } from './updates';

export interface HostSample
{
  pid: number;
  rssBytes: number;
  cpuMicros: number;
}

export class RuntimeMonitor
{
  private readonly subscriptions = new Set<() => void>();
  private closed = false;

  public constructor(private readonly runtime: CbimRuntime, private readonly sampleHost?: () => HostSample) {}

  public GetSnapshot()
  {
    const now = performance.now();
    const offices = this.runtime.ListOffices().map(office => {
      const active = new Map(office.organization.ListActiveAgents().map(agent => [agent.id, agent]));
      const usage = office.GetTokenUsage(now);
      const agents = usage.agents.map(agent => {
        const running = active.get(agent.id);
        return { ...agent, running: agent.state === "executing", taskId: running?.role.conversation.taskId, tokens: agent.reported ? agent.totalTokens : undefined };
      });
      const workspaces = office.ListWorkspaces().map(instance => ({ id: instance.instanceId, workspaceId: instance.description.id, directory: instance.directory }));
      return { id: office.id, workspaceId: office.workspaceId, rootSessionId: office.rootSessionId, agents, workspaces, engines: active.size, totalTokens: usage.totalTokens, tokensPerSecond: usage.tokensPerSecond, reportedTokens: agents.some(agent => agent.reported) ? usage.totalTokens : undefined };
    });
    return {
      sampledAt: Date.now(), host: this.sampleHost?.(), offices,
      counts: { offices: offices.length, agents: offices.reduce((n, office) => n + office.agents.length, 0),
        engines: offices.reduce((n, office) => n + office.engines, 0), workspaces: offices.reduce((n, office) => n + office.workspaces.length, 0) }
    };
  }

  /** 首次订阅返回当前快照，同一微任务内的连续变更合并通知。 */
  public Subscribe(listener: (snapshot: ReturnType<RuntimeMonitor['GetSnapshot']>) => void)
  {
    if (this.closed) throw Error('监控已关闭');
    let active = true, queued = false;
    const detach = this.runtime.Subscribe(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (active) { try { listener(this.GetSnapshot()); } catch (error) { console.error('Monitor subscriber failed', error); } }
      });
    });
    const cancel = () => { active = false; detach(); this.subscriptions.delete(cancel); };
    this.subscriptions.add(cancel);
    try { listener(this.GetSnapshot()); } catch (error) { cancel(); throw error; }
    return cancel;
  }

  /** UI 首次读取现有行，随后按事件中的实例 ID 投递单行。仅宿主 CPU/RSS 有周期采样。 */
  public WatchRows(send: (row: MonitorUpdate) => void)
  {
    if (this.closed) throw Error('监控已关闭');
    type Office = ReturnType<CbimRuntime['ListOffices']>[number];
    const officeRow = (office: Office) => send({ kind: 'office', officeId: office.id, workspaceId: office.workspaceId, sessionId: office.rootSessionId, workspaceCount: office.ListWorkspaces().length });
    const agentRow = (office: Office, agentId: string) => {
      const usage = office.GetAgentTokenUsage(agentId);
      if (!usage) return send({kind: 'remove-agent', officeId: office.id, agentId});
      send({kind: 'agent', officeId: office.id, agentId, running: usage.state === 'executing', tokens: usage.reported ? usage.totalTokens : undefined, rate: usage.tokensPerSecond});
    };
    const detach = this.runtime.Subscribe(({officeId, change}) => {
      if (change !== 'opened' && change.type === 'closed') return send({kind: 'remove-office', officeId});
      const office = this.runtime.FindOffice(officeId);
      if (!office) return;
      if (change !== 'opened' && change.type === 'agent') agentRow(office, change.change.agentId);
      else officeRow(office);
    });
    let previous: {cpu: number; time: number; pid: number} | undefined;
    const sample = () => {
      const host = this.sampleHost?.();
      if (!host) return;
      const time = performance.now();
      const cpuPercent = previous && previous.pid === host.pid && time > previous.time && host.cpuMicros >= previous.cpu
        ? (host.cpuMicros - previous.cpu) / ((time - previous.time) * 10) : undefined;
      previous = {cpu: host.cpuMicros, time, pid: host.pid};
      send({kind: 'host', rssBytes: host.rssBytes, cpuPercent});
    };
    const timer = this.sampleHost ? setInterval(sample, 5000) : undefined;
    const cancel = () => { detach(); clearInterval(timer); this.subscriptions.delete(cancel); };
    this.subscriptions.add(cancel);
    try {
      for (const office of this.runtime.ListOffices()) {
        officeRow(office);
        for (const agent of office.ListAgents()) agentRow(office, agent.id);
      }
      sample();
    } catch (error) { cancel(); throw error; }
    return cancel;
  }

  public Close()
  {
    this.closed = true;
    for (const cancel of this.subscriptions) cancel();
    this.subscriptions.clear();
  }
}
