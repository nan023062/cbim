/** 桌面主框架只负责布局与侧栏展开状态。业务入口在对应模块接入后启用。 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import type { DiscoveryPage, ProjectItem, OfficeConversation } from '../../bridge/contracts/discovery';

import { OfficeView } from '../office/OfficeView';

import { DiscoveryView } from '../discovery/MenuViews';

import { BrandMark } from '../shared/BrandMark';

import { Icon } from '../shared/Icon';

import { ExtensionPanel } from '../extension/ExtensionPanel';

import { SettingsView } from '../settings/SettingsView';

import { ProjectSidebar } from './ProjectSidebar';

import './desktop.css';

const resourceNavigation = [
  ['sparkles', '执行引擎', 'engines'],
  ['plug', '链接器', 'connectors'],
  ['team', '人才市场', 'talent'],
  ['knowledge', '业务模版', 'templates'],
] as const;

export function DesktopShell()
{
  const [sidebarWidth, setSidebarWidth] = useState(() => { const stored = Number(localStorage.getItem('project-sidebar-width')); return stored >= 220 && stored <= 420 ? stored : 260; });

  const [expanded, setExpanded] = useState(() => window.innerWidth > 720);

  const [settings, setSettings] = useState<'通用' | '外观'>();

  const [page, setPage] = useState<DiscoveryPage | 'workspace'>('workspace');

  const [projects, setProjects] = useState<ProjectItem[]>([]);

  const [selected, setSelected] = useState<ProjectItem>();

  const [office, setOffice] = useState<OfficeConversation>();

  const [running, setRunning] = useState<Record<string, number>>({});

  const request = useRef(0);

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function openProject(project: ProjectItem, draft = false, session?: string)
  {
    setPage('workspace');

    if (innerWidth <= 720)
      setExpanded(false);

    const sequence = ++request.current;

    setError('');

    if (!draft && session && selected?.id === project.id && office?.id === session)
      return;

    // 切换完成前保留当前对话，避免异步返回覆盖新的选择。
    if (!office)
      setSelected(project);

    window.desktopMenu.OpenOffice(project.id, draft ? 'create' : session ? 'select' : 'latest', session).then(value => { if (sequence !== request.current) return; setSelected(project); setOffice(value); localStorage.setItem('project-last-office', JSON.stringify({ project: project.id, session: value.id })); }).catch(e => { if (sequence === request.current) setError(String(e)); });
  }

  const [updateOpen, setUpdateOpen] = useState(false);

  const [updateStatus, setUpdateStatus] = useState<Awaited<ReturnType<typeof window.desktopMenu.Update>>>();

  useEffect(() => { if (!updateOpen) return; let active = true; let timer: ReturnType<typeof setTimeout>; const read = async () => { try { const state = await window.desktopMenu.Update('status'); if (active) setUpdateStatus(state); } catch (e) { if (active) setError(String(e)); } if (active) timer = setTimeout(read, 750); }; void read(); return () => { active = false; clearTimeout(timer); }; }, [updateOpen]);

  const [error, setError] = useState('');

  const [choosing, setChoosing] = useState(false);

  useEffect(() => { let current = true; window.desktopMenu.Navigation().then(value => { if (!current) return; const items = value.projects.filter(project => !project.removed); let saved; try { saved = JSON.parse(localStorage.getItem('project-last-office') || 'null'); } catch { return; } const project = items.find(project => project.id === saved?.project); if (request.current === 0 && project?.sessions.some(session => session.id === saved.session && !session.removed)) openProject(project, false, saved.session); }).catch(error => { if (current) setError(String(error)); }); return () => { current = false; }; }, []);

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

  useEffect(() => { function Shortcut(event: KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); setExpanded(value => !value); } if (event.key === 'Escape' && innerWidth <= 720 && !document.querySelector('dialog[open]')) setExpanded(false); } window.addEventListener('keydown', Shortcut); return () => window.removeEventListener('keydown', Shortcut); }, []);

  const title = page === 'workspace' ? selected?.name || '工作区' : resourceNavigation.find(item => item[2] === page)![1];

  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1380);

  const sidebarToggle = <button className="icon-button" aria-controls="team-sidebar" aria-expanded={expanded}
    aria-label={expanded ? '收起侧栏' : '展开侧栏'} onClick={() => setExpanded(!expanded)}><Icon name="panelLeft" size={16} /></button>;

  return <div id="application-home" style={{ '--sidebar-width': sidebarWidth + 'px' } as CSSProperties}>
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
    {updateOpen && <div className="update-notice" role="region" aria-label="应用更新"><strong>应用更新</strong> {({ disabled: '当前构建不支持更新', idle: '等待检查', checking: '正在检查', available: '有可用更新', current: '已是最新版', downloading: '正在下载', ready: '已就绪，等待重启', installing: '正在重启安装' } as Record<string, string>)[updateStatus?.phase ?? 'checking']} {updateStatus?.version} {updateStatus?.progress != null && Math.round(updateStatus.progress) + '%'} {updateStatus?.error}
      {updateStatus?.phase === 'ready' && <button onClick={() => void window.desktopMenu.Update('install').catch(e => setError(String(e)))}>重启安装</button>}
      {updateStatus?.phase === 'available' && <button onClick={() => void window.desktopMenu.Update('download').catch(e => setError(String(e)))}>重新下载</button>}
      <button onClick={() => setUpdateOpen(false)}>关闭</button></div>}
    {settings && <SettingsView initial={settings} onBack={() => setSettings(undefined)} />}
    <div style={settings ? { display: 'none' } : undefined} className={'desktop-shell' + (expanded ? '' : ' sidebar-collapsed')}>
    {expanded && <button className="sidebar-backdrop" aria-label="关闭项目侧栏" onClick={() => setExpanded(false)} />}
    <aside id="team-sidebar" className="workspace-sidebar sidebar-frame">
      <button className="sidebar-new-conversation" onClick={() => selected ? openProject(selected, true) : void chooseProject()}><Icon name="edit" size={16} />新建对话</button>
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
      <ProjectSidebar activeProject={page === 'workspace' ? selected?.id : undefined} activeSession={page === 'workspace' ? office?.id : undefined} OnOpen={openProject} OnAdd={() => void chooseProject()} OnSnapshot={items => { setProjects(items); setSelected(previous => { const latest = items.find(item => item.id === previous?.id); return latest && previous && (latest.name !== previous.name || latest.path !== previous.path) ? latest : previous; }); }} OnUnavailable={(project, session) => { if (selected?.id === project && (!session || office?.id === session)) { request.current++; localStorage.removeItem('project-last-office'); setOffice(undefined); setSelected(undefined); } }} />
      <footer className="sidebar-footer">
        <button className="user-profile-trigger" aria-label="用户菜单" popoverTarget="user-actions">
          <span className="profile-badge">C</span><span className="user-profile-copy"><b>本地用户</b><small>CBIM · 本地使用</small></span>
        </button>
        <div id="user-actions" popover="auto" role="group" aria-label="用户操作">
          <button popoverTarget="user-actions" popoverTargetAction="hide" onClick={() => { setUpdateOpen(true); void window.desktopMenu.Update('check').catch(e => setError(String(e))); }}><Icon name="retry" size={16} />检查更新</button>
          <button popoverTarget="user-actions" popoverTargetAction="hide" onClick={() => setSettings('通用')}><Icon name="settings" size={16} />设置</button>
        </div>
      </footer>
      <div className="project-sidebar-resize" role="separator" aria-label="调整项目侧栏宽度" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={420} aria-valuenow={sidebarWidth} tabIndex={0} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 260 : Math.max(220, Math.min(420, sidebarWidth + (event.key === 'ArrowRight' ? 10 : -10))); setSidebarWidth(next); localStorage.setItem('project-sidebar-width', String(next)); } }} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setSidebarWidth(Math.max(220, Math.min(420, event.clientX))); }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); localStorage.setItem('project-sidebar-width', String(sidebarWidth)); }} onDoubleClick={() => { setSidebarWidth(260); localStorage.removeItem('project-sidebar-width'); }} />
    </aside>
    <main className="workspace-main">
      <header className="workspace-topbar">{page !== 'workspace' && <button aria-label="返回工作区" onClick={() => setPage('workspace')}>←</button>}<Icon name="folder" size={16} /><strong>{title}</strong>
      </header>
      {error && <p role="alert">{error}</p>}
      {page !== 'workspace' ? <DiscoveryView key={page} page={page} title={title} /> : selected ? office ?
          <OfficeView onManageEngines={() => setPage('engines')} key={office.id} conversation={office} project={selected} draft={drafts[office.id] ?? ''}
            onDraft={text => setDrafts(previous => ({ ...previous, [office.id]: text }))}
            started={running[office.id] ?? 0} onRunning={time => setRunning(previous => ({ ...previous, [office.id]: time }))}
            onSaved={messages => { setOffice(current => current?.id === office.id ? { ...current, messages: [...current.messages, ...messages.filter(m => !current.messages.some(existing => existing.id === m.id))] } : current); }} />
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
