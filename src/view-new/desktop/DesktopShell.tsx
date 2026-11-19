/** 桌面主框架只负责布局与侧栏展开状态。业务入口在对应模块接入后启用。 */
import { useEffect, useState } from 'react';
import type { DiscoveryPage, ProjectItem } from '../../bridge/contracts/discovery';
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
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    let current = true;
    window.desktopMenu?.projects().then(items => { if (current) setProjects(items); }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, []);
  async function chooseProject()
  {
    setChoosing(true);
    setError('');
    try {
      const item = await window.desktopMenu.addProject();
      if (item) {
        setProjects(await window.desktopMenu.projects());
        setSelected(item);
        setPage('workspace');
      }
    } catch (e) { setError(String(e)); }
    finally { setChoosing(false); }
  }
  const title = page === 'workspace' ? selected?.name || '工作区' : resourceNavigation.find(item => item[2] === page)![1];
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 960);
  const sidebarToggle = <button className="icon-button" aria-controls="team-sidebar" aria-expanded={expanded}
    aria-label={expanded ? '收起侧栏' : '展开侧栏'} onClick={() => setExpanded(!expanded)}><Icon name="panelLeft" size={16} /></button>;

  return <div id="application-home">
    <header className="desktop-titlebar">
      {sidebarToggle}
      <button onClick={() => void window.desktopMenu.openMonitor().catch(e => setError(String(e)))}><Icon name="flow" size={15} />资源监视器</button>
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
      <nav className="workspace-list" aria-label="项目列表">{projects.filter(p => (p.name+' '+p.path).toLowerCase().includes(search.toLowerCase())).map(p => <button key={p.id} title={p.path} onClick={() => { setSelected(p); setPage('workspace'); }}><Icon name="folder" />{p.name}</button>)}</nav>
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
      {page !== 'workspace' ? <DiscoveryView key={page} page={page} title={title} /> : <section className="workspace-welcome">
        <div className="intro-emblem"><BrandMark size={64} decorative /></div>
        <p className="overline">CBIM Assistant · 团队工作空间</p>
        <h1>{selected?.name ?? '你的团队，新的工作方式'}</h1>
        <p>{selected?.path ?? '连接团队能力、项目知识与每一次协作。'}</p>
        <button className="solid-button" disabled={choosing} onClick={() => void chooseProject()}><Icon name="plus" size={17} />新建</button>
      </section>}
    </main>
    <ExtensionPanel open={panelOpen} />
    <button className="icon-button panel-switch" aria-label={panelOpen ? '收起扩展面板' : '展开扩展面板'} aria-controls="extension-panel" aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)}><Icon name="panelRight" size={16} /></button>
  </div></div>;
}
