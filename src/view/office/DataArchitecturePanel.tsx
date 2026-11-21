/** 数据架构页面：导航与搜索只持有展示状态，定义修改经版本化 IPC 保存。 */
import { useEffect, useRef, useState } from 'react';

import type { DataArchitectureSnapshot } from '../../bridge/contracts/discovery';

import { DataNodeDialog, type DataEdit } from './DataNodeDialog';

import { Icon } from '../shared/Icon';

/** 图标提供悬浮提示与可访问名称。 */
function Action({ label, icon, disabled, OnClick }: { label: string; icon: string; disabled?: boolean; OnClick(): void })
{
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={OnClick}><Icon name={icon} size={18} /></button>;
}

export function DataArchitecturePanel({ project, OnBack }: { project: string; OnBack(): void })
{
  const [snapshot, setSnapshot] = useState<DataArchitectureSnapshot>();

  const [selected, setSelected] = useState<string>();

  const [query, setQuery] = useState('');

  const [collapsed, setCollapsed] = useState(new Set<string>());

  const [edit, setEdit] = useState<DataEdit>();

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState('');

  const [refresh, setRefresh] = useState(0);

  const generation = useRef(0);

  useEffect(() => { const version = ++generation.current; setLoading(true); setError(''); window.desktopMenu.DataArchitecture(project).then(value => { if (version === generation.current) { setSnapshot(value); setSelected(previous => value.nodes.some(node => node.id === previous) ? previous : value.nodes[0]?.id); } }).catch(error => { if (version === generation.current) setError(String(error)); }).finally(() => { if (version === generation.current) setLoading(false); }); return () => { generation.current++; }; }, [project, refresh]);

  const nodes = snapshot?.nodes ?? [];

  const byId = new Map(nodes.map(node => [node.id, node]));

  const term = query.trim().toLowerCase();

  const visible = new Set<string>();

  for (const node of nodes)
    if ([node.name, node.summary, node.dataType, node.id].join(' ').toLowerCase().includes(term))
    {
      let current: string | null = node.id;

      while (current && !visible.has(current))
      {
        visible.add(current);

        current = byId.get(current)?.parentId ?? null;
      }
    }

  const rows:
    {
      id: string;

      depth: number
    }[] = [];

  const pending = nodes.filter(node => node.parentId === null).map(node => ({ id: node.id, depth: 0 })).reverse();

  const visited = new Set<string>();

  while (pending.length)
  {
    const row = pending.pop()!;

    if (!visible.has(row.id) || visited.has(row.id))
      continue;

    visited.add(row.id);

    rows.push(row);

    if (term || !collapsed.has(row.id))
      pending.push(...nodes.filter(node => node.parentId === row.id).map(node => ({ id: node.id, depth: row.depth + 1 })).reverse());
  }

  const node = selected ? byId.get(selected) : undefined;

  const children = nodes.filter(item => item.parentId === node?.id);

  const crumbs: string[] = [];

  for (let id = node?.id; id && !crumbs.includes(id); id = byId.get(id)?.parentId ?? undefined)
    crumbs.unshift(id);

  const labels = { domain: '数据域', entity: '实体／表', field: '字段' };

  const icons = { domain: 'folder', entity: 'table', field: 'field' };

  function Saved(value: DataArchitectureSnapshot)
  {
    generation.current++;

    setLoading(false);

    const created = value.nodes.find(node => !byId.has(node.id));

    setSnapshot(value);

    setSelected(created?.id ?? (value.nodes.some(item => item.id === selected) ? selected : value.nodes.at(-1)?.id));

    setCollapsed(new Set());

    setQuery('');

    setError('');
  }

  return <section className="business-page organization-tree-page" aria-label="数据架构">
    <header><Action label="返回对话" icon="back" OnClick={OnBack} /><h2>数据架构</h2><Action label="新增顶层数据域" icon="folderAdd" disabled={!snapshot || loading} OnClick={() => setEdit({ action: 'create', kind: 'domain', parentId: null })} /><Action label="新增顶层实体" icon="tableAdd" disabled={!snapshot || loading} OnClick={() => setEdit({ action: 'create', kind: 'entity', parentId: null })} /><Action label="刷新数据架构" icon="retry" disabled={loading} OnClick={() => setRefresh(value => value + 1)} /></header>
    <p className="business-caption">{nodes.filter(node => node.kind === 'domain').length} 个数据域 · {nodes.filter(node => node.kind === 'entity').length} 个实体 · {nodes.filter(node => node.kind === 'field').length} 个字段{loading ? ' · 正在读取…' : ''}</p>
    <p className="business-caption">管理数据结构定义，保存于本机；不会自动创建或迁移数据库。</p>
    {error && <p role="alert">{error}{snapshot && '。当前保留上次读取结果。'}</p>}
    {!snapshot ? <p role="status">{loading ? '正在读取数据架构…' : '读取失败，请刷新重试。'}</p> : <div className="business-layout">
      <nav className="business-navigation" aria-label="数据节点"><label className="org-search"><Icon name="search" size={16} /><input type="search" aria-label="搜索数据架构" placeholder="搜索名称、说明或字段类型" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="business-tree-actions"><Action label="全部展开" icon="expand" OnClick={() => setCollapsed(new Set())} /><Action label="全部收起" icon="collapse" disabled={!!term} OnClick={() => setCollapsed(new Set(nodes.map(node => node.id)))} /></div>
        <ul className="business-tree">{rows.map(row => { const item = byId.get(row.id)!; const hasChildren = nodes.some(child => child.parentId === item.id); const expanded = !!term || !collapsed.has(item.id); return <li key={item.id} style={{ paddingInlineStart: Math.min(row.depth, 5) * 12 }}><div>{hasChildren ? <button type="button" className="business-toggle" title={(expanded ? '收起 ' : '展开 ') + item.name} aria-label={(expanded ? '收起 ' : '展开 ') + item.name} aria-expanded={expanded} disabled={!!term} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}><span className={expanded ? 'org-open' : ''}><Icon name="chevron" size={14} /></span></button> : <span className="business-toggle" />}<button type="button" className="business-node" aria-current={item.id === selected ? 'true' : undefined} onClick={() => setSelected(item.id)}><span className="org-node-label"><Icon name={icons[item.kind]} size={16} />{item.name}</span><small>{item.kind === 'field' ? item.dataType + (item.primaryKey ? ' · 主键' : item.required ? ' · 必填' : '') : labels[item.kind]}</small></button></div></li>; })}</ul>
        {!rows.length && <p role="status">{nodes.length ? '没有匹配的节点。' : '数据架构为空，使用上方图标新增数据域或实体。'}</p>}
      </nav>
      <article className="business-detail" aria-label="数据节点详情">{node ? <><nav className="business-breadcrumbs" aria-label="数据路径">{crumbs.map((id, index) => <span key={id}>{index > 0 && ' / '}<button type="button" onClick={() => setSelected(id)}>{byId.get(id)?.name}</button></span>)}</nav>
        <div className="org-detail-title"><h3>{node.name}</h3><div className="org-actions"><Action label="编辑定义与归属" icon="edit" disabled={loading} OnClick={() => setEdit({ action: 'update', node })} />{node.kind === 'domain' && <><Action label="新增下级数据域" icon="folderAdd" disabled={loading} OnClick={() => setEdit({ action: 'create', kind: 'domain', parentId: node.id })} /><Action label="新增实体" icon="tableAdd" disabled={loading} OnClick={() => setEdit({ action: 'create', kind: 'entity', parentId: node.id })} /></>}{node.kind === 'entity' && <Action label="新增字段" icon="fieldAdd" disabled={loading} OnClick={() => setEdit({ action: 'create', kind: 'field', parentId: node.id })} />}<Action label={children.length ? '删除前请先移除或调整下级节点' : '删除节点'} icon="remove" disabled={loading || children.length > 0} OnClick={() => setEdit({ action: 'delete', node })} /></div></div>
        <small>{labels[node.kind]}</small><h4>说明</h4><p className="business-summary">{node.summary || '尚未填写说明。'}</p><p className="business-id">{node.id}</p>
        {node.kind === 'field' ? <dl><dt>字段类型</dt><dd>{node.dataType}</dd><dt>主键</dt><dd>{node.primaryKey ? '是' : '否'}</dd><dt>必填</dt><dd>{node.required ? '是' : '否'}</dd></dl> : <><h4>{node.kind === 'entity' ? '字段' : '直属下级'}（{children.length}）</h4>{children.length ? <ul className="data-children">{children.map(child => <li key={child.id}><button type="button" onClick={() => setSelected(child.id)}><Icon name={icons[child.kind]} size={16} />{child.name}</button><small>{child.kind === 'field' ? child.dataType + (child.primaryKey ? ' · 主键' : child.required ? ' · 必填' : ' · 可选') : labels[child.kind]}</small></li>)}</ul> : <p>尚未添加{node.kind === 'entity' ? '字段' : '下级节点'}。</p>}</>}
      </> : <p>选择数据域、实体或字段查看详情。</p>}</article>
    </div>}
    {snapshot && edit && <DataNodeDialog project={project} snapshot={snapshot} edit={edit} OnClose={() => setEdit(undefined)} OnSaved={Saved} />}
  </section>;
}
