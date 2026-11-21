/**
 * 作用定位：组织资料编辑与删除确认；失败保留输入，成功后刷新父页面快照。
 * 设计原因：资料修改、父节点选择和删除确认在表单内完成，冲突不会静默丢弃用户草稿。
 */
import { useEffect, useRef, useState } from 'react';

import type { OrganizationNode, OrganizationSnapshot } from '../../bridge/contracts/discovery';

import { Icon } from '../../framework-ui/Icon';

export type OrganizationEdit =
  {
    action: 'create';

    kind: 'team' | 'agent';

    parentId: string | null
  } |
  {
    action: 'update' | 'delete';

    node: OrganizationNode
  };

export function OrganizationNodeDialog({ project, snapshot, edit, OnClose, OnSaved }: { project: string; snapshot: OrganizationSnapshot; edit: OrganizationEdit; OnClose(): void; OnSaved(value: OrganizationSnapshot): void })
{
  const dialog = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState(edit.action === 'create' ? '' : edit.node.name);

  const [position, setPosition] = useState(edit.action === 'create' ? '' : edit.node.position);

  const [parentId, setParentId] = useState(edit.action === 'create' ? edit.parentId : edit.node.parentId);

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState('');

  useEffect(() => { dialog.current?.showModal(); }, []);

  const kind = edit.action === 'create' ? edit.kind : edit.node.kind;

  const title = (edit.action === 'create' ? '新增' : edit.action === 'update' ? '编辑' : '删除') + (kind === 'team' ? '团队' : '成员');

  const excluded = new Set<string>();

  if (edit.action !== 'create')
  {
    excluded.add(edit.node.id);

    let changed = true;

    while (changed)
    {
      changed = false;

      for (const node of snapshot.nodes)
        if (node.parentId && excluded.has(node.parentId) && !excluded.has(node.id))
        {
          excluded.add(node.id);

          changed = true;
        }
    }
  }

  async function Save()
  {
    setBusy(true);

    setError('');

    try
    {
      const change = edit.action === 'delete' ? { action: 'delete' as const, id: edit.node.id, revision: snapshot.revision } : edit.action === 'create' ? { action: 'create' as const, kind: edit.kind, parentId, name, position, revision: snapshot.revision } : { action: 'update' as const, id: edit.node.id, parentId, name, position, revision: snapshot.revision };

      OnSaved(await window.desktopMenu.Organization(project, change));

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
      {edit.action === 'delete' ? <p>确定移除「{edit.node.name}」？历史任务与项目文件会保留。</p> : <div className="agent-settings-body"><label>名称<input autoFocus required maxLength={160} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><label>所属团队<select value={parentId ?? ''} disabled={busy} onChange={event => setParentId(event.target.value || null)}><option value="">项目组织（顶层）</option>{snapshot.nodes.filter(node => node.kind === 'team' && !excluded.has(node.id)).map(node => <option key={node.id} value={node.id}>{node.name} · {node.id}</option>)}</select></label><label>{kind === 'team' ? '团队职责' : '岗位职责'}<textarea rows={5} maxLength={4000} value={position} disabled={busy} onChange={event => setPosition(event.target.value)} /></label></div>}
      {error && <p role="alert">{error}</p>}
      <footer><small>{busy ? '正在保存…' : edit.action === 'delete' ? '请确认删除目标' : '修改不会改变节点身份'}</small><button autoFocus={edit.action === 'delete'} type="button" title="取消" aria-label="取消" disabled={busy} onClick={OnClose}><Icon name="close" size={18} /></button><button type="submit" title={edit.action === 'delete' ? '确认删除' : '保存'} aria-label={edit.action === 'delete' ? '确认删除' : '保存'} disabled={busy || edit.action !== 'delete' && !name.trim()}><Icon name={edit.action === 'delete' ? 'remove' : 'confirm'} size={18} /></button></footer>
    </form>
  </dialog>;
}
