/** 主对话每轮发送前选择引擎及其兼容模型。 */
import { useEffect, useState } from 'react';

import type { OfficeSelection } from '../../bridge/contracts/discovery';

import type { ModelActionResults } from '../../bridge/contracts/desktop-models';

import type { EnginePackageStatus } from '../../bridge/contracts/desktop-engines';

import { selectProviderConnection } from '../../bridge/contracts/desktop-models';

export function MainAgentPicker({ value, change, disabled, fail }: { value: OfficeSelection; change(v: OfficeSelection): void; disabled: boolean; fail(error: string): void })
{
  const [engines, setEngines] = useState<EnginePackageStatus[]>([]);

  const [models, setModels] = useState<ModelActionResults['models.list']>();

  useEffect(() => { let active = true; Promise.all([window.desktopMenu.Engines('list'), window.desktopMenu.Model('models.list')]).then(([packages, list]) => { if (!active) return; setEngines(packages.items.filter(item => item.active && item.enabled)); setModels(list); }).catch(e => { if (active) fail(String(e)); }); return () => { active = false; }; }, [fail]);

  const engine = engines.find(item => item.kind === value.engine);

  const choices = models?.profiles.flatMap(profile => profile.models.filter(model => model.enabled && (!engine || selectProviderConnection(profile, engine.requirement, model.id))).map(model => ({ key: JSON.stringify([profile.id, model.id]), label: profile.name + ' / ' + (model.name || model.id) }))) ?? [];

  const selected = value.profileId ? JSON.stringify([value.profileId, value.modelId]) : '';

  return <div className="office-model office-pickers"><select disabled={disabled} aria-label="主 Agent 执行引擎" value={value.engine ?? ''} onChange={e => change({ engine: e.target.value || undefined })}>
    <option value="">模型直连</option>{value.engine && !engine && <option disabled value={value.engine}>{value.engine}（不可用）</option>}
    {engines.map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select>
    <select disabled={disabled} aria-label="主 Agent 大模型" value={selected} onChange={e => { const [profileId, modelId] = e.target.value ? JSON.parse(e.target.value) : []; change({ engine: value.engine, profileId, modelId }); }}>
      <option value="">默认模型</option>{selected && !choices.some(c => c.key === selected) && <option value={selected} disabled>{value.modelId}（不可用）</option>}
      {choices.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>;
}
