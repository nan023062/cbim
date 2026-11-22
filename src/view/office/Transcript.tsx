/**
 * 作用定位：可视窗口内的 Office 历史与流式正文，较早的轮次仅在进入窗口时读取。
 * 设计原因：按可视范围读取历史并复用正文渲染，减少长会话开销，不据展示状态推断执行完成。
 */
import { Button, Icon } from '../../framework-ui';
import { memo, useEffect, useState } from 'react';

import Markdown from 'react-markdown';

import remarkGfm from 'remark-gfm';

import type { OfficeMessage, OfficeActivity } from '../../bridge/contracts/discovery';


const ReplyBody = memo(function ReplyBody({ text }: { text: string })
{
  return <div className="office-prose"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>{alt}</span> }}>{text}</Markdown></div>;
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

  return <li><Button type="button" aria-expanded={!!open} onClick={() => toggle(!open)}>{open ? '▾' : '▸'} {step.label}</Button>
    {open && <div>{step.input !== undefined && <><b>输入</b><pre>{step.input}</pre></>}
      {step.result !== undefined && <><b>结果</b><pre>{step.result}</pre></>}</div>}</li>;
}

/** 工具回执可能是纯文本，也可能在 content 文本块内包装结构化错误。 */
function failureText(value: unknown, depth = 0): string
{
  if (!value || depth > 12) return '';
  if (typeof value === 'string')
  {
    const text = value.trim();
    if (text.startsWith('{') || text.startsWith('['))
    {
      try { return failureText(JSON.parse(text), depth + 1); } catch { /* 普通命令输出 */ }
    }
    return text;
  }
  if (Array.isArray(value)) return value.map(item => failureText(item, depth + 1)).filter(Boolean).join('\n');
  if (typeof value !== 'object') return '';
  const result = value as Record<string, unknown>;
  for (const key of ['message', 'error', 'reason', 'stderr', 'content', 'text'])
  {
    const text = failureText(result[key], depth + 1);
    if (text) return text;
  }
  return '';
}

function FailureDetails({ step }: { step: OfficeActivity })
{
  const reason = step.alert === step.label + '执行失败'
    ? failureText(step.result) || '工具未返回具体原因'
    : step.alert || '工具未返回具体原因';
  const lines = reason.split(/\r?\n/).filter(Boolean);
  const summary = lines.find(line => /^fatal:|^error:/i.test(line)) || lines[0] || '工具执行失败';
  return <details className="office-work-alert">
    <summary>{step.label} · {summary.length > 150 ? summary.slice(0, 150) + '…' : summary}</summary>
    <pre>{reason}</pre>
    {step.result && step.result !== reason && <><b>工具回执</b><pre>{step.result}</pre></>}
  </details>;
}

function WorkRecord({ steps, group, elapsed, live, model }: { steps: OfficeActivity[]; group: string; elapsed?: number; live?: boolean; model?: string })
{
  const [open, toggle] = useDisclosure(group);

  const visible = open ? steps : live && open === undefined ? steps.slice(-5) : [];

  return <>
    <section className="office-work-record">
      <Button type="button" aria-expanded={!!open} onClick={() => toggle(!open)}>
        <Icon name="clock" size={13} /> {live ? '正在工作' : '已工作'} {Math.floor((elapsed ?? 0) / 1000)} 秒 {open ? '▾' : '▸'}
      </Button>
      {visible.length > 0 && <ol>{visible.map(step => <ActivityRow key={step.id} group={group} step={step} />)}</ol>}
      {open && !steps.length && <p>本轮未保存步骤明细</p>}
      {open && model && <div>模型 · {model}</div>}
    </section>
    {steps.filter(step => step.alert).map(step => <FailureDetails key={step.id} step={step} />)}
  </>;
}

export const Message = memo(function Message({ role, text, elapsed, workLog, model, live, messageId }: { role: OfficeMessage['role']; text: string; elapsed?: number; workLog?: OfficeActivity[]; model?: string; live?: boolean; messageId?: string })
{
  const group = 'office-work:' + (workLog?.[0]?.id ?? messageId);

  return <article className={'office-' + role}>{role === 'assistant' ? <>
    {elapsed !== undefined || live || workLog?.length ? <WorkRecord key={group} group={group} steps={workLog ?? []} elapsed={elapsed} model={model} live={live} /> : <small>Office 主 Agent</small>}
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
    return <p role="alert">{error} <Button onClick={() => { setError(''); setAttempt(attempt + 1); }}>重试</Button></p>;

  return messages ? <>{messages.map(message => <Message key={message.id} messageId={message.id} role={message.role} text={message.text} elapsed={message.metrics?.elapsed} workLog={message.workLog} model={message.metrics?.model} />)}</> : <p>正在读取对话…</p>;
}
