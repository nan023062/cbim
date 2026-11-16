/**
 * 作用定位：按真实 Agent 工具调用引用读取执行对话，并在同一种工具轨道中逐次展开子调用。
 * 设计原因：调用详情独立于旧派发图；每次只读一个明确 run，模态详情在手机保持全宽，关闭返回原工具与焦点。
 * 职责边界：展开与重试仅查询 loop.inspect；核对父调用和子日志身份，不推测关系、不执行工具、不提供用户直发框。
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { AgentCallReference, RunSummary } from '../../bridge/contracts/execution';
import { transcript } from './transcript';
import { MarkdownMessage } from './MarkdownMessage';
import { ToolTimeline } from './ToolTimeline';
import { Icon } from '../components/Icon';
import './agent-call-details.css';

const fields = ['version', 'workspaceId', 'callerTaskId', 'callerRunId', 'toolCallId', 'taskId', 'runId'] as const;

function record(value: unknown): Record<string, unknown> | undefined
{
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function reference(value: unknown): AgentCallReference | undefined
{
  const item = record(value);
  if (!item || item.version !== 1 || fields.slice(1).some(key => typeof item[key] !== 'string' || !item[key] || String(item[key]).length > 512))
    return;
  return item as unknown as AgentCallReference;
}

function resultReference(value: unknown): unknown
{
  const result = record(value);
  if (!result)
    return;
  if (result.agentCall)
    return result.agentCall;
  if (Array.isArray(result.content))
    for (const item of result.content)
    {
      if (item?.type === 'text' && typeof item.text === 'string')
        try
        {
          const parsed = record(JSON.parse(item.text));
          if (parsed?.agentCall)
            return parsed.agentCall
        }
        catch
        {
          /* 原始非 JSON 输出仍由工具轨道展示。 */
        }
    }
}

function sameReference(left: AgentCallReference, right: AgentCallReference)
{
  return fields.every(key => left[key] === right[key])
}

/** 只接受原工具的宿主事件引用；互相冲突的记录不任选一个子运行。 */
export function agentCallReference(run: RunSummary, toolCallId: string): AgentCallReference | undefined
{
  let selected: AgentCallReference | undefined;
  for (const event of run.events)
  {
    if (!['tool.updated', 'tool.finished'].includes(event.type) || event.data.id !== toolCallId || event.data.name !== 'cbim_agent_call')
      continue;
    if (event.workspaceId !== run.task.workspaceId || event.taskId !== run.task.taskId || event.runId !== run.runId)
      return;
    const raw = event.data.agentCall ?? resultReference(event.data.result);
    if (raw === undefined)
      continue;
    const current = reference(raw);
    if (!current || current.workspaceId !== run.task.workspaceId || current.callerTaskId !== run.task.taskId || current.callerRunId !== run.runId || current.toolCallId !== toolCallId || selected && !sameReference(selected, current))
      return;
    selected = current;
  }
  return selected;
}

/** 展示前复核子日志实际起始绑定；查询成功不代表读取的是此调用的记录。 */
export function assertAgentCallRun(call: AgentCallReference, run: RunSummary): void
{
  const start = run.events[0],
    bound = reference(start?.data.agentCall);
  if (run.task.workspaceId !== call.workspaceId || run.task.taskId !== call.taskId || run.runId !== call.runId || start?.type !== 'run.started' || start.workspaceId !== call.workspaceId || start.taskId !== call.taskId || start.runId !== call.runId || !bound || !sameReference(call, bound))
    throw Error('执行对话身份与原工具调用不一致，未展示该记录。');
}

/** 对话输入仅来自调用方；所有状态与正文取自核验后的日志，读取失败不提供执行重试。 */
export function AgentCallDetails({ parentRun, toolCallId, active = true }: { parentRun: RunSummary; toolCallId: string; active?: boolean })
{
  const call = agentCallReference(parentRun, toolCallId),
    key = call ? JSON.stringify(fields.map(field => call[field])) : '';
  const [open, setOpen] = useState(false),
    [snapshot, setSnapshot] = useState<
      {
        key: string;

        run: RunSummary
      }>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    titleId = useId();
  const run = snapshot?.key === key ? snapshot.run : undefined;
  useEffect(() =>
  {
    if (!open || !active || !call)
      return;
    setError('');
    let cancelled = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () =>
    {
      if (document.visibilityState === 'hidden')
      {
        timer = setTimeout(() => void read(), 1000);
        return
      }
      setLoading(true);
      try
      {
        const value = await window.cbim.call('loop.inspect', { id: call.workspaceId, taskId: call.taskId, runId: call.runId });
        assertAgentCallRun(call, value);
        if (cancelled)
          return;
        setSnapshot({ key, run: value });
        setError('');
        if (value.status === 'running')
          timer = setTimeout(() => void read(), 1000);
      }
      catch (reason)
      {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : '无法读取执行对话，请重试读取。')
      }
      finally
      {
        if (!cancelled)
          setLoading(false)
      }
    };
    void read();
    return () =>
    {
      cancelled = true;
      if (timer)
        clearTimeout(timer)
    };
  }, [open, active, key, retry]);
  useEffect(() =>
  {
    const node = dialog.current;
    if (open && active && call)
    {
      if (!node?.open)
        node?.showModal()
    }
    else if (node?.open)
      node.close();
  }, [open, active, key]);
  function close()
  {
    setOpen(false);
    dialog.current?.close();
    trigger.current?.focus()
  }
  if (!call)
    return null;
  const items = run ? transcript(run) : [];
  return <div className="agent-call-details">
    <button ref={trigger} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="inspect" size={16} />查看执行对话</button>
    <dialog ref={dialog} className="agent-call-dialog" aria-labelledby={titleId} onCancel={event =>
    {
      event.preventDefault();
      close()
    }}>
      <header><h2 id={titleId}>Agent 执行对话</h2><button onClick={close}><Icon name="undo" size={16} />返回调用方</button></header>
      <p className="agent-call-origin">只读 · 指令来自调用方 Agent · 结果返回调用方</p>
      {loading && !run && <p role="status">正在读取执行对话…</p>}
      {error && <p role="alert">{error} {run && '以下保留最近一次核实的记录。'}<button disabled={loading} onClick={() => setRetry(value => value + 1)}><Icon name="retry" size={16} />重试读取</button></p>}
      {run && <div className="agent-call-stream" aria-label="执行 Agent 对话记录">
        <p role="status">{{ running: '执行中', completed: '本轮结束', failed: '执行失败', cancelled: '已停止', interrupted: '执行中断' }[run.status]}</p>
        {items.map(item => item.kind === 'tool' && item.toolCallId ? <ToolTimeline key={item.id} run={run} toolCallId={item.toolCallId} renderDetails={id => <AgentCallDetails parentRun={run} toolCallId={id} active={active && open} />} /> : <article key={item.id} className={'agent-call-message ' + item.kind}><strong>{item.kind === 'user' ? '调用方指令' : item.kind === 'assistant' ? '执行 Agent' : item.kind === 'error' ? '执行错误' : '运行记录'}</strong><MarkdownMessage text={item.text} streaming={item.pending} workspaceId={call.workspaceId} /></article>)}
        {!items.length && <p>本轮尚无公开消息。</p>}
      </div>}
    </dialog>
  </div>;
}
