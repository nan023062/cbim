/** 执行引擎的版本、下载安装与更新。 */
import { useEffect, useState } from 'react';

import type { EnginePackageSettings, EnginePackageStatus } from '../../bridge/contracts/desktop-engines';

export function EnginePackagesView()
{
  const [state, setState] = useState<EnginePackageSettings>();

  const [busy, setBusy] = useState('');

  const [error, setError] = useState('');

  useEffect(() => { window.desktopMenu.Engines('list').then(setState).catch(e => setError(String(e))); }, []);

  useEffect(() => { if (!busy || busy === 'check') return; let active = true; let timer: ReturnType<typeof setTimeout>; const refresh = async () => { try { const snapshot = await window.desktopMenu.Engines('list'); if (active) setState(snapshot); } catch { /* The operation reports its own failure. */ } if (active) timer = setTimeout(refresh, 750); }; timer = setTimeout(refresh, 750); return () => { active = false; clearTimeout(timer); }; }, [busy]);

  async function update(item?: EnginePackageStatus, action?: 'enable' | 'disable' | 'remove')
  {
    setError('');

    setBusy(item?.kind ?? 'check');

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

  return <section className="view-page menu-page"><header className="view-heading"><h1>执行引擎</h1><button disabled={!!busy || state?.managed === false} onClick={() => void update()}>{busy === 'check' ? '正在检查…' : '检查更新'}</button></header>
    {!state && !error && <p role="status">正在读取引擎目录…</p>}
    {error && <p role="alert">{error}</p>}
    {state && !state.managed && <p>当前宿主未提供签名引擎目录。</p>}
    <div className="definition-grid">{state?.items.map(item => <article key={item.kind} className="definition-card">
      <h3>{item.label}</h3>
      <p>{item.active ? '当前版本 ' + item.active.version : '尚未安装'}{item.candidate && ' · 可用版本 ' + item.candidate.version}</p>
      {item.candidate && (item.active?.identity !== item.candidate.identity || item.error) && <button disabled={!!busy} onClick={() => void update(item)}>{busy === item.kind ? '正在下载并校验…' : item.active ? '更新引擎' : '下载并安装'}</button>}
      {item.preparing && <progress aria-label="引擎准备进度" max={100} value={item.preparation?.progress} />}
      {item.active && <div className="model-actions"><button disabled={!!busy || item.preparing || item.enabled && item.references > 0} onClick={() => void update(item, item.enabled ? 'disable' : 'enable')}>{item.enabled ? '停用' : '启用'}</button>
        <button disabled={!!busy || item.preparing || item.references > 0} onClick={() => void update(item, 'remove')}>移除引擎</button></div>}
      <details><summary>版本与依赖信息</summary><p>支持协议 · {item.requirement.supportedApis.join(' / ')}</p><p>使用中 · {item.references}</p>
        {item.installed.map(version => <p key={version.identity}>已缓存 {version.version} · {version.identity.slice(0, 12)}</p>)}
        {item.active?.dependencies?.map(ref => <p key={ref.kind}>依赖 {ref.kind} · {ref.identity.slice(0, 12)}</p>)}</details>
      {item.error && <p role="alert">{item.error}</p>}
    </article>)}</div></section>;
}
