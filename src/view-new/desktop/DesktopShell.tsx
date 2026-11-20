/** 桌面主框架只负责布局与侧栏展开状态。业务入口在对应模块接入后启用。 */
import { useEffect, useRef, useState } from 'react';

import type { DiscoveryPage, ProjectItem, OfficeConversation } from '../../bridge/contracts/discovery';

import { OfficeView } from '../office/OfficeView';

import { DiscoveryView } from '../discovery/MenuViews';

import { BrandMark } from '../shared/BrandMark';

import { Icon } from '../shared/Icon';

import { ExtensionPanel } from '../extension/ExtensionPanel';

import { SettingsView } from '../settings/SettingsView';

import './desktop.css';

const resourceNavigation = [
  ['sparkles', '执行引擎', 'engines'],
  ['plug', '链接器', 'connectors'],
  ['team', '人才市场', 'talent'],
  ['knowledge', '业务模版', 'templates'],
] as const;

export function DesktopShell()
{
  const [expanded, setExpanded] = useState(() => window.innerWidth > 720);

  const [settings, setSettings] = useState<'通用' | '外观'>();

  const [page, setPage] = useState<DiscoveryPage | 'workspace'>('workspace');

  const [projects, setProjects] = useState<ProjectItem[]>([]);

  const [selected, setSelected] = useState<ProjectItem>();

  const [office, setOffice] = useState<OfficeConversation>();

  const [sessions, setSessions] = useState<Record<string, OfficeConversation['sessions']>>({});

  const [running, setRunning] = useState<Record<string, number>>({});

  const request = useRef(0);

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function openProject(project: ProjectItem, draft = false, session?: string)
  {
    setSelected(project);

    setPage('workspace');

    const sequence = ++request.current;

    setOffice(undefined);

    setError('');

    window.desktopMenu.OpenOffice(project.id, draft ? 'create' : session ? 'select' : 'latest', session).then(value =>
    {
      if (sequence !== request.current) return;
      setSessions(previous => ({ ...previous, [project.id]: value.sessions }));
      setOffice(value);
    }).catch(e => { if (sequence === request.current) setError(String(e)); });
  }

  const [search, setSearch] = useState('');

  const [error, setError] = useState('');

  const [choosing, setChoosing] = useState(false);

  useEffect(() => { let current = true; window.desktopMenu?.Projects().then(items => { if (current) setProjects(items); }).catch(e => { if (current) setError(e.message); }); return () => { current = false; }; }, []);

  async function chooseProject()
  {
    setChoosing(true);

    setError('');

    try
    {
      const item = await window.desktopMenu.AddProject();

      if (item)
      {
        setProjects(await window.desktopMenu.Projects());

        openProject(item);
      }
    }
    catch (e)
    {
      setError(String(e));
    }
    finally
    {
      setChoosing(false);
    }
  }

  const title = page === 'workspace' ? selected?.name || '工作区' : resourceNavigation.find(item => item[2] === page)![1];

  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1380);

  const sidebarToggle = <button className="icon-button" aria-controls="team-sidebar" aria-expanded={expanded}
    aria-label={expanded ? '收起侧栏' : '展开侧栏'} onClick={() => setExpanded(!expanded)}><Icon name="panelLeft" size={16} /></button>;

  return <div id="application-home">
    <header className="desktop-titlebar">
      {sidebarToggle}
      <button onClick={() => void window.desktopMenu.OpenMonitor().catch(e => setError(String(e)))}><Icon name="flow" size={15} />资源监视器</button>
      <button popoverTarget="title-help">帮助</button>
      <button popoverTarget="title-about">关于</button>
      <section id="title-help" className="title-popup title-info" popover="auto" aria-label="帮助">
        <strong>帮助</strong><p>从「新建」选择项目目录，通过「发现」浏览资源。打开「资源监视器」可查看进程占用。</p>
      </section>
      <section id="title-about" className="title-popup title-info" popover="auto" aria-label="关于 CBIM">
        <strong>关于 CBIM Assistant</strong><p>在项目工作区中组织 Agent 团队与工作流。</p>
      </section>
    </header>
    {settings && <SettingsView initial={settings} onBack={() => setSettings(undefined)} />}
    <div style={settings ? { display: 'none' } : undefined} className={'desktop-shell' + (expanded ? '' : ' sidebar-collapsed')}>
    <aside id="team-sidebar" className="workspace-sidebar sidebar-frame">
      <nav className="primary-nav" aria-label="主菜单">
        {resourceNavigation.filter(([, , target]) => target !== 'templates').map(([icon, label, target]) =>
            <button key={target} className={page === target ? 'selected' : undefined} aria-current={page === target ? 'page' : undefined} onClick={() => setPage(target)}>
            <Icon name={icon} />{label}
          </button>)}
        <button className="resource-more" popoverTarget="resource-overflow"><Icon name="more" />发现</button>
        <div id="resource-overflow" popover="auto" role="group" aria-label="发现资源">
          {resourceNavigation.map(([icon, label, target]) => <button key={target} onClick={event => { setPage(target); event.currentTarget.parentElement?.hidePopover(); }}><Icon name={icon} size={16} />{label}</button>)}
        </div>
      </nav>
      <div className="sidebar-search"><Icon name="search" size={16} /><input value={search} onChange={event => setSearch(event.target.value)} aria-label="搜索工作区" placeholder="搜索工作区" /></div>
      <div className="sidebar-label"><span>工作区</span>
        <button className="icon-button" aria-label="新建工作区" title="新建工作区" disabled={choosing} onClick={() => void chooseProject()}>
          <Icon name="plus" size={16} />
        </button>
      </div>
      <nav className="workspace-list" aria-label="项目列表">{projects.filter(p => (p.name + ' ' + p.path).toLowerCase().includes(search.toLowerCase())).map(p => <div key={p.id}>
        <WorkspaceRow project={p} active={selected?.id === p.id && page === 'workspace'} onOpen={openProject} />
        {sessions[p.id]?.map(session => <ConversationRow key={session.id} session={session} active={page === 'workspace' && office?.id === session.id}
          running={!!running[session.id]} onOpen={() => openProject(p, false, session.id)} />)}
      </div>)}</nav>
      <footer className="sidebar-footer">
        <button className="user-profile-trigger" aria-label="用户菜单" popoverTarget="user-actions">
          <span className="profile-badge">C</span><span className="user-profile-copy"><b>本地用户</b><small>CBIM · 本地使用</small></span>
        </button>
        <div id="user-actions" popover="auto" role="group" aria-label="用户操作">
          <button disabled><Icon name="retry" size={16} />检查更新</button>
          <button popoverTarget="user-actions" popoverTargetAction="hide" onClick={() => setSettings('通用')}><Icon name="settings" size={16} />设置</button>
        </div>
      </footer>
    </aside>
    <main className="workspace-main">
      <header className="workspace-topbar">{page !== 'workspace' && <button aria-label="返回工作区" onClick={() => setPage('workspace')}>←</button>}<Icon name="folder" size={16} /><strong>{title}</strong>
      </header>
      {error && <p role="alert">{error}</p>}
      {page !== 'workspace' ? <DiscoveryView key={page} page={page} title={title} /> : selected ? office ?
          <OfficeView onManageEngines={() => setPage('engines')} key={office.id} conversation={office} project={selected} draft={drafts[office.id] ?? ''}
            onDraft={text => setDrafts(previous => ({ ...previous, [office.id]: text }))}
            started={running[office.id] ?? 0} onRunning={time => setRunning(previous => ({ ...previous, [office.id]: time }))}
            onSaved={messages =>
            {
              if (!office.messages.length) setSessions(previous => ({ ...previous, [selected.id]: (previous[selected.id] ?? []).map(s => s.id === office.id ? { ...s, title: messages[0].text.slice(0, 32) } : s) }));
              setOffice(current => current?.id === office.id ? { ...current, messages: [...current.messages, ...messages.filter(m => !current.messages.some(existing => existing.id === m.id))] } : current);
            }} />
          : <p role="status">{error ? '无法打开 Office 对话' : '正在打开 Office 对话…'}</p> : <section className="workspace-welcome">
        <div className="intro-emblem"><BrandMark size={64} decorative /></div>
        
        <h1>打开一个工作区</h1>
        <p>选择本地项目目录，开始 Office 对话。</p>
        <button className="solid-button" disabled={choosing} onClick={() => void chooseProject()}><Icon name="folder" size={16} />选择目录</button>
      </section>}
    </main>
    <ExtensionPanel open={panelOpen} />
    <button className="icon-button panel-switch" aria-label={panelOpen ? '收起扩展面板' : '展开扩展面板'} aria-controls="extension-panel" aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)}><Icon name="panelRight" size={16} /></button>
  </div></div>;
}

/** 项目下的对话入口；本机显示名称可通过行末编辑按钮修改。 */
function ConversationRow({ session, active, running, onOpen }: { session: OfficeConversation['sessions'][number]; active: boolean; running: boolean; onOpen(): void })
{
  const key = 'office-title:' + session.id;
  const [alias, setAlias] = useState(() => localStorage.getItem(key) ?? '');
  const [editing, setEditing] = useState(false);
  const title = alias || session.title;
  return <div className="project-list-row office-session-row" data-active={active || undefined}>
    {editing ? <form onSubmit={event =>
    {
      event.preventDefault();
      const name = String(new FormData(event.currentTarget).get('title') ?? '').trim();
      localStorage.setItem(key, name);
      setAlias(name);
      setEditing(false);
    }}><input autoFocus name="title" aria-label="对话名称" maxLength={80} defaultValue={title}
      onFocus={e => e.target.select()} onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }} />
      <button type="submit" title="保存名称" aria-label="保存名称"><Icon name="confirm" size={14} /></button></form> : <>
      <button className="project-select" aria-current={active ? 'page' : undefined} onClick={onOpen} title={title}>
        <span className={'office-session-icon' + (running ? ' executing' : '')} role="img" aria-label={running ? '正在执行' : '对话'}><Icon name="conversation" size={15} /></span><span>{title}</span></button>
      <button className="project-action" title="重命名对话" aria-label={'重命名对话 · ' + title} onClick={() => setEditing(true)}><Icon name="edit" size={14} /></button></>}
  </div>;
}

/** 同一行的快捷操作和上下文菜单始终绑定当前项目。 */
function WorkspaceRow({ project, active, onOpen }: { project: ProjectItem; active: boolean; onOpen(project: ProjectItem, draft?: boolean): void })
{
  const menu = useRef<HTMLDivElement>(null);

  const menuId = 'workspace-actions-' + project.id;

  return <div className="project-list-row" onContextMenu={event => { event.preventDefault(); const popup = menu.current; if (!popup) return; popup.showPopover(); popup.style.left = Math.max(0, Math.min(event.clientX, innerWidth - popup.offsetWidth)) + 'px'; popup.style.top = Math.max(0, Math.min(event.clientY, innerHeight - popup.offsetHeight)) + 'px'; }}>
    <button className="project-select" title={project.path} aria-current={active ? 'page' : undefined} onClick={() => onOpen(project)}><Icon name="folder" size={16} /><span>{project.name}</span></button>
    <button className="project-action" title="更多" aria-label={project.name + ' · 更多'} popoverTarget={menuId}
      onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); if (menu.current) { menu.current.style.left = Math.max(0, Math.min(rect.left, innerWidth - 90)) + 'px'; menu.current.style.top = Math.min(rect.bottom, innerHeight - 48) + 'px'; } }}><Icon name="more" size={16} /></button>
    <button className="project-action" title="新建任务" aria-label={project.name + ' · 新建任务'} onClick={() => onOpen(project, true)}><Icon name="edit" size={16} /></button>
    <div ref={menu} id={menuId} className="project-context" popover="auto" role="group" aria-label={project.name + '的操作'}>
      <button title="查看工作区" aria-label="查看工作区" popoverTarget={menuId} popoverTargetAction="hide" onClick={() => onOpen(project)}><Icon name="folder" size={16} /></button>
      <button title="新建任务" aria-label="新建任务" popoverTarget={menuId} popoverTargetAction="hide" onClick={() => onOpen(project, true)}><Icon name="edit" size={16} /></button>
    </div>
  </div>;
}
