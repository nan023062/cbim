import { expect, it, vi } from 'vitest';
import { Agent, runAgentTask, type AgentTaskExecution } from '../../../../src/framework/cability/agent';
import { OfficeDispatcher } from '../../../../src/framework/office';

it.each([true, false])('父 Agent 仅在子运行成功后汇总，completed=%s', async completed =>
{
  const caller = new Agent({ id: 'parent', name: 'Parent', instructions: '' }, { workspaceId: 'w', taskId: 'parent' });
  const close = vi.fn(async () => {});
  const release = vi.fn();
  const prepare = vi.fn(async () => ({
    Start: async () => ({ done: Promise.resolve('child result') }),
    Settle: async (summary: string) => ({ completed, summary, value: summary }),
    Close: close, Release: release
  }));
  const dispatcher = new OfficeDispatcher(caller.conversation, prepare, vi.fn(), new AbortController().signal);
  const execution: AgentTaskExecution = {
    Analyze: async () => 'step',
    Decompose: async () => [{ kind: 'forward', memberId: 'worker', task: 'step' }],
    Execute: async () => { throw Error('unexpected local execution') },
    Summarize: vi.fn(async (_, __, results) => results[0].output)
  };
  const run = runAgentTask(caller, 'task', execution, dispatcher);
  if (completed) await expect(run).resolves.toMatchObject({ status: 'completed', conclusion: 'child result' });
  else { await expect(run).rejects.toThrow('child result'); expect(execution.Summarize).not.toHaveBeenCalled() }
  expect(prepare).toHaveBeenCalledWith({kind:'forward', memberId:'worker', task:'step'});
  expect(close).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});
