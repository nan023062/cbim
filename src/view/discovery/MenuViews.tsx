/**
 * 作用定位：发现页负责展示和筛选资源，运行管理页读取当前应用的监控快照。
 * 设计原因：React 页面只筛选和展示发现结果，资源安装与连接器生命周期由宿主入口处理。
 */
import { useEffect, useState } from 'react';

import type { DiscoveryPage, DiscoveryResult } from '../../bridge/contracts/discovery';

import { EnginePackagesView } from './EnginePackagesView';

import { useTransfers, TransferProgress } from '../shared/transfers';

function ConnectorInstall({ id }: { id: string })
{
  const [status, setStatus] = useState<
    {
      installed: boolean;

      identity: string
    }>();

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState('');

  const transfers = useTransfers();

  useEffect(() => { let active = true; window.desktopMenu.Connector(id, false).then(s => { if (active) setStatus(s); }).catch(e => { if (active) setError(String(e)); }); return () => { active = false; }; }, [id]);

  const transfer = transfers.find(t => t.identity === status?.identity);

  return <><button disabled={!status || status.installed || busy} onClick={async () => { setError(''); setBusy(true); try { setStatus(await window.desktopMenu.Connector(id, true)); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>{busy ? '正在安装' : status?.installed ? '已是最新版本' : '下载安装'}</button>
    {transfer && <TransferProgress item={transfer} />} {error && <small role="alert">{error}</small>}</>;
}

function useMenuData<T>(load: () => Promise<T>)
{
  const [data, setData] = useState<T>();

  const [error, setError] = useState('');

  const [revision, setRevision] = useState(0);

  useEffect(() => { let current = true; setError(''); Promise.resolve().then(load).then(value => { if (current) setData(value); }).catch(e => { if (current) setError(String(e)); }); return () => { current = false; }; }, [revision, load]);

  return { data, error, refresh: () => setRevision(r => r + 1) };
}

export function DiscoveryView({ page, title }: { page: DiscoveryPage; title: string })
{
  if (page === 'engines')
    return <EnginePackagesView />;

  return <ResourceListPage key={page} page={page} title={title} />;
}

function ResourceListPage({ page, title }: { page: DiscoveryPage; title: string })
{
  const [load] = useState(() => () => window.desktopMenu.Resources(page));

  const { data, error, refresh } = useMenuData<DiscoveryResult>(load);

  const [query, setQuery] = useState('');

  const [kind, setKind] = useState('');

  const items = data?.items.filter(i => (!kind || i.kind === kind) && (i.name + ' ' + i.summary).toLowerCase().includes(query.toLowerCase()));

  return <section className="view-page menu-page"><header className="view-heading"><h1>{title}</h1><button onClick={refresh}>刷新</button></header>
    {error && <p role="alert">{error}</p>}
    {data && <><div className="repository-bar"><strong>{data.source}</strong></div>
      <div className="graph-toolbar"><input aria-label="搜索资源" placeholder="搜索名称或说明…" value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label="资源类型" value={kind} onChange={e => setKind(e.target.value)}><option value="">全部类型</option>{[...new Set(data.items.map(i => i.kind))].map(k => <option key={k}>{k}</option>)}</select></div>
      <div className="definition-grid">{items?.map(item => <article className="definition-card" key={item.id}><small>{item.kind}</small><h3>{item.name}</h3><p>{item.summary}</p>{page === 'connectors' && <ConnectorInstall id={item.id} />}</article>)}</div>
      {!items?.length && <p role="status">{query || kind ? '没有匹配的资源' : '暂无可展示的资源'}</p>}</>}
  </section>;
}
