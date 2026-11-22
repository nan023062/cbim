/**
 * 作用定位：组织树只持有导航状态，节点资料和能力配置分别通过独立编辑器保存。
 * 设计原因：树导航与能力配置分开编辑，视图只消费宿主快照，不直接修改 Agent 实例。
 */
import { IconButton, Button, FieldLabel, Icon, Input, ListItem } from '../../framework-ui';
import { EngineLogo, ResourceLogo } from '../shared/ResourceLogo';
import { useEffect, useState } from 'react';

import type { OrganizationSnapshot, AgentConfiguration } from '../../bridge/contracts/discovery';

import { AgentSettingsDialog } from './AgentSettingsDialog';

import { OrganizationNodeDialog, type OrganizationEdit } from './OrganizationNodeDialog';


/** 图标操作始终保留标题和可访问名称。 */
function MemberDetails({configuration}:{configuration:AgentConfiguration}){
  const [engines,setEngines]=useState<Awaited<ReturnType<typeof window.desktopMenu.EngineCatalog>>>([]);
  const [models,setModels]=useState<{id:string; name:string; profile:string}[]>([]);
  const [connectors,setConnectors]=useState<Awaited<ReturnType<typeof window.desktopMenu.AgentConnectors>>>([]);
  useEffect(()=>{let current=true;void window.desktopMenu.EngineCatalog().then(v=>current&&setEngines(v)).catch(()=>{});void window.desktopMenu.AgentConnectors().then(v=>current&&setConnectors(v)).catch(()=>{});void window.desktopMenu.Model('models.list').then(v=>{if(current)setModels(v.profiles.flatMap(p=>p.models.map(m=>({id:m.id,name:m.name||m.id,profile:p.id}))))}).catch(()=>{});return()=>{current=false}},[]);
  const model=configuration.model,engine=engines.find(e=>e.id===model?.engine);
  return <><dl><dt>执行引擎</dt><dd>{model?<><EngineLogo src={engine?.logo}/> {engine?.label||model.engine}</>:'未配置'}</dd><dt>模型</dt><dd>{model?(models.find(m=>m.id===model.modelId&&m.profile===model.profileId)?.name||model.modelId):'未配置'}</dd><dt>连接器</dt><dd>{configuration.connectorIds?.length?configuration.connectorIds.map(id=>{const entry=connectors.find(c=>c.id===id);return <span key={id} tabIndex={0} title={entry?.name||id} aria-label={entry?.name||id}>{entry?.logo?<img width={18} height={18} src={entry.logo} alt=""/>:<Icon name="connector"/>}</span>}):'未配置'}</dd></dl><h4>岗位专属技能</h4>{configuration.skills?.length?configuration.skills.map(skill=><p key={skill.id}><ResourceLogo kind="skill" name={skill.name} logo={skill.logo}/> {skill.name}</p>):<p>尚未配置岗位专属技能。</p>}</>;
}

function Action({ label, icon, disabled, OnClick }: { label: string; icon: string; disabled?: boolean; OnClick(): void })
{
  return <IconButton type="button" title={label} aria-label={label} disabled={disabled} onClick={OnClick}><Icon name={icon} size={18} /></IconButton>;
}

export function OrganizationPanel({ project, OnBack, OnManageModels }: { project: string; OnBack(): void; OnManageModels(): void; })
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

  const node = selected && (!term || visited.has(selected)) ? byId.get(selected) : undefined;

  useEffect(() => { let current = true; setConfiguration(undefined); setConfigurationError(''); if (node?.kind === 'agent') window.desktopMenu.AgentSettings(project, { kind: 'member', id: node.id }).then(saved => { if (current) setConfiguration(saved.configuration); }).catch(error => { if (current) setConfigurationError(String(error)); }); return () => { current = false; }; }, [project, node?.id, node?.kind, refresh]);

  const branches = nodes.filter(n => children.get(n.id)?.length).map(n => n.id);
  const expandedAll = !branches.some(id => collapsed.has(id));
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
      <nav className="business-navigation" aria-label="组织节点"><FieldLabel className="org-search"><Icon name="search" size={16} /><Input type="search" aria-label="搜索组织" placeholder="搜索团队、成员或职责" value={query} onChange={event => setQuery(event.target.value)} /></FieldLabel>
        <div className="business-tree-actions"><IconButton aria-expanded={expandedAll} aria-label={expandedAll ? "全部收起" : "全部展开"} title={term ? "搜索时保持匹配分支展开" : undefined} disabled={!!term || !branches.length} onClick={() => setCollapsed(new Set(expandedAll ? branches : []))}><Icon name="chevron" /></IconButton></div>
        <ul className="business-tree">{rows.map(row => { const item = byId.get(row.id)!; const nested = children.get(item.id) ?? []; return <li key={item.id} style={{ paddingInlineStart: Math.min(row.depth, 5) * 12 }}><div>{nested.length ? <IconButton type="button" className="business-toggle" title={(collapsed.has(item.id) && !term ? '展开 ' : '收起 ') + item.name} aria-label={(collapsed.has(item.id) && !term ? '展开 ' : '收起 ') + item.name} aria-expanded={!!term || !collapsed.has(item.id)} disabled={!!term} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}><span className={collapsed.has(item.id) && !term ? '' : 'org-open'}><Icon name="chevron" size={14} /></span></IconButton> : <span className="business-toggle" />}<ListItem type="button" className="business-node" aria-current={node?.id === item.id ? 'true' : undefined} onClick={() => setSelected(item.id)}><span className="org-node-label"><Icon name={item.kind === 'team' ? 'team' : 'person'} size={16} />{item.name}</span><small>{item.kind === 'team' ? nested.length + ' 个下级' : '成员'}</small></ListItem></div></li>; })}</ul>
        {!rows.length && <p role="status">{nodes.length ? '没有匹配的节点。' : '组织为空，使用上方图标新增团队或成员。'}</p>}
      </nav>
      <article className="business-detail" aria-label="组织节点详情">{node ? <><nav className="business-breadcrumbs" aria-label="组织路径">{crumbs.map((id, index) => <span key={id}>{index > 0 && ' / '}<Button type="button" onClick={() => setSelected(id)}>{byId.get(id)?.name}</Button></span>)}</nav>
        <div className="org-detail-title"><h3>{node.name}</h3><div className="org-actions"><Action label="编辑资料与归属" icon="edit" OnClick={() => setEdit({ action: 'update', node })} />{node.kind === 'agent' && <Action label="成员能力设置" icon="settings" OnClick={() => setSettings(true)} />}{node.kind === 'team' && <><Action label="新增下级团队" icon="teamAdd" OnClick={() => setEdit({ action: 'create', kind: 'team', parentId: node.id })} /><Action label="新增团队成员" icon="personAdd" OnClick={() => setEdit({ action: 'create', kind: 'agent', parentId: node.id })} /></>}<Action label={descendants.length ? '删除前请先移除或调整下级节点' : '删除节点'} icon="remove" disabled={descendants.length > 0} OnClick={() => setEdit({ action: 'delete', node })} /></div></div>
        <small>{node.kind === 'team' ? '团队' : 'Agent 成员'}</small><h4>{node.kind === 'team' ? '团队职责' : '岗位职责'}</h4><p className="business-summary">{node.position || '尚未填写职责。'}</p><p className="business-id">{node.id}</p>
        {node.kind === 'team' ? <><h4>团队专属技能</h4>{node.teamSkills?.length?node.teamSkills.map(skill=><details key={skill.id}><summary><ResourceLogo kind="skill" name={skill.name} logo={skill.logo}/> {skill.name}</summary><p>{skill.content}</p></details>):<p>尚未配置团队技能。</p>}<h4>直属下级（{descendants.length}）</h4>{descendants.length ? <ul>{descendants.map(id => <li key={id}><Button type="button" onClick={() => setSelected(id)}>{byId.get(id)?.name}</Button></li>)}</ul> : <p>团队尚未添加成员。</p>}</> : <><h4>执行能力</h4>{configurationError ? <p role="alert">{configurationError}</p> : configuration ? <MemberDetails configuration={configuration} /> : <p>正在读取能力配置…</p>}<p>通过设置图标配置此成员的独立执行能力。</p></>}
      </> : <p>{term && !rows.length ? '没有匹配项。更换关键词或清空搜索后查看详情。' : '选择一个团队或成员查看详情。'}</p>}</article>
    </div>}
    {snapshot && edit && <OrganizationNodeDialog project={project} snapshot={snapshot} edit={edit} OnClose={() => setEdit(undefined)} OnSaved={save} />}
    {settings && node?.kind === 'agent' && <AgentSettingsDialog project={project} target={{ kind: 'member', id: node.id }} title={node.name + ' · 成员设置'} OnClose={() => setSettings(false)} OnManageModels={OnManageModels} OnSaved={setConfiguration} />}
  </section>;
}
