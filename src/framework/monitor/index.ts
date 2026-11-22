/**
 * 作用定位：对运行时进行只读采样。宿主提供进程指标，业务对象只提供自身实例和已上报用量。
 * 设计原因：监控实例组合只读业务数据与宿主指标，订阅解除不改变被监控任务的生命周期。
 */
import type { CbimRuntime } from '../cbim-runtime';

import type { MonitorUpdate } from './updates';

import { listActiveConnectors, subscribeConnectorActivity } from '../connectors';

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

  public constructor(private readonly runtime: Pick<CbimRuntime, 'ListOffices' | 'FindOffice' | 'Subscribe'> & { ProjectName?(id: string): string | undefined }, private readonly sampleHost?: () => HostSample)
  {
  }

  public GetSnapshot()
  {
    const now = performance.now();

    const offices = this.runtime.ListOffices().map(office => {
      const projectName = this.runtime.ProjectName?.(office.workspaceId)?.trim() || '未知项目';
      const members = office.BoundMemberNames();
      const active = new Map(office.ListActiveAgents().map(agent => [agent.id, agent]));
      const title = (id: string) => {
        const roleName = active.get(id)?.role.definition.name?.trim();
        const name = id === office.mainAgentId
          ? roleName || office.mainRole.definition.name?.trim() || '助理'
          : members.get(id)?.trim() || roleName || '未知 Agent';
        return projectName + ' · ' + name;
      };
      const usage = office.GetTokenUsage(now);
      const agents = usage.agents.map(agent => ({
        ...agent, name: title(agent.id), running: agent.state === 'executing',
        taskId: active.get(agent.id)?.role.conversation.taskId, tokens: agent.reported ? agent.totalTokens : undefined
      }));
      const cores = [...active.values()].map(agent => ({
        id: agent.engineInstanceId, agentId: agent.id, main: agent.id === office.mainAgentId,
        engine: agent.role.definition.model?.engine, name: title(agent.id), taskId: agent.role.conversation.taskId
      }));
      const workspaces = office.ListWorkspaces().map(instance => ({ id: instance.instanceId, workspaceId: instance.description.id, directory: instance.directory }));
      return { id: office.id, workspaceId: office.workspaceId, rootSessionId: office.rootSessionId, agents, cores, workspaces, tasks: office.ListTasks(), engines: active.size, totalTokens: usage.totalTokens, tokensPerSecond: usage.tokensPerSecond, reportedTokens: agents.some(agent => agent.reported) ? usage.totalTokens : undefined };
    });

    const peripherals = listActiveConnectors();

    const counts = {
      connectors: peripherals.length, offices: offices.length, agents: offices.reduce((n, o) => n + o.agents.length, 0),
      engines: offices.reduce((n, o) => n + o.cores.length, 0), workspaces: offices.reduce((n, o) => n + o.workspaces.length, 0)
    };

    const weights = { agents: 10, engines: 100, workspaces: 5, connectors: 50 };

    const total = counts.agents * weights.agents + counts.engines * weights.engines + counts.workspaces * weights.workspaces + counts.connectors * weights.connectors;

    return {
      sampledAt: Date.now(), host: this.sampleHost?.(), offices, peripherals, counts,
      load: { total, threshold: 1000, weights }, tokensPerSecond: offices.reduce((n, o) => n + o.tokensPerSecond, 0)
    };
  }

  /** 首次订阅返回当前快照，同一微任务内的连续变更合并通知。 */
  public Subscribe(listener: (snapshot: ReturnType<RuntimeMonitor['GetSnapshot']>) => void)
  {
    if (this.closed)
      throw Error('监控已关闭');

    let active = true,
      queued = false;

    const changed = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; if (active) { try { listener(this.GetSnapshot()); } catch (error) { console.error('Monitor subscriber failed', error); } } }); };

    const detach = this.runtime.Subscribe(changed);

    const detachConnectors = subscribeConnectorActivity(changed);

    const cancel = () => { active = false; detach(); detachConnectors(); this.subscriptions.delete(cancel); };

    this.subscriptions.add(cancel);

    try
    {
      listener(this.GetSnapshot());
    }
    catch (error)
    {
      cancel();

      throw error;
    }

    return cancel;
  }

  /** UI 首次读取现有行，随后按事件中的实例 ID 投递单行。仅宿主 CPU/RSS 有周期采样。 */
  public WatchRows(send: (row: MonitorUpdate) => void)
  {
    if (this.closed)
      throw Error('监控已关闭');

    type Office = ReturnType<CbimRuntime['ListOffices']>[number];

    const officeRow = (office: Office) => send({ kind: 'office', officeId: office.id, workspaceId: office.workspaceId, sessionId: office.rootSessionId, workspaceCount: office.ListWorkspaces().length });

    const agentRow = (office: Office, agentId: string) => { const usage = office.GetAgentTokenUsage(agentId); if (!usage) return send({ kind: 'remove-agent', officeId: office.id, agentId }); send({ kind: 'agent', officeId: office.id, agentId, running: usage.state === 'executing', tokens: usage.reported ? usage.totalTokens : undefined, rate: usage.tokensPerSecond }); };

    const detach = this.runtime.Subscribe(({ officeId, change }) => { if (change !== 'opened' && change.type === 'closed') return send({ kind: 'remove-office', officeId }); const office = this.runtime.FindOffice(officeId); if (!office) return; if (change !== 'opened' && change.type === 'agent') agentRow(office, change.change.agentId); else { officeRow(office); if (change === 'opened') agentRow(office, office.mainAgentId); } });

    let previous:
      {
        cpu: number;

        time: number;

        pid: number
      } | undefined;

    const sample = () => { const host = this.sampleHost?.(); if (!host) return; const time = performance.now(); const cpuPercent = previous && previous.pid === host.pid && time > previous.time && host.cpuMicros >= previous.cpu ? (host.cpuMicros - previous.cpu) / ((time - previous.time) * 10) : undefined; previous = { cpu: host.cpuMicros, time, pid: host.pid }; send({ kind: 'host', rssBytes: host.rssBytes, cpuPercent }); };

    const timer = this.sampleHost ? setInterval(sample, 5000) : undefined;

    const cancel = () => { detach(); clearInterval(timer); this.subscriptions.delete(cancel); };

    this.subscriptions.add(cancel);

    try
    {
      for (const office of this.runtime.ListOffices())
      {
        officeRow(office);

        for (const agent of office.ListAgents())
          agentRow(office, agent.id);
      }

      sample();
    }
    catch (error)
    {
      cancel();

      throw error;
    }

    return cancel;
  }

  public Close()
  {
    this.closed = true;

    for (const cancel of this.subscriptions)
      cancel();

    this.subscriptions.clear();
  }
}
