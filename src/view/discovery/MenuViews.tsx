/**
 * 作用定位：发现页负责展示和筛选资源，运行管理页读取当前应用的监控快照。
 * 设计原因：React 页面只筛选和展示发现结果，资源安装与连接器生命周期由宿主入口处理。
 */
import { IconButton, Button, Checkbox, ConfirmWindow, Disclosure, DisclosureSummary, FieldLabel, Form, Icon, Input, Option, Select, Tabs, Tooltip, type IconName } from '../../framework-ui';
import { useEffect, useState, useRef, useLayoutEffect } from 'react';

import type { ProjectItem, RegistryPublication, RegistryVersion } from '../../bridge/contracts/discovery';





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
      <Button
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
      </Button>
      {transfer && <TransferProgress item={transfer} />}
      {state.installed && (
        <Button disabled={busy} onClick={() => setConfirm(true)}>
          卸载此版本
        </Button>
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
const glyphs = { engine: 'terminal', connector: 'connector', talent: 'teamAdd', business: 'folder' };
const marketStatusIcons = {
  '已安装': 'success', '已启用': 'play', '已停用': 'pause', '未安装': 'download',
  '已卸载': 'remove', '可更新': 'refresh', '本机状态未知': 'warning', '正在读取本机状态…': 'queued',
} as const satisfies Record<string, IconName>;
type MarketStatus = keyof typeof marketStatusIcons;

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
  return <section><Button disabled={busy} onClick={()=>void request('')}>检查已导入实例</Button>
    {Boolean(preview?.instances.length)&&<FieldLabel>目标实例<Select disabled={busy} value={instance} onChange={e=>void request(e.target.value)}><Option value="">选择项目实例</Option>{preview!.instances.map(item=><Option key={item.id} value={item.id}>{item.name} · v{item.version} · {item.id.slice(0,8)}</Option>)}</Select></FieldLabel>}
    {instance&&preview&&<><p>{preview.changes.length?'选择要合并的差异':'当前实例与此版本一致'}</p>{preview.changes.map(change=><FieldLabel key={change.id} style={{display:'block',overflowWrap:'anywhere'}}><Checkbox disabled={busy} checked={fields.includes(change.id)} onChange={e=>setFields(e.target.checked?[...fields,change.id]:fields.filter(id=>id!==change.id))}/>{change.label} · 当前 {change.before} → 模板 {change.after}</FieldLabel>)}<Button disabled={busy||!fields.length} onClick={()=>void request(instance,true)}>合并选定变更</Button></>}
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
  function localStatus(v: RegistryVersion): MarketStatus | '' {
    if (v.kind !== 'engine' && v.kind !== 'connector') return '';
    const engine = v.kind === 'engine' && engines.data?.managed ? engines.data.items.find(x => x.kind === v.id) : undefined;
    if (engine?.active) return engine.enabled ? '已启用' : '已停用';
    if (inventory.error) return '本机状态未知';
    if (!inventory.data) return '正在读取本机状态…';
    if (inventory.data.some(x => x.kind === v.kind && x.id === v.id && x.installed.length)) return '已安装';
    return removed(v) ? '已卸载' : '未安装';
  }
  const engine = row?.kind === 'engine' ? engines.data?.items.find(x => x.kind === row.id) : undefined;
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
        <FieldLabel>
          搜索资源 <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </FieldLabel>
        <FieldLabel>
          状态{' '}
          <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <Option value="all">全部状态</Option>
            <Option disabled value="owned">
              已购（权益服务未接入）
            </Option>
            <Option value="removed">已卸载</Option>
            <Option value="update">可更新</Option>
          </Select>
        </FieldLabel>
      </div>
      {!catalog.data && !catalog.error && <p>正在读取商城目录…</p>}
      {catalog.data && !filtered.length && <p>没有符合条件的资源。</p>}
      <div className="definition-grid">
        {filtered.map(([identity, group]) => {
          const v = group[0],
            item = v.kind === 'engine' ? engines.data?.items.find((x) => x.kind === v.id) : undefined;
          const state = localStatus(v);
          const statuses: MarketStatus[] = state ? [state] : [];
          if (updatable(v)) statuses.push('可更新');
          return (
            <Button
              type="button"
              className="definition-card market-card"
              aria-description={statuses.join('，') || undefined}
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
              {statuses.length > 0 && <span className="market-statuses">
                {statuses.map(label => <Tooltip key={label} text={label}><span className="market-status" data-status={marketStatusIcons[label]} aria-label={label} role="img"><Icon name={marketStatusIcons[label]} size={16} /></span></Tooltip>)}
              </span>}
            </Button>
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
          <IconButton aria-label="发布资源" onClick={() => setPublishing(!publishing)}><Icon name="upload" /></IconButton>
          <IconButton aria-label="刷新"
            disabled={busy}
            onClick={() => {
              catalog.refresh();
              engines.refresh();
              inventory.refresh();
            }}
          ><Icon name="refresh" /></IconButton>
        </header>
        {publishing && (
          <Form
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
            <FieldLabel>
              类别
              <Select name="kind">
                {Object.entries(kinds).map(([id, label]) => (
                  <Option key={id} value={id}>
                    {label}
                  </Option>
                ))}
              </Select>
            </FieldLabel>
            <FieldLabel>
              资源 ID
              <Input required name="id" pattern="[a-z][a-z0-9\-]{0,47}" />
            </FieldLabel>
            <FieldLabel>
              版本
              <Input
                name="version"
                required
                defaultValue="1.0.0"
                pattern={'[0-9]{1,8}\\.[0-9]{1,8}\\.[0-9]{1,8}'}
              />
            </FieldLabel>
            {Object.entries({
              name: '商品名称',
              summary: '功能说明',
              developer: '开发者',
              preview: '预览说明',
              changes: '更新记录',
            }).map(([id, label]) => (
              <FieldLabel key={id}>
                {label}
                <Input
                  name={id}
                  maxLength={id === 'name' || id === 'developer' ? 100 : id === 'summary' ? 500 : 1000}
                />
              </FieldLabel>
            ))}
            <FieldLabel>
              商品图片<Input name="logo" type="file" accept="image/png,image/jpeg,image/webp"/>
            </FieldLabel><FieldLabel>
              价格（人民币元）
              <Input type="number" min="0" max="1000000" step=".01" name="price" />
            </FieldLabel>
            <Button type="submit" disabled={busy}>选择文件并发布</Button>
          </Form>
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
      </section>
      {row && rows && (
        <section>
          <Button disabled={busy} onClick={() => setKey('')}>
            返回商城
          </Button>
          <h2 tabIndex={-1} ref={heading}>
            {row.metadata?.name ?? row.id}
          </h2>
          <p>
            {kinds[row.kind]} · {price(row)}
          </p>
          <FieldLabel>
            版本{' '}
            <Select
              disabled={busy}
              value={version}
              onChange={(e) => {
                setVersion(e.target.value);
                setError('');
                setMessage('');
              }}
            >
              {rows.map((v) => (
                <Option key={v.version}>{v.version}</Option>
              ))}
            </Select>
          </FieldLabel>
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
          {(row.kind === 'engine' || row.kind === 'connector') && <section aria-label="本机状态">
            <h3>本机状态</h3><p>{localStatus(row)}{engine?.active && ' · 当前版本 v' + engine.active.version}</p>
            {row.kind === 'engine' && engines.error && <p role="alert">{engines.error}</p>}
            {engine && engines.data?.managed && <>
              {engine.active && <Button disabled={busy || engine.preparing || (engine.enabled && engine.references > 0)}
                title={engine.enabled && engine.references > 0 ? '使用中的引擎不能停用' : undefined}
                onClick={() => void act(async () => {
                  try {
                    await window.desktopMenu.Engines('configure', { kind: engine.kind, revision: engines.data!.revision, action: engine.enabled ? 'disable' : 'enable' });
                    return engine.enabled ? '已停用引擎' : '已启用引擎';
                  } finally { engines.refresh(); }
                })}>{engine.enabled ? '停用' : '启用'}</Button>}
              <Disclosure><DisclosureSummary>缓存与依赖</DisclosureSummary>
                <p>使用中 · {engine.references}</p>
                {engine.installed.length ? engine.installed.map(v => <p key={v.identity}>已缓存 v{v.version} · {v.identity.slice(0,12)}</p>) : <p>暂无缓存版本</p>}
                {(engine.active ?? engine.candidate)?.dependencies?.map(dep => <p key={dep.identity}>依赖 {dep.kind} · {dep.identity.slice(0,12)}</p>)}
              </Disclosure>{engine.error && <p role="alert">{engine.error}</p>}
            </>}
          </section>}
          {paid ? (
            <p>此版本需要购买权益，当前未接入支付和授权服务。</p>
          ) : row.kind === 'talent' || row.kind === 'business' ? (
            <>
              <Button
                disabled={busy || !project}
                onClick={() =>
                  void act(async () => {
                    await window.desktopMenu.RegistryImport(row, project!.id);
                    return '已导入 ' + project!.name;
                  })
                }
              >
                {project ? '导入到 ' + project.name : '请先打开项目'}
              </Button>
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
            <Disclosure>
              <DisclosureSummary>版本文件</DisclosureSummary>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(async () => '已校验并缓存到 ' + (await window.desktopMenu.RegistryPull(row)))
                }
              >
                下载所选版本文件
              </Button>
            </Disclosure>
          )}
        </section>
      )}
      {busy && <p role="status">正在处理…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
