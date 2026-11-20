/** 执行引擎的版本、下载安装与更新。 */
import { useEffect, useState } from 'react';

import type { EnginePackageSettings, EnginePackageStatus } from '../../bridge/contracts/desktop-engines';

export function EnginePackagesView()
{
  const [state, setState] = useState<EnginePackageSettings>();

  const [busy, setBusy] = useState('');

  const [error, setError] = useState('');

  useEffect(() => { window.desktopMenu.Engines('list').then(setState).catch(e => setError(String(e))); }, []);

  async function update(item?: EnginePackageStatus)
  {
    setError('');

    setBusy(item?.kind ?? 'check');

    try
    {
      setState(item?.candidate && state ? await window.desktopMenu.Engines('install', { kind: item.kind, revision: state.revision, identity: item.candidate.identity }) : await window.desktopMenu.Engines('check'));
    }
    catch (e)
    {
      setError(String(e));
    }
    finally
    {
      setBusy('');
    }
  }

  return <section className="view-page menu-page"><header className="view-heading"><h1>执行引擎</h1><button disabled={!!busy || !state?.managed} onClick={() => void update()}>{busy === 'check' ? '正在检查…' : '检查更新'}</button></header>
    {error && <p role="alert">{error}</p>}
    {state && !state.managed && <p>当前宿主未提供签名引擎目录。</p>}
    <div className="definition-grid">{state?.items.map(item => <article key={item.kind} className="definition-card">
      <h3>{item.candidate?.plugin?.type === 'engine' ? item.candidate.plugin.label : item.kind}</h3>
      <p>{item.active ? '当前版本 ' + item.active.version : '尚未安装'}{item.candidate && ' · 可用版本 ' + item.candidate.version}</p>
      {item.candidate && item.active?.identity !== item.candidate.identity && <button disabled={!!busy} onClick={() => void update(item)}>{busy === item.kind ? '正在下载并校验…' : item.active ? '更新引擎' : '下载并安装'}</button>}
      {item.error && <p role="alert">{item.error}</p>}
    </article>)}</div></section>;
}
