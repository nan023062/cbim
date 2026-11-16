/**
 * 作用定位：将递归业务的启动意图和实际排空提交到已有工作区事务日志。
 * 设计原因：受控文件与隔离报告复用同一运行身份；重启只读原事实，不创建派发任务或自动补结算。
 */
import { isDeepStrictEqual as equal } from 'node:util';
import { fail } from '../../../core/errors';
import type { DispatchStore } from '../../dispatch/rules/dispatch-storage';
import type { AgentBusinessRun } from '../rules/business-run';
import type { AgentCallReference } from '../../agents/contracts';
import type { RunSummary } from '../rules/types';
import { agentBusinessRunCommand } from '../rules/business-run-invariants';

export class AgentBusinessRuns
{
  constructor(private readonly store: DispatchStore, private readonly assertCurrent: () => void, private readonly inspect: (taskId: string, runId: string) => Promise<RunSummary>)
  {
  }

  /** 从本调用向根读取实际父工具及原日志；不接受模型提供来源链。 */
  async start(value: Omit<AgentBusinessRun, 'lineage'>): Promise<void>
  {
    this.assertCurrent();
    const frozen = structuredClone(value),
      lineage: AgentCallReference[] = [];
    let link = frozen.parent;
    while (true)
    {
      if (lineage.length >= 8 || lineage.some(item => item.runId === link.runId))
        fail('AGENT_RUN_IDENTITY', '调用来源链超限或循环');
      const summary = await this.inspect(link.callerTaskId, link.callerRunId),
        started = summary.events[0];
      if (summary.task.workspaceId !== frozen.binding.workspaceId || summary.task.taskId !== link.callerTaskId || summary.runId !== link.callerRunId || summary.events.some(e => e.type === 'run.settled' || e.type === 'run.interrupted') || summary.logIntegrity?.partialTail !== false || started?.data.executionModel !== 'agent-tools-v1')
        fail('AGENT_RUN_IDENTITY', '父调用日志无法核实');
      // 等待与恢复可以重复报告同一引用；只有首次带 limits 的绑定事件创建运行。
      const updates = summary.events.filter(e => e.type === 'tool.updated' && e.data.id === link.toolCallId && e.data.agentCall);
      const refs = updates.filter(e => e.data.limits && equal(e.data.agentCall, link));
      if (updates.some(e => !equal(e.data.agentCall, link)))
        fail('AGENT_RUN_IDENTITY', '父工具引用发生换绑');
      if (refs.length !== 1 || !summary.events.some(e => e.type === 'tool.allowed' && e.data.id === link.toolCallId && e.data.name === 'cbim_agent_call'))
        fail('AGENT_RUN_IDENTITY', '父调用缺少原工具授权及唯一引用');
      lineage.push(structuredClone(link));
      if (link.callerTaskId === frozen.binding.rootSessionId)
        break;
      if (!started.data.agentCall)
        fail('AGENT_RUN_IDENTITY', '父运行缺少根来源');
      link = started.data.agentCall as AgentCallReference;
    }
    const record: AgentBusinessRun = { ...frozen, lineage };
    await this.store.transact(agentBusinessRunCommand(record), async () =>
    {
      this.assertCurrent();
      return { agentBusinessRuns: [record], receipt: record }
    });
  }

  /** 仅实际 Runtime.close 成功后调用；保存未知保留准入，不重做执行。 */
  async close(value: Pick<AgentBusinessRun, 'binding' | 'parent' | 'scopeId'>): Promise<void>
  {
    const old = (await this.store.read()).agentBusinessRuns?.find(run => run.binding.runId === value.binding.runId);
    if (!old)
      return;
    if (!equal(old.binding, value.binding) || !equal(old.parent, value.parent) || old.scopeId !== value.scopeId)
      fail('AGENT_RUN_IDENTITY', '业务运行关闭身份不一致');
    if (old.status === 'closed')
      return;
    const closed: AgentBusinessRun = { ...old, status: 'closed', closedAt: new Date().toISOString() };
    await this.store.transact(agentBusinessRunCommand(closed), async () => ({ agentBusinessRuns: [closed], receipt: closed }));
  }
}
