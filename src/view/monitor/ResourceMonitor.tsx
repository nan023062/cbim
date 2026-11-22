/**
 * 作用定位：对照查看 CBIM 运行资源与宿主的真实操作系统进程。
 * 设计原因：只读订阅业务与进程指标并在卸载时清理监听，不把监控列表变成进程控制入口。
 */
import { memo, useEffect, useState } from 'react';

import type { ProcessGroup, ProcessRow } from '../../bridge/contracts/discovery';

import { Icon } from '../../framework-ui';

import './monitor.css';

const ResourceList = memo(function ResourceList({ title, rows, icon }: { title: string; rows: ProcessRow[]; icon: string })
{
  return <details open><summary>{title}<b>{rows.length}</b></summary>
    {rows.map(row => <div className="resource-entry" key={row.id}>{row.logo ? <img alt="" src={row.logo} width={16} height={16} /> : <Icon name={icon} size={15} />}
      <div><strong>{row.name}</strong><small>{row.detail}</small></div></div>)}
  </details>;
});

export function ResourceMonitor()
{
  const [runtime, setRuntime] = useState<Extract<ProcessGroup,
    {
      group: 'runtime'
    }>>();

  const [processes, setProcesses] = useState<ProcessRow[]>([]);

  useEffect(() => window.WatchProcesses(update => { if (update.group === 'runtime') setRuntime(update); else setProcesses([...update.rows].sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0))); }), []);

  return <main className="process-monitor">
    <header><Icon name="flow" size={16} />资源监视器</header>
    <div className="process-list">
      {runtime && <>
        <div className="load-summary"><div><strong>虚拟总负载</strong><b>{runtime.load.total} / {runtime.load.threshold}</b></div>
          <progress aria-label="虚拟总负载" max={runtime.load.threshold} value={runtime.load.total} />
          <small>每进程 {runtime.load.weights.agents} · 每核心 {runtime.load.weights.engines} · 每磁盘 {runtime.load.weights.workspaces} · 每外设 {runtime.load.weights.connectors}</small>
        </div>
        <div className="flow-summary">流量（Token 速度）<b>{runtime.traffic.toFixed(1)} tok/s</b></div>
        <ResourceList title="进程（Agent 实例）" rows={runtime.agents} icon="person" />
        <ResourceList title="CPU 核心（引擎实例）" rows={runtime.engines} icon="api" />
        <ResourceList title="磁盘（Workspace 实例）" rows={runtime.disks} icon="folder" />
        <ResourceList title="外设（链接器实例）" rows={runtime.peripherals} icon="connector" />
      </>}
      <section className="host-processes"><h2>操作系统进程 · CBIM</h2>
        <div className="process-columns"><span>进程</span><span>CPU ↓</span><span>内存</span><span>PID</span></div>
        {processes.map(row => <div key={row.id} className="process-columns"><span className="process-name"><Icon name="desktop" size={15} /><span>{row.name}<small>{row.detail}</small></span></span>
          <span>{row.cpu?.toFixed(1)}%</span><span>{Math.round((row.memoryKiB ?? 0) / 1024)} MB</span><span>{row.pid}</span></div>)}
      </section>
    </div>
  </main>;
}
