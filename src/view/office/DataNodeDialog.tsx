/**
 * 作用定位：数据定义编辑器：保留失败草稿，按节点类别编辑资料，删除前确认。
 * 设计原因：按节点类别限定可编辑字段并保留失败输入，提交结构定义不执行数据库迁移。
 */
import { useEffect, useRef, useState } from 'react';

import type { DataArchitectureSnapshot, DataArchitectureNode, DataDefinition } from '../../bridge/contracts/discovery';

import { Icon } from '../shared/Icon';

export type DataEdit =
  {
    action: 'create';

    kind: DataDefinition['kind'];

    parentId: string | null
  } |
  {
    action: 'update' | 'delete';

    node: DataArchitectureNode
  };

export function DataNodeDialog({ project, snapshot, edit, OnClose, OnSaved }: { project: string; snapshot: DataArchitectureSnapshot; edit: DataEdit; OnClose(): void; OnSaved(value: DataArchitectureSnapshot): void })
{
  const dialog = useRef<HTMLDialogElement>(null);

  const kind = edit.action === 'create' ? edit.kind : edit.node.kind;

  const [definition, setDefinition] = useState<DataDefinition>(() => edit.action === 'create' ? { kind, parentId: edit.parentId, name: '', summary: '', ...(kind === 'field' && { dataType: 'string', required: false, primaryKey: false }) } : { kind, parentId: edit.node.parentId, name: edit.node.name, summary: edit.node.summary, ...(kind === 'field' && { dataType: edit.node.dataType, required: edit.node.required, primaryKey: edit.node.primaryKey }) });

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState('');

  useEffect(() => { dialog.current?.showModal(); }, []);

  const title = (edit.action === 'create' ? '新增' : edit.action === 'update' ? '编辑' : '删除') + ({ domain: '数据域', entity: '实体', field: '字段' }[kind]);

  const excluded = new Set(edit.action === 'create' ? [] : [edit.node.id]);

  for (let size = -1; size !== excluded.size;)
  {
    size = excluded.size;

    for (const node of snapshot.nodes)
      if (node.parentId && excluded.has(node.parentId))
        excluded.add(node.id);
  }

  const parents = snapshot.nodes.filter(node => node.kind === (kind === 'field' ? 'entity' : 'domain') && !excluded.has(node.id));

  async function Save()
  {
    setBusy(true);

    setError('');

    try
    {
      const change = edit.action === 'create' ? { action: 'create' as const, revision: snapshot.revision, definition } : edit.action === 'update' ? { action: 'update' as const, revision: snapshot.revision, id: edit.node.id, definition } : { action: 'delete' as const, revision: snapshot.revision, id: edit.node.id };

      OnSaved(await window.desktopMenu.DataArchitecture(project, change));

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

  return <dialog ref={dialog} className="agent-settings organization-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) OnClose(); }}>
    <header><strong>{title}</strong><button type="button" title="关闭" aria-label="关闭" disabled={busy} onClick={OnClose}><Icon name="close" size={18} /></button></header>
    <form onSubmit={event => { event.preventDefault(); void Save(); }}>
      {edit.action === 'delete' ? <p>确定删除「{edit.node.name}」的结构定义？此操作不会删除实际数据库或记录。</p> : <div className="agent-settings-body">
        <label>名称<input autoFocus required maxLength={160} disabled={busy} value={definition.name} onChange={event => setDefinition({ ...definition, name: event.target.value })} /></label>
        <label>{kind === 'field' ? '所属实体' : '所属数据域'}<select required={kind === 'field'} disabled={busy} value={definition.parentId ?? ''} onChange={event => setDefinition({ ...definition, parentId: event.target.value || null })}><option value="" disabled={kind === 'field'}>{kind === 'field' ? '选择实体' : '数据架构（顶层）'}</option>{parents.map(node => <option key={node.id} value={node.id}>{node.name} · {node.id}</option>)}</select></label>
        <label>说明<textarea rows={4} maxLength={4000} disabled={busy} value={definition.summary} onChange={event => setDefinition({ ...definition, summary: event.target.value })} /></label>
        {kind === 'field' && <><label>字段类型<select disabled={busy} value={definition.dataType} onChange={event => setDefinition({ ...definition, dataType: event.target.value as DataDefinition['dataType'] })}>{['string', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'json', 'binary'].map(type => <option key={type} value={type}>{type}</option>)}</select></label><label className="data-check"><input type="checkbox" disabled={busy} checked={definition.primaryKey} onChange={event => setDefinition({ ...definition, primaryKey: event.target.checked, required: event.target.checked || definition.required })} />主键（可选择多个字段组成联合主键）</label><label className="data-check"><input type="checkbox" disabled={busy || definition.primaryKey} checked={definition.required} onChange={event => setDefinition({ ...definition, required: event.target.checked })} />必填</label></>}
      </div>}
      {error && <p role="alert">{error}</p>}
      <footer><small>{busy ? '正在保存…' : '保存于本机项目数据目录'}</small><button autoFocus={edit.action === 'delete'} type="button" title="取消" aria-label="取消" disabled={busy} onClick={OnClose}><Icon name="close" size={18} /></button><button type="submit" title={edit.action === 'delete' ? '确认删除' : '保存'} aria-label={edit.action === 'delete' ? '确认删除' : '保存'} disabled={busy || edit.action !== 'delete' && (!definition.name.trim() || kind === 'field' && !definition.parentId)}><Icon name={edit.action === 'delete' ? 'remove' : 'confirm'} size={18} /></button></footer>
    </form>
  </dialog>;
}
