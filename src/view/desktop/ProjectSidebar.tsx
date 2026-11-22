/**
 * 作用定位：项目导航组件：持久状态由宿主提供，视图只持有搜索、折叠、菜单和编辑草稿。
 * 设计原因：界面草稿与宿主持久导航分离，列表操作不直接修改项目文件或运行对象。
 */
import { ScrollWindow, IconButton, Button, ConfirmWindow, FieldLabel, Form, Icon, Input, ListItem, ModalWindow, Option, Popover, Select } from '../../framework-ui';
import { useEffect, useRef, useState, type MouseEvent } from 'react';

import type { NavigationSnapshot, NavigationChange, NavigationProject, NavigationSession, ProjectItem } from '../../bridge/contracts/discovery';




type Target =
  {
    project: NavigationProject;

    session?: NavigationSession
  };

type MenuItem =
  {
    label: string;

    icon: Parameters<typeof Icon>[0]['name'];

    Run(): void;

    danger?: boolean
  };

export function ProjectSidebar({ added, choosing, addingName, reading = true, activeProject, activeSession, OnOpen, OnAdd, OnUnavailable, OnSnapshot }: { added?: { attempt: string; item: ProjectItem }; choosing: boolean; addingName: string; reading?: boolean; activeProject?: string; activeSession?: string; OnOpen(project: ProjectItem, create?: boolean, session?: string): void; OnAdd(): void; OnUnavailable(project: string, session?: string): void; OnSnapshot(projects: ProjectItem[]): void })
{
  const [snapshot, setSnapshot] = useState<NavigationSnapshot>({ revision: 0, projects: [] });

  const [search, setSearch] = useState('');

  const [deviceOpen, setDeviceOpen] = useState(true);

  /** 相对时间随列表轮询刷新，行提示仍显示完整日期。 */
  function Elapsed(updated: number)
  {
    const minutes = Math.max(0, Math.floor((Date.now() - updated) / 60000));

    if (minutes < 1)
      return '刚刚';

    if (minutes < 60)
      return minutes + ' 分钟';

    if (minutes < 1440)
      return Math.floor(minutes / 60) + ' 小时';

    if (minutes < 10080)
      return Math.floor(minutes / 1440) + ' 天';

    return Math.floor(minutes / 10080) + ' 周';
  }

  const [filter, setFilter] = useState<'active' | 'running' | 'archived' | 'removed'>('active');

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => { try { const value = JSON.parse(localStorage.getItem('project-collapsed') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } });

  const [all, setAll] = useState<Record<string, boolean>>({});

  const [menu, setMenu] = useState<
    {
      target: Target;

      point?: { x: number; y: number }
    }>();

  const [editing, setEditing] = useState<Target>();

  const [name, setName] = useState('');

  const [confirm, setConfirm] = useState<
    {
      target: Target;

      action: 'remove' | 'archive'
    }>();

  const [error, setError] = useState('');

  const [busy, setBusy] = useState(false);

  const callbacks = useRef({ OnSnapshot, OnUnavailable });

  callbacks.current = { OnSnapshot, OnUnavailable };

  const current = useRef(snapshot);


  const menuElement = useRef<HTMLDivElement>(null);

  const returnFocus = useRef<HTMLElement | null>(null);

  const input = useRef<HTMLInputElement>(null);

  const dragging = useRef<
    {
      id: string;

      start: number;

      moved: boolean;

      before?: string
    } | undefined>(undefined);

  const [over, setOver] = useState<string>();

  const [seen, setSeen] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem('office-read-completions') || '{}') || {}; } catch { return {}; } });

  const [focused, setFocused] = useState(() => document.hasFocus() && !document.hidden);

  useEffect(() => { const update = () => setFocused(document.hasFocus() && !document.hidden); window.addEventListener('focus', update); window.addEventListener('blur', update); document.addEventListener('visibilitychange', update); return () => { window.removeEventListener('focus', update); window.removeEventListener('blur', update); document.removeEventListener('visibilitychange', update); }; }, []);

  useEffect(() => { const next = { ...seen }; let changed = false; for (const project of snapshot.projects) for (const session of project.sessions) { const done = session.completedAt ?? 0; if (!(session.id in next) || (reading && focused && session.id === activeSession && done > next[session.id])) { next[session.id] = done; changed = true; } } if (changed) { setSeen(next); localStorage.setItem('office-read-completions', JSON.stringify(next)); } }, [seen, snapshot, activeSession, focused, reading]);

  const generation = useRef(0);

  const displayed = useRef('');

  useEffect(() => { if (!added) return; generation.current++; const { item } = added; const previous = current.current; const existing = previous.projects.find(p => p.id === item.id); const project = { pinned: false, sessions: [], ...existing, ...item, removed: false }; Apply({ ...previous, projects: existing ? previous.projects.map(p => p.id === item.id ? project : p) : [...previous.projects, project] }); setSearch(''); setFilter('active'); setDeviceOpen(true); setCollapsed(old => ({ ...old, [item.id]: false })); }, [added]);

  useEffect(() => { if (!added || activeProject !== added.item.id || displayed.current === added.attempt) return; const row = document.querySelector('[data-project-id="' + added.item.id + '"]'); if (!row || !row.getClientRects().length) return; row.scrollIntoView({ block: 'nearest' }); displayed.current = added.attempt; void window.desktopMenu.ProjectDisplayed(added.attempt, Date.now()).catch(console.warn); }, [added, snapshot, activeProject, filter, search, deviceOpen]);

  function Apply(value: NavigationSnapshot)
  {
    if (value.revision < current.current.revision)
      return;

    current.current = value;

    setSnapshot(value);

    callbacks.current.OnSnapshot(value.projects.filter(project => !project.removed));
  }

  useEffect(() => { let alive = true; let migrated = false; let timer: ReturnType<typeof setTimeout>; async function Refresh() { const version = generation.current; try { let value = await window.desktopMenu.Navigation(); if (alive && !migrated) { for (const project of value.projects) for (const session of project.sessions) { const key = 'office-title:' + session.id; const alias = localStorage.getItem(key)?.trim(); if (alive && alias && !session.renamed) value = await window.desktopMenu.Navigation({ revision: value.revision, project: project.id, session: session.id, action: 'rename', name: alias.slice(0, 80) }); if (alive && alias) localStorage.removeItem(key); } migrated = true; } if (alive && version === generation.current) Apply(value); } catch (error) { if (alive) setError(String(error)); } finally { if (alive) timer = setTimeout(Refresh, 1500); } } void Refresh(); return () => { alive = false; clearTimeout(timer); }; }, []);


  useEffect(() => { if (!menu) return; const element = menuElement.current!; element.querySelector<HTMLButtonElement>('button')?.focus(); function Dismiss(event: PointerEvent) { if (!element.contains(event.target as Node)) setMenu(undefined); } document.addEventListener('pointerdown', Dismiss); return () => document.removeEventListener('pointerdown', Dismiss); }, [menu]);

  useEffect(() => { function Shortcut(event: KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.current?.focus(); } } window.addEventListener('keydown', Shortcut); return () => window.removeEventListener('keydown', Shortcut); }, []);

  async function Change(target: Target, action: NavigationChange['action'], extra: Partial<NavigationChange> = {})
  {
    if (busy)
      return false;

    setBusy(true);

    setError('');

    try
    {
      const value = await window.desktopMenu.Navigation({ revision: current.current.revision, project: target.project.id, session: target.session?.id, action, ...extra });

      Apply(value);

      if (action === 'remove')
        callbacks.current.OnUnavailable(target.project.id, target.session?.id);

      return true;
    }
    catch (error)
    {
      setError(String(error));

      try
      {
        Apply(await window.desktopMenu.Navigation());
      }
      catch
      {
        /* 保留原错误和草稿。 */
      }

      return false;
    }
    finally
    {
      setBusy(false);
    }
  }

  function Rename(target: Target)
  {
    setName(target.session?.title ?? target.project.name);

    setEditing(target);
  }

  function Toggle(id: string)
  {
    const next = { ...collapsed, [id]: !collapsed[id] };

    setCollapsed(next);

    localStorage.setItem('project-collapsed', JSON.stringify(next));

    setAll(previous => ({ ...previous, [id]: false }));
  }

  function Menu(target: Target, event: MouseEvent<HTMLElement>)
  {
    event.preventDefault();

    returnFocus.current = event.currentTarget;



    setMenu({ target, point: event.type === 'contextmenu' && (event.clientX || event.clientY) ? { x: event.clientX, y: event.clientY } : undefined });
  }

  function Actions(target: Target): MenuItem[]
  {
    const { project, session } = target;

    if ((session ?? project).removed)
      return [{ label: '恢复到列表', icon: 'retry', Run: () => { void Change(target, 'restore'); } }];

    const items: MenuItem[] = [
      { label: (session ?? project).pinned ? '取消置顶' : '置顶', icon: 'pin', Run: () => { void Change(target, 'pin', { value: !(session ?? project).pinned }); } },
      { label: '重命名', icon: 'edit', Run: () => Rename(target) },
    ];

    if (session)
      items.push({ label: session.archived ? '取消归档' : '归档', icon: 'archive', danger: !session.archived, Run: () => { if (session.archived) void Change(target, 'archive', { value: false }); else setConfirm({ target, action: 'archive' }); } });
    else
    {
      items.push(
        { label: '新建对话', icon: 'plus', Run: () => OnOpen(project, true) },
        { label: '搜索项目对话', icon: 'search', Run: () => { setSearch(project.name); setFilter('active'); input.current?.focus(); } },
        { label: '在文件管理器中打开', icon: 'folder', Run: () => { void window.desktopMenu.RevealProject(project.id).catch(error => setError(String(error))); } },
        { label: '复制项目路径', icon: 'copy', Run: () => { void navigator.clipboard.writeText(project.path).catch(error => setError(String(error))); } },
        { label: filter === 'archived' ? '取消全部归档' : '归档全部对话', icon: 'archive', danger: filter !== 'archived', Run: () => { if (filter === 'archived') void Change(target, 'archive', { value: false }); else setConfirm({ target, action: 'archive' }); } },
        { label: '向前移动', icon: 'up', Run: () => { const peers = snapshot.projects.filter(item => !item.removed && item.pinned === project.pinned); const at = peers.findIndex(item => item.id === project.id); if (at > 0) void Change(target, 'move', { before: peers[at - 1].id }); } },
        { label: '向后移动', icon: 'down', Run: () => { const peers = snapshot.projects.filter(item => !item.removed && item.pinned === project.pinned); const at = peers.findIndex(item => item.id === project.id); if (at < peers.length - 1) void Change(target, 'move', { before: peers[at + 2]?.id }); } },
      );
    }

    items.push({ label: session ? '删除对话' : '移出项目列表', icon: 'remove', danger: true, Run: () => setConfirm({ target, action: 'remove' }) });

    return items;
  }

  const query = search.trim().toLocaleLowerCase();

  const projects = snapshot.projects.filter(project => filter === 'removed' || !project.removed).filter(project => { const matches = (project.name + ' ' + project.path).toLocaleLowerCase().includes(query); return (!query && filter === 'active') || filter === 'removed' && project.removed && (!query || matches) || project.sessions.some(session => (filter === 'removed' ? project.removed || session.removed : !session.removed && (filter === 'archived' ? session.archived : filter === 'running' ? session.running : !session.archived)) && (!query || matches || session.title.toLocaleLowerCase().includes(query))) || filter === 'active' && matches; });

  return <section className="project-navigation" aria-label="项目与对话">
    <div className="sidebar-search"><Icon name="search" size={15} /><Input ref={input} type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label="搜索项目和对话" placeholder="搜索项目和对话" /></div>
    <div className="task-section-heading"><Button className="task-filter-trigger" popoverTarget="task-list-options" aria-label="本机任务筛选与显示选项">{({ active: '本机任务', running: '运行中任务', archived: '已归档任务', removed: '已移除任务' })[filter]}<Icon name="chevronDown" size={12} /></Button></div>
    <Popover id="task-list-options" className="task-list-options"><FieldLabel>显示任务<Select aria-label="筛选对话" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><Option value="active">全部对话</Option><Option value="running">运行中</Option><Option value="archived">已归档</Option><Option value="removed">已移除</Option></Select></FieldLabel><Button onClick={() => { setDeviceOpen(true); setCollapsed({}); localStorage.setItem('project-collapsed', '{}'); document.getElementById('task-list-options')?.hidePopover(); }}><Icon name="expand" size={15} />展开全部项目</Button><Button onClick={() => { const next = Object.fromEntries(projects.map(project => [project.id, true])); setCollapsed(next); localStorage.setItem('project-collapsed', JSON.stringify(next)); document.getElementById('task-list-options')?.hidePopover(); }}><Icon name="collapse" size={15} />收起全部项目</Button></Popover>
    <div className="local-device-row"><Button aria-expanded={deviceOpen} aria-controls="local-project-tree" onClick={() => setDeviceOpen(value => !value)}><Icon name="desktop" size={14} /><span>本机</span><Icon name={deviceOpen ? 'chevronDown' : 'chevronRight'} size={11} /></Button><IconButton className="device-add" title="添加项目" aria-label="添加项目" disabled={choosing} onClick={OnAdd}><Icon name="folderAdd" size={16} /></IconButton></div>
    {addingName && <div role="status"><Icon name="spinner" motion="rotate" size={14} /> 正在添加：{addingName}</div>}
    <nav {...ScrollWindow.native} id="local-project-tree" hidden={!deviceOpen && !query} className="workspace-list project-tree" aria-label="项目列表">{projects.map(project =>
    {
      const matchesProject = (project.name + ' ' + project.path).toLocaleLowerCase().includes(query);

      const sessions = project.sessions.filter(session => (filter === 'removed' ? project.removed || session.removed : !session.removed && (filter === 'archived' ? session.archived : filter === 'running' ? session.running : !session.archived)) && (!query || matchesProject || session.title.toLocaleLowerCase().includes(query)));

      if (query && !matchesProject && !sessions.length || filter !== 'active' && !sessions.length && !(filter === 'removed' && project.removed))
        return null;

      const open = !!query || !collapsed[project.id];

      const visible = all[project.id] || query || filter !== 'active' ? sessions : sessions.filter((session, index) => index < 5 || session.id === activeSession || session.running || session.pinned);

      return <section className={'sidebar-project' + (over === project.id ? ' navigation-drop' : '')} key={project.id} data-project-id={project.id} aria-label={project.name}>
        <div className="project-list-row project-heading" data-active={activeProject === project.id || undefined} onContextMenu={event => Menu({ project }, event)}>
          <IconButton className="project-grip" aria-label={'拖动项目 · ' + project.name} title="拖动调整项目顺序" disabled={busy || project.removed} onPointerDown={event => { if (event.button !== 0) return; dragging.current = { id: project.id, start: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { const drag = dragging.current; if (!drag) return; if (Math.abs(event.clientY - drag.start) > 6) drag.moved = true; const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-project-id]'); if (drag.moved && hit) { const target = projects.find(item => item.id === hit.dataset.projectId); if (target?.pinned === project.pinned) { const peers = projects.filter(item => item.pinned === project.pinned); const index = peers.findIndex(item => item.id === target.id); const after = event.clientY > hit.getBoundingClientRect().top + hit.getBoundingClientRect().height / 2; drag.before = (after ? peers[index + 1]?.id : target.id) ?? ''; setOver(drag.before || 'end'); } const bounds = event.currentTarget.closest('.project-tree')?.getBoundingClientRect(); const list = event.currentTarget.closest('.project-tree'); if (bounds && event.clientY > bounds.bottom - 24) list?.scrollBy(0, 14); if (bounds && event.clientY < bounds.top + 24) list?.scrollBy(0, -14); } }} onPointerUp={event => { const drag = dragging.current; dragging.current = undefined; setOver(undefined); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (drag?.moved && drag.before !== undefined && drag.before !== drag.id) void Change({ project }, 'move', { before: drag.before || undefined }); }} onPointerCancel={() => { dragging.current = undefined; setOver(undefined); }}><Icon name="grip" size={12} /></IconButton>
          <ListItem className="project-select" aria-expanded={open} title={project.path} onClick={() => Toggle(project.id)} onDoubleClick={() => Rename({ project })}><span className="project-folder"><Icon name="folder" size={15} /><span className="project-chevron"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} /></span></span><span>{project.name}</span>{project.pinned && <Icon name="pin" size={11} />}</ListItem>
          <IconButton className="project-action" aria-label={'项目更多 · ' + project.name} title="更多操作" onClick={event => Menu({ project }, event)}><Icon name="more" size={15} /></IconButton>
          <IconButton className="project-action" disabled={project.removed} aria-label={'新建对话 · ' + project.name} title="新建对话" onClick={() => OnOpen(project, true)}><Icon name="edit" size={15} /></IconButton>
        </div>
        {open && <div className="project-conversations">{project.error && <small role="alert">{project.error}</small>}{visible.map(session => <div className="project-list-row office-session-row" key={session.id} data-active={activeSession === session.id || undefined} onContextMenu={event => Menu({ project, session }, event)}>
          <ListItem className="project-select" disabled={project.removed || session.removed} aria-current={activeSession === session.id ? 'page' : undefined} title={session.title + '\n' + new Date(session.updated).toLocaleString()} onClick={() => OnOpen(project, false, session.id)} onDoubleClick={() => Rename({ project, session })}><span className={'office-session-icon' + (session.running ? ' executing' : '')}><Icon name={session.attention ? 'warning' : session.pinned ? 'pin' : 'task'} size={14} /></span><span>{session.title}</span>{session.queued > 0 && <small className="navigation-count" title="排队指令">{session.queued}</small>}</ListItem>
          <span className="session-meta">{session.running ? <Icon name="spinner" motion="rotate" size={12} label="正在运行" /> : session.attention ? <span title="需要关注" aria-label="需要关注"><Icon name="warning" size={13} /></span> : (session.completedAt ?? 0) > (seen[session.id] ?? Infinity) ? <Icon name="dot" tone="success" size={9} label="有新的任务结果" /> : <time dateTime={new Date(session.updated).toISOString()}>{Elapsed(session.updated)}</time>}</span>
          <IconButton className="project-action" title="更多操作" aria-label={'对话更多 · ' + session.title} onClick={event => Menu({ project, session }, event)}><Icon name="more" size={15} /></IconButton>
          <IconButton className="project-action" data-archive={!session.removed && !session.archived || undefined} disabled={busy || project.removed} title={session.removed ? '恢复对话' : session.archived ? '取消归档' : '归档对话'} aria-label={(session.removed ? '恢复对话 · ' : session.archived ? '取消归档 · ' : '归档对话 · ') + session.title} onClick={() => { if (!session.removed && !session.archived) setConfirm({ target: { project, session }, action: 'archive' }); else void Change({ project, session }, session.removed ? 'restore' : 'archive', { value: false }); }}><Icon name={session.removed || session.archived ? 'retry' : 'archive'} size={14} /></IconButton>
        </div>)}{visible.length < sessions.length && <Button className="navigation-show-all" onClick={() => setAll(previous => ({ ...previous, [project.id]: true }))}>显示全部 {sessions.length} 条对话</Button>}{all[project.id] && sessions.length > 5 && <Button className="navigation-show-all" onClick={() => setAll(previous => ({ ...previous, [project.id]: false }))}>收起较早对话</Button>}{!sessions.length && !project.error && <small className="navigation-empty">{filter === 'active' ? '暂无对话，点击右侧新建' : '没有符合条件的对话'}</small>}</div>}
      </section>;
    })}{projects.length === 0 && <p className="navigation-empty">{snapshot.projects.length ? '没有符合条件的项目或对话' : '添加项目，开始第一条对话'}</p>}</nav>
    {error && <small {...ScrollWindow.native} role="alert" className="navigation-error">{error}</small>}
    {menu && <Popover anchorRef={returnFocus} point={menu.point} menuRef={menuElement} className="navigation-menu" role="menu" aria-label="项目和对话操作" onKeyDown={event => { const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); if (event.key === 'Escape') { event.stopPropagation(); setMenu(undefined); returnFocus.current?.focus(); } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } else if (event.key === 'Tab') setMenu(undefined); }}>{Actions(menu.target).map(action => <Button key={action.label} role="menuitem" disabled={busy} data-danger={action.danger || undefined} onClick={() => { setMenu(undefined); action.Run(); }}><Icon name={action.icon} size={15} />{action.label}</Button>)}</Popover>}
    {editing && <ModalWindow className="navigation-dialog" aria-label="重命名" onCancel={event => { event.preventDefault(); if (!busy) setEditing(undefined); }}><Form onSubmit={event => { event.preventDefault(); void Change(editing, 'rename', { name }).then(ok => { if (ok) setEditing(undefined); }); }}><h3>重命名</h3><FieldLabel>名称<Input autoFocus maxLength={80} value={name} onFocus={event => event.target.select()} onChange={event => setName(event.target.value)} /></FieldLabel>{error && <p role="alert">{error}</p>}<footer><Button type="button" disabled={busy} onClick={() => setEditing(undefined)}>取消</Button><Button type="submit" disabled={busy || !name.trim()}>保存</Button></footer></Form></ModalWindow>}
    {confirm && <ConfirmWindow danger focusConfirm={confirm.action === 'archive'} busyLabel={confirm.action === 'archive' ? '正在归档…' : '正在移除…'} title={confirm.action === 'archive' ? confirm.target.session ? '归档对话' : '归档全部对话' : '移除确认'} confirmLabel={confirm.action === 'archive' ? '确认归档' : '确认移除'} busy={busy} error={error} onCancel={() => setConfirm(undefined)} onConfirm={() => { void Change(confirm.target, confirm.action, confirm.action === 'archive' ? { value: true } : {}).then(ok => { if (ok) setConfirm(undefined); }); }}>
      {confirm.action === 'archive' ? (confirm.target.session ? '归档对话「' + confirm.target.session.title + '」？' : '归档「' + confirm.target.project.name + '」的全部对话？') + '可在“已归档”中恢复。运行中的任务继续执行。' : confirm.target.session ? '移除后将停止当前任务并暂停排队指令。对话历史保留，可在“已移除”中恢复。' : '从侧栏移出项目，不删除项目文件和对话历史。运行中的任务继续执行，可在“已移除”中恢复。'}
    </ConfirmWindow>}
  </section>;
}
