/**
 * 作用定位：可视窗口内的 Office 历史与流式正文，较早的轮次仅在进入窗口时读取。
 * 设计原因：按可视范围读取历史并复用正文渲染，减少长会话开销，不据展示状态推断执行完成。
 */
import { memo, useEffect, useState } from 'react';

import Markdown from 'react-markdown';

import remarkGfm from 'remark-gfm';

import type { OfficeMessage, OfficeActivity } from '../../bridge/contracts/discovery';

import { Icon } from '../../framework-ui/Icon';

const ReplyBody = memo(function ReplyBody({ text }: { text: string })
{
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>{alt}</span> }}>{text}</Markdown>;
});

function useDisclosure(key: string)
{
  const [choice, setChoice] = useState<boolean | undefined>(() => { const saved = sessionStorage.getItem(key); return saved === null ? undefined : saved === 'open'; });

  const toggle = (open: boolean) => { setChoice(open); sessionStorage.setItem(key, open ? 'open' : 'closed'); };

  return [choice, toggle] as const;
}

function ActivityRow({ step, group }: { step: OfficeActivity; group: string })
{
  const [open, toggle] = useDisclosure(group + '/' + step.id);

  if (step.input === undefined && step.result === undefined)
    return <li>{step.label}</li>;

  return <li><button type="button" aria-expanded={!!open} onClick={() => toggle(!open)}>{open ? '▾' : '▸'} {step.label}</button>
    {open && <div>{step.input !== undefined && <><b>输入</b><pre>{step.input}</pre></>}
      {step.result !== undefined && <><b>结果</b><pre>{step.result}</pre></>}</div>}</li>;
}

function WorkRecord({ steps, group, elapsed, live, model }: { steps: OfficeActivity[]; group: string; elapsed?: number; live?: boolean; model?: string })
{
  const [open, toggle] = useDisclosure(group);

  const visible = open ? steps : live && open === undefined ? steps.slice(-5) : [];

  return <>
    <section className="office-work-record">
      <button type="button" aria-expanded={!!open} onClick={() => toggle(!open)}>
        <Icon name="clock" size={13} /> {live ? '正在工作' : '已工作'} {Math.floor((elapsed ?? 0) / 1000)} 秒 {open ? '▾' : '▸'}
      </button>
      {visible.length > 0 && <ol>{visible.map(step => <ActivityRow key={step.id} group={group} step={step} />)}</ol>}
      {open && !steps.length && <p>本轮未保存步骤明细</p>}
      {open && model && <div>模型 · {model}</div>}
    </section>
    {steps.filter(step => step.alert).map(step => <p key={step.id} className="office-work-alert" role="alert">{step.label} · {step.alert}</p>)}
  </>;
}

export const Message = memo(function Message({ role, text, elapsed, workLog, model, live, messageId }: { role: OfficeMessage['role']; text: string; elapsed?: number; workLog?: OfficeActivity[]; model?: string; live?: boolean; messageId?: string })
{
  const group = 'office-work:' + (workLog?.[0]?.id ?? messageId);

  return <article className={'office-' + role}>{role === 'assistant' ? <>
    {elapsed !== undefined || live ? <WorkRecord key={group} group={group} steps={workLog ?? []} elapsed={elapsed} model={model} live={live} /> : <small>Office 主 Agent</small>}
    <ReplyBody text={text} />
  </> : text}</article>;
});

export function EarlierTurn({ project, session, file }: { project: string; session: string; file: string })
{
  const [messages, setMessages] = useState<OfficeMessage[]>();

  const [error, setError] = useState('');

  const [attempt, setAttempt] = useState(0);

  useEffect(() => { let active = true; window.desktopMenu.ReadOfficeTurn(project, session, file).then(result => { if (active) setMessages(result); }).catch(e => { if (active) setError(String(e)); }); return () => { active = false; }; }, [project, session, file, attempt]);

  if (error)
    return <p role="alert">{error} <button onClick={() => { setError(''); setAttempt(attempt + 1); }}>重试</button></p>;

  return messages ? <>{messages.map(message => <Message key={message.id} messageId={message.id} role={message.role} text={message.text} elapsed={message.metrics?.elapsed} workLog={message.workLog} model={message.metrics?.model} />)}</> : <p>正在读取对话…</p>;
}
