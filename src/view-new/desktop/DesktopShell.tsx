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
  const [expanded, setExpanded] = useState(true);

  const [settings, setSettings] = useState<'通用' | '外观'>();

  const [page, setPage] = useState<DiscoveryPage | 'workspace'>('workspace');

  const [projects, setProjects] = useState<ProjectItem[]>([]);

  const [selected, setSelected] = useState<ProjectItem>();

  const [office, setOffice] = useState<OfficeConversation>();

  const request = useRef(0);

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function openProject(project: ProjectItem, draft = false, session?: string)
  {
    setSelected(project);

    setPage('workspace');

    const sequence = ++request.current;

    setOffice(undefined);

    setError('');

    window.desktopMenu.OpenOffice(project.id, draft ? 'create' : session ? 'select' : 'latest', session).then(value => { if (sequence === request.current) setOffice(value); }).catch(e => { if (sequence === request.current) setError(String(e)); });
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

  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 960);

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
      <nav className="workspace-list" aria-label="项目列表">{projects.filter(p => (p.name + ' ' + p.path).toLowerCase().includes(search.toLowerCase())).map(p => <WorkspaceRow key={p.id} project={p} active={selected?.id === p.id && page === 'workspace'} onOpen={openProject} />)}</nav>
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
          <OfficeView key={office.id} conversation={office} project={selected} draft={drafts[office.id] ?? ''}
            onDraft={text => setDrafts(previous => ({ ...previous, [office.id]: text }))}
            onSelect={id => openProject(selected, false, id)} onCreate={() => openProject(selected, true)}
            onSaved={messages => setOffice(current => current?.id === office.id ? { ...current, sessions: current.sessions.map(s => s.id === current.id && !current.messages.length ? { ...s, title: messages[0].text.slice(0, 32) } : s), messages: [...current.messages, ...messages] } : current)} />
          : <p role="status">{error ? '无法打开 Office 对话' : '正在打开 Office 对话…'}</p> : <section className="workspace-welcome">
        <div className="intro-emblem"><BrandMark size={64} decorative /></div>
        <p className="overline">CBIM Assistant · 团队工作空间</p>
        <h1>你的团队，新的工作方式</h1>
        <p>连接团队能力、项目知识与每一次协作。</p>
        <button className="solid-button" disabled={choosing} onClick={() => void chooseProject()}><Icon name="plus" size={17} />新建</button>
      </section>}
    </main>
    <ExtensionPanel open={panelOpen} />
    <button className="icon-button panel-switch" aria-label={panelOpen ? '收起扩展面板' : '展开扩展面板'} aria-controls="extension-panel" aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)}><Icon name="panelRight" size={16} /></button>
  </div></div>;
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
