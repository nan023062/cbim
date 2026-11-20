/** 宿主、Office 和 Agent 各自订阅本行。只有增删实例才通知父列表。 */
import { memo, useEffect, useState, useSyncExternalStore } from 'react';

import type { MonitorUpdate } from '../../bridge/contracts/workspace';

function cell<T>(initial: T)
{
  let value = initial;

  const listeners = new Set<() => void>();

  return {
    read: () => value,

    subscribe(listener: () => void)
    {
      listeners.add(listener);

      return () => { listeners.delete(listener); };
    },

    set(next: T)
    {
      value = next;

      for (const listener of listeners)
        listener();
    }
  };
}

type AgentRow = Extract<MonitorUpdate,
  {
    kind: 'agent'
  }>;

type OfficeRow = Extract<MonitorUpdate,
  {
    kind: 'office'
  }>;

type HostRow = Extract<MonitorUpdate,
  {
    kind: 'host'
  }>;

type Cell<T> = ReturnType<typeof cell<T>>;

const useCell = <T,>(source: Cell<T>) => useSyncExternalStore(source.subscribe, source.read);

function collection<T>()
{
  const rows = new Map<string, T>();

  const list = cell<[string, T][]>([]);

  return { rows, list, publish: () => list.set([...rows]) };
}

function officeView(row: OfficeRow)
{
  return { info: cell(row), agents: collection<Cell<AgentRow>>() };
}

function monitorView()
{
  const offices = collection<ReturnType<typeof officeView>>();

  const host = cell<HostRow | undefined>(undefined);

  function update(row: MonitorUpdate)
  {
    if (row.kind === 'host')
      return host.set(row);

    if (row.kind === 'remove-office')
    {
      if (offices.rows.delete(row.officeId))
        offices.publish();

      return;
    }

    const office = offices.rows.get(row.officeId);

    if (row.kind === 'office')
    {
      if (office)
        office.info.set(row);
      else
      {
        offices.rows.set(row.officeId, officeView(row));

        offices.publish();
      }

      return;
    }

    if (!office)
      return;

    const agents = office.agents;

    if (row.kind === 'remove-agent')
    {
      if (agents.rows.delete(row.agentId))
        agents.publish();

      return;
    }

    const current = agents.rows.get(row.agentId);

    if (current)
      current.set(row);
    else
    {
      agents.rows.set(row.agentId, cell(row));

      agents.publish();
    }
  }

  return { host, offices, update };
}

const Agent = memo(function Agent({ source }: { source: Cell<AgentRow> })
{
  const row = useCell(source);

  return <li>Agent {row.agentId} · {row.running ? '执行中' : '空闲'} · {row.tokens === undefined ? '用量未上报' : row.tokens + ' Token'} · {row.rate} Token/s</li>;
});

const Office = memo(function Office({ source }: { source: ReturnType<typeof officeView> })
{
  const row = useCell(source.info),
    agents = useCell(source.agents.list);

  return <article className="runtime-row"><strong>Office {row.sessionId}</strong><p>工作区 {row.workspaceId} · 已打开 {row.workspaceCount} 个工作区实例 · {agents.length} 个 Agent</p>
    <ul>{agents.map(([id, agent]) => <Agent key={id} source={agent} />)}</ul></article>;
});

const Host = memo(function Host({ source }: { source: Cell<HostRow | undefined> })
{
  const host = useCell(source);

  return host && <p>宿主 CPU {host.cpuPercent === undefined ? '采样中' : host.cpuPercent.toFixed(1) + '%'} · 内存 {(host.rssBytes / 1048576).toFixed(1)} MiB</p>;
});

export const LiveMonitor = memo(function LiveMonitor()
{
  const [view] = useState(monitorView);

  const offices = useCell(view.offices.list);

  useEffect(() => window.cbim?.WatchMonitor?.(view.update), [view]);

  if (!window.cbim?.WatchMonitor)
    return null;

  return <section className="runtime-section"><h2>实时运行实例</h2><Host source={view.host} />
    {offices.map(([id, office]) => <Office key={id} source={office} />)}</section>;
});
