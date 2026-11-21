/**
 * 作用定位：两种 Agent 共用设置表单；父页面只决定保存目标及初始标签。
 * 设计原因：主会话和岗位共用能力表单但保存身份独立，版本化提交避免覆盖其他窗口编辑。
 */
import { useEffect, useRef, useState } from 'react';

import type { AgentConfiguration, AgentSettingsTarget, OfficeSelection } from '../../bridge/contracts/discovery';

import { MainAgentPicker } from './MainAgentPicker';

import { Icon } from '../../framework-ui/Icon';

export function AgentSettingsDialog({ project, target, title, tab = 'model', initialModel, OnClose, OnSaved, OnManageModels }: { project: string; target: AgentSettingsTarget; title: string; tab?: 'model' | 'skills' | 'connectors'; initialModel?: OfficeSelection; OnClose(): void; OnSaved(configuration: AgentConfiguration): void; OnManageModels(): void; })
{
  const dialog = useRef<HTMLDialogElement>(null);

  const [active, setActive] = useState(tab);

  const [revision, setRevision] = useState<number>();

  const [configuration, setConfiguration] = useState<AgentConfiguration>({});

  const [model, setModel] = useState<OfficeSelection>({});

  const [connectors, setConnectors] = useState<Awaited<ReturnType<typeof window.desktopMenu.AgentConnectors>>>([]);

  const [error, setError] = useState('');

  const [busy, setBusy] = useState(false);

  const [ready, setReady] = useState(false);

  useEffect(() => { dialog.current?.showModal(); }, []);

  useEffect(() => { let current = true; Promise.all([window.desktopMenu.AgentSettings(project, target), window.desktopMenu.AgentConnectors()]).then(([saved, choices]) => { if (!current) return; setRevision(saved.revision); setConfiguration(saved.configuration); setModel(initialModel ?? saved.configuration.model ?? {}); setConnectors(choices); }).catch(error => { if (current) setError(String(error)); }); return () => { current = false; }; }, [project, target.kind, target.id]);

  async function Save()
  {
    if (revision === undefined)
      return;

    setBusy(true);

    setError('');

    try
    {
      if ((model.engine || model.profileId || model.modelId) && !(model.engine && model.profileId && model.modelId))
        throw Error('请选择完整的引擎与模型');

      const next = { ...configuration, model: model.engine && model.profileId && model.modelId ? { engine: model.engine, profileId: model.profileId, modelId: model.modelId } : undefined };

      const saved = await window.desktopMenu.AgentSettings(project, target, { revision, configuration: next });

      OnSaved(saved.configuration);

      OnClose();
    }
    catch (error)
    {
      setError(String(error));
    }
    finally
    {
      setBusy(false);
    }
  }

  const skills = configuration.skills ?? [];

  const selected = configuration.connectorIds ?? [];

  return <dialog ref={dialog} className="agent-settings" onCancel={event => { event.preventDefault(); if (!busy) OnClose(); }} aria-label={title}>
    <header><strong>{title}</strong><button type="button" disabled={busy} onClick={OnClose} aria-label="关闭设置" title="关闭设置"><Icon name="close" size={18} /></button></header>
    <nav aria-label="Agent 配置分类">{(['model', 'skills', 'connectors'] as const).map(item => <button type="button" key={item} aria-pressed={active === item} onClick={() => setActive(item)}>{({ model: '引擎与大模型', skills: 'Skills', connectors: '连接器' })[item]}</button>)}</nav>
    {revision === undefined ? <p>正在读取配置…</p> : <div className="agent-settings-body">
      <section hidden={active !== 'model'}><p>该 Agent 使用自己的引擎和模型。</p><MainAgentPicker value={model} change={setModel} disabled={busy} fail={setError} onReady={setReady} onManageModels={() => { OnClose(); OnManageModels(); }} />{model.engine && !ready && <small>当前选择尚未就绪；启动时会再次检查可用性。</small>}</section>
      <section hidden={active !== 'skills'}><p>这里配置当前 Agent 的可用 Skill 清单，保存不会执行技能。在对话输入框输入 /，选择技能并发送后才主动调用；技能不提高执行权限。</p>{skills.map((skill, index) => <fieldset key={skill.id}><label>技能名称<input value={skill.name} maxLength={100} disabled={busy} onChange={event => setConfiguration({ ...configuration, skills: skills.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /></label><label>技能指令<textarea rows={5} maxLength={32000} disabled={busy} value={skill.content} onChange={event => setConfiguration({ ...configuration, skills: skills.map((item, i) => i === index ? { ...item, content: event.target.value } : item) })} /></label><button type="button" disabled={busy} onClick={() => setConfiguration({ ...configuration, skills: skills.filter((_, i) => i !== index) })} title="删除技能" aria-label="删除技能"><Icon name="remove" size={18} /></button></fieldset>)}<button type="button" disabled={busy || skills.length >= 32} onClick={() => setConfiguration({ ...configuration, skills: [...skills, { id: crypto.randomUUID(), name: '新技能', content: '' }] })} title="添加 Skill" aria-label="添加 Skill"><Icon name="plus" size={18} /></button></section>
      <section hidden={active !== 'connectors'}><p>勾选只将连接器加入当前 Agent 的可用工具清单，不会主动执行工具。实际调用仍受 Office 权限控制。</p>{connectors.length === 0 && <p>尚无连接器。请先从侧栏「链接器」安装。</p>}{connectors.map(connector => <label className="agent-connector" key={connector.id}><input type="checkbox" disabled={busy || !connector.available && !selected.includes(connector.id)} checked={selected.includes(connector.id)} onChange={event => setConfiguration({ ...configuration, connectorIds: event.target.checked ? [...selected, connector.id] : selected.filter(id => id !== connector.id) })} />{connector.name}{!connector.available && '（未安装或未启用）'}</label>)}{selected.filter(id => !connectors.some(item => item.id === id)).map(id => <label className="agent-connector" key={id}><input type="checkbox" checked disabled={busy} onChange={() => setConfiguration({ ...configuration, connectorIds: selected.filter(value => value !== id) })} />{id}（已不可用，可取消选择）</label>)}</section>
    </div>}
    {error && <p role="alert">{error}</p>}
    <footer><small>{target.kind === 'main' ? '保存后用于下一条提交的指令，已排队项保留原配置' : '保存后用于下一次派发，当前成员任务保留原配置'}</small><button type="button" disabled={busy} onClick={OnClose} title="取消" aria-label="取消"><Icon name="close" size={18} /></button><button type="button" disabled={busy || revision === undefined} onClick={() => void Save()} title="保存" aria-label="保存"><Icon name={busy ? "clock" : "confirm"} size={18} /></button></footer>
  </dialog>;
}
