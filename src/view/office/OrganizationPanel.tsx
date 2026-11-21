/**
 * 作用定位：组织树只持有导航状态，节点资料和能力配置分别通过独立编辑器保存。
 * 设计原因：树导航与能力配置分开编辑，视图只消费宿主快照，不直接修改 Agent 实例。
 */
import { useEffect, useState } from 'react';

import type { OrganizationSnapshot, AgentConfiguration } from '../../bridge/contracts/discovery';

import { AgentSettingsDialog } from './AgentSettingsDialog';

import { OrganizationNodeDialog, type OrganizationEdit } from './OrganizationNodeDialog';

import { Icon } from '../../framework-ui/Icon';

/** 图标操作始终保留标题和可访问名称。 */
function Action({ label, icon, disabled, OnClick }: { label: string; icon: string; disabled?: boolean; OnClick(): void })
{
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={OnClick}><Icon name={icon} size={18} /></button>;
}

export function OrganizationPanel({ project, OnBack, OnManageEngines }: { project: string; OnBack(): void; OnManageEngines(): void })
{
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot>();

  const [selected, setSelected] = useState<string>();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState('');

  const [edit, setEdit] = useState<OrganizationEdit>();

  const [settings, setSettings] = useState(false);

  const [error, setError] = useState('');

  const [loading, setLoading] = useState(true);

  const [refresh, setRefresh] = useState(0);

  const [configuration, setConfiguration] = useState<AgentConfiguration>();

  const [configurationError, setConfigurationError] = useState('');

  useEffect(() => { let current = true; setLoading(true); setError(''); window.desktopMenu.Organization(project).then(value => { if (current) { setSnapshot(value); setSelected(previous => value.nodes.some(node => node.id === previous) ? previous : value.nodes[0]?.id); } }).catch(error => { if (current) setError(String(error)); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; }; }, [project, refresh]);

  const nodes = snapshot?.nodes ?? [];

  const byId = new Map(nodes.map(node => [node.id, node]));

  const children = new Map<string | null, string[]>();

  for (const node of nodes)
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);

  const term = query.trim().toLocaleLowerCase();

  const visible = new Set<string>();

  for (const node of nodes)
    if ((node.name + ' ' + node.position + ' ' + node.id).toLocaleLowerCase().includes(term))
    {
      let id: string | null = node.id;

      const seen = new Set<string>();

      while (id && !seen.has(id))
      {
        seen.add(id);

        visible.add(id);

        id = byId.get(id)?.parentId ?? null;
      }
    }

  const rows:
    {
      id: string;

      depth: number
    }[] = [];

  const pending = (children.get(null) ?? []).map(id => ({ id, depth: 0 })).reverse();

  const visited = new Set<string>();

  while (pending.length)
  {
    const row = pending.pop()!;

    if (!visible.has(row.id) || visited.has(row.id))
      continue;

    visited.add(row.id);

    rows.push(row);

    if (term || !collapsed.has(row.id))
      pending.push(...(children.get(row.id) ?? []).map(id => ({ id, depth: row.depth + 1 })).reverse());
  }

  const node = selected ? byId.get(selected) : undefined;

  useEffect(() => { let current = true; setConfiguration(undefined); setConfigurationError(''); if (node?.kind === 'agent') window.desktopMenu.AgentSettings(project, { kind: 'member', id: node.id }).then(saved => { if (current) setConfiguration(saved.configuration); }).catch(error => { if (current) setConfigurationError(String(error)); }); return () => { current = false; }; }, [project, node?.id, node?.kind, refresh]);

  const descendants = children.get(node?.id ?? null) ?? [];

  const crumbs: string[] = [];

  const seen = new Set<string>();

  for (let id = node?.id; id && !seen.has(id); id = byId.get(id)?.parentId ?? undefined)
  {
    seen.add(id);

    crumbs.unshift(id);
  }

  const save = (value: OrganizationSnapshot) => { const created = value.nodes.find(item => !byId.has(item.id)); setSnapshot(value); setSelected(previous => created?.id ?? (value.nodes.some(item => item.id === previous) ? previous : value.nodes.at(-1)?.id)); setCollapsed(new Set()); setQuery(''); setError(''); };

  return <section className="business-page organization-tree-page" aria-label="组织架构">
    <header><Action label="返回对话" icon="back" OnClick={OnBack} /><h2>组织架构</h2><Action label="新增顶层团队" icon="teamAdd" disabled={!snapshot || loading} OnClick={() => setEdit({ action: 'create', kind: 'team', parentId: null })} /><Action label="新增顶层成员" icon="personAdd" disabled={!snapshot || loading} OnClick={() => setEdit({ action: 'create', kind: 'agent', parentId: null })} /><Action label="刷新组织" icon="retry" disabled={loading} OnClick={() => setRefresh(value => value + 1)} /></header>
    <p className="business-caption">{nodes.filter(node => node.kind === 'team').length} 个团队 · {nodes.filter(node => node.kind === 'agent').length} 名成员{loading ? ' · 正在读取…' : ''}</p>
    {error && <p role="alert">{error}{snapshot && '。当前保留上次读取结果。'}</p>}
    {!snapshot ? <p role="status">{loading ? '正在读取组织…' : '读取失败，请刷新重试。'}</p> : <div className="business-layout">
      <nav className="business-navigation" aria-label="组织节点"><label className="org-search"><Icon name="search" size={16} /><input type="search" aria-label="搜索组织" placeholder="搜索团队、成员或职责" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="business-tree-actions"><Action label="全部展开" icon="expand" OnClick={() => setCollapsed(new Set())} /><Action label="全部收起" icon="collapse" disabled={!!term} OnClick={() => setCollapsed(new Set(nodes.filter(node => node.kind === 'team').map(node => node.id)))} /></div>
        <ul className="business-tree">{rows.map(row => { const item = byId.get(row.id)!; const nested = children.get(item.id) ?? []; return <li key={item.id} style={{ paddingInlineStart: Math.min(row.depth, 5) * 12 }}><div>{nested.length ? <button type="button" className="business-toggle" title={(collapsed.has(item.id) && !term ? '展开 ' : '收起 ') + item.name} aria-label={(collapsed.has(item.id) && !term ? '展开 ' : '收起 ') + item.name} aria-expanded={!!term || !collapsed.has(item.id)} disabled={!!term} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}><span className={collapsed.has(item.id) && !term ? '' : 'org-open'}><Icon name="chevron" size={14} /></span></button> : <span className="business-toggle" />}<button type="button" className="business-node" aria-current={node?.id === item.id ? 'true' : undefined} onClick={() => setSelected(item.id)}><span className="org-node-label"><Icon name={item.kind === 'team' ? 'team' : 'person'} size={16} />{item.name}</span><small>{item.kind === 'team' ? nested.length + ' 个下级' : '成员'}</small></button></div></li>; })}</ul>
        {!rows.length && <p role="status">{nodes.length ? '没有匹配的节点。' : '组织为空，使用上方图标新增团队或成员。'}</p>}
      </nav>
      <article className="business-detail" aria-label="组织节点详情">{node ? <><nav className="business-breadcrumbs" aria-label="组织路径">{crumbs.map((id, index) => <span key={id}>{index > 0 && ' / '}<button type="button" onClick={() => setSelected(id)}>{byId.get(id)?.name}</button></span>)}</nav>
        <div className="org-detail-title"><h3>{node.name}</h3><div className="org-actions"><Action label="编辑资料与归属" icon="edit" OnClick={() => setEdit({ action: 'update', node })} />{node.kind === 'agent' && <Action label="成员能力设置" icon="settings" OnClick={() => setSettings(true)} />}{node.kind === 'team' && <><Action label="新增下级团队" icon="teamAdd" OnClick={() => setEdit({ action: 'create', kind: 'team', parentId: node.id })} /><Action label="新增团队成员" icon="personAdd" OnClick={() => setEdit({ action: 'create', kind: 'agent', parentId: node.id })} /></>}<Action label={descendants.length ? '删除前请先移除或调整下级节点' : '删除节点'} icon="remove" disabled={descendants.length > 0} OnClick={() => setEdit({ action: 'delete', node })} /></div></div>
        <small>{node.kind === 'team' ? '团队' : 'Agent 成员'}</small><h4>{node.kind === 'team' ? '团队职责' : '岗位职责'}</h4><p className="business-summary">{node.position || '尚未填写职责。'}</p><p className="business-id">{node.id}</p>
        {node.kind === 'team' ? <><h4>直属下级（{descendants.length}）</h4>{descendants.length ? <ul>{descendants.map(id => <li key={id}><button type="button" onClick={() => setSelected(id)}>{byId.get(id)?.name}</button></li>)}</ul> : <p>团队尚未添加成员。</p>}</> : <><h4>执行能力</h4>{configurationError ? <p role="alert">{configurationError}</p> : configuration ? <><p>{configuration.model ? configuration.model.engine + ' · ' + configuration.model.modelId : '尚未配置引擎与模型'}</p><p>{configuration.skills?.length ?? 0} Skills · {configuration.connectorIds?.length ?? 0} 连接器</p></> : <p>正在读取能力配置…</p>}<p>通过设置图标配置此成员的独立执行能力。</p></>}
      </> : <p>选择一个团队或成员查看详情。</p>}</article>
    </div>}
    {snapshot && edit && <OrganizationNodeDialog project={project} snapshot={snapshot} edit={edit} OnClose={() => setEdit(undefined)} OnSaved={save} />}
    {settings && node?.kind === 'agent' && <AgentSettingsDialog project={project} target={{ kind: 'member', id: node.id }} title={node.name + ' · 成员设置'} OnClose={() => setSettings(false)} OnManageEngines={OnManageEngines} OnSaved={setConfiguration} />}
  </section>;
}
