/** Office 消息记录与贴底输入栏。执行状态由当前会话的模型流驱动。 */
import { useEffect, useRef, useState } from 'react';

import Markdown from 'react-markdown';

import remarkGfm from 'remark-gfm';

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

  onSelect(id: string): void;

  onManageEngines(): void;

  onCreate(): void;
}

function duration(ms: number)
{
  const s = Math.floor(ms / 1000);

  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + s % 60 + 's';
}

export function OfficeView({ project, conversation, draft, onDraft, onSaved, onSelect, onCreate, onManageEngines }: Props)
{
  const [started, setStarted] = useState(0);

  const [now, setNow] = useState(0);

  const [sample, setSample] = useState<OfficeProgress>();

  const [error, setError] = useState('');

  const [engineReady, setEngineReady] = useState(false);

  const selectionKey = 'office-main-agent:' + conversation.id;

  const [selection, setSelection] = useState<OfficeSelection>(() => { try { const stored = JSON.parse(localStorage.getItem(selectionKey) || '{}'); return { ...stored, engine: stored?.engine || 'codex' }; } catch { return { engine: 'codex' }; } });

  const pref = 'office-permission:' + conversation.id;

  const [permission, setPermission] = useState<'read' | 'ask' | 'execute'>(() => { const value = localStorage.getItem(pref); return value === 'read' || value === 'execute' ? value : 'ask'; });

  const log = useRef<HTMLDivElement>(null);

  const picker = useRef<HTMLInputElement>(null);

  const stopped = useRef(false);

  useEffect(() => window.desktopMenu.WatchOffice(event => { if (event.session === conversation.id && event.project === project.id) setSample(event); }), [conversation.id, project.id]);

  useEffect(() => { if (!started) return; const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, [started]);

  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [conversation.messages.length, started]);

  const replies = conversation.messages.filter(m => m.role === 'assistant');

  const last = replies.at(-1)?.metrics;

  const elapsed = replies.reduce((n, m) => n + (m.metrics?.elapsed ?? 0), 0) + (started ? Math.max(0, now - started) : 0);

  const cost = replies.length && replies.every(m => m.metrics?.cost != null) ? '$' + replies.reduce((n, m) => n + m.metrics!.cost!, 0).toFixed(5) : '—';

  const percent = last?.used != null && last.capacity ? Math.round(100 * last.used / last.capacity) : undefined;

  async function submit()
  {
    if (started || !draft.trim() || !engineReady || !selection.engine || !selection.profileId || !selection.modelId)
      return;

    stopped.current = false;

    setSample(undefined);

    setNow(Date.now());

    setStarted(Date.now());

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
      setStarted(0);
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

  return <section className="office-chat" aria-label="Office 对话">
    <header><strong>Office 对话</strong><select aria-label="项目会话" value={conversation.id} onChange={e => onSelect(e.target.value)}>
      {conversation.sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
      <button onClick={onCreate} title="新建对话" aria-label="新建对话"><Icon name="plus" size={16} /></button></header>
    <div className="office-transcript" role="log" ref={log}><div className="office-column">
      {!conversation.messages.length && !started && <h2>在 {project.name} 中开始对话</h2>}
      {conversation.messages.map(m => <article key={m.id} className={'office-' + m.role}>
        {m.role === 'assistant' ? <><small><Icon name="clock" size={13} /> {m.metrics ? '已工作 ' + duration(m.metrics.elapsed) : 'Office 主 Agent'}</small><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>{alt}</span> }}>{m.text}</Markdown></> : m.text}
      </article>)}
      {!!started && <article className="office-user">{draft}</article>}
    </div></div>
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
  </section>;
}
