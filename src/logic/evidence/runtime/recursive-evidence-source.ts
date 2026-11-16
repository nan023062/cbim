/**
 * 作用定位：证据报告读取递归业务运行时，核对持久登记、原调用和固定 canonical 身份。
 * 设计原因：新子运行没有旧派工任务/信封；共享只读来源核验，不生成兼容任务或第二份运行状态。
 */
import { isDeepStrictEqual as equal } from 'node:util';
import { fail } from '../../../core/errors';
import { checkedAgentCallReference } from '../../agents/contracts';
import type { AgentBusinessRun } from '../../execution/rules/business-run';
import type { DispatchState } from '../../dispatch/rules/dispatch-storage';
import type { RunSummary } from '../../execution/rules/types';
import { preparedWorkflowContracts } from '../../tasks/rules/execution-context';

/** 只接受当前根/周期唯一登记；旧新来源冲突拒绝，不按最近运行或同名角色猜测。 */
export function recursiveEvidenceRun(state: DispatchState, workspaceId: string, rootSessionId: string, taskId: string, runId: string): AgentBusinessRun | undefined
{
  const matches = state.agentBusinessRuns?.filter(r => r.binding.workspaceId === workspaceId && r.binding.rootSessionId === rootSessionId && r.binding.taskId === taskId && r.binding.runId === runId) ?? [];
  if (!matches.length)
    return undefined;
  const run = matches[0];
  if (state.workspaceId !== workspaceId || matches.length !== 1 || state.runs?.some(r => r.binding.runId === runId) || state.graphs.some(g => g.tasks.some(t => t.taskId === taskId)) || (state.scopes?.filter(s => s.workspaceId === workspaceId && s.rootSessionId === rootSessionId && s.scopeId === run.scopeId).length ?? 0) !== 1)
    fail('EVIDENCE_SOURCE_IDENTITY', '递归运行的登记、周期或来源不唯一');
  return run;
}

/** 同时核对原生绑定和完整连续事件；active 登记不证明进程活跃，文件复核另要求真实终态与 closed。 */
export function recursiveEvidenceLogMatches(run: AgentBusinessRun, summary: RunSummary, root: string): boolean
{
  const b = run.binding,
    first = summary.events[0],
    bounds = summary.events.filter(e => e.type === 'session.bound'),
    terminal = summary.events.filter(e => e.type === 'run.settled' || e.type === 'run.interrupted');
  try
  {
    const ref = checkedAgentCallReference(first?.data.agentCall, summary.task, summary.runId);
    return !!ref && equal(ref, run.parent) && summary.runId === b.runId && summary.task.workspaceId === b.workspaceId && summary.task.root === root && summary.task.taskId === b.taskId && summary.task.agentId === b.agentId && equal(summary.task.moduleIds, run.prepared.modules.map(m => m.binding.moduleId)) && equal(summary.task.ownerBinding, run.prepared.memberContext?.binding) && !summary.task.fallbackBinding && !summary.conversationBinding && equal(summary.memberBinding, b) && first?.type === 'run.started' && first.data.executionModel === 'agent-tools-v1' && equal(first.data.memberBinding, b) && equal(first.data.task, summary.task) && equal(first.data.workflowContracts ?? [], preparedWorkflowContracts(run.prepared)) && typeof first.data.nativeSessionId === 'string' && !!first.data.nativeSessionId && typeof summary.sessionFile === 'string' && !!summary.sessionFile && bounds.length > 0 && bounds.every(e => e.data.sessionId === first.data.nativeSessionId && e.data.sessionFile === summary.sessionFile) && summary.events.every((e, i) => e.version === 1 && e.seq === i + 1 && e.workspaceId === b.workspaceId && e.taskId === b.taskId && e.runId === b.runId) && summary.events.filter(e => e.type === 'run.started').length === 1 && terminal.length <= 1 && (!terminal.length || summary.events.every(e => e.seq <= terminal[0].seq || e.type === 'run.stop_requested'));
  }
  catch
  {
    return false
  }
}
