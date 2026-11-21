/**
 * 作用定位：主 Agent 与成员设置共用的引擎、兼容模型选择组件。
 * 设计原因：主与成员采用同一兼容性选择规则，页面保存引用而不读取供应商密钥。
 */
import { useEffect, useState, type CSSProperties } from 'react';

import type { OfficeSelection } from '../../bridge/contracts/discovery';

import type { ModelActionResults } from '../../bridge/contracts/desktop-models';

import type { EnginePackageSettings } from '../../bridge/contracts/desktop-engines';

import { selectProviderConnection } from '../../bridge/contracts/desktop-models';

import { Icon } from '../shared/Icon';

import { useTransfers, TransferProgress } from '../shared/transfers';

export function MainAgentPicker({ value, change, disabled, fail, onReady, onManage, compact = false }: { compact?: boolean; onManage(): void; onReady: (ready: boolean) => void; value: OfficeSelection; change(v: OfficeSelection): void; disabled: boolean; fail(error: string): void })
{
  const [catalog, setCatalog] = useState<EnginePackageSettings>();

  const [retry, setRetry] = useState(0);

  const [busy, setBusy] = useState(false);

  const [checked, setChecked] = useState<string>();

  const [models, setModels] = useState<ModelActionResults['models.list']>();

  useEffect(() => { let active = true; setChecked(undefined); setBusy(true); const load = async () => { const [local, list] = await Promise.all([window.desktopMenu.Engines('list'), window.desktopMenu.Model('models.list')]); if (!active) return; setCatalog(local); setModels(list); const latest = await window.desktopMenu.Engines('check'); if (active) { setCatalog(latest); setChecked(value.engine); } }; void load().catch(error => { if (active) fail(String(error)); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [value.engine, fail, retry]);

  const transfers = useTransfers();

  useEffect(() => { let active = true; let timer: ReturnType<typeof setTimeout>; const off = window.desktopMenu.WatchTransfers(() => { clearTimeout(timer); timer = setTimeout(() => { void window.desktopMenu.Engines('list').then(state => { if (active) setCatalog(state); }).catch(() => { }); }, 180); }); return () => { active = false; clearTimeout(timer); off(); }; }, []);

  const [products, setProducts] = useState<Awaited<ReturnType<typeof window.desktopMenu.EngineCatalog>>>([]);

  useEffect(() => { void window.desktopMenu.EngineCatalog().then(setProducts).catch(e => fail(String(e))); }, [fail]);

  const engines = catalog?.items ?? [];

  const engine = engines.find(item => item.kind === value.engine);

  const choices = models?.profiles.flatMap(profile => profile.models.filter(model => model.enabled && (!engine || selectProviderConnection(profile, engine.requirement, model.id))).map(model => ({ key: JSON.stringify([profile.id, model.id]), label: profile.name + ' / ' + (model.name || model.id) }))) ?? [];

  const selected = value.profileId ? JSON.stringify([value.profileId, value.modelId]) : '';

  const current = !!engine?.enabled && !!engine.active && engine.candidate?.identity === engine.active.identity;

  const ready = !busy && checked === value.engine && current && choices.some(choice => choice.key === selected);

  useEffect(() => { onReady(ready); }, [ready, onReady]);

  useEffect(() => { if (!engine || value.profileId || value.modelId) return; const profile = models?.profiles.find(item => item.id === models.selectedId); if (profile?.models.some(model => model.enabled && model.id === profile.defaultModel && selectProviderConnection(profile, engine.requirement, model.id))) change({ engine: engine.kind, profileId: profile.id, modelId: profile.defaultModel }); }, [models, engine, value, change]);

  const logo = engine?.logo || products.find(product => product.id === value.engine)?.logo;

  const modelLabel = choices.find(choice => choice.key === selected)?.label ?? (selected ? value.modelId + '（不可用）' : choices.length ? '选择大模型' : '请配置兼容模型');

  return <div className="office-model office-pickers"><label className={compact ? 'composer-engine' : undefined} title={engine?.label || value.engine || '选择执行引擎'}>{compact && (logo ? <img src={logo} alt="" /> : <Icon name="sparkles" size={16} />)}<select className="engine-choice" style={{ '--logo': 'url("' + (engine?.logo ?? products.find(p => p.id === value.engine)?.logo ?? '') + '")' } as CSSProperties} disabled={disabled} aria-label="Agent 执行引擎" value={value.engine ?? ''} onChange={e => { if (e.target.value === ':manage') onManage(); else change({ engine: e.target.value }); }}>
    <option disabled value="">{!models ? '正在加载引擎…' : engines.length ? '选择执行引擎' : '请先安装并启用引擎'}</option>{value.engine && !engine && <option disabled value={value.engine}>{value.engine}（不可用）</option>}
    {engines.map(item => <option style={{ '--logo': 'url("' + item.logo + '")' } as CSSProperties} key={item.kind} value={item.kind}>{item.label}{!item.active ? ' · 未安装' : !item.enabled ? ' · 已停用' : item.active.identity !== item.candidate?.identity ? ' · 需更新' : ''}</option>)}<option value=":manage">管理执行引擎…</option></select></label>
    {transfers.filter(t => t.identity === (engine?.preparation?.identity ?? engine?.candidate?.identity)).map(t => <TransferProgress key={t.identity} item={t} />)}
    {!busy && !checked && <button type="button" onClick={() => setRetry(n => n + 1)}>重试版本检查</button>}
    {checked && !current && engine?.candidate && catalog && <button type="button" disabled={busy || disabled} onClick={async () => { setBusy(true); try { setCatalog(engine.active?.identity === engine.candidate!.identity ? await window.desktopMenu.Engines('configure', { kind: engine.kind, revision: catalog.revision, action: 'enable' }) : await window.desktopMenu.Engines('install', { kind: engine.kind, revision: catalog.revision, identity: engine.candidate!.identity })); setRetry(n => n + 1); } catch (error) { fail(String(error)); setChecked(undefined); } finally { setBusy(false); } }}>{busy ? '准备中…' : engine.active?.identity === engine.candidate.identity ? '启用' : engine.active ? '更新并启用' : '下载安装'}</button>}
    <label className={compact ? 'composer-model' : undefined}>{compact && <span aria-hidden="true">{modelLabel} <Icon name="chevronDown" size={12} /></span>}<select disabled={disabled || !engine} aria-label="Agent 大模型" value={selected} onChange={e => { const [profileId, modelId] = e.target.value ? JSON.parse(e.target.value) : []; change({ engine: value.engine, profileId, modelId }); }}>
      <option disabled value="">{choices.length ? '选择大模型' : '请配置兼容模型'}</option>{selected && !choices.some(c => c.key === selected) && <option value={selected} disabled>{value.modelId}（不可用）</option>}
      {choices.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label></div>;
}
