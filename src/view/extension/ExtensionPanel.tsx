/**
 * 作用定位：右侧窗口管理浏览器标签和项目工具，切换工具不会卸载中间的对话。
 * 设计原因：独立维护扩展页签可以保留聊天状态。
 */
import { useEffect, useId, useRef, useState } from 'react';

import { PaneDivider } from '../../framework-ui';

import { Icon } from '../../framework-ui';

import type { OfficeQueueSnapshot } from '../../bridge/contracts/discovery';

const types = {
  web: ['Web 浏览器', 'globe'],
  organization: ['组织架构', 'team'],
  business: ['业务架构', 'flow'],
  schedule: ['定时任务', 'clock'],
  console: ['控制台', 'terminal'],
} as const;

type Kind = keyof typeof types;

const choices = Object.keys(types) as Kind[];

function WebTab({ hidden }: { hidden: boolean })
{
  const [address, setAddress] = useState('');

  const [url, setUrl] = useState('');

  const [error, setError] = useState('');

  const [revision, refresh] = useState(0);

  return (
    <section className="extension-web" hidden={hidden}>
      <form
        className="extension-address"
        onSubmit={(e) => { e.preventDefault(); try { const target = new URL(address.includes(':') ? address : 'https://' + address,); if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw Error(); setUrl(target.href); setAddress(target.href); setError(''); refresh((v) => v + 1); } catch { setError('请输入有效的 HTTP 或 HTTPS 网址'); } }}
      >
        <input
          placeholder="输入网址"
          aria-label="网址"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button
          title="打开网址"
          aria-label="打开网址"
          disabled={!address.trim()}
        >
          →
        </button>
      </form>
      {error && <small role="alert">{error}</small>}
      {url ? (
        <iframe
          key={revision}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          title="网页内容"
          src={url}
        />
      ) : (
        <div className="extension-placeholder">
          <Icon name="browser" size={40} />
          输入网址以浏览网页
        </div>
      )}
    </section>
  );
}

function ConsoleTab({ project, session, }: { project: string; session: string; })
{
  const [snapshot, setSnapshot] = useState<OfficeQueueSnapshot>();

  const [error, setError] = useState('');

  useEffect(() => { let alive = true; let timer: ReturnType<typeof setTimeout>; async function read() { try { const value = await window.desktopMenu.OfficeQueue(project, session); if (alive) { setSnapshot(value); setError(''); } } catch (e) { if (alive) setError(String(e)); } if (alive) timer = setTimeout(read, 2000); } void read(); return () => { alive = false; clearTimeout(timer); }; }, [project, session]);

  return (
    <section className="extension-console">
      <h2>控制台</h2>
      {error ? (
        <p role="alert">{error}</p>
      ) : !snapshot ? (
        <p>读取运行记录…</p>
      ) : !snapshot.attempts?.length ? (
        <p>当前对话暂无运行记录。</p>
      ) : (
        snapshot.attempts
          .slice()
          .reverse()
          .map((a) => (
            <details key={a.id}>
              <summary>
                {new Date(a.started).toLocaleTimeString()} ·{' '}
                {
                  {
                    running: '执行中',
                    completed: '已完成',
                    failed: '失败',
                    interrupted: '已中断',
                  }[a.outcome]
                }
              </summary>
              <ol>
                {a.events.map((e, i) => (
                  <li key={i}>
                    {new Date(e.at).toLocaleTimeString()} · {e.stage}
                  </li>
                ))}
              </ol>
            </details>
          ))
      )}
    </section>
  );
}

export function ExtensionPanel({ open, project, session, organization, business, }: { open: boolean; project?: string; session?: string; organization: React.ReactNode; business: React.ReactNode; })
{
  const [tabs, setTabs] = useState(() => choices.map((kind, id) => ({ kind, id })),
  );

  const [active, setActive] = useState(0);

  const [maximized, setMaximized] = useState(false);

  const next = useRef(choices.length);

  const menu = useId();

  const kind = tabs.find((t) => t.id === active)?.kind;

  function add(kind: Kind)
  {
    const existing = kind !== 'web' && tabs.find((t) => t.kind === kind);

    if (existing)
    {
      setActive(existing.id);

      return;
    }

    const id = next.current++;

    setTabs([...tabs, { id, kind }]);

    setActive(id);
  }

  useEffect(() => { if (open) document.querySelector('#extension-panel [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active, open]);

  return (
    <aside
      id="extension-panel"
      className="desktop-extension"
      data-maximized={maximized}
      hidden={!open}
      aria-label="扩展面板"
    >
      {!maximized && (
        <PaneDivider
          side="right"
          label="调整扩展面板宽度"
          controls="extension-panel"
        />
      )}
      <header>
        <div className="extension-strip" role="tablist" aria-label="扩展标签">
          {tabs.map((t, i) => (
            <div key={t.id} className={active === t.id ? 'chosen' : ''}>
              <button
                role="tab"
                aria-selected={active === t.id}
                onClick={() => setActive(t.id)}
              >
                <Icon name={types[t.kind][1]} size={15} />
                {types[t.kind][0]}
              </button>
              <button
                aria-label={'关闭' + types[t.kind][0]}
                onClick={() => { const rest = tabs.filter((v) => v.id !== t.id); setTabs(rest); if (active === t.id) setActive(rest[Math.max(0, i - 1)]?.id ?? -1); }}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
        <button title="新增标签页" aria-label="新增标签页" popoverTarget={menu}>
          <Icon name="plus" size={16} />
        </button>
        <div id={menu} className="extension-types" popover="auto">
          {choices.map((k) => (
            <button
              key={k}
              popoverTarget={menu}
              popoverTargetAction="hide"
              onClick={() => add(k)}
            >
              <Icon name={types[k][1]} size={15} />
              {types[k][0]}
            </button>
          ))}
        </div>
        <button
          className="panel-size"
          aria-label={maximized ? '恢复面板宽度' : '最大化面板'}
          onClick={() => setMaximized(!maximized)}
        >
          <Icon name={maximized ? 'collapse' : 'expand'} size={15} />
        </button>
      </header>
      <div
        className="extension-body"
        role="tabpanel"
        aria-label={kind ? types[kind][0] : '扩展内容'}
      >
        {tabs
          .filter((t) => t.kind === 'web')
          .map((t) => (<WebTab key={t.id} hidden={active !== t.id} />))}
        {!kind ? (
          <p>暂无标签页，点击＋添加。</p>
        ) : kind === 'schedule' ? (
          <div className="extension-placeholder">
            <Icon name="clock" size={32} />
            定时任务调度尚未接入
          </div>
        ) : kind !== 'web' && !project ? (
          <p>请先打开项目。</p>
        ) : kind === 'organization' ? (
          organization
        ) : kind === 'business' ? (
          business
        ) : kind === 'console' ? (
          session && open ? (
            <ConsoleTab
              key={project + ':' + session}
              project={project!}
              session={session}
            />
          ) : (
            <p>请先打开对话。</p>
          )
        ) : null}
      </div>
    </aside>
  );
}
