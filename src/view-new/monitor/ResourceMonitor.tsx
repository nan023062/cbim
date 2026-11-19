/** 独立的资源监视器视图，按 CPU 占用显示 Agent 实例与桌面进程。 */
import { useEffect, useState } from 'react';
import type { ProcessRow } from '../../bridge/contracts/discovery';
import { Icon } from '../shared/Icon';
import './monitor.css';

export function ResourceMonitor()
{
  const [agents, setAgents] = useState<ProcessRow[]>([]);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [selection, select] = useState('');
  useEffect(() => window.watchProcesses(update => {
    if (update.group === 'agents') setAgents(update.rows);
    else setProcesses([...update.rows].sort((a,b) => (b.cpu ?? 0) - (a.cpu ?? 0)));
  }), []);
  const selected = [...agents, ...processes].find(row => row.id === selection);
  return <main className="process-monitor">
    <header><Icon name="flow" size={16} />资源监视器</header>
    <div className="process-columns"><span>进程</span><span>CPU ↓</span><span>内存</span><span>PID</span></div>
    <div className="process-list">{([['Agent 实例',agents],['应用进程',processes]] as const).map(([title,rows]) =>
      <section key={title}><h2>{title}</h2>
        {rows.map(row => <button className="process-columns" key={row.id} aria-pressed={selection === row.id} onClick={() => select(row.id)}>
          <span className="process-name"><Icon name={row.pid ? 'desktop' : 'person'} size={15} /><span>{row.name}{row.detail && <small>{row.detail}</small>}</span></span>
          <span>{row.cpu === undefined ? '—' : row.cpu.toFixed(1)+'%'}</span>
          <span>{row.memoryKiB === undefined ? '—' : Math.round(row.memoryKiB/1024)+' MB'}</span><span>{row.pid ?? '—'}</span>
        </button>)}
        {!rows.length && <p>{title === 'Agent 实例' ? '当前没有运行中的 Agent' : '正在读取进程'}</p>}
      </section>)}</div>
    <footer><span>{selected?.name ?? '选择一个进程'}</span><button disabled title="当前窗口提供只读监控">终止进程</button></footer>
  </main>;
}
