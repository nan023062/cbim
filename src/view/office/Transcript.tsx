/**
 * 作用定位：可视窗口内的 Office 历史与流式正文，较早的轮次仅在进入窗口时读取。
 * 设计原因：按可视范围读取历史并复用正文渲染，减少长会话开销，不据展示状态推断执行完成。
 */
import { failureText, failureSummary, isAbortedReceipt } from '../../bridge/contracts/discovery';
import { Button, Icon, type IconName } from '../../framework-ui';
import { Children, isValidElement, memo, useEffect, useState } from 'react';

import Markdown from 'react-markdown';

import remarkGfm from 'remark-gfm';

import type { OfficeMessage, OfficeActivity } from '../../bridge/contracts/discovery';


/** 有些模型用标记为 Markdown 的围栏包住整份回复；仅解开完整文档外层。 */
function displayMarkdown(text: string): string
{
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = source.trim().split('\n');
  const opening = /^(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*$/i.exec(lines[0]);
  if (!opening) return source;
  const closing = new RegExp('^ {0,3}' + opening[1][0] + '{' + opening[1].length + ',}[ \\t]*$');
  const end = lines.findIndex((line, index) => index > 0 && closing.test(line));
  return end === lines.length - 1 ? lines.slice(1, end).join('\n') : source;
}

function ReplyMarkdown({ text, allowDetails = true }: { text: string; allowDetails?: boolean })
{
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    img: ({ alt }) => <span>{alt}</span>,
    table: ({ children }) => <div className="office-table-scroll" role="region" aria-label="表格" tabIndex={0}><table>{children}</table></div>,
    pre: ({ children }) => {
      const block = Children.toArray(children)[0];
      if (allowDetails && isValidElement<{ className?: string; children?: string }>(block) && block.props.className === 'language-details' && typeof block.props.children === 'string') {
        const [label, ...lines] = block.props.children.trimEnd().split('\n');
        if (label.trim() && lines.length)
          return <details className="office-reply-detail"><summary>{label}</summary><ReplyMarkdown text={lines.join('\n')} allowDetails={false} /></details>;
      }
      return <pre>{children}</pre>;
    },
  }}>{text}</Markdown>;
}

const ReplyBody = memo(function ReplyBody({ text }: { text: string })
{
  return <div className="office-prose"><ReplyMarkdown text={displayMarkdown(text)} /></div>;
});

function useDisclosure(key: string)
{
  const [choice, setChoice] = useState<boolean | undefined>(() => { const saved = sessionStorage.getItem(key); return saved === null ? undefined : saved === 'open'; });

  const toggle = (open: boolean) => { setChoice(open); sessionStorage.setItem(key, open ? 'open' : 'closed'); };

  return [choice, toggle] as const;
}

const toolIcons: Record<string, IconName> = {
  cbim_office_plan: 'brain', cbim_office_dispatch: 'teamDispatch', cbim_office_inspect: 'inspect',
  cbim_project_read: 'knowledge', cbim_project_write: 'edit',
  bash: 'terminal', read: 'knowledge', edit: 'edit', write: 'edit',
  glob: 'search', find: 'search', grep: 'search', ls: 'folder',
};

function eventIcon(step: OfficeActivity): IconName
{
  if (step.id.startsWith('receipt:')) return 'delivered';
  if (step.id.startsWith('task:')) {
    const icons: Record<string, IconName> = {waiting:'queued',queued:'queued',running:'running',completed:'success',blocked:'blocked',suspended:'pause',cancelled:'stopped'};
    return icons[step.id.split(':').at(-1) ?? ''] ?? 'task';
  }
  if (step.id.startsWith('tool:')) return toolIcons[step.label] ?? 'connector';
  return step.input ? 'notification' : 'workflow';
}

function eventSummary(step: OfficeActivity): string
{
  if (step.id.startsWith('receipt:')) return '收到' + (step.actor ?? '成员') + '回执 · ' + (step.summary ?? step.result ?? '');
  if (step.summary) return step.summary;
  if (!step.input) return step.label;
  try {
    const args = JSON.parse(step.input);
    const target = args.command ?? args.goal ?? args.path ?? args.file_path ?? args.pattern ?? args.resource;
    return step.label + ' · ' + (typeof target === 'string' ? target : step.input);
  } catch { return step.label + ' · ' + step.input; }
}

/** 历史计划保留原文与换行，仅给约定的段落标题附上语义图标。 */
function PlanBody({ text }: { text?: string })
{
  const labels: Record<string, { title: string; icon: IconName }> = {
    '业务范围': { title: '匹配业务工作区', icon: 'workspaceSearch' },
    '岗位分工': { title: '匹配团队和执行者', icon: 'organizationSearch' },
    '目的': { title: '目的', icon: 'goal' },
    '前置': { title: '前置', icon: 'workflow' },
  };
  return <div className="office-plan-body">{text?.split('\n').map((line, index) => {
    const label = line.split('：', 1)[0];
    const field = line.includes('：') && Object.hasOwn(labels, label) ? labels[label] : undefined;
    return <div className="office-plan-line" key={index}>{field ? <><Icon name={field.icon} size={16} />{field.title}{line.slice(label.length)}</> : line || '\u00a0'}</div>;
  })}</div>;
}

function ActivityRow({ step, live }: { step: OfficeActivity; live?: boolean })
{
  const plan = step.id.startsWith('plan:');
  const receipt = step.id.startsWith('receipt:');
  const dispatch = step.label === 'cbim_office_dispatch';
  const broadcast = step.id.startsWith('broadcast:');
  const team = plan || receipt || dispatch || broadcast;
  const running = live && step.toolState === 'running' && !step.alert;
  const returned = step.toolState === 'returned' || step.id.startsWith('receipt:') || (step.id.startsWith('tool:') && step.toolState === undefined && step.result !== undefined);
  const title = eventSummary(step).replace(/\s+/g, ' ').trim();
  const reason = step.alert === step.label + '执行失败' ? failureText(step.result) || '工具未返回具体原因' : step.alert;
  const cancelled = !!step.cancelSource || (!!reason && isAbortedReceipt(reason));
  const error = cancelled ? '已中止 · ' + (step.cancelSource ?? '来源未知') : reason ? '失败 · ' + failureSummary(reason) : undefined;
  return <details open={plan || undefined} className={'office-event' + (team ? ' office-team-event' : '') + (error ? ' office-work-alert' : '')}>
    <summary>{error ? <Icon name={cancelled ? 'stopped' : 'failed'} size={16} label={cancelled ? '已中止' : '执行失败'} /> : running ? <Icon name="spinner" motion="rotate" tone="warning" size={16} label="正在执行" />
      : returned ? <Icon name="check" size={16} label="已收到回执" /> : team ? <span /> : <Icon name={eventIcon(step)} size={16} />}
      <span className="office-event-copy">{team && <b className="office-team-route"><Icon name={broadcast ? 'notification' : plan ? 'brain' : receipt ? 'teamReceipt' : 'teamDispatch'} size={16} />{broadcast ? '环境广播' : plan ? '分析任务' : receipt ? '任务回执' : '派发任务'} · {step.actor}{step.recipient && ' → ' + step.recipient}</b>}
        {!!step.issues?.length && <small>过程反馈 · {step.issues.length} 项</small>}
        {step.workspace && <small><Icon name="folder" size={16} />工作区 · {step.workspace}</small>}
        <span>{!team && step.actor && !step.id.startsWith('receipt:') ? step.actor + ' · ' : ''}{team && step.summary ? step.summary : title}</span>
        {error && <strong>{error}</strong>}</span>
      <Icon name="chevronRight" size={14} /></summary>
    <div className="office-event-detail">{plan ? <PlanBody text={step.input} /> : <><b>{step.label}</b>
      {!!step.issues?.length && <><b>成员过程反馈</b><ul>{step.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></>}
      {step.actor && <div>执行人 · {step.actor}</div>}
      {reason && <><b>{cancelled ? '中止详情' : '失败原因'}</b><pre>{reason}</pre></>}
      {step.input !== undefined && <><b>输入</b><pre>{step.input}</pre></>}
      {step.result !== undefined && <><b>结果</b><pre>{step.result}</pre></>}
    </>}</div></details>;
}

function WorkRecord({ steps, group, elapsed, live, model }: { steps: OfficeActivity[]; group: string; elapsed?: number; live?: boolean; model?: string })
{
  const [open, toggle] = useDisclosure(group);

  const visible = steps.filter((step, index) => open || step.id.startsWith('plan:') || step.recipient || step.label === 'cbim_office_dispatch' || step.id.startsWith('receipt:') || (live && open === undefined && (step.toolState === 'running' || index >= steps.length - 5)));
  const seconds = Math.floor((elapsed ?? 0) / 1000);
  const duration = seconds >= 60 ? Math.floor(seconds / 60) + '分' + seconds % 60 + '秒' : seconds + '秒';

  return <>
    <section className="office-work-record">
      <Button type="button" aria-expanded={!!open} onClick={() => toggle(!open)}>
        <Icon name="clock" size={14} /> {live ? '正在工作' : '已工作'}{elapsed !== undefined && ' ' + duration}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
      </Button>
      {visible.length > 0 && <ol>{visible.map(step => <li key={step.id}><ActivityRow step={step} live={live} /></li>)}</ol>}
      {open && !steps.length && <p>本轮未保存步骤明细</p>}
      {open && model && <div>模型 · {model}</div>}
    </section>
    {steps.filter(step => step.alert && !visible.includes(step)).map(step => <ActivityRow key={step.id} step={step} />)}
  </>;
}

export const Message = memo(function Message({ role, text, elapsed, workLog, model, live, messageId }: { role: OfficeMessage['role']; text: string; elapsed?: number; workLog?: OfficeActivity[]; model?: string; live?: boolean; messageId?: string })
{
  const group = 'office-work:' + (workLog?.[0]?.id ?? messageId);

  return <article className={'office-' + role}>{role === 'assistant' ? <>
    {text && <ReplyBody text={text} />}
    {(elapsed !== undefined || live || !!workLog?.length) && <WorkRecord key={group} group={group} steps={workLog ?? []} elapsed={elapsed} model={model} live={live} />}
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
