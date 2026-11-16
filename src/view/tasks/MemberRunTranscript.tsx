/**
 * 作用定位：以执行 Agent 身份连续显示调用方输入、公开输出与工具过程，兼容旧成员卡片及任务详情。
 * 设计原因：工具与正文按原事件顺序展示，Agent 调用详情按需读取；输入只来自调用方，私有推理和用户直发不进入此通道。
 */
import type { RunSummary } from '../../bridge/contracts/execution';

import { useEffect, useState } from 'react';

import { transcript } from '../execution-view/transcript';

import { MarkdownMessage } from '../execution-view/MarkdownMessage';

import { WorkStatus } from '../execution-view/WorkStatus';

import { MemberProgressSummary } from './MemberProgressSummary';

import { ToolTimeline } from '../execution-view/ToolTimeline';

import { AgentCallDetails } from '../execution-view/AgentCallDetails';

/**
 * 调用方须传入后端已筛选的公开投影；本组件负责排版，不承担凭据脱敏。
 * 流式 delta 由 transcript 合并，最终 message 替换暂态正文；compact 只缩短展示，不改变事件读取范围。
 */
export function MemberRunTranscript({ run, workspaceId, memberName, compact = false, active = true }: { run: RunSummary; workspaceId: string; memberName: string; compact?: boolean; active?: boolean })
{
  const [now, setNow] = useState(Date.now());

  useEffect(() => { if (run.status !== 'running' || !active) return; setNow(Date.now()); const timer = setInterval(() => { if (document.visibilityState !== 'hidden') setNow(Date.now()) }, 1000); return () => clearInterval(timer) }, [run.status, active]);

  const messages = transcript(run);

  const shown = compact ? messages.filter(item => item.kind === 'assistant' || item.kind === 'error').slice(-1) : messages;

  if (!run.events.length)

    return <p className="member-muted" role="status">{run.status === 'running' ? '正在准备成员执行，尚未收到公开运行事件。' : '本轮没有可展示的公开运行记录。'}</p>;

  return <div className={'member-run-transcript' + (compact ? ' compact' : '')}>
    <WorkStatus run={run} now={now} inline />
    <MemberProgressSummary run={run} compact={compact} />
    {shown.map(item => item.kind === 'tool' && item.toolCallId ? <ToolTimeline key={item.id} run={run} toolCallId={item.toolCallId} renderDetails={id => <AgentCallDetails parentRun={run} toolCallId={id} active={active} />} /> : <article className={'member-message ' + item.kind} key={item.id} aria-label={item.kind === 'error' ? '成员执行错误' : item.kind === 'user' ? '调用方指令' : memberName + '的公开输出'}>
      <div className="member-message-label">{item.kind === 'error' ? '执行错误' : item.kind === 'user' ? '调用方指令' : memberName}{item.pending && <span> · 正在输出</span>}</div>
      <MarkdownMessage text={item.text} streaming={item.pending} workspaceId={workspaceId} />
    </article>)}
    {!shown.length && <p className="member-muted">{run.status === 'running' ? '等待成员产生公开回复，可展开工作记录查看工具状态。' : '本轮未产生公开回复。'}</p>}
  </div>;
}
