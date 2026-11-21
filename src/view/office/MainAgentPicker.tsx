/**
 * 作用定位：主 Agent 与成员设置共用的引擎、兼容模型选择组件。
 * 设计原因：主与成员采用同一兼容性选择规则，页面保存引用而不读取供应商密钥。
 */
import { useEffect, useId, useState } from 'react';

import type { OfficeSelection } from '../../bridge/contracts/discovery';

import type { ModelActionResults } from '../../bridge/contracts/desktop-models';

import type { EnginePackageSettings } from '../../bridge/contracts/desktop-engines';

import { selectProviderConnection } from '../../bridge/contracts/desktop-models';

import { Icon } from '../../framework-ui/Icon';

import { useTransfers, TransferProgress } from '../shared/transfers';

export function MainAgentPicker({ value, change, disabled, fail, onReady, onManage, onManageModels, compact = false, autoSelect = true }: { autoSelect?: boolean; compact?: boolean; onManage(): void; onManageModels(): void; onReady: (ready: boolean) => void; value: OfficeSelection; change(v: OfficeSelection): void; disabled: boolean; fail(error: string): void })
{
  const [catalog, setCatalog] = useState<EnginePackageSettings>();

  const [retry, setRetry] = useState(0);

  const [busy, setBusy] = useState(false);

  const [checkFailed, setCheckFailed] = useState(false);

  const [checked, setChecked] = useState<string>();

  const [models, setModels] = useState<ModelActionResults['models.list']>();

  useEffect(() => { let active = true; setChecked(undefined); setCheckFailed(false); setBusy(true); const load = async () => { const [local, list] = await Promise.all([window.desktopMenu.Engines('list'), window.desktopMenu.Model('models.list')]); if (!active) return; setCatalog(local); setModels(list); const latest = await window.desktopMenu.Engines('check'); if (active) { setCatalog(latest); setChecked(value.engine); } }; void load().catch(error => { if (active) { setCheckFailed(true); fail(String(error)); } }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [value.engine, fail, retry]);

  const transfers = useTransfers();

  useEffect(() => { let active = true; let timer: ReturnType<typeof setTimeout>; const off = window.desktopMenu.WatchTransfers(() => { clearTimeout(timer); timer = setTimeout(() => { void window.desktopMenu.Engines('list').then(state => { if (active) setCatalog(state); }).catch(() => { }); }, 180); }); return () => { active = false; clearTimeout(timer); off(); }; }, []);

  const [products, setProducts] = useState<Awaited<ReturnType<typeof window.desktopMenu.EngineCatalog>>>([]);

  useEffect(() => { void window.desktopMenu.EngineCatalog().then(setProducts).catch(e => fail(String(e))); }, [fail]);

  const engines = catalog?.items ?? [];

  const menuId = useId();
  const modelMenu = useId();
  const first = engines.find(item => item.active && item.enabled) ?? engines[0];
  useEffect(() => { if (autoSelect && !value.engine && first) change({ ...value, engine: first.kind }); }, [autoSelect, value, first, change]);

  const engine = engines.find(item => item.kind === value.engine);

  const choices = models?.profiles.flatMap(profile => profile.models.filter(model => model.enabled && (!engine || selectProviderConnection(profile, engine.requirement, model.id))).map(model => ({ profileId: profile.id, modelId: model.id, key: JSON.stringify([profile.id, model.id]), label: profile.name + ' / ' + (model.name || model.id) }))) ?? [];

  const selected = value.profileId ? JSON.stringify([value.profileId, value.modelId]) : '';

  const current = !!engine?.enabled && !!engine.active && engine.candidate?.identity === engine.active.identity;

  const ready = !busy && checked === value.engine && current && choices.some(choice => choice.key === selected);

  useEffect(() => { onReady(ready); }, [ready, onReady]);

  const firstModel = choices[0];
  useEffect(() => { if (autoSelect && engine && !value.profileId && !value.modelId && firstModel) change({ engine: engine.kind, profileId: firstModel.profileId, modelId: firstModel.modelId }); }, [autoSelect, engine, value, firstModel?.key, change]);

  const logo = engine?.logo || products.find(product => product.id === value.engine)?.logo;

  const modelLabel = choices.find(choice => choice.key === selected)?.label ?? (selected ? value.modelId + '（不可用）' : firstModel?.label ?? '请配置兼容模型');

  return <div className="office-model office-pickers"><button type="button" className={compact ? 'composer-engine' : 'engine-trigger'} disabled={disabled} popoverTarget={menuId} aria-label="选择执行引擎" title={engine?.label || value.engine || '选择执行引擎'}>{logo ? <img width={16} height={16} src={logo} alt="" /> : <Icon name="sparkles" size={16} />}{!compact && (engine?.label || value.engine || '选择执行引擎')}</button>
    <div className="engine-options" id={menuId} popover="auto" aria-label="选择执行引擎">
      <div className="picker-list">
      {!engines.length && <small>{busy ? '正在加载…' : '暂无执行引擎'}</small>}
      {engines.map(item => <button type="button" key={item.kind} aria-pressed={value.engine === item.kind} popoverTarget={menuId} popoverTargetAction="hide" onClick={() => { if (item.kind !== value.engine) change({ engine: item.kind }); }}>{item.logo && <img width={16} height={16} src={item.logo} alt="" />}{item.label}{!item.active ? ' · 未安装' : !item.enabled ? ' · 已停用' : item.active.identity !== item.candidate?.identity ? ' · 需更新' : ''}{item.kind === value.engine && <Icon name="check" size={13} />}</button>)}
      </div>
      <button className="picker-settings" type="button" title="引擎设置" popoverTarget={menuId} popoverTargetAction="hide" onClick={onManage}><Icon name="settings" size={15} />引擎设置</button>
    </div>
    {transfers.filter(t => t.identity === (engine?.preparation?.identity ?? engine?.candidate?.identity)).map(t => <TransferProgress key={t.identity} item={t} />)}
    {!busy && checkFailed && <button type="button" onClick={() => setRetry(n => n + 1)}>重试版本检查</button>}
    {checked && !current && engine?.candidate && catalog && <button type="button" disabled={busy || disabled} onClick={async () => { setBusy(true); try { setCatalog(engine.active?.identity === engine.candidate!.identity ? await window.desktopMenu.Engines('configure', { kind: engine.kind, revision: catalog.revision, action: 'enable' }) : await window.desktopMenu.Engines('install', { kind: engine.kind, revision: catalog.revision, identity: engine.candidate!.identity })); setRetry(n => n + 1); } catch (error) { fail(String(error)); setCheckFailed(true); setChecked(undefined); } finally { setBusy(false); } }}>{busy ? '准备中…' : engine.active?.identity === engine.candidate.identity ? '启用' : engine.active ? '更新并启用' : '下载安装'}</button>}
    <button type="button" className="composer-model" disabled={disabled} popoverTarget={modelMenu} aria-label="Agent 大模型" title={modelLabel} onClick={() => { void window.desktopMenu.Model('models.list').then(setModels).catch(e => fail(String(e))); }}><span>{modelLabel} <Icon name="chevronDown" size={12} /></span></button>
    <div id={modelMenu} popover="auto" className="engine-options model-options" aria-label="可用大模型">
      <div className="picker-list">
      {engine && choices.map(choice => <button type="button" key={choice.key} aria-pressed={selected === choice.key} popoverTarget={modelMenu} popoverTargetAction="hide" onClick={() => change({ engine: engine.kind, profileId: choice.profileId, modelId: choice.modelId })}>{choice.label}{selected === choice.key && <Icon name="check" size={13} />}</button>)}
      {(!engine || !choices.length) && <small>暂无兼容的大模型</small>}
      </div>
      <button className="picker-settings" type="button" title="大模型设置" popoverTarget={modelMenu} popoverTargetAction="hide" onClick={onManageModels}><Icon name="settings" size={15} />大模型设置</button>
    </div></div>;
}
