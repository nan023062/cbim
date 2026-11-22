/**
 * 作用定位：业务结构资料编辑与删除确认；运行中的 Office 不阻止保存。
 * 设计原因：组件保存资料草稿并提交版本化命令，结构调整不直接移动工作树文件。
 */
import { useEffect, useRef, useState } from 'react';

import type { BusinessSnapshot } from '../../bridge/contracts/discovery';

import { ResourceLogoEditor } from '../shared/ResourceLogo';

import { Icon } from '../../framework-ui';

export type BusinessEdit =
  {
    action: 'create';

    parentId: string | null
  } |
  {
    action: 'update' | 'delete';

    node: BusinessSnapshot['nodes'][number]
  };

export function BusinessNodeDialog({ project, snapshot, edit, OnClose, OnSaved }: { project: string; snapshot: BusinessSnapshot; edit: BusinessEdit; OnClose(): void; OnSaved(value: BusinessSnapshot): void })
{
  const dialog = useRef<HTMLDialogElement>(null);

  const [definition, setDefinition] = useState(() => edit.action === 'create' ? { name: '', summary: '', parentId: edit.parentId, sources: [] as { location: string; scope: string }[], virtual: false, workflows: [] as NonNullable<BusinessSnapshot['nodes'][number]['workflows']> } : { name: edit.node.name, summary: edit.node.summary, parentId: edit.node.parentId, sources: edit.node.sources, virtual: edit.node.virtual, workflows: edit.node.workflows ?? [] });

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState('');

  useEffect(() => { dialog.current?.showModal(); }, []);

  const excluded = new Set(edit.action === 'create' ? [] : [edit.node.id]);

  for (let size = -1; size !== excluded.size;)
  {
    size = excluded.size;

    for (const node of snapshot.nodes)
      if (node.parentId && excluded.has(node.parentId))
        excluded.add(node.id);
  }

  async function Save()
  {
    setBusy(true);

    setError('');

    try
    {
      const change = edit.action === 'create' ? { action: 'create' as const, revision: snapshot.revision, definition } : edit.action === 'update' ? { action: 'update' as const, id: edit.node.id, revision: snapshot.revision, definition } : { action: 'delete' as const, id: edit.node.id, revision: snapshot.revision };

      OnSaved(await window.desktopMenu.BusinessArchitecture(project, change));

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

  const title = { create: '新增业务节点', update: '编辑业务节点', delete: '删除业务节点' }[edit.action];

  return <dialog ref={dialog} className="agent-settings organization-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) OnClose(); }}><header><strong>{title}</strong><button type="button" title="关闭" aria-label="关闭" disabled={busy} onClick={OnClose}><Icon name="close" /></button></header><form onSubmit={event => { event.preventDefault(); void Save(); }}>
    {edit.action === 'delete' ? <p>确认移除「{edit.node.name}」？已有任务、工作树和文件保留，变化将通知正在执行的主 Agent。</p> : <div className="agent-settings-body"><label>名称<input required autoFocus maxLength={160} disabled={busy} value={definition.name} onChange={event => setDefinition({ ...definition, name: event.target.value })} /></label><label>所属业务节点<select disabled={busy} value={definition.parentId ?? ''} onChange={event => setDefinition({ ...definition, parentId: event.target.value || null })}><option value="">顶层</option>{snapshot.nodes.filter(node => !excluded.has(node.id)).map(node => <option key={node.id} value={node.id}>{node.name} · {node.id}</option>)}</select></label><label>业务职责<textarea rows={4} maxLength={4000} disabled={busy} value={definition.summary} onChange={event => setDefinition({ ...definition, summary: event.target.value })} /></label><label className="architecture-check"><input type="checkbox" disabled={busy} checked={definition.virtual} onChange={event => setDefinition({ ...definition, virtual: event.target.checked })} />虚拟节点（不直接打开执行工作区）</label>
      <h4>工作流声明</h4>{definition.workflows.map((flow, index) => <fieldset key={index}><ResourceLogoEditor kind="workflow" name={flow.name} logo={flow.logo} disabled={busy} onChange={logo => setDefinition(previous => ({ ...previous, workflows: previous.workflows.map((item, i) => i === index ? { ...item, logo } : item) }))} /><label>工作流名称<input required maxLength={100} value={flow.name} onChange={e => setDefinition({ ...definition, workflows: definition.workflows.map((item, i) => i === index ? { ...item, name: e.target.value } : item) })} /></label><label>正文引用<input required maxLength={2048} value={flow.reference} onChange={e => setDefinition({ ...definition, workflows: definition.workflows.map((item, i) => i === index ? { ...item, reference: e.target.value } : item) })} /></label><button type="button" disabled={busy} onClick={() => setDefinition({ ...definition, workflows: definition.workflows.filter((_, i) => i !== index) })}>移除声明</button></fieldset>)}<button type="button" disabled={busy || definition.workflows.length >= 32} onClick={() => setDefinition({ ...definition, workflows: [...definition.workflows, { name: '', reference: '' }] })}>添加工作流声明</button>
      <h4>来源与范围</h4>{definition.sources.map((source, index) => <fieldset key={index}><label>来源<input required maxLength={2048} disabled={busy} value={source.location} onChange={event => setDefinition({ ...definition, sources: definition.sources.map((item, i) => i === index ? { ...item, location: event.target.value } : item) })} /></label><label>范围<input maxLength={4000} disabled={busy} value={source.scope} onChange={event => setDefinition({ ...definition, sources: definition.sources.map((item, i) => i === index ? { ...item, scope: event.target.value } : item) })} /></label><button type="button" title="移除来源" aria-label="移除来源" disabled={busy} onClick={() => setDefinition({ ...definition, sources: definition.sources.filter((_, i) => i !== index) })}><Icon name="remove" /></button></fieldset>)}<button type="button" title="添加来源" aria-label="添加来源" disabled={busy || definition.sources.length >= 100} onClick={() => setDefinition({ ...definition, sources: [...definition.sources, { location: '', scope: '' }] })}><Icon name="plus" /></button></div>}
    {error && <p role="alert">{error}</p>}<footer><small>保存后通知项目内活动主 Agent</small><button autoFocus={edit.action === 'delete'} type="button" title="取消" aria-label="取消" disabled={busy} onClick={OnClose}><Icon name="close" /></button><button type="submit" title={edit.action === 'delete' ? '确认删除' : '保存'} aria-label={edit.action === 'delete' ? '确认删除' : '保存'} disabled={busy || edit.action !== 'delete' && !definition.name.trim()}><Icon name={edit.action === 'delete' ? 'remove' : 'confirm'} /></button></footer>
  </form></dialog>;
}
