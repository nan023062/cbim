/**
 * 作用定位：Office 消息记录与贴底输入栏。执行状态由当前会话的模型流驱动。
 * 设计原因：界面维护输入草稿、历史与队列展示，发送时采纳设置，后台执行与持久队列由宿主持有。
 */
import { useDeferredValue, useEffect, useRef, useState } from 'react';

import { Screen } from '../../framework-ui/screen';

import { Button } from '../../framework-ui/controls';

import { WindowList, type ListHandle } from '../../framework-ui/list';

import { OfficeQueuePanel } from './OfficeQueuePanel';

import type { OfficeQueueSnapshot, OfficeQueueAction } from '../../bridge/contracts/discovery';

import { EarlierTurn, Message } from './Transcript';

import type { OfficeConversation, OfficeMessage, OfficeProgress, ProjectItem } from '../../bridge/contracts/discovery';

import { MainAgentPicker } from './MainAgentPicker';

import { PermissionPicker } from './PermissionPicker';

import { AgentSettingsDialog } from './AgentSettingsDialog';

import { OrganizationPanel } from './OrganizationPanel';

import { BusinessPanel } from './BusinessPanel';

import { DataArchitecturePanel } from './DataArchitecturePanel';

import type { OfficeSelection } from '../../bridge/contracts/discovery';

import { Icon } from '../shared/Icon';

import './office.css';

interface Props
{
  project: ProjectItem;

  conversation: OfficeConversation;

  draft: string;

  onDraft(text: string): void;

  onSaved(messages: OfficeMessage[]): void;

  started: number;

  onRunning(started: number): void;

  onManageEngines(): void;
}

function duration(ms: number)
{
  const s = Math.floor(ms / 1000);

  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + s % 60 + 's';
}

export function OfficeView({ project, conversation, draft, onDraft, onSaved, started, onRunning, onManageEngines }: Props)
{
  const [now, setNow] = useState(0);

  const [sample, setSample] = useState<OfficeProgress>();

  const [error, setError] = useState('');

  const [queue, setQueue] = useState<OfficeQueueSnapshot>();

  const [queueBusy, setQueueBusy] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const queueRef = useRef<OfficeQueueSnapshot | undefined>(undefined);

  const submission = useRef<
    {
      signature: string;

      id: string
    } | undefined>(undefined);

  const callbacks = useRef({ onSaved, onRunning });

  callbacks.current = { onSaved, onRunning };

  const [engineReady, setEngineReady] = useState(false);

  const [settingsTab, setSettingsTab] = useState<'model' | 'skills' | 'connectors'>();

  const [organization, setOrganization] = useState(false);

  const [business, setBusiness] = useState(false);

  const [dataArchitecture, setDataArchitecture] = useState(false);

  const [settingsReady, setSettingsReady] = useState(false);

  const selectionKey = 'office-main-agent:' + conversation.id;

  const [selection, setSelection] = useState<OfficeSelection>(() => { try { const stored = JSON.parse(localStorage.getItem(selectionKey) || '{}'); return { ...stored, engine: stored?.engine || 'codex' }; } catch { return { engine: 'codex' }; } });

  useEffect(() => { let current = true; window.desktopMenu.AgentSettings(project.id, { kind: 'main', id: conversation.id }).then(saved => { if (current) { if (saved.configuration.model) setSelection(saved.configuration.model); setSettingsReady(true); } }).catch(error => { if (current) setError(String(error)); }); return () => { current = false; }; }, [project.id, conversation.id]);

  const pref = 'office-permission:' + conversation.id;

  const [permission, setPermission] = useState<'read' | 'ask' | 'execute'>(() => { const value = localStorage.getItem(pref); return value === 'read' || value === 'execute' ? value : 'ask'; });

  const log = useRef<ListHandle>(null);

  const [arrow, setArrow] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function interact()
  {
    setArrow(true);

    clearTimeout(timer.current);

    timer.current = setTimeout(() => setArrow(false), 3000);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  const picker = useRef<HTMLInputElement>(null);

  function ApplyQueue(value: OfficeQueueSnapshot)
  {
    if (queueRef.current && value.revision < queueRef.current.revision)
      return;

    const previous = queueRef.current;

    queueRef.current = value;

    setQueue(value);

    const current = value.items.find(item => item.status === 'running');

    if (current?.id !== previous?.items.find(item => item.status === 'running')?.id)
      setSample(undefined);

    callbacks.current.onRunning(value.running ? current?.started ?? Date.now() : 0);
  }

  useEffect(() => { let alive = true; let timer: ReturnType<typeof setTimeout>; let historyRevision = -1; async function Poll() { try { const value = await window.desktopMenu.OfficeQueue(project.id, conversation.id); if (!alive) return; ApplyQueue(value); if (value.revision !== historyRevision) { const opened = await window.desktopMenu.OpenOffice(project.id, 'select', conversation.id); if (!alive) return; callbacks.current.onSaved(opened.messages); historyRevision = value.revision; } } catch (error) { if (alive) setError(String(error)); } finally { if (alive) timer = setTimeout(() => void Poll(), 700); } } void Poll(); return () => { alive = false; clearTimeout(timer); }; }, [project.id, conversation.id]);

  async function ChangeQueue(action: OfficeQueueAction): Promise<boolean>
  {
    if (queueBusy)
      return false;

    setQueueBusy(true);

    try
    {
      ApplyQueue(await window.desktopMenu.OfficeQueue(project.id, conversation.id, action));

      setError('');

      return true;
    }
    catch (error)
    {
      setError(String(error));

      return false;
    }
    finally
    {
      setQueueBusy(false);
    }
  }

  useEffect(() => window.desktopMenu.WatchOffice(event => { if (event.session === conversation.id && event.project === project.id) setSample(previous => ({ ...event, text: event.text ?? previous?.text, workLog: event.workLog ?? previous?.workLog })); }), [conversation.id, project.id]);

  useEffect(() => { if (!started) return; const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, [started]);

  const replies = conversation.messages.filter(m => m.role === 'assistant');

  const last = replies.at(-1)?.metrics;

  const elapsed = (conversation.earlierUsage?.elapsed ?? 0) + replies.reduce((n, m) => n + (m.metrics?.elapsed ?? 0), 0) + (started ? Math.max(0, now - started) : 0);

  const cost = replies.length && conversation.earlierUsage?.complete !== false && replies.every(m => m.metrics?.cost != null) ? '$' + replies.reduce((n, m) => n + m.metrics!.cost!, conversation.earlierUsage?.cost ?? 0).toFixed(5) : '—';

  const percent = last?.used != null && last.capacity ? Math.round(100 * last.used / last.capacity) : undefined;

  async function submit()
  {
    if (submitting || !settingsReady || !draft.trim() || !engineReady || !selection.engine || !selection.profileId || !selection.modelId)
      return;

    setSubmitting(true);

    setError('');

    const text = draft;

    const model = { engine: selection.engine, profileId: selection.profileId, modelId: selection.modelId };

    const signature = JSON.stringify([text, model, permission]);

    if (submission.current?.signature !== signature)
      submission.current = { signature, id: crypto.randomUUID() };

    try
    {
      const value = await window.desktopMenu.OfficeQueue(project.id, conversation.id, { action: 'enqueue', id: submission.current.id, text, permission, selection: model });

      ApplyQueue(value);

      onDraft('');

      submission.current = undefined;
    }
    catch (error)
    {
      setError(String(error));
    }
    finally
    {
      setSubmitting(false);
    }
  }

  async function stop()
  {
    await ChangeQueue({ action: 'stop' });
  }

  async function attach(file?: File)
  {
    if (!file)
      return;

    try
    {
      if (file.size > 128000)
        throw Error('文件超出输入长度');

      const content = await file.text();

      const next = [draft, file.name, content].filter(Boolean).join('\n\n');

      if (next.length > 32000 || content.includes('\0'))
        throw Error('请选择可放入输入框的文本文件');

      onDraft(next);

      setError('');
    }
    catch (e)
    {
      setError(String(e));
    }
  }

  const phase = started ? ({ connecting: '正在连接模型…', thinking: '正在思考…', writing: '正在生成回复…' }[sample?.phase ?? 'connecting']) : replies.length ? '已完成回复' : '准备就绪';

  const earlier = conversation.earlier ?? [];

  const persisted = earlier.length + conversation.messages.length;

  const streamingText = useDeferredValue(sample?.text ?? '');

  const count = persisted + (started ? 2 : 0);

  if (organization)
    return <OrganizationPanel project={project.id} OnBack={() => setOrganization(false)} OnManageEngines={onManageEngines} />;

  if (business)
    return <BusinessPanel project={project.id} OnBack={() => setBusiness(false)} />;

  if (dataArchitecture)
    return <DataArchitecturePanel key={project.id} project={project.id} OnBack={() => setDataArchitecture(false)} />;

  return <Screen className="office-chat" aria-label="Office 对话" onPointerMove={interact} onPointerDown={interact}
    onWheelCapture={interact} onTouchMove={interact} onKeyDownCapture={interact} onFocusCapture={interact} onInputCapture={interact}>
    <div className="office-agent-toolbar"><button type="button" onClick={() => setBusiness(true)}><Icon name="flow" size={15} />业务架构</button><button type="button" onClick={() => setOrganization(true)}><Icon name="team" size={15} />组织架构</button><button type="button" onClick={() => setDataArchitecture(true)}><Icon name="database" size={15} />数据架构</button><button type="button" disabled={submitting} onClick={() => setSettingsTab('model')}><Icon name="settings" size={15} />主 Agent 设置</button></div>
    {settingsTab && <AgentSettingsDialog project={project.id} target={{ kind: 'main', id: conversation.id }} title="主 Agent 设置" tab={settingsTab} initialModel={selection} OnClose={() => setSettingsTab(undefined)} OnManageEngines={onManageEngines} OnSaved={configuration => { if (configuration.model) { setSelection(configuration.model); localStorage.setItem(selectionKey, JSON.stringify(configuration.model)); } }} />}
    <div className="office-transcript">
      {count ? <WindowList listRef={log} count={count} label="对话记录" initialEnd
        itemKey={i => earlier[i] ?? ('message-' + (i - earlier.length))}
        render={i => { const message = conversation.messages[i - earlier.length]; return <div className="office-column office-message-row">{i < earlier.length ? <EarlierTurn project={project.id} session={conversation.id} file={earlier[i]} /> : <Message role={message?.role ?? (i === persisted ? 'user' : 'assistant')} text={message?.text ?? (i === persisted ? queue?.items.find(item => item.status === 'running')?.text ?? '' : streamingText)} messageId={message?.id ?? conversation.id + ':' + started} live={!message && !!started} elapsed={message?.metrics?.elapsed ?? (!message && started ? Math.max(0, now - started) : undefined)} workLog={message ? message.workLog : sample?.workLog} model={message ? message.metrics?.model : sample?.model} />}</div>; }} />
        : <h2>在 {project.name} 中开始对话</h2>}
      <Button className="office-jump" data-visible={arrow} aria-label="移动到最下方" title="移动到最下方" onClick={() => log.current?.scrollToEnd()}>↓</Button>
    </div>
    <div className="office-dock office-column">
      {queue && <OfficeQueuePanel snapshot={queue} busy={queueBusy} OnChange={ChangeQueue} />}
      <div className="office-strip" title={project.name}><span role="status" className={started ? 'active' : ''}><Icon name="sparkles" size={14} />{phase}</span>
      <span title="累计工作时间 · 近两秒估算生成速度">{duration(elapsed)} · {started && sample?.rate != null ? '≈' + sample.rate.toFixed(1) : '—'} tok/s</span></div>
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <textarea id="office-message" aria-label="任务目标或补充消息" placeholder={started ? "输入下一条指令，发送后加入队列…" : "继续聊一聊…"} rows={3} maxLength={32000} disabled={submitting} value={draft} onChange={e => onDraft(e.target.value)}
          onKeyDown={e => { if (!e.nativeEvent.isComposing && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }} />
        <footer><button type="button" disabled={submitting} title="添加附件、Skill 或连接器" aria-label="添加附件或能力" popoverTarget="office-add-menu"><Icon name="plus" size={16} /></button>
          <div id="office-add-menu" className="office-add-menu" popover="auto"><button type="button" popoverTarget="office-add-menu" popoverTargetAction="hide" onClick={() => picker.current?.click()}><Icon name="folder" size={15} />添加文本文件</button><button type="button" popoverTarget="office-add-menu" popoverTargetAction="hide" onClick={() => setSettingsTab('skills')}><Icon name="knowledge" size={15} />Skills</button><button type="button" popoverTarget="office-add-menu" popoverTargetAction="hide" onClick={() => setSettingsTab('connectors')}><Icon name="plug" size={15} />连接器</button></div>
          <input ref={picker} type="file" hidden accept="text/*,.md,.json,.yaml,.csv" onChange={e => { void attach(e.target.files?.[0]); e.target.value = ''; }} />
          <PermissionPicker value={permission} disabled={!!started} OnChange={value => { setPermission(value); localStorage.setItem(pref, value); }} />
          <MainAgentPicker onManage={onManageEngines} onReady={setEngineReady} value={selection} disabled={submitting} fail={setError} change={next => { setSelection(next); localStorage.setItem(selectionKey, JSON.stringify(next)); }} />
          <button className="office-action" type="submit" disabled={submitting || !draft.trim() || !engineReady || !settingsReady} title={started ? '加入队列（Ctrl / ⌘ + Enter）' : '发送（Ctrl / ⌘ + Enter）'} aria-label={started ? '加入队列' : '发送'}><Icon name={started ? 'enqueue' : 'send'} size={16} /></button>
          {started && <button className="office-action" type="button" disabled={queueBusy} onClick={stop} title="停止当前任务并暂停队列" aria-label="停止回复"><Icon name="stop" size={14} /></button>}
        </footer>
      </form>
      <span className="office-meter" title={'会话累计估算费用（美元） · 最近一次请求的输入上下文 ' + (last?.used ?? '—') + ' / ' + (last?.capacity ?? '—') + ' tokens'}>费用 {cost} · 上下文 <i style={{ background: 'conic-gradient(currentColor ' + Math.min(100, percent ?? 0) + '%, var(--line) 0)' }} />{percent == null ? '—' : percent + '%'}</span>

      {started && <small className="office-next-settings">引擎、模型和连接器的修改用于下一条提交的指令</small>}
      {error && <small role="alert">{error}</small>}
    </div>
  </Screen>;
}
