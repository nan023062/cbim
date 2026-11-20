/** Office 消息记录与贴底输入栏。执行状态由当前会话的模型流驱动。 */
import { useDeferredValue, useEffect, useRef, useState } from 'react';

import { Screen } from '../../framework-ui/screen';
import { Button } from '../../framework-ui/controls';
import { WindowList, type ListHandle } from '../../framework-ui/list';
import { EarlierTurn, Message } from './Transcript';

import type { OfficeConversation, OfficeMessage, OfficeProgress, ProjectItem } from '../../bridge/contracts/discovery';

import { MainAgentPicker } from './MainAgentPicker';

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

  const [engineReady, setEngineReady] = useState(false);

  const selectionKey = 'office-main-agent:' + conversation.id;

  const [selection, setSelection] = useState<OfficeSelection>(() => { try { const stored = JSON.parse(localStorage.getItem(selectionKey) || '{}'); return { ...stored, engine: stored?.engine || 'codex' }; } catch { return { engine: 'codex' }; } });

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

  const stopped = useRef(false);

  useEffect(() => window.desktopMenu.WatchOffice(event => { if (event.session === conversation.id && event.project === project.id) setSample(previous => ({ ...event, text: event.text ?? previous?.text, workLog: event.workLog ?? previous?.workLog })); }), [conversation.id, project.id]);

  useEffect(() => { if (!started) return; const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, [started]);



  const replies = conversation.messages.filter(m => m.role === 'assistant');

  const last = replies.at(-1)?.metrics;

  const elapsed = (conversation.earlierUsage?.elapsed ?? 0) + replies.reduce((n, m) => n + (m.metrics?.elapsed ?? 0), 0) + (started ? Math.max(0, now - started) : 0);

  const cost = replies.length && conversation.earlierUsage?.complete !== false && replies.every(m => m.metrics?.cost != null) ? '$' + replies.reduce((n, m) => n + m.metrics!.cost!, conversation.earlierUsage?.cost ?? 0).toFixed(5) : '—';

  const percent = last?.used != null && last.capacity ? Math.round(100 * last.used / last.capacity) : undefined;

  async function submit()
  {
    if (started || !draft.trim() || !engineReady || !selection.engine || !selection.profileId || !selection.modelId)
      return;

    stopped.current = false;

    setSample(undefined);

    setNow(Date.now());

    onRunning(Date.now());

    setError('');

    try
    {
      onSaved(await window.desktopMenu.SendOffice(project.id, conversation.id, draft, permission, { engine: selection.engine, profileId: selection.profileId, modelId: selection.modelId }));

      onDraft('');
    }
    catch (e)
    {
      setError(stopped.current ? '已停止回复' : (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method 'office:send': (?:Error: )?/, ''));
    }
    finally
    {
      onRunning(0);
    }
  }

  async function stop()
  {
    stopped.current = true;

    try
    {
      await window.desktopMenu.StopOffice(project.id, conversation.id);
    }
    catch (e)
    {
      setError(String(e));
    }
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
  return <Screen className="office-chat" aria-label="Office 对话" onPointerMove={interact} onPointerDown={interact}
    onWheelCapture={interact} onTouchMove={interact} onKeyDownCapture={interact} onFocusCapture={interact} onInputCapture={interact}>
    <div className="office-transcript">
      {count ? <WindowList listRef={log} count={count} label="对话记录" initialEnd
        itemKey={i => earlier[i] ?? ('message-' + (i - earlier.length))}
        render={i =>
        {
          const message = conversation.messages[i - earlier.length];
          return <div className="office-column office-message-row">{i < earlier.length ?
            <EarlierTurn project={project.id} session={conversation.id} file={earlier[i]} /> :
            <Message role={message?.role ?? (i === persisted ? 'user' : 'assistant')}
              text={message?.text ?? (i === persisted ? draft : streamingText)} messageId={message?.id ?? conversation.id + ':' + started} live={!message && !!started} elapsed={message?.metrics?.elapsed ?? (!message && started ? Math.max(0, now - started) : undefined)} workLog={message ? message.workLog : sample?.workLog} model={message ? message.metrics?.model : sample?.model} />}</div>;
        }} />
        : <h2>在 {project.name} 中开始对话</h2>}
      <Button className="office-jump" data-visible={arrow} aria-label="移动到最下方" title="移动到最下方" onClick={() => log.current?.scrollToEnd()}>↓</Button>
    </div>
    <div className="office-dock office-column">
      <div className="office-strip" title={project.name}><span role="status" className={started ? 'active' : ''}><Icon name="sparkles" size={14} />{phase}</span>
      <span title="累计工作时间 · 近两秒估算生成速度">{duration(elapsed)} · {started && sample?.rate != null ? '≈' + sample.rate.toFixed(1) : '—'} tok/s</span></div>
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <textarea id="office-message" aria-label="任务目标或补充消息" placeholder="继续聊一聊…" rows={3} maxLength={32000} disabled={!!started} value={started ? '' : draft} onChange={e => onDraft(e.target.value)}
          onKeyDown={e => { if (!e.nativeEvent.isComposing && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }} />
        <footer><button type="button" disabled={!!started} title="添加文本文件到草稿" aria-label="添加文本文件" onClick={() => picker.current?.click()}><Icon name="plus" size={16} /></button>
          <input ref={picker} type="file" hidden accept="text/*,.md,.json,.yaml,.csv" onChange={e => { void attach(e.target.files?.[0]); e.target.value = ''; }} />
          <label className="office-permission" title="执行权限"><Icon name="unblock" size={16} /><select aria-label="执行权限" disabled={!!started} value={permission} onChange={e => { const v = e.target.value as typeof permission; setPermission(v); localStorage.setItem(pref, v); }}>
            <option value="read">只读访问</option><option value="ask">默认权限</option><option value="execute">完全访问</option></select></label>
          <MainAgentPicker onManage={onManageEngines} onReady={setEngineReady} value={selection} disabled={!!started} fail={setError} change={next => { setSelection(next); localStorage.setItem(selectionKey, JSON.stringify(next)); }} />
          {started ? <button className="office-action" type="button" onClick={stop} aria-label="停止回复"><Icon name="stop" size={14} /></button> :
            <button className="office-action" type="submit" disabled={!draft.trim() || !engineReady} title="发送（Ctrl / ⌘ + Enter）" aria-label="发送"><Icon name="send" size={15} /></button>}
        </footer>
      </form>
      <span className="office-meter" title={'会话累计估算费用（美元） · 最近一次请求的输入上下文 ' + (last?.used ?? '—') + ' / ' + (last?.capacity ?? '—') + ' tokens'}>费用 {cost} · 上下文 <i style={{ background: 'conic-gradient(currentColor ' + Math.min(100, percent ?? 0) + '%, var(--line) 0)' }} />{percent == null ? '—' : percent + '%'}</span>

      {error && <small role="alert">{error}</small>}
    </div>
  </Screen>;
}
