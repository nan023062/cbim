/** 当前 Office 的对话记录、会话选择与消息输入。宿主确认保存后才显示消息。 */
import { useEffect, useRef, useState } from 'react';
import type { OfficeConversation, OfficeMessage, ProjectItem } from '../../bridge/contracts/discovery';
import { Icon } from '../shared/Icon';
import './office.css';

interface Props {
  project: ProjectItem;
  conversation: OfficeConversation;
  draft: string;
  onDraft(text: string): void;
  onSaved(message: OfficeMessage): void;
  onSelect(id: string): void;
  onCreate(): void;
}
export function OfficeView({ project, conversation, draft, onDraft, onSaved, onSelect, onCreate }: Props)
{
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [conversation.messages.length]);
  async function submit()
  {
    if (sending || !draft.trim()) return;
    setSending(true);
    setError('');
    try {
      const message = await window.desktopMenu.sendOffice(project.id, conversation.id, draft);
      onSaved(message);
      onDraft('');
    } catch (e) { setError(String(e)); }
    finally { setSending(false); }
  }
  return <section className="office-chat" aria-label="Office 对话">
    <header><strong>Office 对话</strong><select aria-label="项目会话" value={conversation.id} onChange={e => onSelect(e.target.value)}>
      {conversation.sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
      <button onClick={onCreate} title="新建对话" aria-label="新建对话"><Icon name="plus" size={16} /></button></header>
    <div className="office-transcript" role="log" ref={log}>
      {!conversation.messages.length && <h2>在 {project.name} 中开始对话</h2>}
      {conversation.messages.map(m => <article key={m.id}><small>你 · {new Date(m.created).toLocaleTimeString()}</small><p>{m.text}</p></article>)}
    </div>
    <form onSubmit={e => { e.preventDefault(); void submit(); }}>
      <label htmlFor="office-message">任务目标或补充消息</label>
      <textarea id="office-message" rows={3} maxLength={32000} disabled={sending} value={draft} onChange={e => onDraft(e.target.value)}
        onKeyDown={e => { if (!e.nativeEvent.isComposing && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }} />
      <footer><small>主 Agent 尚未连接执行引擎，消息仅保存到此会话。</small><button disabled={sending || !draft.trim()}>{sending ? '保存中' : '保存消息'}</button></footer>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;
}
