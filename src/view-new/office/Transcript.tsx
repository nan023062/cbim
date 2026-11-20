/** 可视窗口内的 Office 历史与流式正文，较早的轮次仅在进入窗口时读取。 */
import { memo, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { OfficeMessage } from '../../bridge/contracts/discovery';
import { Icon } from '../shared/Icon';

export const Message = memo(function Message({ message }: { message: OfficeMessage })
{
  const seconds = Math.floor((message.metrics?.elapsed ?? 0) / 1000);
  return <article className={'office-' + message.role}>{message.role === 'assistant' ? <>
    <small><Icon name="clock" size={13} />{message.metrics ? '已工作 ' + seconds + 's' : 'Office 主 Agent'}</small>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>{alt}</span> }}>{message.text}</Markdown>
  </> : message.text}</article>;
});

export function EarlierTurn({ project, session, file }: { project: string; session: string; file: string })
{
  const [messages, setMessages] = useState<OfficeMessage[]>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() =>
  {
    let active = true;
    window.desktopMenu.ReadOfficeTurn(project, session, file).then(result => { if (active) setMessages(result); })
      .catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [project, session, file, attempt]);
  if (error) return <p role="alert">{error} <button onClick={() => { setError(''); setAttempt(attempt + 1); }}>重试</button></p>;
  return messages ? <>{messages.map(message => <Message key={message.id} message={message} />)}</> : <p>正在读取对话…</p>;
}
