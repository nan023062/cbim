/**
 * 作用定位：发现页负责展示和筛选资源，运行管理页读取当前应用的监控快照。
 * 设计原因：React 页面只筛选和展示发现结果，资源安装与连接器生命周期由宿主入口处理。
 */
import { useEffect, useState } from 'react';

import type { DiscoveryPage, RegistryVersion } from '../../bridge/contracts/discovery';

import { Tabs } from '../../framework-ui/tabs';

import { EnginePackagesView } from './EnginePackagesView';

import { useTransfers, TransferProgress } from '../shared/transfers';

function ConnectorInstall({ id, digest }: { id: string; digest:string })
{
  const [status, setStatus] = useState<
    {
      installed: boolean;

      identity: string
    }>();

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState('');

  const transfers = useTransfers();

  useEffect(() => { let active = true; window.desktopMenu.Connector(id, false,digest).then(s => { if (active) setStatus(s); }).catch(e => { if (active) setError(String(e)); }); return () => { active = false; }; }, [id,digest]);

  const transfer = transfers.find(t => t.identity === status?.identity);

  if(status && status.identity!==digest)return <small>此版本不在当前签名安装目录中</small>;
  return <><button disabled={!status || status.installed || busy} onClick={async () => { setError(''); setBusy(true); try { setStatus(await window.desktopMenu.Connector(id, true,digest)); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>{busy ? '正在安装' : status?.installed ? '已是最新版本' : '下载安装'}</button>
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

export function ResourceMarket(){
  const [page,setPage]=useState<DiscoveryPage>('engines');
  return <section className="view-page menu-page resource-market"><Tabs label="资源商城分类" value={page} onChange={id=>setPage(id as DiscoveryPage)}
    items={(Object.keys(registryKinds) as DiscoveryPage[]).map(id=>({id,label:registryLabels[id],content:page===id?<><LocalRegistry key={id} page={id}/>{id==='engines'&&<EnginePackagesView/>}</>:null}))}/></section>;
}

const registryKinds={engines:'engine',connectors:'connector',talent:'talent',templates:'business'} as const;
const registryLabels={engines:'引擎',connectors:'连接器',talent:'人力',templates:'业务'};
function LocalRegistry({page}:{page:DiscoveryPage}){
  const [load]=useState(()=>()=>window.desktopMenu.RegistryList());
  const {data,error,refresh}=useMenuData(load);
  const [id,setId]=useState(''),[version,setVersion]=useState('1.0.0'),[busy,setBusy]=useState(false),[note,setNote]=useState('');
  const [query,setQuery]=useState('');
  const kind=registryKinds[page],rows=data?.filter(row=>row.kind===kind && (row.id+' '+row.version).includes(query.trim().toLowerCase()));
  async function act(row?:RegistryVersion){
    setBusy(true);setNote('');
    try{
      if(row)setNote('已校验并保存到：'+await window.desktopMenu.RegistryPull(row));
      else{const result=await window.desktopMenu.RegistryPublish({kind,id,version});if(result){setNote('已发布 '+result.id+' '+result.version);refresh();}}
    }catch(e){setNote(String(e));}finally{setBusy(false);}
  }
  return <section className="view-page menu-page"><header className="view-heading"><h2>{registryLabels[page]}资源</h2><button onClick={refresh} disabled={busy}>刷新</button></header>
    <div className="graph-toolbar"><input aria-label="筛选商城资源" placeholder="按资源 ID 或版本筛选" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    <form className="graph-toolbar" onSubmit={e=>{e.preventDefault();void act();}}>
      <label>资源 ID <input required pattern="[a-z][a-z0-9\-]{0,47}" placeholder="例如 planner" value={id} onChange={e=>setId(e.target.value)}/></label>
      <label>版本 <input required pattern={'[0-9]{1,8}\\.[0-9]{1,8}\\.[0-9]{1,8}'} value={version} onChange={e=>setVersion(e.target.value)}/></label>
      <button disabled={busy}>上传并发布</button></form>
    {error&&<p role="alert">{error}</p>}{(busy||note)&&<p role="status">{busy?'正在处理…':note}</p>}
    {!data&&!error&&<p>正在读取商城目录…</p>}{rows?.length===0&&<p>{query?'没有匹配的资源':'尚无已发布的'+registryLabels[page]}</p>}
    <div className="definition-grid">{rows?.map(row=><article className="definition-card" key={row.id+'@'+row.version}><h3>{row.id}</h3><p>{row.version} · {row.size.toLocaleString()} 字节</p><button disabled={busy} onClick={()=>void act(row)}>下载此版本</button>{page==='connectors'&&<ConnectorInstall id={row.id} digest={row.sha256}/>}</article>)}</div>
  </section>;
}
