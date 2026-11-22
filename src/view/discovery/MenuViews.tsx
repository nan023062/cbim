/**
 * 作用定位：发现页负责展示和筛选资源，运行管理页读取当前应用的监控快照。
 * 设计原因：React 页面只筛选和展示发现结果，资源安装与连接器生命周期由宿主入口处理。
 */
import { useEffect, useState, useRef, useLayoutEffect } from 'react';

import type { ProjectItem, RegistryPublication, RegistryVersion } from '../../bridge/contracts/discovery';

import { Icon } from '../../framework-ui';

import { ConfirmWindow } from '../../framework-ui';

import { Tabs } from '../../framework-ui';

import { EnginePackagesView } from './EnginePackagesView';

import { useTransfers, TransferProgress } from '../shared/transfers';

function PluginActions({
  row,
  project,
  busy,
  run,
  changed,
}: {
  row: RegistryVersion;
  project?: ProjectItem;
  busy: boolean;
  run: (action: () => Promise<string>) => Promise<void>;
  changed: () => void;
}) {
  const [state, setState] = useState<Awaited<ReturnType<typeof window.desktopMenu.RegistryPlugin>>>();
  const [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const transfers = useTransfers(),
    transfer = transfers.find((item) => item.identity === row.sha256);
  useEffect(() => {
    let live = true;
    window.desktopMenu
      .RegistryPlugin(project?.id, row, 'read')
      .then((result) => {
        if (live) setState(result);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [project?.id, row.sha256]);
  function apply(action: 'install' | 'remove') {
    return run(async () => {
      const updated = await window.desktopMenu.RegistryPlugin(project?.id, row, action);
      setState(updated);
      setConfirm(false);
      changed();
      return action === 'remove'
        ? '已卸载所选版本，项目引用已核对'
        : updated.referenced
          ? '项目已引用 v' + row.version
          : '已安装 v' + row.version;
    });
  }
  if (!state) return <p role={error ? 'alert' : 'status'}>{error || '正在读取本机版本…'}</p>;
  return (
    <>
      <button
        disabled={
          busy ||
          (!state.installed && !state.candidate) ||
          (state.installed && (!project || state.referenced))
        }
        onClick={() => void apply('install')}
      >
        {state.referenced
          ? '项目正在引用'
          : state.installed
            ? project
              ? '在 ' + project.name + ' 引用'
              : '本机已安装'
            : state.candidate
              ? project
                ? '安装并在 ' + project.name + ' 引用'
                : '安装到本机'
              : '暂无匹配的签名版本'}
      </button>
      {transfer && <TransferProgress item={transfer} />}
      {state.installed && (
        <button disabled={busy} onClick={() => setConfirm(true)}>
          卸载此版本
        </button>
      )}
      {confirm && (
        <ConfirmWindow
          title={'卸载 ' + row.id + ' v' + row.version}
          onCancel={() => setConfirm(false)}
          busy={busy}
          onConfirm={() => void apply('remove')}
          confirmLabel="卸载"
          danger
        >
          当前项目若引用此版本，将回退到剩余的最高安装版本；最后一个版本卸载后将清除引用。其他项目占用时会阻止卸载。
        </ConfirmWindow>
      )}
    </>
  );
}

function useMenuData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>();

  const [error, setError] = useState('');

  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let current = true;
    setError('');
    Promise.resolve()
      .then(load)
      .then((value) => {
        if (current) setData(value);
      })
      .catch((e) => {
        if (current) setError(String(e));
      });
    return () => {
      current = false;
    };
  }, [revision, load]);

  return { data, error, refresh: () => setRevision((r) => r + 1) };
}

const kinds = { engine: '引擎', connector: '连接器', talent: '人力', business: '业务' } as const;
const glyphs = { engine: 'terminal', connector: 'link', talent: 'teamAdd', business: 'folder' };
function ProductLogo({src,kind}:{src?:string;kind:Kind}){
  const [failed,setFailed]=useState('');
  return src&&failed!==src?<img src={src} alt="" width="36" height="36" onError={()=>setFailed(src)}/>:<Icon name={glyphs[kind]} size={32}/>;
}
function TemplateUpdates({row,project}:{row:RegistryVersion;project:ProjectItem}){
  const [preview,setPreview]=useState<Awaited<ReturnType<typeof window.desktopMenu.RegistryImport>>>(),[instance,setInstance]=useState(''),[fields,setFields]=useState<string[]>([]),[busy,setBusy]=useState(false),[note,setNote]=useState('');
  async function request(next:string,merge=false){
    setBusy(true);setNote('');
    try{
      const result=await window.desktopMenu.RegistryImport(row,project.id,merge?'merge':'preview',next?{instance:next,revision:preview?.revision??0,fields:merge?fields:[]}:undefined);
      if(merge){setPreview(undefined);setInstance('');setNote('已合并选定变更。')}
      else {setPreview(result);setInstance(next);if(!result.instances.length)setNote('此项目还没有来自该商品的实例。')}
      setFields([]);
    }catch(e){setNote(String(e))}finally{setBusy(false)}
  }
  return <section><button disabled={busy} onClick={()=>void request('')}>检查已导入实例</button>
    {Boolean(preview?.instances.length)&&<label>目标实例<select disabled={busy} value={instance} onChange={e=>void request(e.target.value)}><option value="">选择项目实例</option>{preview!.instances.map(item=><option key={item.id} value={item.id}>{item.name} · v{item.version} · {item.id.slice(0,8)}</option>)}</select></label>}
    {instance&&preview&&<><p>{preview.changes.length?'选择要合并的差异':'当前实例与此版本一致'}</p>{preview.changes.map(change=><label key={change.id} style={{display:'block',overflowWrap:'anywhere'}}><input disabled={busy} type="checkbox" checked={fields.includes(change.id)} onChange={e=>setFields(e.target.checked?[...fields,change.id]:fields.filter(id=>id!==change.id))}/>{change.label} · 当前 {change.before} → 模板 {change.after}</label>)}<button disabled={busy||!fields.length} onClick={()=>void request(instance,true)}>合并选定变更</button></>}
    <p role="status">{busy?'正在处理…':note}</p></section>;
}
type Kind = keyof typeof kinds;
const compare = new Intl.Collator('en', { numeric: true });
const loadCatalog = () => window.desktopMenu.RegistryList();
const loadInventory = () => window.desktopMenu.RegistryInventory();
const loadHistory = () => window.desktopMenu.RegistryHistory();
const loadEngines = () => window.desktopMenu.Engines('list');
function price(row: RegistryVersion) {
  const amount = row.metadata?.priceCnyFen;
  return amount === undefined ? '价格未提供' : amount === 0 ? '免费' : '人民币 ¥' + (amount / 100).toFixed(2);
}
/** 分类共用整卡入口，精确版本的读写始终由宿主校验。 */
export function ResourceMarket({ project }: { project?: ProjectItem }) {
  const catalog = useMenuData(loadCatalog),
    engines = useMenuData(loadEngines),
    history = useMenuData(loadHistory),
    inventory = useMenuData(loadInventory);
  const [tab, setTab] = useState('all'),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [key, setKey] = useState(''),
    [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [publishing, setPublishing] = useState(false);
  const card = useRef<HTMLButtonElement | null>(null),
    heading = useRef<HTMLHeadingElement>(null),
    container = useRef<HTMLElement>(null),
    offset = useRef(0);
  const groups = new Map<string, RegistryVersion[]>();
  const known = new Map(
    [...(history.data ?? []).map((x) => x.row), ...(catalog.data ?? [])].map((x) => [
      x.kind + '/' + x.id + '@' + x.version,
      x,
    ]),
  );
  for (const row of known.values()) {
    const identity = row.kind + '/' + row.id;
    const group = groups.get(identity) ?? [];
    group.push(row);
    groups.set(identity, group);
  }
  for (const group of groups.values()) group.sort((a, b) => compare.compare(b.version, a.version));
  const rows = groups.get(key),
    row = rows?.find((v) => v.version === version);
  const paid = (row?.metadata?.priceCnyFen ?? 0) > 0;
  function updatable(v: RegistryVersion) {
    const local = inventory.data?.find((x) => x.id === v.id && x.kind === v.kind);
    return (
      local?.candidate === v.sha256 &&
      local.installed.length > 0 &&
      local.installed.every((x) => compare.compare(x.version, v.version) < 0)
    );
  }
  useLayoutEffect(() => {
    if (key) {
      heading.current?.focus();
      if (container.current) container.current.scrollTop = 0;
    } else if (card.current) {
      card.current.focus({ preventScroll: true });
      if (container.current) container.current.scrollTop = offset.current;
    }
  }, [key]);
  async function act(action: () => Promise<string>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setMessage(await action());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function removed(v: RegistryVersion) {
    const items = history.data?.filter((x) => x.row.kind === v.kind && x.row.id === v.id) ?? [];
    return (
      items.length > 0 &&
      items.some((x) => x.removed) &&
      Boolean(inventory.data) &&
      !inventory.data?.find((x) => x.kind === v.kind && x.id === v.id)?.installed.length
    );
  }
  const filtered = [...groups].filter(
    ([, group]) =>
      (tab === 'all' || tab === group[0].kind) &&
      (filter === 'all' ||
        (filter === 'update' && updatable(group[0])) ||
        (filter === 'removed' && removed(group[0]))) &&
      group.some((v) =>
        [v.id, v.version, v.metadata?.name, v.metadata?.developer].some((s) =>
          s?.toLowerCase().includes(query.trim().toLowerCase()),
        ),
      ),
  );
  const panel = (
    <>
      <div className="graph-toolbar">
        <label>
          搜索资源 <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          状态{' '}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部状态</option>
            <option disabled value="owned">
              已购（权益服务未接入）
            </option>
            <option value="removed">已卸载</option>
            <option value="update">可更新</option>
          </select>
        </label>
      </div>
      {!catalog.data && !catalog.error && <p>正在读取商城目录…</p>}
      {catalog.data && !filtered.length && <p>没有符合条件的资源。</p>}
      <div className="definition-grid">
        {filtered.map(([identity, group]) => {
          const v = group[0],
            item = v.kind === 'engine' ? engines.data?.items.find((x) => x.kind === v.id) : undefined;
          return (
            <button
              type="button"
              className="definition-card market-card"
              key={identity}
              onClick={(e) => {
                card.current = e.currentTarget;
                offset.current = container.current?.scrollTop ?? 0;
                setVersion(group.find((x) => x.version === query.trim())?.version ?? v.version);
                setKey(identity);
                setMessage('');
                setError('');
              }}
            >
              <ProductLogo src={v.metadata?.logo||item?.logo} kind={v.kind}/>
              <strong>{v.metadata?.name ?? v.id}</strong>
              <span>{v.metadata?.summary}</span>
              <small>
                {kinds[v.kind]} · {price(v)} · 最新 v{v.version} · 安装量暂无统计
              </small>
              {updatable(v) && <b>可更新</b>}
              {removed(v) && <b>已卸载</b>}
            </button>
          );
        })}
      </div>
    </>
  );
  return (
    <section ref={container} className="view-page menu-page resource-market">
      <section hidden={Boolean(key)}>
        <header className="view-heading">
          <h2>资源商城</h2>
          <button onClick={() => setPublishing(!publishing)}>发布资源</button>
          <button
            disabled={busy}
            onClick={() => {
              catalog.refresh();
              engines.refresh();
              inventory.refresh();
            }}
          >
            刷新
          </button>
        </header>
        {publishing && (
          <form
            className="graph-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              const fields = new FormData(e.currentTarget),
                get = (name: string) => String(fields.get(name) ?? '').trim();
              const metadata: RegistryPublication['metadata'] = {};
              for (const name of ['name', 'summary', 'developer', 'preview', 'changes'] as const)
                if (get(name)) metadata[name] = get(name);
              if (get('price')) metadata.priceCnyFen = Math.round(Number(get('price')) * 100);
              void act(async () => {
                const image=fields.get('logo');
                if(image instanceof File&&image.size){
                  if(image.size>72000||!['image/png','image/jpeg','image/webp'].includes(image.type))throw Error('请选择 72 KB 以内的 PNG、JPEG 或 WebP 图片');
                  metadata.logo=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(image)});
                }
                const receipt = await window.desktopMenu.RegistryPublish({
                  kind: get('kind') as Kind,
                  id: get('id'),
                  version: get('version'),
                  metadata,
                });
                if (!receipt) return '已取消发布';
                catalog.refresh();
                setPublishing(false);
                return '已发布 ' + receipt.id + ' v' + receipt.version;
              });
            }}
          >
            <label>
              类别
              <select name="kind">
                {Object.entries(kinds).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              资源 ID
              <input required name="id" pattern="[a-z][a-z0-9\-]{0,47}" />
            </label>
            <label>
              版本
              <input
                name="version"
                required
                defaultValue="1.0.0"
                pattern={'[0-9]{1,8}\\.[0-9]{1,8}\\.[0-9]{1,8}'}
              />
            </label>
            {Object.entries({
              name: '商品名称',
              summary: '功能说明',
              developer: '开发者',
              preview: '预览说明',
              changes: '更新记录',
            }).map(([id, label]) => (
              <label key={id}>
                {label}
                <input
                  name={id}
                  maxLength={id === 'name' || id === 'developer' ? 100 : id === 'summary' ? 500 : 1000}
                />
              </label>
            ))}
            <label>
              商品图片<input name="logo" type="file" accept="image/png,image/jpeg,image/webp"/>
            </label><label>
              价格（人民币元）
              <input type="number" min="0" max="1000000" step=".01" name="price" />
            </label>
            <button disabled={busy}>选择文件并发布</button>
          </form>
        )}
        <Tabs
          label="资源分类"
          value={tab}
          onChange={setTab}
          items={Object.entries({ all: '全部', ...kinds }).map(([id, label]) => ({
            id,
            label,
            content: tab === id ? panel : null,
          }))}
        />
        {catalog.error && <p role="alert">{catalog.error}</p>}
        <details>
          <summary>本机引擎管理</summary>
          <EnginePackagesView />
        </details>
      </section>
      {row && rows && (
        <section>
          <button disabled={busy} onClick={() => setKey('')}>
            返回商城
          </button>
          <h2 tabIndex={-1} ref={heading}>
            {row.metadata?.name ?? row.id}
          </h2>
          <p>
            {kinds[row.kind]} · {price(row)}
          </p>
          <label>
            版本{' '}
            <select
              disabled={busy}
              value={version}
              onChange={(e) => {
                setVersion(e.target.value);
                setError('');
                setMessage('');
              }}
            >
              {rows.map((v) => (
                <option key={v.version}>{v.version}</option>
              ))}
            </select>
          </label>
          <p>
            {row.size.toLocaleString()} 字节 · {row.id}
          </p>
          <h3>功能</h3>
          <p>{row.metadata?.summary || '发布者未提供说明'}</p>
          <h3>预览</h3>
          <p>{row.metadata?.preview || '暂无预览'}</p>
          <h3>开发者</h3>
          <p>{row.metadata?.developer || '未提供'}</p>
          <h3>更新记录</h3>
          <ul>
            {rows.map((v) => (
              <li key={v.version}>
                v{v.version} · {v.metadata?.changes || '未提供更新说明'}
              </li>
            ))}
          </ul>
          {paid ? (
            <p>此版本需要购买权益，当前未接入支付和授权服务。</p>
          ) : row.kind === 'talent' || row.kind === 'business' ? (
            <>
              <button
                disabled={busy || !project}
                onClick={() =>
                  void act(async () => {
                    await window.desktopMenu.RegistryImport(row, project!.id);
                    return '已导入 ' + project!.name;
                  })
                }
              >
                {project ? '导入到 ' + project.name : '请先打开项目'}
              </button>
              {project&&<TemplateUpdates key={row.sha256+project.id} row={row} project={project}/>}
            </>
          ) : (
            <PluginActions
              key={row.kind + row.id + row.sha256 + project?.id}
              row={row}
              project={project}
              busy={busy}
              run={act}
              changed={() => {
                history.refresh();
                engines.refresh();
                inventory.refresh();
              }}
            />
          )}
          {!paid && (
            <details>
              <summary>版本文件</summary>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => '已校验并缓存到 ' + (await window.desktopMenu.RegistryPull(row)))
                }
              >
                下载所选版本文件
              </button>
            </details>
          )}
        </section>
      )}
      {busy && <p role="status">正在处理…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
