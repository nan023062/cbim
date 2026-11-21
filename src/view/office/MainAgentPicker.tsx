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



export function MainAgentPicker({ value, change, disabled, fail, onReady, onManageModels, compact = false, autoSelect = true }: { autoSelect?: boolean; compact?: boolean; onManageModels(): void; onReady: (ready: boolean, reason: string, working: boolean) => void; value: OfficeSelection; change(v: OfficeSelection): void; disabled: boolean; fail(error: string): void })
{
  const [catalog, setCatalog] = useState<EnginePackageSettings>();

  const [models, setModels] = useState<ModelActionResults['models.list']>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([window.desktopMenu.Engines('list'), window.desktopMenu.Model('models.list')])
      .then(([local, list]) => { if (active) { setCatalog(local); setModels(list); } })
      .catch(error => { if (active) { setFailed(true); fail(String(error)); } });
    return () => { active = false; };
  }, [fail]);

  const [products, setProducts] = useState<Awaited<ReturnType<typeof window.desktopMenu.EngineCatalog>>>([]);

  useEffect(() => { void window.desktopMenu.EngineCatalog().then(setProducts).catch(e => fail(String(e))); }, [fail]);

  const engines = catalog?.items.filter(item => item.enabled && item.active && !item.error) ?? [];

  const menuId = useId();
  const modelMenu = useId();
  const first = engines[0];
  useEffect(() => { if (autoSelect && !value.engine && first) change({ ...value, engine: first.kind }); }, [autoSelect, value, first, change]);

  const engine = engines.find(item => item.kind === value.engine);

  const choices = models?.profiles.flatMap(profile => profile.models.filter(model => model.enabled && (!engine || selectProviderConnection(profile, engine.requirement, model.id))).map(model => ({ profileId: profile.id, modelId: model.id, key: JSON.stringify([profile.id, model.id]), label: profile.name + ' / ' + (model.name || model.id) }))) ?? [];

  const selected = value.profileId ? JSON.stringify([value.profileId, value.modelId]) : '';

  const working = !failed && (!catalog || !models);
  function blockedReason(): string {
    if (failed) return '无法读取本机引擎或模型列表';
    if (working) return '正在读取本机引擎和模型…';
    if (!engines.length) return '本机没有可用引擎，请前往「执行引擎」页安装或启用';
    if (!engine) return '请选择可用的执行引擎';
    if (!choices.length) return '没有兼容的模型，请打开大模型设置';
    if (!choices.some(choice => choice.key === selected)) return '请选择兼容的模型';
    return '';
  }
  const reason = blockedReason();

  useEffect(() => { onReady(!reason, reason, working); }, [reason, working, onReady]);

  const firstModel = choices[0];
  useEffect(() => { if (autoSelect && engine && !value.profileId && !value.modelId && firstModel) change({ engine: engine.kind, profileId: firstModel.profileId, modelId: firstModel.modelId }); }, [autoSelect, engine, value, firstModel?.key, change]);

  const logo = engine?.logo || products.find(product => product.id === engine?.kind)?.logo;

  const modelLabel = choices.find(choice => choice.key === selected)?.label ?? (selected ? value.modelId + '（不可用）' : firstModel?.label ?? '请配置兼容模型');

  return <div className="office-model office-pickers"><button type="button" className={compact ? 'composer-engine' : 'engine-trigger'} disabled={disabled} popoverTarget={menuId} aria-label="选择执行引擎" title={engine?.label || value.engine || '选择执行引擎'}>{logo ? <img width={16} height={16} src={logo} alt="" /> : <Icon name="sparkles" size={16} />}{!compact && (engine?.label || value.engine || '选择执行引擎')}</button>
    <div className="engine-options" id={menuId} popover="auto" aria-label="选择执行引擎">
      <div className="picker-list">
      {!engines.length && <small>{working ? '正在读取…' : '暂无可用引擎'}</small>}
      {engines.map(item => <button type="button" key={item.kind} aria-pressed={value.engine === item.kind} popoverTarget={menuId} popoverTargetAction="hide" onClick={() => { if (item.kind !== value.engine) change({ engine: item.kind }); }}>{item.logo && <img width={16} height={16} src={item.logo} alt="" />}{item.label}{item.kind === value.engine && <Icon name="check" size={13} />}</button>)}
      </div>
    </div>
    <button type="button" className="composer-model" disabled={disabled} popoverTarget={modelMenu} aria-label="Agent 大模型" title={modelLabel} onClick={() => { void window.desktopMenu.Model('models.list').then(setModels).catch(e => fail(String(e))); }}><span>{modelLabel} <Icon name="chevronDown" size={12} /></span></button>
    <div id={modelMenu} popover="auto" className="engine-options model-options" aria-label="可用大模型">
      <div className="picker-list">
      {engine && choices.map(choice => <button type="button" key={choice.key} aria-pressed={selected === choice.key} popoverTarget={modelMenu} popoverTargetAction="hide" onClick={() => change({ engine: engine.kind, profileId: choice.profileId, modelId: choice.modelId })}>{choice.label}{selected === choice.key && <Icon name="check" size={13} />}</button>)}
      {(!engine || !choices.length) && <small>暂无兼容的大模型</small>}
      </div>
      <button className="picker-settings" type="button" title="大模型设置" popoverTarget={modelMenu} popoverTargetAction="hide" onClick={onManageModels}><Icon name="settings" size={15} />大模型设置</button>
    </div></div>;
}
