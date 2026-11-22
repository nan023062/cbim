/**
 * 作用定位：执行引擎的版本、下载安装与更新。
 * 设计原因：以宿主版本快照驱动安装操作和进度，页面不负责解包、校验或运行版本持有。
 */
import { ScrollWindow, Button, Disclosure, DisclosureSummary, FieldLabel, Icon, ListItem, Progress, Tooltip } from '../../framework-ui';
import { useEffect, useState } from 'react';

import type { EnginePackageSettings, EnginePackageStatus } from '../../bridge/contracts/desktop-engines';

import { EngineLogo } from '../shared/ResourceLogo';

import { useTransfers, TransferProgress } from '../shared/transfers';

function EngineVersionIcon({ state, kind }: { state?: EnginePackageSettings; kind: string })
{
  const item = state?.items.find(entry => entry.kind === kind);

  let icon = 'unknown',
    label = '版本状态未知';

  if (state?.managed && !item?.active)
  {
    icon = 'notRun';

    label = '未安装';
  }
  else if (state?.managed && item?.active && item.candidate)
  {
    const current = item.active.identity === item.candidate.identity;

    icon = current ? 'success' : 'retry';

    label = current ? '已是最新版本' : '可更新';
  }

  return <span className={'engine-version-icon ' + icon} role="img" aria-label={label} title={label}><Icon name={icon} size={16} /></span>;
}

export function EnginePackagesView()
{
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof window.desktopMenu.EngineCatalog>>>([]);

  const [selected, setSelected] = useState('codex');

  useEffect(() => { window.desktopMenu.EngineCatalog().then(setCatalog).catch(e => setError(String(e))); }, []);

  const [state, setState] = useState<EnginePackageSettings>();

  const [busy, setBusy] = useState('');

  const [error, setError] = useState('');

  useEffect(() => { window.desktopMenu.Engines('list').then(setState).catch(e => setError(String(e))); }, []);

  const preparing = !!state?.items.some(entry => entry.preparing);

  const installing = busy.startsWith('install:');

  useEffect(() => { if (!installing && !preparing) return; let active = true; let timer: ReturnType<typeof setTimeout>; async function refresh() { try { const snapshot = await window.desktopMenu.Engines('list'); if (active) setState(snapshot); } catch { /* Keep the current progress until the next snapshot. */ } if (active) timer = setTimeout(refresh, 750); } timer = setTimeout(refresh, 750); return () => { active = false; clearTimeout(timer); }; }, [installing, preparing]);

  async function update(item?: EnginePackageStatus, action?: 'enable' | 'disable' | 'remove')
  {
    setError('');

    setBusy(item ? (action ?? 'install') + ':' + item.kind : 'check');

    try
    {
      setState(action && item && state ? await window.desktopMenu.Engines('configure', { kind: item.kind, revision: state.revision, action }) : item?.candidate && state ? await window.desktopMenu.Engines('install', { kind: item.kind, revision: state.revision, identity: item.candidate.identity }) : await window.desktopMenu.Engines('check'));
    }
    catch (e)
    {
      setError(String(e));

      await window.desktopMenu.Engines('list').then(setState).catch(() => { });
    }
    finally
    {
      setBusy('');
    }
  }

  const transfers = useTransfers();

  // 目录保留尚未安装的产品，签名清单还可以提供额外的可安装引擎。
  const products = [...catalog, ...(state?.items ?? []).filter(item => !catalog.some(entry => entry.id === item.kind)).map(item => ({ id: item.kind, label: item.label, logo: item.logo, businessTypes: [], supportedApis: item.requirement.supportedApis, }))];

  const product = products.find(entry => entry.id === selected) ?? products[0];

  const item = state?.items.find(entry => entry.kind === product?.id);

  function progressFor(kind: string)
  {
    const engine = state?.items.find(entry => entry.kind === kind);

    const transfer = transfers.find(t => t.identity === (engine?.preparation?.identity ?? engine?.candidate?.identity));

    if (transfer)
      return { label: { queued: '排队中', downloading: '下载中', verifying: '校验中' }[transfer.phase], percent: Math.floor(100 * transfer.bytes / transfer.total) };

    if (!engine?.preparing && busy !== 'install:' + kind)
      return;

    const value = engine?.preparation?.progress;

    return { label: engine?.active ? '正在更新' : '正在安装', percent: value === undefined ? undefined : Math.floor(value) };
  }

  const progress = product && progressFor(product.id);

  return <section {...ScrollWindow.native} className="view-page menu-page engine-page"><header className="view-heading"><h1>执行引擎</h1><Button disabled={!!busy || state?.managed === false} onClick={() => void update()}>{busy === 'check' ? '正在检查…' : '检查更新'}</Button></header>
    {error && <p role="alert">{error}</p>}
    <div className="engine-layout">
      <nav className="engine-list" aria-label="支持的执行引擎">{products.map(entry =>
      {
        const row = progressFor(entry.id);

        const status = state?.items.find(item => item.kind === entry.id);

        return <div className="engine-catalog-row" key={entry.id}><Tooltip text={entry.label}><ListItem aria-label={entry.label} aria-current={entry.id===product?.id || undefined} onClick={()=>setSelected(entry.id)}>
        {row && <span aria-hidden="true" className={'engine-progress-fill' + (row.percent === undefined ? ' pending' : '')} style={{ width: row.percent === undefined ? undefined : row.percent + '%' }} />}
        <span className="engine-list-title"><span className="engine-brand"><EngineLogo src={entry.logo} />{entry.label}</span><EngineVersionIcon state={state} kind={entry.id} /></span><small>{[state?.managed && !status?.active ? '未安装' : '', ...entry.businessTypes].filter(Boolean).join(' · ')}</small>
      </ListItem></Tooltip>{state?.managed && !status?.active && status?.candidate && <Button className="engine-install-shortcut" type="button" disabled={!!busy || status.preparing} aria-label={'安装 ' + entry.label} onClick={() => { setSelected(entry.id); void update(status); }}>{row?.label ?? '安装'}</Button>}</div>;
      })}</nav>
      {product && <article className="engine-detail" aria-label={product.label + ' 详情'}>
        <h2 className="engine-brand"><EngineLogo src={product.logo} />{product.label}</h2><p>{product.businessTypes.join(' · ')}</p>
        <dl><dt>支持协议</dt><dd>{product.supportedApis.join(' / ')}</dd>
        <dt>本机状态</dt><dd>{!state ? error ? '状态未知' : '正在读取…' : !state.managed ? '宿主不可用' : item?.active ? item.enabled ? '已启用' : '已停用' : '尚未安装'}</dd>
        <dt>当前版本</dt><dd>{item?.active?.version ?? '—'}</dd>
        <dt>可用版本</dt><dd>{item?.candidate?.version ?? (state ? '暂无兼容版本' : '—')}</dd></dl>
        {item && <>
          <div className="model-actions">
          {item.candidate && (item.active?.identity !== item.candidate.identity || item.error) && <Button disabled={!!busy || item.preparing} onClick={() => void update(item)}>{progress?.label ?? (item.active ? '更新引擎' : '下载并安装')}</Button>}
          {item.active && <><Button disabled={!!busy || item.preparing || item.enabled && item.references > 0} onClick={() => void update(item, item.enabled ? 'disable' : 'enable')}>{item.enabled ? '停用' : '启用'}</Button>
          <Button disabled={!!busy || item.preparing || item.references > 0} onClick={() => void update(item, 'remove')}>卸载本机版本</Button></>}</div>
          {progress && <FieldLabel className="engine-install-progress"><span>{progress.label}</span><span>{progress.percent === undefined ? '准备中…' : progress.percent + '%'}</span>
            <Progress max={100} value={progress.percent} /></FieldLabel>}
          {transfers.filter(t => t.identity === (item.preparation?.identity ?? item.candidate?.identity)).map(t => <TransferProgress item={t} key={t.identity} />)}
          <Disclosure><DisclosureSummary>缓存与依赖</DisclosureSummary><p>使用中 · {item.references}</p>
          {item.installed.map(version => <p key={version.identity}>已缓存 {version.version} · {version.identity.slice(0, 12)}</p>)}
          {(item.active ?? item.candidate)?.dependencies?.map(ref => { const dependency = products.find(entry => entry.id === ref.kind); return <p key={ref.kind}>依赖 <EngineLogo src={dependency?.logo} />{dependency?.label ?? ref.kind} · {ref.identity.slice(0, 12)}</p>; })}</Disclosure>
          {item.error && <p role="alert">{item.error}</p>}
        </>}
      </article>}
    </div></section>;
}
