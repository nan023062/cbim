/**
 * 作用定位：业务架构实时编辑视图；页面只持有选择、搜索和折叠状态。
 * 设计原因：树展示与持久定义分开，刷新以宿主快照为准，编辑流程由独立弹窗负责。
 */
import { Button, FieldLabel, Icon, Input, ListItem } from '../../framework-ui';
import { useEffect, useState } from 'react';

import { BusinessNodeDialog, type BusinessEdit } from './BusinessNodeDialog';

import type { BusinessArchitecture, BusinessSnapshot } from '../../bridge/contracts/discovery';

import { ResourceLogo } from '../shared/ResourceLogo';


export function BusinessPanel({ project, OnBack }: { project: string; OnBack(): void })
{
  const [snapshot, setSnapshot] = useState<BusinessSnapshot>();

  const [edit, setEdit] = useState<BusinessEdit>();

  const tree: BusinessArchitecture | undefined = snapshot && { roots: snapshot.nodes.filter(node => node.parentId === null).map(node => node.id), nodes: snapshot.nodes.map(node => ({ ...node, children: snapshot.nodes.filter(child => child.parentId === node.id).map(child => child.id) })) };

  const [selected, setSelected] = useState<string>();

  const [query, setQuery] = useState('');

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [refresh, setRefresh] = useState(0);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState('');

  useEffect(() => { let current = true; setLoading(true); setError(''); window.desktopMenu.BusinessArchitecture(project).then(value => { if (!current) return; setSnapshot(value); setSelected(previous => value.nodes.some(node => node.id === previous) ? previous : value.nodes.find(node => node.parentId === null)?.id); }).catch(error => { if (current) setError(String(error)); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; }; }, [project, refresh]);

  const nodes = new Map((tree?.nodes ?? []).map(node => [node.id, node]));

  const parents = new Map<string, string>();

  for (const node of nodes.values())
    for (const child of node.children)
      parents.set(child, node.id);

  const keyword = query.trim().toLocaleLowerCase();

  const matches = new Set([...nodes.values()].filter(node => (node.name + ' ' + node.id + ' ' + node.summary).toLocaleLowerCase().includes(keyword)).map(node => node.id));

  const visible = new Set(matches);

  for (const id of matches)
  {
    const seen = new Set<string>();

    for (let parent = parents.get(id); parent && !seen.has(parent); parent = parents.get(parent))
    {
      seen.add(parent);

      visible.add(parent);
    }
  }

  const rows:
    {
      id: string;

      depth: number
    }[] = [];

  const visited = new Set<string>();

  const pending = (tree?.roots ?? []).map(id => ({ id, depth: 0 })).reverse();

  while (pending.length)
  {
    const row = pending.pop()!;

    const node = nodes.get(row.id);

    if (!node || visited.has(row.id) || !visible.has(row.id))
      continue;

    visited.add(row.id);

    rows.push(row);

    if (keyword || !collapsed.has(row.id))
      pending.push(...node.children.map(id => ({ id, depth: row.depth + 1 })).reverse());
  }

  const node = selected ? nodes.get(selected) : undefined;

  const breadcrumbs: string[] = [];

  const ancestry = new Set<string>();

  for (let id = node?.id; id && !ancestry.has(id); id = parents.get(id))
  {
    ancestry.add(id);

    breadcrumbs.unshift(id);
  }

  return <section className="business-page" aria-label="业务架构">
    <header><Button type="button" title="返回对话" aria-label="返回对话" onClick={OnBack}><Icon name="back" /></Button><h2>业务架构</h2><Button type="button" title="新增顶层业务节点" aria-label="新增顶层业务节点" disabled={!snapshot || loading} onClick={() => setEdit({ action: 'create', parentId: null })}><Icon name="folderAdd" /></Button><Button type="button" title="刷新业务架构" aria-label="刷新业务架构" disabled={loading} onClick={() => setRefresh(value => value + 1)}><Icon name="retry" size={18} /></Button></header>
    <p className="business-caption">与 Agent 共用当前业务树 · {tree?.nodes.length ?? 0} 个节点 · {tree?.roots.length ?? 0} 个顶层节点</p>
    {error && <p role="alert">读取失败：{error}{tree && '。下方保留上次读取结果。'}</p>}
    {!tree ? <p role="status">{loading ? '正在读取业务架构…' : '未能读取业务架构，请重试。'}</p> : !tree.nodes.length ? <div className="business-empty"><Icon name="flow" size={36} /><h3>尚未登记业务节点</h3><p>项目业务模块登记后，会在这里显示层级、职责和来源范围。</p></div> : <div className="business-layout">
      <nav className="business-navigation" aria-label="业务节点">
        <FieldLabel>搜索业务节点<Input type="search" placeholder="名称、职责或节点 ID" value={query} onChange={event => setQuery(event.target.value)} /></FieldLabel>
        <div className="business-tree-actions"><Button type="button" onClick={() => setCollapsed(new Set())}>全部展开</Button><Button type="button" disabled={!!keyword} onClick={() => setCollapsed(new Set(nodes.keys()))}>全部收起</Button></div>
        <ul className="business-tree">{rows.map(row => { const item = nodes.get(row.id)!; return <li key={item.id} style={{ paddingInlineStart: Math.min(row.depth, 5) * 12 }}><div>{item.children.length ? <Button type="button" className="business-toggle" disabled={!!keyword} aria-label={(collapsed.has(item.id) && !keyword ? '展开 ' : '收起 ') + item.name} aria-expanded={!!keyword || !collapsed.has(item.id)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}>{collapsed.has(item.id) && !keyword ? '▸' : '▾'}</Button> : <span className="business-toggle">·</span>}<ListItem type="button" className="business-node" aria-current={selected === item.id ? 'true' : undefined} onClick={() => setSelected(item.id)}><span>{item.name || item.id}</span><small>{item.children.length ? item.children.length + ' 个子节点' : '叶子节点'}</small></ListItem></div></li>; })}</ul>
        {!rows.length && <p role="status">没有匹配的业务节点。</p>}
      </nav>
      <article className="business-detail" aria-label="业务节点详情">{node ? <>
        <nav className="business-breadcrumbs" aria-label="业务层级路径">{breadcrumbs.map((id, index) => <span key={id}>{index > 0 && ' / '}<Button type="button" onClick={() => setSelected(id)}>{nodes.get(id)?.name ?? id}</Button></span>)}</nav>
        <div className="org-detail-title"><h3>{node.name}</h3><div className="org-actions"><Button type="button" title="编辑业务节点" aria-label="编辑业务节点" disabled={loading} onClick={() => setEdit({ action: 'update', node: snapshot!.nodes.find(item => item.id === node.id)! })}><Icon name="edit" /></Button><Button type="button" title="新增下级业务节点" aria-label="新增下级业务节点" disabled={loading} onClick={() => setEdit({ action: 'create', parentId: node.id })}><Icon name="folderAdd" /></Button><Button type="button" title={node.children.length ? '请先移除或调整下级节点' : '删除业务节点'} aria-label="删除业务节点" disabled={loading || !!node.children.length} onClick={() => setEdit({ action: 'delete', node: snapshot!.nodes.find(item => item.id === node.id)! })}><Icon name="remove" /></Button></div></div><p className="business-id">{node.id}</p><small>{node.virtual ? '虚拟业务节点' : '业务工作区'}</small>
        {snapshot?.nodes.find(item => item.id === node.id)?.workflows?.map((flow,index) => <p key={index}><ResourceLogo kind="workflow" name={flow.name} logo={flow.logo} /> {flow.name}</p>)}
        <h4>业务职责</h4><p className="business-summary">{node.summary || '尚未填写职责说明。'}</p>
        <h4>直属子节点（{node.children.length}）</h4>{node.children.length ? <ul>{node.children.map(id => <li key={id}><Button type="button" disabled={!nodes.has(id)} onClick={() => setSelected(id)}>{nodes.get(id)?.name ?? id}</Button></li>)}</ul> : <p>没有直属子节点。</p>}
        <h4>来源与范围（{node.sources.length}）</h4>{node.sources.length ? <dl className="business-sources">{node.sources.map((source, index) => <div key={index}><dt>来源</dt><dd>{source.location}</dd><dt>范围</dt><dd>{source.scope || '未填写'}</dd></div>)}</dl> : <p>尚未登记来源范围。</p>}
      </> : <p>选择节点查看业务详情。</p>}</article>
    </div>}
    {snapshot && edit && <BusinessNodeDialog project={project} snapshot={snapshot} edit={edit} OnClose={() => setEdit(undefined)} OnSaved={value => { const created = value.nodes.find(item => !nodes.has(item.id)); setSnapshot(value); setSelected(created?.id ?? (value.nodes.some(item => item.id === selected) ? selected : value.nodes.at(-1)?.id)); setCollapsed(new Set()); setQuery(''); setError(''); }} />}
  </section>;
}
